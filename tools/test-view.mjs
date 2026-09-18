/**
 * Browser check for the connected forest and underground views.
 *
 * The project's P0 work asks for the two views to be one continuous picture: a
 * crossing that takes the same wall-clock time whatever the frame rate, that
 * reverses cleanly at any point, that dissolves the soil's contents rather than
 * switching them off, and that re-frames itself when the window changes shape.
 *
 * The timing checks drive the frame loop by hand with a synthetic clock, so the
 * frame rate is an input to the test rather than something the software
 * renderer decides. A 4fps rise and a 30fps rise that both take one and a half
 * seconds is the property that matters, and it cannot be measured by watching a
 * machine whose frame times wander by a second. Everything else - the round
 * trip from a crown to its roots, the framing at three viewports, reduced
 * motion - runs against the ordinary loop.
 *
 *   npm run build && npm run test:view
 *   node tools/test-view.mjs --url http://127.0.0.1:4173   # use a server you started
 *   node tools/test-view.mjs --verbose                     # print every measurement
 *
 * `--url` is optional: without it the script starts `vite preview` on the build
 * in `dist/` and shuts it down again.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { collectProblems, launchBrowser } from './browser.mjs';

/** Must match CROSSING_SECONDS in `src/render/camera.ts`. */
const CROSSING_SECONDS = 1.5;
/** Frame rates the crossing is measured at. Below 10fps the old smoothing
 *  stretched the crossing in wall-clock time; 30fps is the ordinary case. */
const RATES = [30, 4];

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const verbose = args.includes('--verbose');
const port = Number(argOf('port', 4173));
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const url = argOf('url', `http://127.0.0.1:${port}`);

const results = [];
const failures = [];

function check(name, ok, detail) {
  if (ok) results.push(detail ? `${name} (${detail})` : name);
  else failures.push(detail ? `${name} — ${detail}` : name);
  return ok;
}

const note = (line) => {
  if (verbose) console.log(`    ${line}`);
};

// ---------------------------------------------------------------------------
// A preview server, unless one was supplied
// ---------------------------------------------------------------------------
let server = null;
if (!args.includes('--url')) {
  const entry = fileURLToPath(new URL('../dist/index.html', import.meta.url));
  if (!existsSync(entry)) {
    console.error('test-view: no build in dist/. Run `npm run build` first.');
    process.exit(1);
  }
  const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
  server = spawn(
    process.execPath,
    [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: repoRoot, stdio: 'ignore' }
  );
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      server.kill();
      console.error(`test-view: preview server never answered on ${url}`);
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const browser = await launchBrowser();
const problems = [];
const contexts = [];

async function open(path, viewport = { width: 1600, height: 1000 }, options = {}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    reducedMotion: options.reducedMotion ?? 'no-preference',
  });
  contexts.push(context);
  const page = await context.newPage();
  problems.push(...collectProblems(page));
  await page.goto(url + path, { waitUntil: 'commit', timeout: 120000 });
  await page.waitForFunction(() => Boolean(window.mycelia), null, { timeout: 120000 });
  return page;
}

const report = (page) => page.evaluate(() => window.mycelia.game.viewReport());

/** Wait for the page to be in a steady view state. */
const settleView = (page, timeout = 60000) =>
  page.waitForFunction(
    () => {
      const state = window.mycelia?.game?.viewReport?.();
      return Boolean(state) && !state.crossing;
    },
    null,
    { timeout, polling: 'raf' }
  );

/** Wait for the camera to finish gliding to its framing. */
const settleFraming = (page, timeout = 60000) =>
  page.waitForFunction(
    () => {
      const state = window.mycelia?.game?.viewReport?.();
      return Boolean(state) && Math.abs(state.distance - state.goalDistance) < 1;
    },
    null,
    { timeout, polling: 'raf' }
  );

const settle = async (page) => {
  await settleView(page);
  await settleFraming(page);
};

/**
 * Drive whole frames — simulation, overlays, renderer — from a synthetic clock,
 * so a crossing can be measured at a frame rate the test chooses. The real loop
 * is stopped first and stopped again after a frame, in case a callback was
 * already in flight, so nothing runs beside the driven frames.
 *
 * Each entry in `reversals` is a driven frame on which to click a control.
 */
async function drive(page, { entry, step, frames, reversals = [] }) {
  return page.evaluate(
    async ({ entry, step, frames, reversals }) => {
      const game = window.mycelia.game;
      game.stop();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      game.stop();
      // `start` re-bases the frame clock on the wall clock and `stop` cancels
      // the frame it scheduled, so the driven frames measure from here rather
      // than from however long ago the last real frame began.
      game.start();
      game.stop();
      const series = [];
      let now = game.lastFrame;
      document.querySelector(entry).click();
      for (let i = 0; i < frames; i++) {
        for (const reversal of reversals) {
          if (i === reversal.at) document.querySelector(reversal.entry).click();
        }
        now += step * 1000;
        game.frame(now);
        series.push({ frame: i, seconds: i * step, ...game.viewReport() });
      }
      game.start();
      return series;
    },
    { entry, step, frames, reversals }
  );
}

const firstSettled = (series) => series.findIndex((sample) => !sample.crossing);

/** What counts as a pop: the picture holding still while the overlays move. */
function movement(series) {
  let worstBlendStep = 0;
  let worstStrandStep = 0;
  let stillFrameJumps = 0;
  let backward = 0;
  for (let i = 1; i < series.length; i++) {
    const blendStep = series[i].blend - series[i - 1].blend;
    const strandStep = series[i].strandOpacity - series[i - 1].strandOpacity;
    worstBlendStep = Math.max(worstBlendStep, Math.abs(blendStep));
    worstStrandStep = Math.max(worstStrandStep, Math.abs(strandStep));
    if (Math.abs(blendStep) < 0.02 && Math.abs(strandStep) > 0.05) stillFrameJumps++;
    // The overlays come and go against the crossing: any frame where they move
    // *with* it has lost the plot.
    if (strandStep * blendStep > 0) backward++;
  }
  return { worstBlendStep, worstStrandStep, stillFrameJumps, backward };
}

// ---------------------------------------------------------------------------
// 1. A crossing is timed by the clock, not by the frame rate
// ---------------------------------------------------------------------------
{
  const page = await open('/?seed=raven-wood&view=underground', { width: 900, height: 560 });

  for (const rate of RATES) {
    const step = 1 / rate;
    const span = Math.ceil(CROSSING_SECONDS / step) + 4;

    const rise = await drive(page, { entry: '#view-forest', step, frames: span });
    const done = firstSettled(rise);
    // Frame `done` is the one that finished the crossing, so it is the
    // (done + 1)th frame of the crossing.
    const seconds = (done + 1) * step;
    note(`${rate}fps rise: settled on frame ${done} of ${(step * 1000).toFixed(0)}ms = ${seconds.toFixed(2)}s`);
    check(
      `a rise at ${rate}fps takes a wall-clock ${CROSSING_SECONDS}s`,
      seconds >= CROSSING_SECONDS && seconds <= CROSSING_SECONDS + 2 * step,
      `${done + 1} frames of ${(step * 1000).toFixed(0)}ms = ${seconds.toFixed(2)}s`
    );
    const top = rise[rise.length - 1];
    check(
      `the rise at ${rate}fps ends above the forest floor with nothing drawn through the soil`,
      top.view === 'forest' && top.blend === 1 && top.strandOpacity === 0,
      JSON.stringify({ view: top.view, blend: top.blend, strandOpacity: top.strandOpacity })
    );
    const up = movement(rise);
    check(
      `the soil's contents dissolve at ${rate}fps rather than switching off`,
      up.stillFrameJumps === 0 && up.worstStrandStep < 1 && up.backward === 0,
      `largest opacity step ${up.worstStrandStep.toFixed(3)}, ${up.stillFrameJumps} jumps at a still frame`
    );

    const fall = await drive(page, { entry: '#view-underground', step, frames: span });
    const landed = fall[firstSettled(fall)];
    check(
      `the descent at ${rate}fps restores the network at full strength`,
      landed.view === 'underground' && landed.blend === 0 && landed.strandOpacity === 1,
      JSON.stringify({ view: landed.view, blend: landed.blend, strandOpacity: landed.strandOpacity })
    );
  }

  // -------------------------------------------------------------------------
  // 2. A crossing reverses cleanly at any point
  // -------------------------------------------------------------------------
  {
    const step = 1 / 30;
    const half = Math.round(CROSSING_SECONDS / 2 / step);
    const series = await drive(page, {
      entry: '#view-forest',
      step,
      frames: half + Math.ceil(CROSSING_SECONDS / step) + 4,
      reversals: [{ at: half, entry: '#view-underground' }],
    });
    const done = firstSettled(series);
    let peak = 0;
    let peakFrame = 0;
    series.forEach((sample, i) => {
      if (sample.blend > peak) {
        peak = sample.blend;
        peakFrame = i;
      }
    });
    const backFrames = done - half;
    const expected = Math.round((CROSSING_SECONDS * peak) / step);
    note(`reversal: turned at blend ${peak.toFixed(2)} on frame ${peakFrame}, landed on frame ${done}`);
    check(
      'the turn happens at the frame it was asked for',
      peakFrame >= half - 1 && peakFrame <= half + 1,
      `peak at frame ${peakFrame}, reversal asked for at ${half}`
    );
    check(
      'reversing half way takes only the remaining part of the crossing',
      backFrames >= expected - 2 && backFrames <= expected + 3,
      `${backFrames} frames back from blend ${peak.toFixed(2)}, ${expected} expected`
    );
    check(
      'a reversal lands underground with the network whole',
      series[done].view === 'underground' && series[done].blend === 0 && series[done].strandOpacity === 1,
      JSON.stringify({ view: series[done].view, blend: series[done].blend, strandOpacity: series[done].strandOpacity })
    );
    const motion = movement(series);
    check(
      'the reversal never jumps the picture',
      motion.worstBlendStep < 0.1 && motion.worstStrandStep < 0.2 && motion.stillFrameJumps === 0,
      `largest blend step ${motion.worstBlendStep.toFixed(3)}, largest opacity step ${motion.worstStrandStep.toFixed(3)}`
    );
  }

  // A player who changes their mind twice in a fraction of a second gets a
  // crossing that still runs on the clock, with a floor so it is neither a
  // flicker nor a stall.
  {
    const step = 1 / 30;
    const series = await drive(page, {
      entry: '#view-forest',
      step,
      frames: Math.ceil(CROSSING_SECONDS / step) + 20,
      reversals: [
        { at: 3, entry: '#view-underground' },
        { at: 12, entry: '#view-forest' },
      ],
    });
    const done = firstSettled(series);
    const motion = movement(series);
    note(`double reversal: settled on frame ${done} of ${(step * 1000).toFixed(0)}ms`);
    check(
      'changing your mind twice still lands in the forest',
      series[done].view === 'forest' && series[done].blend === 1 && series[done].strandOpacity === 0,
      JSON.stringify({ view: series[done].view, blend: series[done].blend, strandOpacity: series[done].strandOpacity })
    );
    check(
      'a double reversal neither flickers nor stalls',
      (done + 1) * step <= CROSSING_SECONDS + 20 * step && motion.worstBlendStep < 0.1 && motion.stillFrameJumps === 0,
      `${done + 1} frames, largest blend step ${motion.worstBlendStep.toFixed(3)}`
    );
  }

  // -------------------------------------------------------------------------
  // 3. The same crown is followed down to its roots and back
  // -------------------------------------------------------------------------
  {
    const selected = await page.evaluate(() => {
      const select = document.querySelector('#forest-tree');
      const option = [...select.options].find((entry) => entry.value !== '');
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return Number(option.value);
    });
    await page.click('#view-forest');
    await settle(page);
    await page.click('#descend-tree');
    await settle(page);
    // Descending from a crown must land on one of that tree's own root tips,
    // wherever the rig chose to stand off from it.
    const offsets = await page.evaluate((id) => {
      const game = window.mycelia.game;
      const state = game.viewReport();
      const tree = game.sim.world.trees.find((entry) => entry.id === id);
      const { halfWidth, halfHeight } = state.mount;
      return tree.rootTips.map((tip) =>
        Math.hypot(state.target.x - (tip.gx - halfWidth + 8), state.target.y - (halfHeight - tip.gy))
      );
    }, selected);
    const offset = Math.min(...offsets);
    check(
      'following a crown descends to that tree\u2019s own root',
      offset < 1.5,
      `camera landed ${offset.toFixed(2)} world units from the root`
    );
    await page.click('#view-forest');
    await settle(page);
    const returned = await report(page);
    check(
      'and rising returns to the forest above that tree',
      returned.view === 'forest' && returned.blend === 1,
      JSON.stringify({ view: returned.view, blend: returned.blend })
    );
  }

  // -------------------------------------------------------------------------
  // 4. A live crossing under the real renderer, frame hitches included
  // -------------------------------------------------------------------------
  {
    const live = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const game = window.mycelia.game;
          const samples = [];
          let previous = performance.now();
          const tick = () => {
            const now = performance.now();
            const state = game.viewReport();
            samples.push({ frame: samples.length, gap: now - previous, ...state });
            previous = now;
            if (state.crossing) requestAnimationFrame(tick);
            else resolve(samples);
          };
          document.querySelector('#view-underground').click();
          requestAnimationFrame(tick);
        })
    );
    const crossing = live.filter((sample) => sample.crossing);
    const gaps = crossing.map((sample) => sample.gap);
    const worst = Math.max(...gaps, 0);
    const motion = movement(live);
    // The rig's own accounting of the crossing, bracketed by the frame that
    // ended it: the crossing must have run its full budget in wall-clock time,
    // however many frames that took.
    const last = crossing[crossing.length - 1];
    const closing = live[last.frame + 1] ?? { gap: worst };
    const spent = last.crossingElapsed;
    const ceiling = last.crossingElapsed + closing.gap / 1000;
    note(
      `live crossing: ${crossing.length} frames, ${spent.toFixed(2)}s of ${last.crossingDuration.toFixed(2)}s spent, worst frame ${Math.round(worst)}ms`
    );
    const landed = await report(page);
    check(
      'a live crossing spends its wall-clock budget through the frame hitches',
      spent < CROSSING_SECONDS && ceiling >= CROSSING_SECONDS - 0.001,
      `${spent.toFixed(2)}-${ceiling.toFixed(2)}s over ${crossing.length} frames, worst frame ${Math.round(worst)}ms`
    );
    check(
      'a live crossing lands underground with the network whole',
      landed.view === 'underground' && landed.blend === 0 && landed.strandOpacity === 1,
      JSON.stringify({ view: landed.view, blend: landed.blend, strandOpacity: landed.strandOpacity })
    );
    check(
      'a live crossing never pops the strands while the picture holds still',
      motion.stillFrameJumps === 0,
      `${motion.stillFrameJumps} jumps at a still frame`
    );
  }

  await contexts.pop().close();
}

// ---------------------------------------------------------------------------
// 5. A viewport change re-frames the active view
// ---------------------------------------------------------------------------
{
  const page = await open('/?seed=raven-wood&view=underground');

  const framed = () =>
    page.evaluate(() => {
      const camera = window.mycelia.game.stage.rig.camera;
      camera.updateMatrixWorld();
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      const apply = (m, x, y, z, w) => [
        m[0] * x + m[4] * y + m[8] * z + m[12] * w,
        m[1] * x + m[5] * y + m[9] * z + m[13] * w,
        m[2] * x + m[6] * y + m[10] * z + m[14] * w,
        m[3] * x + m[7] * y + m[11] * z + m[15] * w,
      ];
      const project = (x, y, z) => {
        const view = apply(camera.matrixWorldInverse.elements, x, y, z, 1);
        const clip = apply(camera.projectionMatrix.elements, view[0], view[1], view[2], view[3]);
        return [clip[0] / clip[3], clip[1] / clip[3]];
      };
      const state = window.mycelia.game.viewReport();
      const { halfWidth: hw, halfHeight: hh } = state.mount;
      return {
        view: state.view,
        distance: state.distance,
        aspect: state.aspect,
        auto: state.autoFraming,
        corners: [project(-hw, hh, 0), project(hw, hh, 0), project(-hw, -hh, 0), project(hw, -hh, 0)],
        crowns: window.mycelia.game.surface.trees
          .map((entry) => window.mycelia.game.surface.crownPosition(entry.tree.id))
          .map((crown) => (crown ? project(crown.x, crown.y, crown.z) : null))
          .filter(Boolean),
      };
    });

  const inside = (points, limit) => points.every(([x, y]) => Math.abs(x) <= limit && Math.abs(y) <= limit);
  const sizes = ['1600x1000', '1366x768', '390x844'];
  const distances = [];

  for (const size of sizes) {
    const [width, height] = size.split('x').map(Number);
    await page.setViewportSize({ width, height });
    // A resize is a request to the window server, and the game only sees it when
    // the event arrives: wait for the rig to be framing the new aspect before
    // judging the framing that follows from it.
    await page.waitForFunction(
      ([w, h]) => {
        const state = window.mycelia?.game?.viewReport?.();
        return Boolean(state) && Math.abs(state.aspect - w / h) < 0.01;
      },
      [width, height],
      { timeout: 30000, polling: 'raf' }
    );
    await settle(page);
    const frame = await framed();
    distances.push(frame.distance);
    const worst = Math.max(...frame.corners.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
    note(`${size}: aspect ${frame.aspect.toFixed(3)}, distance ${frame.distance.toFixed(0)}, worst corner ${worst.toFixed(2)}`);
    check(
      `the specimen is framed at ${size}`,
      inside(frame.corners, 0.98),
      `worst corner ${worst.toFixed(2)} of the half-viewport`
    );
    check(`the framing follows the viewport at ${size}`, frame.auto === true);

    // Framing is only half of a layout: the sheet's own annotations have to be
    // on screen with something to say at each size.
    const layout = await page.evaluate(() => {
      const box = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          hidden: style.visibility === 'hidden' || style.display === 'none',
        };
      };
      const canvas = document.querySelector('#gl');
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        canvas: { width: canvas.clientWidth, height: canvas.clientHeight },
        status: document.querySelector('#view-status')?.textContent?.trim() ?? '',
        values: [...document.querySelectorAll('#record dd')].map((dd) => dd.textContent?.trim() ?? ''),
        buttons: box('.view-buttons'),
        record: box('#record'),
      };
    });
    const onScreen = (rect) =>
      Boolean(rect) && !rect.hidden && rect.top >= -1 && rect.left >= -1 && rect.bottom <= layout.viewport.height + 1 && rect.right <= layout.viewport.width + 1;
    check(
      `the sheet fills the viewport at ${size}`,
      layout.canvas.width === layout.viewport.width && layout.canvas.height === layout.viewport.height,
      `canvas ${layout.canvas.width}x${layout.canvas.height} in ${layout.viewport.width}x${layout.viewport.height}`
    );
    check(
      `the view controls stay on screen at ${size}`,
      layout.status.length > 0 && onScreen(layout.buttons),
      `status "${layout.status}"`
    );
    check(
      `every resource figure stays on screen at ${size}`,
      layout.values.length > 0 && layout.values.every((value) => value.length > 0) && onScreen(layout.record),
      `${layout.values.length} figures: ${layout.values.join(', ')}`
    );

    // The forest has to be framed from above at the same viewport.
    await page.click('#view-forest');
    await settle(page);
    const forest = await framed();
    const outside = forest.crowns.filter(([x, y]) => Math.abs(x) > 1 || Math.abs(y) > 1).length;
    note(`${size}: ${forest.crowns.length} crowns, ${outside} outside the frame`);
    check(
      `the stand is framed at ${size}`,
      forest.crowns.length > 0 && outside === 0,
      `${outside} of ${forest.crowns.length} crowns outside the frame`
    );
    await page.click('#view-underground');
    await settle(page);
  }

  check(
    'the default framing is re-derived, not merely re-projected',
    new Set(distances.map((value) => Math.round(value))).size > 1,
    `distances ${distances.map((value) => value.toFixed(0)).join(', ')}`
  );
  await contexts.pop().close();
}

// ---------------------------------------------------------------------------
// 6. Reduced motion moves between the views without a crossing
// ---------------------------------------------------------------------------
{
  const page = await open('/?seed=raven-wood&view=underground', { width: 1366, height: 768 }, { reducedMotion: 'reduce' });
  await page.evaluate(() => {
    window.__crossingFrames = 0;
    const tick = () => {
      if (window.mycelia.game.viewReport().crossing) window.__crossingFrames++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.keyboard.press('v');
  await page.waitForTimeout(600);
  const crossed = await page.evaluate(() => {
    const state = window.mycelia.game.viewReport();
    return { frames: window.__crossingFrames, view: state.view, blend: state.blend, strandOpacity: state.strandOpacity };
  });
  check(
    'reduced motion shows the forest in the frame it is asked for',
    crossed.view === 'forest' && crossed.blend === 1 && crossed.frames <= 1,
    `${crossed.frames} frames reported a crossing`
  );
  check(
    'reduced motion leaves the soil\u2019s contents out of the forest',
    crossed.strandOpacity === 0,
    `strand opacity ${crossed.strandOpacity}`
  );
  await contexts.pop().close();
}

await browser.close();
server?.kill();

for (const line of results) console.log('  ok - ' + line);
for (const line of failures) console.log('  FAIL - ' + line);
if (problems.length > 0) console.log('PROBLEMS:\n  ' + problems.slice(0, 20).join('\n  '));
else console.log('PROBLEMS: none');

if (failures.length > 0 || problems.length > 0) process.exit(1);
console.log(`PASS: ${results.length} checks.`);
