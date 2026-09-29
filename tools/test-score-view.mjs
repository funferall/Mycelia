/**
 * The score in the built game: sound starts on a real click, is audible but
 * never clips, keeps changing, thunders on demand, and falls silent when
 * toggled off. Also records what it played, for listening.
 *
 *   npm run test:score-view            # software rendering is fine; audio is CPU
 *   node tools/test-score-view.mjs --seconds 90 --out design/audio/score.webm
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { launchBrowser } from './browser.mjs';
import { startPreview } from './preview.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const seconds = Number(arg('seconds', 45));
const out = arg('out', null);

const server = await startPreview(4231);
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${server.url}/?start=best&seed=raven-wood`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.mycelia?.game?.match));
  await page.click('#sound');
  assert.equal(await page.getAttribute('#sound', 'aria-pressed'), 'true', 'the button reports sound on');

  const result = await page.evaluate(async (seconds) => {
    const sound = window.mycelia.game.sound;
    const ctx = sound.context;
    const tap = ctx.createMediaStreamDestination();
    sound.master.connect(tap);
    const recorder = new MediaRecorder(tap.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 160000 });
    const chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.start(1000);
    const levels = [];
    let peak = 0;
    const data = new Float32Array(sound.analyser.fftSize);
    const started = performance.now();
    let thundered = false, thunderLevel = 0;
    while (performance.now() - started < seconds * 1000) {
      await new Promise((r) => setTimeout(r, 200));
      sound.analyser.getFloatTimeDomainData(data);
      for (const v of data) peak = Math.max(peak, Math.abs(v));
      const level = sound.level();
      levels.push(level);
      const t = (performance.now() - started) / 1000;
      if (!thundered && t > seconds * 0.6) {
        thundered = true;
        sound.thunder(ctx.currentTime + 0.05, 1);
      }
      if (thundered && t < seconds * 0.6 + 2.5) thunderLevel = Math.max(thunderLevel, level);
    }
    recorder.stop();
    await new Promise((r) => { recorder.onstop = r; });
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { levels, peak, thunderLevel, state: ctx.state, audio: btoa(binary), rootIndex: sound.rootIndex };
  }, seconds);

  const settled = result.levels.slice(Math.floor(result.levels.length * 0.25));
  const mean = settled.reduce((v, x) => v + x, 0) / settled.length;
  const min = Math.min(...settled), max = Math.max(...settled);
  console.log(`context ${result.state}; RMS mean ${mean.toFixed(4)}, range ${min.toFixed(4)}–${max.toFixed(4)}; peak ${result.peak.toFixed(3)}; thunder ${result.thunderLevel.toFixed(4)}; fields reached ${result.rootIndex}`);
  assert.equal(result.state, 'running', 'the audio context runs after the click');
  assert.ok(mean > 0.005, `the score is audible (RMS ${mean})`);
  assert.ok(result.peak < 0.99, `the score never clips (peak ${result.peak})`);
  assert.ok(max - min > mean * 0.1, 'the score moves rather than sitting on one level');
  assert.ok(result.thunderLevel > mean, 'thunder rises above the score');

  await page.click('#sound');
  await page.waitForTimeout(5000);
  const quiet = await page.evaluate(() => window.mycelia.game.sound.level());
  assert.ok(quiet < 0.002, `toggling off falls silent (RMS ${quiet})`);
  assert.deepEqual(errors, [], 'no browser errors');

  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(result.audio, 'base64'));
    console.log(`RECORDED ${out} (${seconds}s)`);
  }
  console.log('PASS score browser: starts on a click, audible, never clips, moves, thunders, falls silent when off, no errors.');
} finally {
  await browser.close();
  server.stop();
}
