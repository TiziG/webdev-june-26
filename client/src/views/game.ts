import type { Direction, GameView, LastMove, RankingEntry } from '../../../shared/types';
import { DIFFICULTIES } from '../../../shared/types';
import type { AppCtx } from '../main';
import { card, h, playerList } from './components';

const ARROW: Record<Direction, string> = { up: '↑', down: '↓', left: '←', right: '→' };
const DIR_LABEL: Record<Direction, string> = { up: 'up', down: 'down', left: 'left', right: 'right' };

let tick: number | null = null;

/** Clear the countdown interval of the previous render. */
export function disposeGameView(): void {
  if (tick !== null) {
    clearInterval(tick);
    tick = null;
  }
}

export function renderGame(app: HTMLElement, ctx: AppCtx): void {
  app.dataset.screen = 'game';
  app.replaceChildren();

  const { state, self } = ctx;
  const g = state.game!;
  const phase = state.phase;
  const diffLabel = DIFFICULTIES.find((d) => d.id === g.difficulty)?.label ?? g.difficulty;

  app.append(
    h(
      'header',
      { class: 'top' },
      h('span', { class: 'logo-sm' }, '🌋'),
      h('h1', {}, 'Death Hike'),
      h('span', { class: 'phase-tag' }, `Attempt ${g.attempt}`),
      h('span', { class: 'phase-tag dim' }, diffLabel),
    ),
  );

  // --- board ---------------------------------------------------------------
  if (g.difficulty === 'no-context' && phase !== 'won') {
    app.append(
      card(
        h('p', { class: 'grid-text' }, `Grid: ${g.width} wide × ${g.height} high`),
        h('p', { class: 'muted center' }, 'Start: bottom left · Goal: top right'),
      ),
    );
  } else {
    app.append(buildGrid(g));
  }

  // --- phase panel -----------------------------------------------------------
  if (phase === 'thinking') {
    app.append(thinkingPanel(g, ctx));
  } else if (phase === 'move-result') {
    app.append(resultPanel(g.lastMove!));
  } else {
    app.append(wonPanel(g));
  }

  // --- admin extras ----------------------------------------------------------
  if (self.isAdmin) {
    const endBtn = h('button', { class: 'btn danger', type: 'button' }, 'End game') as HTMLButtonElement;
    endBtn.onclick = () => {
      if (confirm('End the game and send everyone back to the lobby?')) ctx.actions.end();
    };
    app.append(
      h('div', { class: 'divider' }, 'Admin'),
      card(
        h('p', { class: 'muted' }, `Players (${state.players.length})`),
        playerList(state.players, { selfName: self.name, onKick: (name) => ctx.actions.kick(name) }),
        endBtn,
      ),
    );
  }

  // --- countdown wiring --------------------------------------------------------
  if (g.phaseEndsAt !== null && g.phaseDurationMs !== null) {
    const endsAt = g.phaseEndsAt;
    const duration = g.phaseDurationMs;
    const update = () => {
      const remaining = Math.max(0, endsAt - ctx.now());
      for (const el of app.querySelectorAll('[data-count]')) {
        el.textContent = String(Math.ceil(remaining / 1000));
      }
      const bar = app.querySelector<HTMLElement>('[data-bar]');
      if (bar) bar.style.width = `${(remaining / duration) * 100}%`;
    };
    update();
    tick = window.setInterval(update, 100);
  }
}

function buildGrid(g: GameView): HTMLElement {
  const grid = h('div', { class: 'grid' });
  grid.style.gridTemplateColumns = `repeat(${g.width}, 1fr)`;
  const stepped = new Set(g.steppedTiles.map((t) => `${t.x},${t.y}`));
  const lava = new Set((g.lavaTiles ?? []).map((t) => `${t.x},${t.y}`));

  for (let y = g.height - 1; y >= 0; y--) {
    for (let x = 0; x < g.width; x++) {
      const key = `${x},${y}`;
      const isFigure = g.figure?.x === x && g.figure?.y === y;
      const isGoal = x === g.width - 1 && y === g.height - 1;
      const isStart = x === 0 && y === 0;
      const cls = [
        'tile',
        isStart && 'start',
        isGoal && 'goal',
        stepped.has(key) && 'stepped',
        lava.has(key) && 'lava',
        isFigure && 'figure',
      ]
        .filter(Boolean)
        .join(' ');
      const glyph = isFigure ? (isGoal ? '🏆' : '🚶‍♂️‍➡️🚶‍♀️‍➡️🚶‍♂️‍➡️') : lava.has(key) ? '🌋' : isGoal ? '🌄' : isStart ? '🏠' : '';
      grid.append(h('div', { class: cls }, glyph));
    }
  }
  return h('div', { class: 'grid-wrap' }, grid);
}

function thinkingPanel(g: GameView, ctx: AppCtx): HTMLElement {
  const isMe = g.currentPlayerName?.toLowerCase() === ctx.self.name.toLowerCase();
  const panel = card(
    h('p', { class: 'turn-title' }, isMe ? '🎯 Your move!' : `🎯 ${g.currentPlayerName ?? '…'} is choosing…`),
    countdown(),
  );

  if (isMe) {
    const dpad = h('div', { class: 'dpad' });
    for (const dir of ['up', 'left', 'down', 'right'] as Direction[]) {
      const btn = h('button', { class: `dpad-btn ${dir}`, type: 'button', 'aria-label': dir }, ARROW[dir]) as HTMLButtonElement;
      btn.onclick = () => {
        for (const b of dpad.querySelectorAll('button')) b.disabled = true;
        ctx.actions.move(dir);
      };
      dpad.append(btn);
    }
    panel.append(dpad);
  }
  return panel;
}

function resultPanel(lm: LastMove): HTMLElement {
  const moveLine =
    lm.direction !== null
      ? h('p', { class: 'move-line' }, h('span', { class: 'big-arrow' }, ARROW[lm.direction]), `${lm.playerName} moved ${DIR_LABEL[lm.direction]}`)
      : h('p', { class: 'move-line' }, h('span', { class: 'big-arrow' }, '⏰'), `${lm.playerName} didn't choose in time`);

  if (lm.outcome === 'valid') {
    return card(
      moveLine,
      h('p', { class: 'result ok' }, '✅ Safe!'),
      h('p', { class: 'muted center' }, 'Next turn in ', h('span', { 'data-count': '' }), 's'),
      countdown(false),
    );
  }

  const reason =
    lm.outcome === 'lava'
      ? 'The figure stepped into lava. 🔥'
      : lm.outcome === 'off-board'
        ? 'The figure fell off the board. 🕳️'
        : 'Time ran out. ⏰';
  return card(
    moveLine,
    h('p', { class: 'result fail' }, '💀 Attempt failed'),
    h('p', { class: 'muted center' }, reason),
    h('p', { class: 'muted center' }, 'The figure returns to start. New attempt in ', h('span', { 'data-count': '' }), 's'),
    countdown(false),
  );
}

function wonPanel(g: GameView): HTMLElement {
  const lm = g.lastMove!;
  const panel = card(
    h('p', { class: 'result win' }, '🏆 You made it!'),
    lm.direction !== null
      ? h('p', { class: 'center' }, `${lm.playerName} moved ${DIR_LABEL[lm.direction]} — straight onto the goal.`)
      : '',
    h('p', { class: 'muted center' }, 'The lava field is revealed above.'),
  );
  if (g.ranking && g.ranking.length > 0) panel.append(rankingSection(g.ranking));
  panel.append(h('p', { class: 'muted center pulse' }, 'Waiting for the admin to end the game…'));
  return panel;
}

function rankingSection(ranking: RankingEntry[]): HTMLElement {
  const wrap = h('div', { class: 'ranking' }, h('p', { class: 'muted' }, 'Fewest avoidable mistakes'));
  // Players with the same mistake count share one rank row.
  const groups = new Map<number, string[]>();
  for (const r of ranking) {
    if (!groups.has(r.mistakes)) groups.set(r.mistakes, []);
    groups.get(r.mistakes)!.push(r.name);
  }
  let rank = 0;
  for (const [mistakes, names] of groups) {
    rank++;
    wrap.append(
      h(
        'div',
        { class: 'rank-row' },
        h('span', { class: 'rank-pos' }, rank === 1 ? '🥇' : `#${rank}`),
        h('span', { class: 'rank-names' }, names.join(', ')),
        h('span', { class: 'rank-mistakes' }, `${mistakes} ${mistakes === 1 ? 'mistake' : 'mistakes'}`),
      ),
    );
  }
  return wrap;
}

function countdown(withNumber = true): HTMLElement {
  return h(
    'div',
    { class: 'countdown' },
    withNumber ? h('p', { class: 'count-num', 'data-count': '' }) : '',
    h('div', { class: 'bar' }, h('div', { class: 'bar-fill', 'data-bar': '' })),
  );
}
