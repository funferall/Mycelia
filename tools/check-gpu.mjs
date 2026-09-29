/**
 * Is the game rendering on a real GPU, and how fast?
 *
 *   npm run check:gpu            # build, then run on this machine's GPU
 *   node tools/check-gpu.mjs --grow 150
 *
 * Opens the built game on the hardware GPU, prints the WebGL renderer, then
 * measures real frames per second (requestAnimationFrame, the game running at
 * 1x) in the forest and underground views, before and after growing a large
 * network. Fails if the browser fell back to software rendering.
 */
import { launchBrowser } from './browser.mjs';
import { startPreview } from './preview.mjs';

const growIndex = process.argv.indexOf('--grow');
const growth = growIndex >= 0 ? Number(process.argv[growIndex + 1]) : 150;
const server = await startPreview(4217);
const browser = await launchBrowser({ gpu: true });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(600000);
  await page.goto(`${server.url}/?seed=raven-wood`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.mycelia?.game?.match));
  const report = await page.evaluate(() => window.mycelia.game.renderReport());
  console.log(`WebGL renderer: ${report.backend}`);
  if (report.software) {
    console.log('FAIL: software rendering. The browser did not get a GPU.');
    failed = true;
  }
  const fps = (view, seconds = 4) => page.evaluate(async ([view, seconds]) => {
    document.querySelector(`#view-${view}`).click();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const frames = [];
    await new Promise((resolve) => {
      const start = performance.now();
      let last = start;
      const tick = (now) => {
        frames.push(now - last);
        last = now;
        if (now - start < seconds * 1000) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
    frames.shift();
    frames.sort((a, b) => a - b);
    const mean = frames.reduce((v, f) => v + f, 0) / frames.length;
    return { fps: +(1000 / mean).toFixed(1), p95FrameMs: +frames[Math.floor(frames.length * 0.95)].toFixed(1) };
  }, [view, seconds]);
  const nodes = () => page.evaluate(() => window.mycelia.game.match.stands.reduce((v, s) => v + s.sim.player.nodes.filter((n) => n.alive).length + s.sim.rival.nodes.filter((n) => n.alive).length, 0));
  console.log(`small network (${await nodes()} strands): forest ${JSON.stringify(await fps('forest'))}, underground ${JSON.stringify(await fps('underground'))}`);
  // Grow a large network off the clock: the player is kept fed so it expands
  // like a well-supplied late game; the rival grows on its own.
  await page.evaluate((growth) => {
    const m = window.mycelia.game.match;
    for (let s = 0; s < growth; s++) {
      for (const n of m.active.sim.player.nodes) if (n.alive) n.carbon = Math.max(n.carbon, 6);
      for (let i = 0; i < 60; i++) m.step(1 / 60);
    }
  }, growth);
  console.log(`large network (${await nodes()} strands): forest ${JSON.stringify(await fps('forest'))}, underground ${JSON.stringify(await fps('underground'))}`);
  // Speed multiplies the simulation's share of every frame: 4x runs four
  // times the fixed steps per frame.
  await page.evaluate(() => document.querySelector('.speed-row button[data-speed="4"]')?.click());
  const achieved = async (view) => {
    const result = await fps(view);
    const speed = await page.evaluate(() => window.mycelia.game.effectiveSpeed);
    return { ...result, simSpeed: +speed.toFixed(2) };
  };
  // Frames stay smooth; the world runs as fast as the CPU allows (simSpeed).
  console.log(`large network at 4x speed: forest ${JSON.stringify(await achieved('forest'))}, underground ${JSON.stringify(await achieved('underground'))}`);
} finally {
  await browser.close();
  server.stop();
}
if (failed) process.exit(1);
