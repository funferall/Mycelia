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
    <div data-crossing hidden>
      <output data-crossing-report></output>
      <div class="test-bench-row">
        <button type="button" data-section-prev aria-label="Previous section">Previous</button>
        <button type="button" data-section-next aria-label="Next section">Next</button>
        <button type="button" data-section-flip aria-label="Flip section axis">Flip</button>
        <button type="button" data-section-follow aria-label="Follow connection">Follow</button>
      </div>
      <div class="test-bench-row">
        <button type="button" data-section-return aria-label="Return to forest">Return to forest</button>
        <button type="button" data-surface-here aria-label="Surface here">Surface here</button>
        <button type="button" data-reveal-toggle aria-pressed="false" aria-label="Reveal the network">Network</button>
      </div>
      <output data-section-report></output>
      <output data-reveal-report></output>
    </div>
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
  const sectionOut = bench.querySelector<HTMLElement>('[data-section-report]')!;
  const revealOut = bench.querySelector<HTMLElement>('[data-reveal-report]')!;
  const revealButton = bench.querySelector<HTMLButtonElement>('[data-reveal-toggle]')!;
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
    note.textContent = 'Crossing fixture: one colony across one shared edge. Browse its real sections, and reveal it over the forest.';
    const act = (selector: string, run: () => unknown) => {
      bench.querySelector<HTMLButtonElement>(selector)!.addEventListener('click', () => {
        const result = run() as { ok?: boolean; message?: string } | undefined;
        if (result && typeof result.message === 'string') note.textContent = result.message;
        sync();
      });
    };
    // Descending opens the first section; the rest move within what is open.
    act('[data-section-prev]', () => {
      if (!game.sectionReport().open) return game.openFirstSection();
      return game.stepSection(-1);
    });
    act('[data-section-next]', () => {
      if (!game.sectionReport().open) return game.openFirstSection();
      return game.stepSection(1);
    });
    act('[data-section-flip]', () => {
      if (!game.sectionReport().open) return game.openFirstSection();
      return game.flipSectionAxis();
    });
    act('[data-section-follow]', () => {
      if (!game.sectionReport().open) return game.openFirstSection();
      return game.followConnection();
    });
    act('[data-section-return]', () => game.returnToForest());
    act('[data-surface-here]', () => game.surfaceHere());
    revealButton.addEventListener('click', () => {
      const on = game.toggleReveal();
      revealButton.setAttribute('aria-pressed', String(on));
      sync();
    });
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
      const section = game.sectionReport();
      sectionOut.textContent = section.open
        ? `Section: ${section.label} | strands ${section.strands} | marks ${section.marks}`
        : 'Section: none open. Previous, Next or Follow opens one.';
      const reveal = game.revealReport();
      const pick = reveal.pick
        ? ` | picked ${reveal.pick.key} at ${reveal.pick.depthCm.toFixed(1)}cm` +
          (reveal.pick.alternatives > 0 ? ` (+${reveal.pick.alternatives} stacked)` : '')
        : '';
      revealOut.textContent =
        `Reveal: ${reveal.enabled ? 'on' : 'off'} | ${reveal.strands} strands | ${reveal.draws} draws` +
        (reveal.slice ? ` | slice ${reveal.slice}` : '') +
        pick;
      revealButton.setAttribute('aria-pressed', String(reveal.enabled));
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
