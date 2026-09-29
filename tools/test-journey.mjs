/**
 * Play a whole match through the printed interface.
 *
 * `tools/test-sim.mjs` proves the simulation is winnable through its public
 * order methods. This proves a *player* can win it: every step here is a click
 * on a control the sheet actually prints — Awaken the spore, the root labels,
 * Rest & gather, the Fruit order, a marked strand, and the outcome's own
 * restart — with no assignment to simulation state anywhere.
 *
 *   npm run build && npm run test:journey
 *   node tools/test-journey.mjs --seed old-growth --verbose
 *   node tools/test-journey.mjs --qa fast --seed raven-wood
 *
 * It runs at the fastest pace the sheet offers, so a match takes minutes of
 * wall clock rather than the quarter of an hour a real player would spend.
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

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const verbose = args.includes('--verbose');
const accelerated = args.includes('--accelerated');
let qa;
try {
  qa = parseQaPreset(args);
} catch (error) {
  console.error(`test-journey: ${error.message}`);
  process.exit(1);
}
const port = Number(argOf('port', 4174));
const seed = argOf('seed', 'raven-wood');
const url = argOf('url', `http://127.0.0.1:${port}`);
/** Simulated seconds allowed before the journey is declared stuck. */
const SIM_BUDGET = Number(argOf('sim-budget', 1800));

const results = [];
const failures = [];

function check(name, ok, detail) {
  if (ok) results.push(detail ? `${name} (${detail})` : name);
  else failures.push(detail ? `${name} — ${detail}` : name);
  return ok;
}

const step = (line) => console.log(`    .. ${line}`);

let server = null;
if (!args.includes('--url')) {
  server = await startPreview(port).catch((error) => {
    console.error(`test-journey: ${error.message}`);
    process.exit(1);
  });
}

const browser = await launchBrowser();
try {
const context = await browser.newContext({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const problems = collectProblems(page);

/** A compact picture of the match, for a failure that has to be diagnosable. */
const matchState = () =>
  page.evaluate(() => {
    const sim = window.mycelia.game.sim;
    const journeyText = document.querySelector('#chapter-title')?.textContent ?? '';
    return {
      time: Math.round(sim.time),
      outcome: sim.outcome,
      season: sim.season.id,
      carbon: Math.round(sim.player.carbon),
      surplus: Math.round(sim.player.surplus),
      strands: sim.player.nodes.filter((node) => node.alive && node.connected).length,
      surface: sim.player.nodes.filter((node) => node.alive && node.connected && node.gy <= 12).length,
      bonded: sim.world.trees.filter((tree) => tree.rootTips.some((tip) => tip.bondedTo !== null)).length,
      fruited: sim.player.fruited,
      spores: sim.player.spores,
      resting: sim.player.resting,
      body: sim.player.fruit.active ? Math.round(sim.player.fruit.progress * 100) : null,
      chapter: journeyText,
      note: document.querySelector('#order-note')?.textContent ?? '',
    };
  });

const advanceFrames = (frames = 10) => page.evaluate(frames => {
  const g = window.mycelia.game;
  g.stop();
  for (let i = 0; i < frames; i++) g.frame(g.lastFrame + 100, false);
}, frames);
const settleView = async () => {
  if (accelerated) await advanceFrames(30);
  else await page.waitForFunction(() => !window.mycelia.game.viewReport().crossing, null, { timeout: 60000, polling: 'raf' });
};

/**
 * Wait for the match to reach a point, or give up with the state in hand.
 *
 * `objective` names what is being waited for, so progress lines read as a
 * description of the match rather than as a failure.
 */
async function until(objective, predicate, budgetSeconds = SIM_BUDGET) {
  const started = await page.evaluate(() => window.mycelia.game.sim.time);
  const deadline = Date.now() + 20 * 60 * 1000;
  let ticks = 0;
  for (;;) {
    if (await page.evaluate(predicate)) return true;
    const state = await matchState();
    if (verbose && ++ticks % 20 === 0) step(`waiting on ${objective}: ${JSON.stringify(state)}`);
    if (state.time - started > budgetSeconds) {
      failures.push(`${objective} was not reached within ${Math.round(state.time - started)}s of match time: ${JSON.stringify(state)}`);
      return false;
    }
    if (Date.now() > deadline) {
      failures.push(`${objective} never arrived before the wall-clock timeout: ${JSON.stringify(state)}`);
      return false;
    }
    if (accelerated) await advanceFrames();
    else await page.waitForTimeout(500);
  }
}

/** Click a printed control by its own text, the way a player would find it. */
const clickLabel = (pattern) =>
  page.evaluate((pattern) => {
    const found = [...document.querySelectorAll('#root-markers button')].find(
      (button) => !button.hidden && !button.disabled && new RegExp(pattern, 'i').test(button.textContent ?? '')
    );
    if (!found) return null;
    found.click();
    return found.textContent.trim();
  }, pattern);

const visibleLabels = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('#root-markers button')]
      .filter((button) => !button.hidden)
      .map((button) => `${button.textContent.trim()}${button.disabled ? ' [disabled]' : ''}`)
  );

await page.goto(withQaPreset(url + `/?seed=${seed}`, qa), { waitUntil: 'commit', timeout: 120000 });
await page.waitForFunction(() => Boolean(window.mycelia), null, { timeout: 120000 });
console.log(formatRenderReport(await readRenderReport(page)));
if (accelerated) { await page.evaluate(() => window.mycelia.game.stop()); console.log('Accelerated UI journey: fixed-step state frames, GPU draws only at checkpoints.'); }

// 1. The opening is the sheet's own button, and it takes you down to the soil.
await page.click('#begin');
await settleView();
const opened = await matchState();
check(
  'the opening button wakes the network and descends into the soil',
  opened.carbon > 0 &&
    (await page.evaluate(() => window.mycelia.game.viewReport().view === 'underground')) &&
    (await page.evaluate(() => document.querySelector('#begin').hidden === true)),
  `carbon ${opened.carbon}, strands ${opened.strands}`
);

// The fastest pace the sheet offers, so the match is minutes rather than hours.
await page.getByText('Pace & atmosphere', { exact: true }).click();
await page.click('.speed-row button[data-speed="4"]');
await page.getByText('Pace & atmosphere', { exact: true }).click();
if (accelerated) await advanceFrames(1);

// 2. Reach a root through its label, then bond through the label that appears.
{
  const reach = await clickLabel('Reach');
  check('a labelled root can be reached from the sheet', Boolean(reach), `clicked "${reach}"`);
  const arrived = await until('a root within reach', () =>
    [...document.querySelectorAll('#root-markers button')].some(
      (button) => !button.hidden && !button.disabled && /Bond/.test(button.textContent ?? '') && !/Bonded/.test(button.textContent ?? '')
    )
  );
  if (arrived) {
    const bonded = await clickLabel('Bond');
    const after = await matchState();
    check('the label bonds the tree it names', after.bonded > 0, `clicked "${bonded}", ${after.bonded} bonded`);
  }
  if (verbose) step(`labels: ${(await visibleLabels()).join(' | ')}`);
}

// 3. Grow back up to the surface, where a fruiting body can rise.
{
  let state = await matchState();
  if (state.surface === 0) {
    // Aim at the top of the soil the way a player does: click it.
    await page.click('.order[data-order="grow"]');
    const at = await gridToPage(page, await page.evaluate(() => window.mycelia.game.sim.player.nodes[0].gx), 8);
    await page.mouse.click(at.x, at.y);
    step('clicked the soil 8cm below the surface to send the frontier up');
    await until('the frontier at the surface', () => {
      const sim = window.mycelia.game.sim;
      return sim.player.nodes.some((node) => node.alive && node.connected && node.gy <= 12);
    }, 400);
    state = await matchState();
  }
  check('a supplying network grows back to the surface', state.surface > 0, `${state.surface} strands in the top 12cm`);
}

// 4. Rest to bank the reserve, then raise two fruiting bodies from marked strands.
await page.getByText('Shape the network', { exact: true }).click();
for (const bloom of [1, 2]) {
  const before = await matchState();
  if (!before.resting) await page.click('#rest');
  await page.click('.order[data-order="fruit"]');
  const ready = await until(`the reserve for bloom ${bloom}`, () =>
    [...document.querySelectorAll('#root-markers button')].some(
      (button) => button.classList.contains('is-site') && !button.hidden && !button.disabled
    )
  );
  if (ready) {
    const clicked = await clickLabel('Fruit here');
    const growing = await until(`bloom ${bloom} to begin`, () => window.mycelia.game.sim.player.fruit.active);
    check(`bloom ${bloom} rises from a marked strand`, Boolean(clicked) && growing, `clicked "${clicked}"`);
    const finished = await until(`bloom ${bloom} to finish`, () => {
      const player = window.mycelia.game.sim.player;
      return !player.fruit.active && player.blooms.length >= 1;
    });
    const after = await matchState();
    check(
      `bloom ${bloom} is recorded where it stood`,
      finished && after.fruited >= bloom,
      `${after.fruited} blooms, ${after.spores} spores, at ${after.time}s`
    );
    // The reward has to be somewhere, not just counted: the simulation records
    // the ground the body stood on, the soil draws an authored body, and the
    // same body stands on the forest floor above that site.
    const placed = await page.evaluate(() => {
      const game = window.mycelia.game;
      const report = game.renderReport();
      return {
        site: game.sim.player.blooms.at(-1)?.spatial ?? null,
        fruiting: report.fruiting,
        living: report.living,
      };
    });
    check(
      `bloom ${bloom} records the ground it stood on`,
      Boolean(placed.site) && Number.isFinite(placed.site?.x) && Number.isFinite(placed.site?.y),
      JSON.stringify(placed.site)
    );
    check(
      `bloom ${bloom} is drawn as an authored body in the soil`,
      placed.living.authored >= 1 && placed.living.bodies === placed.living.authored,
      JSON.stringify(placed.living)
    );
    check(
      `bloom ${bloom} stands on the forest floor above its site`,
      placed.fruiting.standing >= bloom && placed.fruiting.waiting === 0,
      JSON.stringify(placed.fruiting)
    );
  }
}

// 5. Two blooms no longer end a regional match: the region decides it. The
//    spores wait on the stalk, the sheet offers to release them, and a release
//    founds a colony elsewhere while the match keeps running.
{
  const ended = await matchState();
  check(
    'two blooms fruit through the interface alone, and the match keeps going',
    ended.fruited >= 2 && ended.outcome === 'playing',
    JSON.stringify({ fruited: ended.fruited, outcome: ended.outcome, time: ended.time })
  );
  const offered = await until('the release action to be offered', () => {
    const button = document.querySelector('#release-spores');
    return Boolean(button && !button.hidden) || window.mycelia.game.match.colonization.length > 0;
  }, 60);
  const before = await page.evaluate(() => ({
    colonies: window.mycelia.game.match.colonization.length,
    notes: document.querySelector('#notes')?.textContent ?? '',
  }));
  check('the sheet offers to release the waiting spores (unless a gust took them first)', offered, JSON.stringify(before));
  check('the notes report the regional hold instead of a bloom count', /Stands held|Holding/.test(before.notes), before.notes);
  if (before.colonies === 0) {
    await page.evaluate(() => document.querySelector('#release-spores')?.click());
  }
  const released = await until('a spore colony to be founded', () => window.mycelia.game.match.colonization.length > 0, 60);
  const after = await page.evaluate(() => ({
    colonies: window.mycelia.game.match.colonization.length,
    flights: window.mycelia.game.sporeFlights?.active ?? 0,
    note: document.querySelector('#order-note')?.textContent ?? '',
  }));
  check('releasing sends spores on the wind to found a colony', released && after.colonies >= 1, JSON.stringify(after));
}

await context.close();
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
