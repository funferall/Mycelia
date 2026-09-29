// Bounded, GPU-synchronized samples. Software numbers describe this backend,
// never a desktop GPU budget. Use the same viewport/preset for comparisons.
import { cpus, totalmem } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, withQaPreset, parseQaPreset, readRenderReport } from './browser.mjs';
import { startPreview } from './preview.mjs';
const server = await startPreview(4176);
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 }, reducedMotion: 'reduce' });
  await page.goto(withQaPreset(server.url + '/?seed=raven-wood', parseQaPreset()), { waitUntil: 'commit' });
  await page.waitForFunction(() => window.mycelia?.game.assets.ready && window.mycelia.game.assets.loading === 0, null, { timeout: 240000 });
  await page.evaluate(() => window.mycelia.game.stop());
  const measure = () => page.evaluate(() => {
    const g = window.mycelia.game, renderer = g.stage.renderer, gl = renderer.getContext();
    const samples = [], pixel = new Uint8Array(4);
    for (let i = 0; i < 10; i++) {
      renderer.info.autoReset = false;
      renderer.info.reset();
      gl.finish();
      const start = performance.now();
      g.frame(g.lastFrame + 16.667);
      gl.finish();
      // Chromium may return from finish before its GPU process has completed.
      // Readback forces completion; its overhead is included in these samples.
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const ms = performance.now() - start;
      if (i >= 2) samples.push({ ms, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles });
    }
    renderer.info.autoReset = true;
    const ordered = samples.map(s => s.ms).sort((a,b) => a-b);
    return { samples, medianMs: ordered[4], p95Ms: ordered[7], memory: { ...renderer.info.memory }, trees: g.renderReport().trees, batches: g.treeBatches?.report() ?? null };
  });
  const opening = await measure();
  await page.evaluate(() => { const g = window.mycelia.game; g.enableSteward(); g.warmUp(180); g.setSpeed(0); });
  const mature = await measure();
  const result = { at: new Date().toISOString(), cpu: cpus()[0]?.model, ramGiB: Math.round(totalmem()/2**30), report: await readRenderReport(page), opening, mature };
  const index = process.argv.indexOf('--out');
  if (index >= 0) { mkdirSync('design/shots', { recursive: true }); writeFileSync(process.argv[index + 1], JSON.stringify(result, null, 2)); }
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); server.stop(); }
