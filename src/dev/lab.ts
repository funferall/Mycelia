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
    <div data-forest hidden>
      <label>Community <select aria-label="Test community"></select></label>
      <label>Dressing <select aria-label="Test dressing">
        <option value="on">on</option>
        <option value="off">off</option>
        <option value="medium">on · denser</option>
        <option value="dense">on · densest</option>
      </select></label>
      <output data-dressing-report></output>
    </div>
    <label>Scene <select aria-label="Test scene">${scenes.map(name => `<option value="${name}">${name}</option>`).join('')}</select></label>
    <button type="button" data-step>Advance 10 seconds</button>
    <label data-water>Water depth <input aria-label="Test water depth" type="range" min="10" max="112" step="1"><output></output></label>
    <a href="?">Exit testing</a>`;
  // The scene control specifically: the fixture panel adds its own selects
  // above it, so "the first select on the bench" is no longer the scene.
  const select = bench.querySelector<HTMLSelectElement>('[aria-label="Test scene"]')!;
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
  const forestBox = bench.querySelector<HTMLElement>('[data-forest]')!;
  const communitySelect = bench.querySelector<HTMLSelectElement>('[aria-label="Test community"]')!;
  const dressingSelect = bench.querySelector<HTMLSelectElement>('[aria-label="Test dressing"]')!;
  const dressingOut = bench.querySelector<HTMLElement>('[data-dressing-report]')!;
  const note = bench.querySelector<HTMLElement>('p')!;
  const isWater = selected === 'water' || selected === 'region';
  const isForest = selected === 'forest';
  waterLabel.hidden = !isWater;
  crossingBox.hidden = selected !== 'crossing';
  forestBox.hidden = !isForest;
  if (selected === 'crossing') {
    note.textContent = 'Headless fixture: one colony crossing one shared edge. Nothing is drawn from it yet.';
  }
  if (isForest) {
    note.textContent = 'Forest fixture: background vegetation is presentation only. Playable trees stay selectable.';
    const options = [{ id: '', label: 'Whole region', standId: -1 }, ...game.labCommunities()];
    communitySelect.replaceChildren(...options.map((entry) => {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.label;
      return option;
    }));
    communitySelect.addEventListener('change', () => {
      const result = game.focusLabCommunity(communitySelect.value === '' ? null : communitySelect.value);
      note.textContent = result.ok
        ? `Forest fixture: ${result.message}.`
        : `Forest fixture: ${result.message}.`;
      sync();
    });
    dressingSelect.addEventListener('change', () => {
      const value = dressingSelect.value;
      if (value === 'off') {
        game.setLabDressing(false);
      } else {
        game.setLabDressing(true);
        if (value === 'medium' || value === 'dense') game.setLabDressingBand(value);
      }
      sync();
    });
  }
  const sync = () => {
    const crossing = game.crossingReport();
    if (crossing) {
      crossingOut.textContent = crossing.join(' | ');
      return;
    }
    if (isForest) {
      const report = game.renderReport().dressing;
      dressingOut.textContent =
        `${report.band} band · ${report.planted} planted of ${report.decorations} placed · ` +
        `${report.draws} batches · ${report.triangles} triangles · LOD${report.tier}`;
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
