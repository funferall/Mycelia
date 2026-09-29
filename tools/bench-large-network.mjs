/**
 * Performance bench: a large network in the real game, simulation and
 * rendering timed separately. Not a pass/fail test; prints numbers.
 *
 *   npm run build && node tools/bench-large-network.mjs [seconds-of-growth]
 */
import { launchBrowser } from './browser.mjs';
import { startPreview } from './preview.mjs';

const growth = Number(process.argv[2] ?? 200);
const server = await startPreview(4207);
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(600000);
  await page.goto(`${server.url}/?seed=raven-wood`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.mycelia?.game?.match));
  const result = await page.evaluate(async (growth) => {
    const g = window.mycelia.game;
    g.stop();
    const m = g.match;
    // Grow: the player's colony is given carbon so it keeps expanding like a
    // well-fed late game; the rival grows on its own.
    for (let s = 0; s < growth; s++) {
      for (const n of m.active.sim.player.nodes) if (n.alive) n.carbon = Math.max(n.carbon, 6);
      for (let i = 0; i < 60; i++) m.step(1 / 60);
    }
    const nodes = m.stands.reduce((v, s) => v + s.sim.player.nodes.filter((n) => n.alive).length + s.sim.rival.nodes.filter((n) => n.alive).length, 0);
    const simOnly = () => { const t = performance.now(); for (let i = 0; i < 60; i++) m.step(1 / 60); return Math.round(performance.now() - t); };
    const before = simOnly();
    const measure = (view) => {
      document.querySelector(`#view-${view}`).click();
      for (let i = 0; i < 30; i++) g.frame(g.lastFrame + 100, true);
      // Split one frame's work: simulation (60 fixed steps = one game second at 1x)...
      const s0 = performance.now();
      for (let i = 0; i < 60; i++) m.step(1 / 60);
      const simPerSecond = performance.now() - s0;
      // ...and presentation: frames with no simulation step (speed 0).
      const f0 = performance.now();
      for (let i = 0; i < 30; i++) g.frame(g.lastFrame + 16, true);
      const framePresent = (performance.now() - f0) / 30;
      return { simPerSecond: Math.round(simPerSecond), framePresentMs: +framePresent.toFixed(1) };
    };
    const underground = measure('underground');
    const afterUnderground = simOnly();
    const forest = measure('forest');
    return { nodes, simBeforeAnyFrame: before, underground, afterUnderground, forest, speed: g.speed, spatial: Boolean(g.spatial), section: Boolean(g.section) };
  }, growth);
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  server.stop();
}
