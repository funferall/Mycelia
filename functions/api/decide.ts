/**
 * Cloudflare Pages Function: `/api/decide`, the production decision relay.
 * Keys are Pages secrets (`wrangler pages secret put TYPESAFE_API_KEY`), never
 * shipped to the browser. See `server/decide.ts`.
 */
import { handle, type DecideEnv } from '../../server/decide';

interface Context { request: Request; env: DecideEnv }

export async function onRequest({ request, env }: Context): Promise<Response> {
  let body: unknown = null;
  if (request.method === 'POST') {
    try { body = await request.json(); } catch { body = null; }
  }
  const result = await handle(request.method, body, env, (url, init) => fetch(url, init));
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
