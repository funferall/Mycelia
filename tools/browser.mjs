/**
 * Shared headless-browser plumbing for the visual QA tools.
 *
 * Every check runs against a software WebGL backend on purpose. It is slow, and
 * slow is the interesting case here: the game has to stay coherent when it is
 * nowhere near sixty frames per second.
 */
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

export function launchBrowser() {
  return chromium.launch({
    // The bundled browser revision rarely matches whatever playwright expects,
    // so reuse whichever Chromium is already on the machine.
    executablePath: findChromium(),
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
    ],
  });
}

/** Collect console errors and page exceptions for a run. */
export function collectProblems(page) {
  const problems = [];
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
