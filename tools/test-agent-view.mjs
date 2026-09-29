/**
 * Browser check for agent players: the relay answers on `/api/decide`, the
 * opponent picker lists providers (unconfigured ones say so), and with
 * `?opponent=local` the offline agent plays the rival and reports decisions.
 */
import assert from 'node:assert/strict';
import { collectProblems, launchBrowser } from './browser.mjs';
import { startPreview } from './preview.mjs';

const server = await startPreview(4207);
let browser;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const problems = collectProblems(page);
  page.setDefaultTimeout(120000);
  const relay = await (await fetch(`${server.url}/api/decide`)).json();
  assert.deepEqual(Object.keys(relay.providers).sort(), ['jev', 'openai'], 'the relay reports its providers');
  const refused = await fetch(`${server.url}/api/decide`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'jev', state: {}, questions: {} }) });
  assert.equal(refused.status, 422, 'an empty question set is refused');
  await page.goto(`${server.url}/?start=best&seed=raven-wood&qa=fast&opponent=local`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.mycelia?.game?.match));
  await page.evaluate(() => window.mycelia.game.stop());
  const result = await page.evaluate(async () => {
    const g = window.mycelia.game;
    // The clock waits for the player; advance the match itself, one frame per second of play.
    for (let i = 0; i < 6; i++) {
      for (let s = 0; s < 60; s++) g.match.step(1 / 60);
      g.frame(g.lastFrame + 16, false);
      await new Promise((r) => setTimeout(r, 0));
    }
    g.frame(g.lastFrame + 16, true);
    const agent = g.agentUI.controller;
    return {
      selected: document.querySelector('#agent-provider').value,
      options: [...document.querySelectorAll('#agent-provider option')].map((o) => o.textContent),
      readout: document.querySelector('.agent-readout').textContent,
      decisions: agent?.decisions ?? 0,
      botsHasRival: g.match.contact.bots.has('rival'),
    };
  });
  assert.equal(result.selected, 'local');
  assert(result.decisions >= 2, `the agent decides (${JSON.stringify(result)})`);
  assert.equal(result.botsHasRival, false, 'the agent, not the placeholder, plays the rival');
  assert.match(result.readout, /heuristic/);
  if (!relay.providers.jev) assert(result.options.some((o) => /Jev.*not configured/.test(o)), 'an unconfigured provider says so');
  assert.deepEqual(problems, [], `no page errors: ${problems.join('\n')}`);
  console.log(`PASS agent browser: relay reports ${JSON.stringify(relay.providers)}, refuses bad requests; ?opponent=local played ${result.decisions} decisions ("${result.readout}")`);
} finally {
  await browser?.close();
  server.stop();
}
