import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';
import { handle, type DecideEnv } from './server/decide';

/**
 * `/api/decide` in development and preview, mirroring the Pages Function in
 * `functions/api/decide.ts`. Keys come from `.env.local` (git-ignored) and
 * stay in this Node process; the browser only ever talks to the relay.
 */
function decisionRelay(env: DecideEnv): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', async () => {
      let body: unknown = null;
      if (chunks.length) {
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = null; }
      }
      const result = await handle(req.method ?? 'GET', body, env, (url, init) => fetch(url, init));
      res.statusCode = result.status;
      res.setHeader('content-type', 'application/json');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify(result.body));
    });
  };
  return {
    name: 'mycelia-decision-relay',
    configureServer(server) { server.middlewares.use('/api/decide', middleware); },
    configurePreviewServer(server) { server.middlewares.use('/api/decide', middleware); },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '') as DecideEnv;
  return {
    // Cloudflare Pages serves the static bundle from the build root, so keep
    // asset URLs relative enough to survive being mounted at any subpath.
    base: './',
    plugins: [decisionRelay(env)],
    build: {
      target: 'es2022',
      outDir: 'dist',
      assetsInlineLimit: 0,
      sourcemap: false,
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
    },
  };
});
