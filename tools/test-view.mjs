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
 *   node tools/test-view.mjs --qa fast --smoke             # small fast smoke check
 *
 * `--url` is optional: without it the script starts `vite preview` on the build
 * in `dist/` and shuts it down again.
 */
import {
  collectProblems,
  formatRenderReport,
  gridToPage,
  launchBrowser,
  parseQaPreset,
  readRenderReport,
  withQaPreset,
} from './browser.mjs';
import { startPreview } from './preview.mjs';

/** Advanced controls now live in native disclosures. Open them as a player would. */
async function revealControl(page, selector) {
  const disclosure = page.locator('details').filter({ has: page.locator(selector) });
  if (await disclosure.count() && !(await disclosure.evaluate(el => el.open))) {
    await disclosure.locator('summary').click();
  }
}

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
const smoke = args.includes('--smoke');
let qa;
try {
  qa = parseQaPreset(args);
} catch (error) {
  console.error(`test-view: ${error.message}`);
  process.exit(1);
}
const port = Number(argOf('port', 4173));
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
  server = await startPreview(port).catch((error) => {
    console.error(`test-view: ${error.message}`);
    process.exit(1);
  });
}

const browser = await launchBrowser();
try {
const problems = [];
const contexts = [];
let announcedQuality = false;

async function open(path, viewport = { width: 1600, height: 1000 }, options = {}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    reducedMotion: options.reducedMotion ?? 'no-preference',
  });
  contexts.push(context);
  const page = await context.newPage();
  // Software WebGL spends seconds inside a single frame once the whole region
  // is drawn, so an ordinary click can wait out Playwright's 30s default while
  // the main thread is busy. This is an action budget, not a relaxation of any
  // check: every click is still a real mouse event on the real control.
  page.setDefaultTimeout(120000);
  collectProblems(page, problems);
  await page.goto(withQaPreset(url + path, qa), { waitUntil: 'commit', timeout: 120000 });
  await page.waitForFunction(() => Boolean(window.mycelia), null, { timeout: 120000 });
  if (!announcedQuality) {
    announcedQuality = true;
    console.log(formatRenderReport(await readRenderReport(page)));
  }
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

/**
 * Wait for the camera to finish gliding to its framing.
 *
 * The glide is frame-rate limited on purpose: ordinary camera smoothing runs
 * on the clamped step, not the wall clock, so a machine drawing the whole
 * region under software WebGL takes roughly twenty frames to land rather than
 * five. At the frame times that renderer produces, that is well over a minute,
 * so the budget is sized for it while the property being checked is unchanged.
 */
const settleFraming = (page, timeout = 180000) =>
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

// ---------------------------------------------------------------------------
// 0. A small opt-in smoke check, for fast visual iteration
// ---------------------------------------------------------------------------
if (smoke) {
  const page = await open('/?seed=raven-wood', { width: 1200, height: 760 });
  const loaded = await readRenderReport(page);
  check(
    'the smoke check is running the requested QA preset',
    loaded?.preset === qa,
    `requested ${qa}, reported ${loaded?.preset ?? 'nothing'}`
  );
  if (qa === 'fast') {
    check(
      'fast QA disables antialiasing, shadow decals, bloom and postprocessing',
      loaded && !loaded.antialias && !loaded.groundShadows && !loaded.bloom && !loaded.postprocessing && !loaded.shadowMaps,
      JSON.stringify({
        antialias: loaded?.antialias,
        groundShadows: loaded?.groundShadows,
        bloom: loaded?.bloom,
        postprocessing: loaded?.postprocessing,
        shadowMaps: loaded?.shadowMaps,
      })
    );
  } else {
    check(
      'normal QA keeps the shipping antialiasing, shadow decals, bloom and postprocessing',
      loaded && loaded.antialias && loaded.groundShadows && loaded.bloom && loaded.postprocessing && !loaded.shadowMaps,
      JSON.stringify({
        antialias: loaded?.antialias,
        groundShadows: loaded?.groundShadows,
        bloom: loaded?.bloom,
        postprocessing: loaded?.postprocessing,
        shadowMaps: loaded?.shadowMaps,
      })
    );
  }
  check(
    'all nine stands and their trees are present',
    loaded?.stands === 9 && loaded.trees > 0,
    `${loaded?.stands ?? 0} stands, ${loaded?.trees ?? 0} trees`
  );

  const layout = await page.evaluate(() => {
    const canvas = document.querySelector('#gl');
    const rect = canvas.getBoundingClientRect();
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      client: { width: canvas.clientWidth, height: canvas.clientHeight },
      css: { width: rect.width, height: rect.height },
      buffer: { width: canvas.width, height: canvas.height },
      quality: window.mycelia.game.renderReport(),
    };
  });
  const cssHolds =
    layout.viewport.width === 1200 &&
    layout.viewport.height === 760 &&
    Math.abs(layout.client.width - 1200) < 1 &&
    Math.abs(layout.client.height - 760) < 1 &&
    Math.abs(layout.css.width - 1200) < 1 &&
    Math.abs(layout.css.height - 760) < 1;
  check('the CSS viewport is unchanged by the QA preset', cssHolds, JSON.stringify({ viewport: layout.viewport, client: layout.client }));
  const expected = {
    width: Math.floor(layout.css.width * layout.quality.pixelRatio),
    height: Math.floor(layout.css.height * layout.quality.pixelRatio),
  };
  check(
    'the drawing buffer follows the preset pixel ratio, not the CSS viewport',
    Math.abs(layout.buffer.width - expected.width) <= 1 && Math.abs(layout.buffer.height - expected.height) <= 1,
    `buffer ${layout.buffer.width}x${layout.buffer.height}, expected ${expected.width}x${expected.height} at ratio ${layout.quality.pixelRatio}`
  );
  if (qa === 'fast') {
    check(
      'fast QA lowers the drawing buffer below the CSS viewport',
      layout.buffer.width < layout.client.width && layout.buffer.height < layout.client.height,
      `buffer ${layout.buffer.width}x${layout.buffer.height}, CSS ${layout.client.width}x${layout.client.height}`
    );
  }

  const selected = await page.evaluate(() => {
    const select = document.querySelector('#forest-tree');
    const option = [...select.options].find((entry) => entry.value !== '');
    if (!option) return null;
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      value: option.value,
      text: option.textContent?.trim() ?? '',
      status: document.querySelector('#tree-status')?.textContent?.trim() ?? '',
      report: window.mycelia.game.renderReport(),
    };
  });
  check(
    'a forest tree can still be selected through the real selector',
    Boolean(selected) && selected.report.selectedTreeId !== null && /bonded|not yet bonded|deadwood|struggling/i.test(selected.status),
    selected ? `${selected.text} -> "${selected.status}"` : 'no tree option'
  );

  await revealControl(page, '#descend-tree');
  await page.click('#descend-tree');
  await settle(page);
  const underground = await report(page);
  check(
    'the selected tree descends into the underground view',
    underground.view === 'underground' && underground.blend === 0,
    JSON.stringify({ view: underground.view, blend: underground.blend })
  );
  await page.click('#view-forest');
  await settle(page);
  const forest = await report(page);
  check(
    'the same page returns to the forest view',
    forest.view === 'forest' && forest.blend === 1,
    JSON.stringify({ view: forest.view, blend: forest.blend })
  );

  await contexts.pop().close();
  await browser.close();
  server?.stop();
  for (const line of results) console.log('  ok - ' + line);
  for (const line of failures) console.log('  FAIL - ' + line);
  if (problems.length > 0) console.log('PROBLEMS:\n  ' + problems.slice(0, 20).join('\n  '));
  else console.log('PROBLEMS: none');
  if (failures.length > 0 || problems.length > 0) process.exit(1);
  console.log(`PASS: ${results.length} smoke checks.`);
  process.exit(0);
}

/**
 * Drive state frames — simulation, transforms and overlays — from a synthetic clock,
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
        // Timing/opacity assertions need current render state, not a GPU draw
        // for each synthetic frame. Real interaction and captures still draw.
        game.frame(now, false);
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
      // The selector is region-wide since the region renders: an option names
      // the stand the crown stands in as well as the tree, as `stand:tree`. The
      // first option belongs to the colony's own stand, which is the only
      // ground a descent can enter.
      const option = [...select.options].find((entry) => entry.value !== '');
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return Number(option.value.split(':')[1]);
    });
    await page.click('#view-forest');
    await settle(page);
    await revealControl(page, '#descend-tree');
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
          const sample = () => {
            const now = performance.now();
            const state = game.viewReport();
            samples.push({ frame: samples.length, gap: now - previous, ...state });
            previous = now;
            return state.crossing;
          };
          const tick = () => (sample() ? requestAnimationFrame(tick) : resolve(samples));
          document.querySelector('#view-underground').click();
          // Sample in the same task as the click. Under software WebGL a frame
          // can outlast the whole 1.5s crossing, so a sampler that starts on the
          // next frame can miss a crossing that already began and finished and
          // report that it observed nothing.
          sample();
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
        reserves: box('.resource-legend'),
        folded: !document.querySelector('#record').closest('details').open,
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
      `resource names stay on screen and exact figures remain in folded readings at ${size}`,
      layout.values.length === 13 && layout.values.every((value) => value.length > 0) && layout.folded && onScreen(layout.reserves),
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

// ---------------------------------------------------------------------------
// 7. What a click, a drag, a wheel and the keyboard actually do
// ---------------------------------------------------------------------------
{
  const page = await open('/?seed=raven-wood&view=underground', { width: 1280, height: 800 });
  await page.click('#begin');
  await settle(page);
  // Paused, so the effect of an order is unambiguous: a waypoint either exists
  // or it does not.
  await revealControl(page, '#btn-pause');
  await page.click('.speed-row button[data-speed="0"]');

  const soil = async () => {
    const founder = await page.evaluate(() => {
      const node = window.mycelia.game.sim.player.nodes[0];
      return { gx: node.gx, gy: node.gy };
    });
    return gridToPage(page, founder.gx, founder.gy);
  };
  const state = () =>
    page.evaluate(() => {
      const game = window.mycelia.game;
      return {
        view: game.viewReport().view,
        crossing: game.viewReport().crossing,
        resting: game.sim.player.resting,
        order: [...document.querySelectorAll('.order')].find((button) => button.classList.contains('is-on'))?.dataset.order ?? null,
        paused: document.querySelector('.speed-row button[data-speed="0"]').classList.contains('is-on'),
        pan: game.viewReport().target.x,
      };
    });
  /** A growth order clears `resting`, so the pace control is the observable. */
  const setResting = async (want) => {
    if ((await state()).resting !== want) await page.click('#rest');
  };

  // A drag is a camera move; a tap is an order.
  {
    await page.click('.order[data-order="grow"]');
    await setResting(true);
    const before = await state();
    const at = await soil();
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 46, at.y + 26, { steps: 8 });
    await page.mouse.up();
    const after = await state();
    check(
      'a drag pans the camera instead of issuing an order',
      after.resting === true && Math.abs(after.pan - before.pan) > 0.5,
      `the frontier stayed still (${after.resting}), camera moved ${(after.pan - before.pan).toFixed(1)} world units`
    );
  }

  // A tap on open soil with Grow selected does issue one.
  {
    await setResting(true);
    const at = await soil();
    await page.mouse.click(at.x, at.y);
    const after = await state();
    const note = await page.textContent('#order-note');
    check(
      'a tap on the soil issues the selected order',
      after.resting === false && /frontier/i.test(note),
      `resting ${after.resting}, note "${note}"`
    );
    check('the order note says where the frontier was sent', /directed to \d+/i.test(note), note);
  }

  // A refused order says so, and leaves the match alone.
  {
    await setResting(true);
    const blank = await page.evaluate(() => {
      const game = window.mycelia.game;
      const { halfWidth, halfHeight } = game.viewReport().mount;
      const rect = document.querySelector('#gl').getBoundingClientRect();
      for (let fx = 0.94; fx > 0.5; fx -= 0.02) {
        const x = rect.left + rect.width * fx;
        const y = rect.top + rect.height * 0.5;
        const point = game.gridAt(x, y);
        if (point && (point.gx < 0 || point.gx > halfWidth * 2 || point.gy < 0 || point.gy > halfHeight * 2)) {
          return { x, y, point };
        }
      }
      return null;
    });
    check('there is bare paper beside the specimen to click on', Boolean(blank), JSON.stringify(blank?.point ?? null));
    if (blank) {
      await page.mouse.click(blank.x, blank.y);
      const refusal = await page.textContent('#order-note');
      const after = await state();
      check(
        'a refused order is refused out loud and changes nothing',
        /stone cannot be crossed/i.test(refusal) && after.resting === true,
        `note "${refusal}", resting ${after.resting}`
      );
    }
  }

  // A cancelled pointer must not leave the canvas waiting for a release, and it
  // must not turn a later release into a tap.
  {
    await setResting(true);
    const at = await soil();
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.evaluate(() => {
      document.querySelector('#gl').dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));
    });
    await page.mouse.move(at.x + 30, at.y + 18, { steps: 4 });
    await page.mouse.up();
    const after = await state();
    check(
      'a cancelled pointer issues no order',
      after.resting === true,
      `resting ${after.resting}`
    );
    // And the canvas is not left deaf: a real drag still pans afterwards.
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x - 40, at.y - 20, { steps: 6 });
    await page.mouse.up();
    const recovered = await state();
    check(
      'the canvas still pans after a cancelled pointer',
      Math.abs(recovered.pan - after.pan) > 0.5,
      `camera moved ${(recovered.pan - after.pan).toFixed(1)} world units`
    );
  }

  // Nothing can be ordered mid-crossing.
  {
    await page.click('.order[data-order="grow"]');
    await setResting(true);
    await page.click('#view-forest');
    const crossingAtClick = (await state()).crossing;
    // The labels are hidden mid-crossing, so the middle of the sheet is the
    // canvas itself rather than a marker sitting over it.
    await page.mouse.click(640, 400);
    const after = await state();
    check(
      'a click during a crossing issues no order',
      crossingAtClick && after.resting === true,
      `crossing at the click: ${crossingAtClick}, resting ${after.resting}`
    );
    await settle(page);
  }

  // Wheel descent: one notch is not enough to cross, and continuing to zoom in
  // is. The threshold is an absolute distance while the overview is framed to
  // the whole region, so the region needs roughly twice the notches the single
  // stand did; the button and the keyboard remain the short ways down.
  {
    const before = await state();
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, -400);
    const once = await state();
    check(
      'one wheel notch zooms the forest without dropping into the soil',
      before.view === 'forest' && once.view === 'forest',
      `${before.view} then ${once.view}`
    );
    let notches = 1;
    let now = once;
    while (now.view === 'forest' && notches < 16) {
      await page.mouse.wheel(0, -400);
      await page.waitForTimeout(120);
      now = await state();
      notches++;
    }
    check(
      'zooming past the threshold descends into the soil',
      now.view === 'underground',
      `${notches} notches to cross`
    );
    await settle(page);
    check('and the descent lands with the network whole', (await report(page)).strandOpacity === 1);
  }

  // The keyboard belongs to the sheet, not to whatever control has focus.
  {
    // The tree selector only exists above ground, so the guard is checked where
    // a player could actually be typing into it.
    await page.click('#view-forest');
    await settle(page);
    await revealControl(page, '#forest-tree');
  await page.focus('#forest-tree');
    const focused = await page.evaluate(() => document.activeElement?.id ?? null);
    const before = await state();
    await page.keyboard.press('v');
    const after = await state();
    check(
      'a key typed into a control does not change the view',
      focused === 'forest-tree' && before.view === after.view,
      `focus ${focused}, ${before.view} to ${after.view}`
    );

    await page.focus('#gl');
    const viewBefore = (await state()).view;
    await page.keyboard.press('v');
    await settle(page);
    check(
      'the canvas itself answers V',
      (await state()).view !== viewBefore,
      `${viewBefore} to ${(await state()).view}`
    );

    await page.keyboard.press('2');
    check('number keys choose an order', (await state()).order === 'bond');
    check('the chosen order is pressed in the sheet', await page.evaluate(() => document.querySelector('.order[data-order="bond"]').getAttribute('aria-pressed') === 'true'));

    const panBefore = (await state()).pan;
    await page.keyboard.press('ArrowLeft');
    // The pose eases toward the new goal, so wait for the frame that moves it.
    await page
      .waitForFunction((from) => Math.abs(window.mycelia.game.viewReport().target.x - from) > 0.5, panBefore, { timeout: 15000 })
      .catch(() => {});
    check(
      'arrow keys pan the camera',
      Math.abs((await state()).pan - panBefore) > 0.5,
      `camera moved ${((await state()).pan - panBefore).toFixed(1)} world units`
    );

    const pausedBefore = (await state()).paused;
    await page.keyboard.press('Space');
    const pausedAfter = (await state()).paused;
    check(
      'Space toggles the pace',
      pausedAfter !== pausedBefore,
      `paused ${pausedBefore} to ${pausedAfter}`
    );
    await page.keyboard.press('Space');
    check('and Space toggles it back', (await state()).paused === pausedBefore);
  }

  // Changing views faster than the crossing takes must still land where the
  // last click asked, with nothing left half faded.
  {
    for (const selector of ['#view-underground', '#view-forest', '#view-underground', '#view-forest', '#view-underground']) {
      await page.click(selector);
    }
    await settle(page);
    const landed = await report(page);
    check(
      'a burst of view changes lands in the view that was asked for last',
      landed.view === 'underground' && landed.blend === 0 && landed.strandOpacity === 1,
      JSON.stringify({ view: landed.view, blend: landed.blend, strandOpacity: landed.strandOpacity })
    );
    await page.keyboard.press('v');
    await settle(page);
    check('and input still works after the burst', (await report(page)).view === 'forest');
  }

  await contexts.pop().close();
}

// ---------------------------------------------------------------------------
// 8. Every tree picks the authored tier its own size on screen deserves
// ---------------------------------------------------------------------------
if (!smoke) {
  const page = await open('/?seed=raven-wood&view=forest', { width: 1366, height: 768 });
  const twoFrames = () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );

  // The check is about which mesh a tree wears, not about how fast the network
  // is, so wait until every tier the manifest declares has actually loaded.
  await page
    .waitForFunction(
      () => {
        const assets = window.mycelia?.game?.renderReport?.()?.assets;
        return Boolean(assets) && assets.ready && assets.pending === 0 && assets.loaded === assets.expected;
      },
      null,
      { timeout: 180000, polling: 250 }
    )
    .catch(() => {});
  const loaded = (await readRenderReport(page))?.assets;
  check(
    'every tier of the authored pack declared in the manifest has loaded',
    loaded && loaded.ready && loaded.pending === 0 && loaded.loaded === loaded.expected && loaded.failures === 0,
    JSON.stringify(loaded ?? null)
  );

  /**
   * Every tree's tier and placement, keyed by stand and simulation tree ID.
   * These keys are the mapping a later instancing pass has to preserve.
   */
  const snapshot = () =>
    page.evaluate(() => {
      const game = window.mycelia.game;
      const surfaces = game.regionSurfaces.filter(Boolean);
      const records = {};
      let trees = 0;
      for (const surface of surfaces) {
        for (const entry of surface.trees) {
          trees++;
          const record = surface.modelRecord(entry.tree.id);
          if (record) records[`${surface.standId}:${entry.tree.id}`] = record;
        }
      }
      return { report: game.renderReport(), records, trees, stands: surfaces.length };
    });

  const overview = await snapshot();
  const tiers = overview.report.lodTiers;
  note(`overview tiers ${tiers.join('/')} across ${overview.trees} trees in ${overview.stands} stands`);
  check(
    'every tree wears an authored tier at the region overview',
    overview.report.lodDressed === overview.trees && overview.trees > 0,
    `${overview.report.lodDressed} of ${overview.trees} dressed`
  );
  check(
    'the region overview pays for no LOD0 tree anywhere',
    tiers[0] === 0,
    `tiers ${tiers.join('/')}`
  );
  check(
    'the far stands of the overview wear the coarsest tier',
    tiers[2] > 0,
    `tiers ${tiers.join('/')}`
  );

  // Focus one crown through the selector's own control, which is the path a
  // player takes: the rig stands off at about 150 units, where a tree is LOD1.
  const selected = await page.evaluate(() => {
    const select = document.querySelector('#forest-tree');
    const option = [...select.options].find((entry) => entry.value !== '');
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const [standId, treeId] = option.value.split(':').map(Number);
    return { standId, treeId };
  });
  await settle(page);
  await twoFrames();
  const focused = await snapshot();
  const refined = focused.report.lodTiers;
  note(`focused tiers ${refined.join('/')} (tree ${selected.standId}:${selected.treeId})`);
  check(
    'focusing a crown refines its own stand without losing a tree',
    refined[0] + refined[1] > tiers[0] + tiers[1] && focused.report.lodDressed === overview.report.lodDressed,
    `${tiers[0] + tiers[1]} to ${refined[0] + refined[1]} fine trees, ${focused.report.lodDressed} dressed`
  );

  // The forest's own closest framing is about 105 units. Asking the rig for it
  // directly keeps the check about level of detail rather than about the wheel
  // threshold that would carry the camera underground.
  await page.evaluate(() => window.mycelia.game.stage.rig.zoomBy(0.7));
  await settle(page);
  await twoFrames();
  const close = await snapshot();
  const near = close.report.lodTiers;
  note(`close tiers ${near.join('/')}`);
  check(
    'a close camera earns the finest tier for the nearest trees',
    near[0] > 0,
    `tiers ${near.join('/')}`
  );
  check(
    'a tier change never changes which tree is which',
    Object.keys(close.records).length === Object.keys(overview.records).length &&
      Object.keys(overview.records).every((key) => close.records[key]?.assetId === overview.records[key].assetId),
    `${Object.keys(close.records).length} of ${Object.keys(overview.records).length} keys intact`
  );

  const changed = Object.keys(overview.records).filter(
    (key) => close.records[key] && close.records[key].tier !== overview.records[key].tier
  );
  const placementHolds = (before, after) =>
    before.tier !== after.tier &&
    before.assetId === after.assetId &&
    before.position.every((value, index) => Math.abs(value - after.position[index]) < 1e-9) &&
    before.quaternion.every((value, index) => Math.abs(value - after.quaternion[index]) < 1e-9) &&
    before.scale.every((value, index) => Math.abs(value - after.scale[index]) < 1e-9) &&
    before.world.every((value, index) => Math.abs(value - after.world[index]) < 1e-3);
  const preserved = changed.filter((key) => placementHolds(overview.records[key], close.records[key]));
  note(`${changed.length} trees changed tier; ${preserved.length} kept their exact placement`);
  check(
    'a tier swap changes geometry only, never ground contact or scale',
    changed.length > 0 && preserved.length === changed.length,
    `${preserved.length} of ${changed.length} placements preserved`
  );
  check(
    'the selected crown keeps its identity through the refinements',
    close.report.selectedTreeId === selected.treeId &&
      close.records[`${selected.standId}:${selected.treeId}`]?.tier <=
        focused.records[`${selected.standId}:${selected.treeId}`]?.tier,
    `selected ${close.report.selectedTreeId} at tier ${close.records[`${selected.standId}:${selected.treeId}`]?.tier}`
  );

  await contexts.pop().close();
}

// ---------------------------------------------------------------------------
// 9. The stream is drawn above ground and is a threshold below it
// ---------------------------------------------------------------------------
if (!smoke) {
  const page = await open('/?seed=raven-wood&view=forest', { width: 1366, height: 768 });
  const water = await page.evaluate(() => window.mycelia.game.renderReport().water);
  check(
    'the forest draws the region\u2019s own stream as a ribbon',
    water.ribbon > 0 && water.stands.length > 0,
    `${water.ribbon} ribbon vertices across stands ${water.stands.join(', ')}`
  );
  await page.screenshot({ path: 'design/shots/regional-stream.png' });

  // Fund a colony in a stand the stream crosses, then go and look at the water
  // from underneath: the channel should be there, and so should the table.
  const fixture = await page.evaluate(() => {
    const game = window.mycelia.game;
    const home = game.match.activeStandId;
    const stands = game.renderReport().water.stands;
    const target = stands.find((id) => id !== home) ?? home;
    if (!game.match.stands[target].sim.hasColony) {
      game.match.stands[target].sim.foundColony({ carbon: 46, water: 6, nitrogen: 3 });
      game.match.stands[target].arrivals.push({ at: game.match.time, from: home, spores: 46 });
    }
    game.refreshStandOptions();
    return { home, target };
  });
  await revealControl(page, '#forest-stand');
  await page.selectOption('#forest-stand', String(fixture.target));
  await settle(page);
  await revealControl(page, '#descend-tree');
  await page.click('#descend-tree');
  await settle(page);
  const below = await page.evaluate(() => {
    const game = window.mycelia.game;
    const report = game.renderReport().water;
    const world = game.sim.world;
    return {
      ...report,
      world: world.cells.filter((cell) => cell.stream).length,
      stream: game.match.active.site.stream,
      stand: game.match.activeStandId,
      view: game.viewReport().view,
    };
  });
  note(`underground water: ${JSON.stringify(below)}`);
  check(
    'descending into a crossed stand shows the channel and the water table',
    below.stand === fixture.target && below.view === 'underground' && below.channel > 0 && below.channel === below.world,
    `${below.channel} channel cells, table at ${below.tableCm}cm, width ${below.width}`
  );
  check(
    'the channel below sticks to the column the region put it in',
    below.stream !== null && Math.abs(below.centre - below.stream.centreGx) < 1 && below.width >= 3,
    `centre ${below.centre?.toFixed(1)} against ${below.stream?.centreGx?.toFixed(1)}, ${below.width} columns wide`
  );
  await page.screenshot({ path: 'design/shots/regional-stream-underground.png' });
  await contexts.pop().close();
}

await browser.close();
server?.stop();

for (const line of results) console.log('  ok - ' + line);
for (const line of failures) console.log('  FAIL - ' + line);
if (problems.length > 0) console.log('PROBLEMS:\n  ' + problems.slice(0, 20).join('\n  '));
else console.log('PROBLEMS: none');

if (failures.length > 0 || problems.length > 0) process.exit(1);
console.log(`PASS: ${results.length} checks.`);

} finally {
  await browser.close();
  server?.stop();
}
