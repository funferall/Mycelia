import './styles.css';
import { Game } from './game';
import { qualityFromSearch } from './render/quality';
import { SheetUI } from './ui/sheet';

/**
 * Mycelia — entry point.
 *
 * The whole game is client-side: no server, no accounts, no network calls. That
 * is a product constraint from the spec (hosting must stay near $5/month), and
 * it is also why the simulation is deterministic and self-contained.
 */

function boot(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#gl');
  if (!canvas) throw new Error('mycelia: no canvas');

  const ui = new SheetUI();

  let game: Game;
  try {
    game = new Game(canvas, ui, seedFromLocation(), qualityFromSearch(location.search));
  } catch (error) {
    // WebGL is the one hard requirement. Say so in the sheet's own voice rather
    // than leaving a blank page.
    const message = document.createElement('p');
    message.className = 'noscript';
    message.textContent =
      'This specimen needs WebGL. The sheet could not be opened in this browser.';
    document.querySelector('#sheet')?.append(message);
    throw error;
  }

  const warm = Number(new URLSearchParams(location.search).get('warm') ?? 0);
  if (new URLSearchParams(location.search).has('steward')) {
    game.enableSteward();
  }
  if (Number.isFinite(warm) && warm > 0) {
    // Warm before the first frame so the opening view is already a grown
    // network rather than a spore.
    game.warmUp(warm);
  }
  game.start();
  if (warm <= 0) ui.setNote('Awaken the spore when you are ready.');

  // A handle for the visual QA harness and for poking at a match from devtools.
  (window as unknown as { mycelia?: unknown }).mycelia = { game, ui };
}

/**
 * Matches are named rather than numbered, so a map can be shared as a word.
 */
function seedFromLocation(): string {
  const params = new URLSearchParams(location.search);
  const seed = params.get('seed');
  return seed && seed.trim().length > 0 ? seed.trim().slice(0, 48) : 'raven-wood';
}

boot();
