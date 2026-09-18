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
 *
 * It runs at the fastest pace the sheet offers, so a match takes minutes of
 * wall clock rather than the quarter of an hour a real player would spend.
 */
import { collectProblems, gridToPage, launchBrowser } from './browser.mjs';
import { startPreview } from './preview.mjs';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const verbose = args.includes('--verbose');
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

const settleView = () =>
  page.waitForFunction(() => !window.mycelia.game.viewReport().crossing, null, { timeout: 60000, polling: 'raf' });

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
    await page.waitForTimeout(500);
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

await page.goto(url + `/?seed=${seed}`, { waitUntil: 'commit', timeout: 120000 });
await page.waitForFunction(() => Boolean(window.mycelia), null, { timeout: 120000 });

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
await page.click('.speed-row button[data-speed="4"]');

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
  }
}

// 5. The match closes on the sheet, and the sheet offers the next one.
{
  const closed = await until('the two-bloom match to close', () => window.mycelia.game.sim.outcome === 'fruited', 600);
  const ended = await matchState();
  check('two blooms win the match through the interface alone', closed && ended.fruited === 2 && ended.spores >= 480, JSON.stringify({ fruited: ended.fruited, spores: ended.spores, time: ended.time }));
  const announced = await page.evaluate(() => {
    const outcome = document.querySelector('#outcome');
    return { hidden: outcome.hidden, title: document.querySelector('#outcome-title').textContent.trim(), packet: document.querySelector('#packet-count').textContent.trim() };
  });
  check(
    'the sheet announces the fruiting',
    !announced.hidden && /Fruiting recorded/.test(announced.title),
    JSON.stringify(announced)
  );
  check('the spore packet counts what was banked', Number(announced.packet) >= 480, `${announced.packet} spores`);

  const restart = await page.evaluate(() => {
    const button = [...document.querySelectorAll('#outcome button')].find((entry) => /new sheet/i.test(entry.textContent ?? ''));
    return button?.textContent?.trim() ?? null;
  });
  check('the outcome offers a new sheet', Boolean(restart), `"${restart}"`);
  if (restart) {
    await page.evaluate(() => {
      [...document.querySelectorAll('#outcome button')].find((entry) => /new sheet/i.test(entry.textContent ?? ''))?.click();
    });
    await page.waitForFunction(() => window.mycelia?.game?.sim?.time < 30, null, { timeout: 120000 });
    const fresh = await matchState();
    check('and the new sheet is a fresh match', fresh.outcome === 'playing' && fresh.fruited === 0, JSON.stringify({ outcome: fresh.outcome, time: fresh.time }));
  }
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
