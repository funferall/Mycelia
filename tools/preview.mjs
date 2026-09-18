/**
 * A built preview for the browser checks to point at.
 *
 * The checks never run against the dev server: hot reload can interrupt a
 * session mid-check, and the built bundle is what actually ships.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function startPreview(port) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  if (!existsSync(fileURLToPath(new URL('../dist/index.html', import.meta.url)))) {
    throw new Error('no build in dist/. Run `npm run build` first.');
  }
  const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
  const server = spawn(
    process.execPath,
    [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: root, stdio: 'ignore' }
  );
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      server.kill();
      throw new Error(`preview server never answered on ${url}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { url, stop: () => server.kill() };
}
