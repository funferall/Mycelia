import type { Game } from '../game';

/** URL-gated bench, intentionally labelled as synthetic test state. */
export async function mountLab(game: Game, scene: string): Promise<void> {
  const scenes = ['water', 'forest', 'region', 'growth', 'crossing'];
  const selected = scenes.includes(scene) ? scene : 'water';
  await game.prepareLab(selected);
  const bench = document.createElement('details');
  bench.className = 'test-bench';
  bench.open = true;
  bench.innerHTML = `<summary>Test specimen</summary>
    <p>Fixture resources · paused at entry</p>
    <p data-crossing hidden><output data-crossing-report></output></p>
    <label>Scene <select aria-label="Test scene">${scenes.map(name => `<option value="${name}">${name}</option>`).join('')}</select></label>
    <button type="button" data-step>Advance 10 seconds</button>
    <label data-water>Water depth <input aria-label="Test water depth" type="range" min="10" max="112" step="1"><output></output></label>
    <a href="?">Exit testing</a>`;
  const select = bench.querySelector('select')!;
  select.value = selected;
  select.addEventListener('change', () => {
    const url = new URL(location.href);
    url.searchParams.set('lab', select.value);
    location.assign(url);
  });
  bench.querySelector('[data-step]')!.addEventListener('click', () => {
    game.advanceLab(10);
    sync();
  });
  const depth = bench.querySelector('input')!;
  const output = bench.querySelector('output')!;
  const waterLabel = bench.querySelector<HTMLElement>('[data-water]')!;
  const crossingBox = bench.querySelector<HTMLElement>('[data-crossing]')!;
  const crossingOut = bench.querySelector<HTMLElement>('[data-crossing-report]')!;
  const note = bench.querySelector<HTMLElement>('p')!;
  const isWater = selected === 'water' || selected === 'region';
  waterLabel.hidden = !isWater;
  crossingBox.hidden = selected !== 'crossing';
  if (selected === 'crossing') {
    note.textContent = 'Headless fixture: one colony crossing one shared edge. Nothing is drawn from it yet.';
  }
  const sync = () => {
    const crossing = game.crossingReport();
    if (crossing) {
      crossingOut.textContent = crossing.join(' | ');
      return;
    }
    if (!isWater) return;
    depth.value = String(game.renderReport().water.tableCm);
    output.value = `${depth.value} cm`;
  };
  depth.addEventListener('input', () => {
    game.setLabWaterDepth(Number(depth.value));
    output.value = `${depth.value} cm`;
  });
  sync();
  document.body.append(bench);
}
