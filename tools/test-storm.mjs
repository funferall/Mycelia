import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
const out=mkdtempSync(join(tmpdir(),'mycelia-storm-'));
for(const file of readdirSync(new URL('../src/sim/',import.meta.url)).filter(f=>f.endsWith('.ts'))) {
  writeFileSync(join(out,file.replace('.ts','.mjs')),stripTypeScriptTypes(readFileSync(new URL('../src/sim/'+file,import.meta.url),'utf8')).replace(/from '(.+?)'/g,"from '$1.mjs'"));
}
const load=name=>import(pathToFileURL(join(out,name+'.mjs')));
const {RegionalMatch,STORM}=await load('match');
const {ECON}=await load('content');
const {markConnectivity,updateTotals,startFruiting,stepNetwork}=await load('network');
const {adaptationState,learnAdaptation}=await load('evolution');

function fixture(freeze=true) {
  const m=new RegionalMatch('storm-race');
  const from=m.stands[0]; m.activeStandId=0; from.sim.hasColony=true;
  const net=from.sim.player;
  net.evolution.learned=['fruit-memory','spore-memory','deep-drink','mineral-weave'];
  net.evolution.age=300; net.fruited=1; from.released=1;
  net.nodes[0].bondedTree=0; net.nodes[1].bondedTree=1;
  for(const n of net.nodes) {n.carbon=300;n.water=100;n.nitrogen=50;}
  markConnectivity(net);updateTotals(net);
  assert.equal(learnAdaptation(net,'storm-crown'),'Storm crown learned.');
  // Lifecycle tests isolate ecology; separate tests below exercise real fruiting.
  // The flood is ecology too (it can wash out bond junctions); tools/test-flood.mjs covers it.
 if(freeze) {for(const s of m.stands)s.sim.step=()=>{};m.soil.step=()=>{};m.flood.step=()=>{};}
  return {m,from,net};
}
{
 const {m,net}=fixture();
 net.evolution.learned=net.evolution.learned.filter(x=>x!=='storm-crown');net.evolution.age=299;
 assert.notEqual(adaptationState(net,'storm-crown'),'Ready to learn');
 assert.match(m.summonStorm(0,0),/Learn Storm/);
 net.evolution.age=300;learnAdaptation(net,'storm-crown');
 const before=net.carbon;
 assert.match(m.summonStorm(0,NaN),/direction/);
 assert.equal(net.carbon,before);
 assert.equal(m.summonStorm(0,0),'Storm announced');
 assert.equal(net.carbon,before-STORM.cost.carbon);
 const paid=net.carbon;m.summonStorm(0,Math.PI);
 assert.equal(net.carbon,paid);assert.equal(m.storm.direction,0);
 const t=m.time;m.step(0);assert.equal(m.time,t);
 m.activeStandId=1;m.step(1);assert.equal(m.stormRemaining,59);
 assert.equal(m.storm.initiator,0);
 console.log('PASS capstone age/prerequisites, atomic cost, invalid direction, direction lock, pause, camera independence');
}
{
 const {m,from,net}=fixture();
 const beforeTargets=m.sporeTargets(0,0);
 assert(beforeTargets.some(id=>m.region.stands[id].sx>=2),'range reaches beyond neighbours');
 assert.equal(m.sporeTargets(0,Math.PI).length,0,'western map edge has no invented destinations');
 assert.equal(m.summonStorm(0,0),'Storm announced');
 net.fruited++;
 m.step(1);assert.equal(m.heldSpores.length,1);assert.equal(m.colonization.length,0);
 m.step(58.999);assert.equal(m.storm.phase,'warning');
 const before={carbon:net.carbon,water:net.water,nitrogen:net.nitrogen};
 m.step(.001);assert.equal(m.storm.phase,'active');assert.equal(m.heldSpores.length,0);
 const lands=m.colonization.filter(x=>x.owner!=='rival');
 assert(lands.length>=2 && lands.length<=3);
 for(const k of ['carbon','water','nitrogen']) assert(Math.abs(before[k]-net[k]-lands.length*ECON.colonyFund[k])<1e-6,'actual parent cost '+k);
 for(const land of lands) {
  const child=m.stands[land.to].sim.player;
  assert.notEqual(child,net); assert.deepEqual(child.evolution.learned,[]);
  assert.equal(child.carbon,ECON.colonyFund.carbon);
  // Freeze new daughter ecology for the remaining pure lifecycle assertions.
  m.spatialColonies.get(land.to).step=()=>{};
 }
 const count=m.colonization.length;m.step(1);assert.equal(m.colonization.length,count,'no repeated release');
 m.step(44);assert.equal(m.storm.phase,'recovery');
 assert.equal(from.released,net.fruited);
 m.step(180);assert.equal(m.storm.phase,'idle');
 assert.equal(m.summonStorm(0,Math.PI/2),'Storm announced');
 console.log('PASS warning boundary, held releases, multi-tile range, paid independent daughters, no replay, recovery/reinvoke');
}
{
 const {m,from,net}=fixture();
 m.summonStorm(0,0);
 net.fruited++;net.blooms[1]={gx:net.nodes[0].gx,gy:net.nodes[0].gy,at:0};
 m.step(1);net.nodes[0].alive=false;m.step(59);
 assert.equal(m.colonization.length,0,'dead parent loses held release');assert.equal(from.released,2);
 console.log('PASS held spores cannot resurrect a severed/dead parent');
}
{
 const {m,from}=fixture();const rival=from.sim.rival;from.rivalPresent=true;
 for(const n of rival.nodes){n.carbon=500;n.water=100;n.nitrogen=100;}
 markConnectivity(rival);updateTotals(rival);
 m.summonStorm(0,0);
 const n=rival.nodes[0];rival.surplus=ECON.fruitThreshold;
 assert(startFruiting(rival,from.sim.world,n.gx,n.gy));
 // Actual supply/weather maturation, with frost deliberately overridden by the warm front.
 const ctx={world:from.sim.world,light:1,warmth:0,rival:null,time:0,log:()=>{},dt:.25,fruitingWeather:true};
 from.sim.world.rainfall=1;
 for(let i=0;i<160&&rival.fruited===0;i++){ctx.time+=.25;stepNetwork(rival,ctx);}
 assert.equal(rival.fruited,1,'rival completes a real supplied body');
 m.step(1);assert(m.heldSpores.some(h=>h.owner==='rival'));
 m.step(59);
 const lands=m.colonization.filter(x=>x.owner==='rival');assert(lands.length>0,'rival shares directional colonization');
 for(const l of lands)assert(m.stands[l.to].rivalPresent);
 console.log('PASS real rival fruiting through frost, held opponent releases, rival colonies on the same wind');
}
{
 // Windfall mechanics, forced to certainty so every consequence is observable.
 const {m,from,net}=fixture();
 const tree=from.sim.world.trees[0];tree.maturity=1;
 tree.rootTips[0].bondedTo=net.nodes[0].id;tree.rootTips[0].bondedColonyId=net.colonyId??null;
 net.nodes[0].bondedRootTip=0;
 const rate=STORM.fallRate;STORM.fallRate=1e6;
 m.summonStorm(0,Math.PI/2);m.step(59.5);
 const stored={carbon:net.nodes[0].carbon,water:net.nodes[0].water};
 assert.equal(m.windfalls.length,0,'nothing falls during the warning');
 m.step(1);
 STORM.fallRate=rate;
 assert(tree.dead&&tree.fallen,'the bonded tree is thrown down');
 assert(Math.abs(tree.fallen.direction-Math.PI/2)<=.35+1e-9,'it falls downwind');
 assert.equal(net.nodes[0].bondedTree,-1,'the bond is severed');
 assert.equal(net.nodes[0].carbon,0,'junction stores are lost');
 assert(net.nodes[0].health<=.35&&net.nodes[0].alive,'the junction is damaged, not killed');
 const fall=m.windfalls.find(w=>w.stand===0&&w.tree===tree.id);
 assert.equal(fall.severed.length,1);assert.equal(fall.severed[0].lost.carbon,stored.carbon);
 for(const s of m.stands) assert(m.windfalls.filter(w=>w.stand===s.site.id).length<=STORM.fallsPerStand,'per-stand cap');
 console.log('PASS windfall: active-only, downwind, bond severed, junction stores lost and damaged, per-stand cap');
}
{
 // Ordinary odds: sometimes, not always. Unforced storms over many seeds.
 let total=0,trees=0,stormsWithFalls=0;
 for(let i=0;i<24;i++){
  const m=new RegionalMatch('gale-'+i);for(const s of m.stands)s.sim.step=()=>{};m.soil.step=()=>{};
  const n=m.stands[0].sim.player;n.evolution.learned=['storm-crown'];n.evolution.age=300;n.nodes[0].bondedTree=0;n.nodes[1].bondedTree=1;
  for(const x of n.nodes){x.carbon=300;x.water=100;x.nitrogen=50;}markConnectivity(n);updateTotals(n);m.stands[0].sim.hasColony=true;
  for(const s of m.stands)for(const t of s.sim.world.trees)t.maturity=Math.max(t.maturity,.8);
  assert.equal(m.summonStorm(0,0),'Storm announced');m.step(60+45);
  total+=m.windfalls.length;stormsWithFalls+=m.windfalls.length>0;
  trees+=m.stands.reduce((v,s)=>v+s.sim.world.trees.length,0);
 }
 assert(stormsWithFalls>=12,`most storms fell something (${stormsWithFalls}/24)`);
 assert(total/trees<.08,`a storm is not a clear-cut (${(100*total/trees).toFixed(1)}%)`);
 console.log(`PASS windfall odds: ${total} falls across 24 storms, ${(100*total/trees).toFixed(1)}% of trees, ${stormsWithFalls}/24 storms fell at least one`);
}
{
 function run(){const {m,net}=fixture();m.summonStorm(0,0);net.fruited++;m.step(60);m.step(45);return JSON.stringify({storm:m.storm,lands:m.colonization,falls:m.windfalls,resources:[net.carbon,net.water,net.nitrogen]});}
 assert.equal(run(),run());
 const {m,from,net}=fixture();net.fruited=2;from.sim.outcome='fruited';m.continueGrowing();assert.equal(from.sim.outcome,'playing');assert.equal(m.outcome,'playing');
 console.log('PASS deterministic replay and continuation beyond introductory victory');
}
