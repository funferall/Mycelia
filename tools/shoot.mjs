/**
 * Visual QA harness.
 *
 * Opens the running dev server in headless Chromium with a software WebGL
 * backend, waits for the simulation to settle, and writes a screenshot. Also
 * reports any console errors, because a black canvas and a thrown exception
 * look identical in a PNG.
 *
 *   node tools/shoot.mjs --url http://127.0.0.1:5174 --out design/shots/01.png
 *   node tools/shoot.mjs --out a.png --out b.png --at 12000 --size 1600x1000
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { join } from 'node:path';

function argAll(name) {
  const out = [];
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}` && args[i + 1]) out.push(args[i + 1]);
  }
  return out;
}
function arg(name, fallback) {
  return argAll(name)[0] ?? fallback;
}

const url = arg('url', 'http://127.0.0.1:5174');
const outs = argAll('out');
const waitMs = Number(arg('at', 9000));
// A warmed match runs its fixed steps before the first frame, and software
// WebGL makes that slow: `?warm=300` needs about three minutes on SwiftShader.
// The default has to cover that, or the harness reports a timeout on a page
// that loaded perfectly well.
const bootTimeout = Number(arg('timeout', 300000));
const [width, height] = arg('size', '1600x1000').split('x').map(Number);
const clicks = argAll('click');
const keys = argAll('key');
const evals = argAll('eval');
const canvasOuts = argAll('canvas-out');

if (outs.length === 0 && canvasOuts.length === 0) {
  console.error('shoot: pass at least one --out <file.png> or --canvas-out <file.png>');
  process.exit(1);
}

const browser = await chromium.launch({
  // The bundled browser revision rarely matches whatever playwright expects, so
  // reuse whichever Chromium is already on the machine.
  executablePath: findChromium(),
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
  ],
});

/** Locate an installed Chromium, preferring a full build over the headless shell. */
function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), 'AppData', 'Local', 'ms-playwright');
  if (!existsSync(root)) return undefined;
  const dirs = readdirSync(root)
    .filter((name) => name.startsWith('chromium-') || name.startsWith('chromium_headless_shell-'))
    .sort()
    .reverse();
  for (const dir of dirs) {
    const candidates = [
      join(root, dir, 'chrome-win64', 'chrome.exe'),
      join(root, dir, 'chrome-win', 'chrome.exe'),
      join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
      join(root, dir, 'chrome-linux', 'chrome'),
      join(root, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
      join(root, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });

const problems = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`);
});
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

// A warmed match can spend a while running fixed steps before the first frame,
// so wait for the game to exist rather than for the load event.
await page.goto(url, { waitUntil: 'commit', timeout: 120000 });
await page
  .waitForFunction(() => Boolean(window.mycelia), null, { timeout: bootTimeout })
  .catch(() => problems.push('timed out waiting for window.mycelia'));

// Let the simulation run so the network has grown before we photograph it.
await page.waitForTimeout(waitMs);

for (const key of keys) {
  await page.keyboard.press(key);
}
for (const spot of clicks) {
  const [x, y] = spot.split(',').map(Number);
  await page.mouse.click(x, y);
  await page.waitForTimeout(600);
}

if (process.argv.includes('--freeze')) {
  await page.evaluate(() => window.mycelia?.game?.stop());
}
for (const out of outs) {
  mkdirSync(dirname(out), { recursive: true });
  // Software WebGL starves the compositor, so a full-page screenshot can time
  // out or catch a stale frame. Prefer --canvas-out for pictures of the game.
  await page
    .screenshot({ path: out, timeout: 60000 })
    .then(() => console.log(`SHOT: ${out} (${width}x${height})`))
    .catch((error) => console.log(`SHOT: ${out} FAILED — ${String(error.message).split('\n')[0]}`));
}

// The compositor does not always fold the WebGL layer into a screenshot under
// software rendering, so capture the drawing buffer directly as well. This is
// the authoritative picture of what the game actually drew.
for (const out of canvasOuts) {
  const dataUrl = await page.evaluate(() => {
    const stage = window.mycelia?.game?.stage;
    if (!stage) return null;
    stage.composer.render(0.016);
    return stage.renderer.domElement.toDataURL('image/png');
  });
  if (!dataUrl) {
    console.log(`CANVAS: ${out} — no canvas`);
    continue;
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`CANVAS: ${out}`);
}

// Report what the game thinks it is doing, not just what it looks like.
const status = await page.evaluate(() => {
  const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
  return {
    title: document.title,
    specimen: text('.specimen-line'),
    season: text('#season-name'),
    notes: text('#notes'),
    orderNote: text('#order-note'),
    record: [...document.querySelectorAll('#record dt')].map(
      (dt, i) => `${dt.textContent}=${document.querySelectorAll('#record dd')[i]?.textContent}`
    ),
    railTicks: document.querySelectorAll('.rail-tick').length,
    horizonLetters: [...document.querySelectorAll('.rail-horizon')].map((n) => n.textContent),
    canvas: (() => {
      const c = document.querySelector('#gl');
      return c ? `${c.width}x${c.height}` : null;
    })(),
  };
});
console.log('STATUS: ' + JSON.stringify(status, null, 2));

for (const expression of evals) {
  const value = await page.evaluate(expression);
  console.log('EVAL: ' + expression + '\n  => ' + JSON.stringify(value, null, 2));
}

if (problems.length > 0) {
  console.log('PROBLEMS:\n  ' + problems.slice(0, 20).join('\n  '));
} else {
  console.log('PROBLEMS: none');
}

await browser.close();
