/**
 * Record the score to WAV files for listening, from the built game.
 *
 *   npm run build && node tools/record-score.mjs [--out design/shots/audio]
 *
 * Writes score.wav (the regular score) and storm.wav, fire.wav, drought.wav:
 * each theme clip starts on the regular score, fades the theme in through
 * `sound.preview()`, then hands back so the fade out is heard too. Runs on
 * the hardware GPU so rendering does not starve the audio thread.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser } from './browser.mjs';
import { startPreview } from './preview.mjs';

const outIndex = process.argv.indexOf('--out');
const outDir = outIndex >= 0 ? process.argv[outIndex + 1] : 'design/shots/audio';
mkdirSync(outDir, { recursive: true });

/** [file, seconds before the theme, seconds of theme, seconds after]. */
const CLIPS = [
  ['score', null, 0, 75, 0],
  ['storm', 'storm', 8, 50, 16],
  ['fire', 'fire', 8, 50, 16],
  ['drought', 'drought', 8, 50, 16],
];

const server = await startPreview(4233);
const browser = await launchBrowser({ gpu: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.setDefaultTimeout(600000);
  await page.goto(`${server.url}/?seed=raven-wood`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.mycelia?.game?.match));
  await page.click('#sound');
  await page.waitForTimeout(3000);
  for (const [name, theme, before, during, after] of CLIPS) {
    const pcm = await page.evaluate(async ([theme, before, during, after]) => {
      const sound = window.mycelia.game.sound;
      const ctx = sound.context;
      const tap = ctx.createScriptProcessor(4096, 2, 2);
      const left = [], right = [];
      tap.onaudioprocess = (e) => {
        left.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        right.push(new Float32Array(e.inputBuffer.getChannelData(1)));
      };
      const sink = ctx.createGain();
      sink.gain.value = 0;
      sound.master.connect(tap);
      tap.connect(sink).connect(ctx.destination);
      const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
      await wait(before);
      if (theme) sound.preview(theme);
      await wait(during);
      if (theme) sound.preview(null);
      await wait(after);
      sound.master.disconnect(tap);
      tap.disconnect();
      // Interleave to 16-bit and return as base64.
      const frames = left.reduce((v, b) => v + b.length, 0);
      const out = new Int16Array(frames * 2);
      let at = 0;
      for (let b = 0; b < left.length; b++) {
        for (let i = 0; i < left[b].length; i++) {
          out[at++] = Math.max(-1, Math.min(1, left[b][i])) * 32767;
          out[at++] = Math.max(-1, Math.min(1, right[b][i])) * 32767;
        }
      }
      const bytes = new Uint8Array(out.buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { rate: ctx.sampleRate, data: btoa(binary) };
    }, [theme, before, during, after]);
    const data = Buffer.from(pcm.data, 'base64');
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(2, 22);
    header.writeUInt32LE(pcm.rate, 24);
    header.writeUInt32LE(pcm.rate * 4, 28);
    header.writeUInt16LE(4, 32);
    header.writeUInt16LE(16, 34);
    header.writeUInt32LE(data.length, 40);
    const file = join(outDir, `${name}.wav`);
    writeFileSync(file, Buffer.concat([header, data]));
    // Report the level so a silent or clipped file is caught here.
    const samples = new Int16Array(data.buffer, data.byteOffset, data.length / 2);
    let peak = 0, sum = 0;
    for (const s of samples) { peak = Math.max(peak, Math.abs(s)); sum += s * s; }
    console.log(`WROTE ${file}: ${(samples.length / 2 / pcm.rate).toFixed(1)}s, RMS ${(Math.sqrt(sum / samples.length) / 32767).toFixed(4)}, peak ${(peak / 32767).toFixed(3)}`);
  }
} finally {
  await browser.close();
  server.stop();
}
