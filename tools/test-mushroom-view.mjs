import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launchBrowser, waitForGame } from './browser.mjs';
import { startPreview } from './preview.mjs';

const server = await startPreview(4181);
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(`${server.url}/?qa=fast`, { waitUntil: 'commit' });
  await waitForGame(page);
  await page.evaluate(() => window.mycelia.game.stop());
  await page.waitForFunction(() => {
    const a = window.mycelia.game.assets;
    return ['porcini-button','porcini-opening','porcini-mature','chanterelle','amethyst-deceiver'].every(k => a.has('fungus.'+k));
  });
  const result = await page.evaluate(() => {
    const game = window.mycelia.game;
    const names = group => { const n=[]; group.traverse(o => { if (o.isMesh) n.push(o.name); }); return n; };
    const stages = [];
    for (const [stage,progress,bloomed] of [['primordium',.2,false],['rising',1,false],['bloom',1,true]]) {
      game.living.syncBodies([{stage}]);
      game.fruiting.update(1,[{key:'specimen',point:{x:0,y:0,z:0},progress,bloomed}]);
      stages.push({stage,soil:names(game.living.group),surface:names(game.fruiting.group)});
    }
    // Force a late-load path using the real procedural fallback and library.
    game.living.syncBodies([]);
    const originalHas=game.assets.has, originalInstance=game.assets.instance;
    game.assets.has = () => false;
    game.assets.instance = () => null;
    game.living.syncBodies([{stage:'primordium'}]);
    const fallback=game.living.report();
    game.assets.has=originalHas; game.assets.instance=originalInstance;
    game.living.syncBodies([{stage:'primordium'}]);
    const recovered=game.living.report();
    // Synthetic bloom for the ordinary underground scene, not an earned match.
    const root=game.sim.player.nodes[0];
    game.sim.player.blooms.push({gx:root.wx,gy:root.wy,at:game.sim.time});
    return {stages,fallback,recovered,assets:game.renderReport().assets};
  });
  for (const [i,kind] of ['button','opening','mature'].entries()) {
    assert(result.stages[i].soil.some(n => n.startsWith('porcini-'+kind)), JSON.stringify(result.stages[i]));
    assert(result.stages[i].surface.some(n => n.startsWith('porcini-'+kind)), JSON.stringify(result.stages[i]));
  }
  assert.equal(result.fallback.authored, 0);
  assert.equal(result.recovered.authored, 1);
  assert.equal(result.assets.failures, 0);
  await page.locator('#view-underground').click();
  await page.evaluate(() => {
    const game=window.mycelia.game;
    for(let i=0;i<25;i++) game.frame(game.lastFrame+100,false);
    game.frame(game.lastFrame+100,true);
  });
  mkdirSync('design/shots',{recursive:true});
  await page.screenshot({path:'design/shots/porcini-in-game.png',timeout:60000});
  assert.deepEqual(errors,[]);
  console.log('PASS browser: all five assets load; three porcini stages in both views; soil late-load recovery; zero runtime errors. Synthetic fixture, fast QA.');
} finally { await browser.close(); server.stop(); }
