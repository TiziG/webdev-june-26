import type { GameConfig } from '../../../shared/types';
import { DIFFICULTIES } from '../../../shared/types';
import type { AppCtx } from '../main';
import { card, h, playerList } from './components';

// Kept across re-renders (every state broadcast rebuilds the screen) so the
// admin's unsaved selections survive players joining/leaving.
let cfg: GameConfig | null = null;

export function renderLobby(app: HTMLElement, ctx: AppCtx): void {
  app.dataset.screen = 'lobby';
  app.replaceChildren();

  const { state, self } = ctx;
  const rotation = state.players.filter((p) => !p.isAdmin);

  app.append(
    h(
      'header',
      { class: 'top' },
      h('span', { class: 'logo-sm' }, '🌋'),
      h('h1', {}, 'Death Hike'),
      h('span', { class: 'phase-tag' }, 'Lobby'),
    ),
    card(
      h('p', { class: 'muted' }, 'You'),
      h('p', { class: 'self-name' }, self.name, ...(self.isAdmin ? [h('span', { class: 'badge' }, 'admin')] : [])),
    ),
    card(
      h('p', { class: 'muted' }, `Players (${state.players.length})`),
      playerList(state.players, {
        selfName: self.name,
        onKick: self.isAdmin ? (name) => ctx.actions.kick(name) : undefined,
      }),
    ),
  );

  if (!self.isAdmin) {
    app.append(card(h('p', { class: 'center pulse' }, 'Waiting for the admin to start the game…')));
    return;
  }

  // --- admin: game setup ---------------------------------------------------
  cfg ??= { mapId: state.maps[0].id, turnSeconds: 15, difficulty: 'easy' };
  if (!state.maps.some((m) => m.id === cfg!.mapId)) cfg.mapId = state.maps[0].id;

  const mapSelect = h('select', { class: 'input' }) as HTMLSelectElement;
  for (const m of state.maps) {
    const opt = h('option', { value: m.id }, `${m.name} — ${m.width} × ${m.height}`) as HTMLOptionElement;
    opt.selected = m.id === cfg.mapId;
    mapSelect.append(opt);
  }
  mapSelect.onchange = () => (cfg!.mapId = mapSelect.value);

  const secondsInput = h('input', {
    class: 'input',
    type: 'number',
    min: '3',
    max: '1200',
    inputmode: 'numeric',
    value: String(cfg.turnSeconds),
  }) as HTMLInputElement;
  secondsInput.onchange = () => (cfg!.turnSeconds = Number(secondsInput.value));

  const diffWrap = h('div', { class: 'diff-options' });
  for (const d of DIFFICULTIES) {
    const radio = h('input', { type: 'radio', name: 'difficulty', value: d.id }) as HTMLInputElement;
    radio.checked = d.id === cfg.difficulty;
    radio.onchange = () => (cfg!.difficulty = d.id);
    diffWrap.append(
      h(
        'label',
        { class: 'diff-option' },
        radio,
        h('span', {}, h('strong', {}, d.label), h('small', {}, d.hint)),
      ),
    );
  }

  const error = h('p', { class: 'form-error' });
  const startBtn = h('button', { class: 'btn', type: 'button' }, '▶ Start game') as HTMLButtonElement;
  startBtn.disabled = rotation.length === 0;
  startBtn.onclick = () => {
    startBtn.disabled = true;
    ctx.actions.start(cfg!, (err) => {
      // On success the broadcast switches everyone to the game screen.
      error.textContent = err ?? '';
      startBtn.disabled = false;
    });
  };

  app.append(
    card(
      h('p', { class: 'muted' }, 'Game setup'),
      h('label', { class: 'field' }, h('span', {}, 'Map'), mapSelect),
      h('label', { class: 'field' }, h('span', {}, 'Seconds per turn'), secondsInput),
      h('p', { class: 'field-label' }, 'Difficulty'),
      diffWrap,
      startBtn,
      rotation.length === 0 ? h('p', { class: 'muted center' }, 'Waiting for at least one player…') : '',
      error,
    ),
  );
}
