/** One entry point to the existing feature checks, always running current code. */
import { spawnSync } from 'node:child_process';
const suites = {
  water: ['test-water.mjs', 'test-water-view.mjs'],
  simulation: ['test-sim.mjs'],
  region: ['test-region.mjs'],
  lod: ['test-lod.mjs'],
  batches: ['test-batches.mjs'],
  assets: ['check-forest-assets.mjs'],
  spatial: ['test-spatial.mjs'],
  crossing: ['test-crossing.mjs'],
  dressing: ['test-dressing.mjs', 'test-dressing-view.mjs'],
  views: [null, 'test-view.mjs'],
  navigation: [null, 'test-navigation.mjs'],
  journey: [null, 'test-journey.mjs'],
};
const args = process.argv.slice(2);
const feature = args.find(arg => !arg.startsWith('--'));
if (!feature || args.includes('--list')) {
  console.log('npm run test:feature -- <feature> [--browser] [--normal] [--full]\n');
  for (const [name, [logic, browser]] of Object.entries(suites))
    console.log(`${name.padEnd(12)} ${logic ? 'headless' : 'browser'}${logic && browser ? '; add --browser for visual checks' : ''}`);
} else {
  if (!suites[feature]) throw new Error(`Unknown feature: ${feature}. Use --list.`);
  const [logic, browser] = suites[feature];
  const run = (file, extra = []) => {
    const result = spawnSync(process.execPath, [file, ...extra], { stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  };
  if (logic) run(`tools/${logic}`);
  if (browser && (!logic || args.includes('--browser'))) {
    run('node_modules/typescript/bin/tsc', ['--noEmit']);
    run('node_modules/vite/bin/vite.js', ['build']);
    const scope = feature === 'views' && !args.includes('--full') ? ['--smoke'] : [];
    run(`tools/${browser}`, ['--qa', args.includes('--normal') ? 'normal' : 'fast', ...scope]);
  }
}
