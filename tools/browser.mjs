/**
 * Shared headless-browser plumbing for the visual QA tools.
 *
 * Checks run against a software WebGL backend by default. It is slow, and slow
 * is the interesting case for coherence: the game has to hold together when it
 * is nowhere near sixty frames per second. Its timings say nothing about real
 * hardware, so pass `--gpu` (or set `MYCELIA_GPU=1`) to run on the machine's
 * own GPU, and `npm run check:gpu` to confirm which one is in use.
 */
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const QA_PRESETS = ['normal', 'fast'];

/** Read `--qa fast` (or `--qa=fast`) from a browser tool's argv. */
export function parseQaPreset(args = process.argv.slice(2)) {
  const inline = args.find((argument) => argument.startsWith('--qa='));
  const index = args.indexOf('--qa');
  const value = inline ? inline.slice('--qa='.length) : index >= 0 ? args[index + 1] : undefined;
  if (!value || value.startsWith('--')) return 'normal';
  if (!QA_PRESETS.includes(value)) {
    throw new Error(`unknown QA preset "${value}"; expected ${QA_PRESETS.join(' or ')}`);
  }
  return value;
}

/**
 * Put the preset in the URL without disturbing seed, view, warm-up or any other
 * query parameter. Normal mode removes an explicit `qa` flag.
 */
export function withQaPreset(url, preset) {
  const target = new URL(url);
  if (preset === 'fast') target.searchParams.set('qa', 'fast');
  else target.searchParams.delete('qa');
  return target.toString();
}

/** The game's own render report, or null when the page never booted. */
export function readRenderReport(page) {
  return page.evaluate(() => window.mycelia?.game?.renderReport?.() ?? null);
}

/** One line that makes a QA result interpretable after the fact. */
export function formatRenderReport(report) {
  if (!report) return 'QA: render report unavailable (the game did not boot)';
  const shadows = report.groundShadows ? 'decals' : 'off';
  const shadowMaps = report.shadowMaps ? 'on' : 'off';
  return (
    `QA: preset=${report.preset} backend=${report.backend}` +
    `${report.software ? ' (software)' : ''}` +
    ` css=${report.viewport.width}x${report.viewport.height}` +
    ` buffer=${report.drawingBuffer.width}x${report.drawingBuffer.height}` +
    ` pixelRatio=${report.pixelRatio} antialias=${report.antialias ? 'on' : 'off'}` +
    ` shadows=${shadows} shadowMaps=${shadowMaps}` +
    ` bloom=${report.bloom ? 'on' : 'off'} postprocessing=${report.postprocessing ? 'on' : 'off'}` +
    ` stands=${report.stands} trees=${report.trees}`
  );
}

/** Locate an installed Chromium, preferring a full build over the headless shell. */
export function findChromium() {
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

/**
 * Whether this run should use the machine's real GPU: `--gpu` on the command
 * line or `MYCELIA_GPU=1` in the environment. Software stays the default, so
 * screenshots and checks are the same on every machine.
 */
export function wantsGpu(args = process.argv.slice(2)) {
  return args.includes('--gpu') || process.env.MYCELIA_GPU === '1';
}

/** Software WebGL (SwiftShader): identical everywhere, slow, CPU-only. */
const SOFTWARE_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'];
/**
 * The real GPU through Direct3D 11 (Windows; ANGLE picks the platform default
 * elsewhere). `--force_high_performance_gpu` matters on laptops: without it
 * Chromium takes the integrated GPU (Intel UHD here) over the discrete one.
 */
const GPU_ARGS = ['--use-gl=angle', ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []), '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--force_high_performance_gpu'];

export function launchBrowser({ gpu = wantsGpu() } = {}) {
  return chromium.launch({
    // The bundled browser revision rarely matches whatever playwright expects,
    // so reuse whichever Chromium is already on the machine.
    executablePath: findChromium(),
    args: gpu ? GPU_ARGS : SOFTWARE_ARGS,
  });
}

/** Collect console errors and page exceptions for a run. */
export function collectProblems(page, problems = []) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

/**
 * Wait for the game to exist.
 *
 * A warmed match can spend minutes running fixed steps before the first frame,
 * so wait for the handle rather than for the load event.
 */
export async function waitForGame(page, timeout = 300000) {
  await page.waitForFunction(() => Boolean(window.mycelia), null, { timeout });
}

/**
 * Soil grid coordinates to page pixels, through the game's own camera.
 *
 * A check that clicks the soil has to aim where the soil actually is, so this
 * projects the point exactly as the game projects its root labels.
 */
export function gridToPage(page, gx, gy) {
  return page.evaluate(
    ([gx, gy]) => {
      const camera = window.mycelia.game.stage.rig.camera;
      camera.updateMatrixWorld();
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      const apply = (m, x, y, z, w) => [
        m[0] * x + m[4] * y + m[8] * z + m[12] * w,
        m[1] * x + m[5] * y + m[9] * z + m[13] * w,
        m[2] * x + m[6] * y + m[10] * z + m[14] * w,
        m[3] * x + m[7] * y + m[11] * z + m[15] * w,
      ];
      const { halfWidth, halfHeight } = window.mycelia.game.viewReport().mount;
      const view = apply(camera.matrixWorldInverse.elements, gx - halfWidth, halfHeight - gy, 0, 1);
      const clip = apply(camera.projectionMatrix.elements, view[0], view[1], view[2], view[3]);
      const rect = document.querySelector('#gl').getBoundingClientRect();
      return {
        x: rect.left + ((clip[0] / clip[3] + 1) / 2) * rect.width,
        y: rect.top + ((1 - clip[1] / clip[3]) / 2) * rect.height,
      };
    },
    [gx, gy]
  );
}
