import type { PlayerInfo } from '../../../shared/types';

/**
 * Tiny DOM builder. We deliberately never use innerHTML with dynamic values —
 * usernames are user input and must always go through textContent.
 */
export function h(
  tag: string,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  e.append(...children);
  return e;
}

export function card(...children: (Node | string)[]): HTMLElement {
  return h('div', { class: 'card' }, ...children);
}

export function playerList(
  players: PlayerInfo[],
  opts: { selfName: string; onKick?: (name: string) => void },
): HTMLElement {
  const list = h('div', { class: 'player-list' });
  for (const p of players) {
    const row = h(
      'div',
      { class: 'player-row' },
      h('span', { class: `dot ${p.connected ? 'on' : 'off'}`, title: p.connected ? 'connected' : 'disconnected' }),
      h('span', { class: 'player-name' }, p.name),
    );
    if (p.isAdmin) row.append(h('span', { class: 'badge' }, 'admin'));
    if (p.name.toLowerCase() === opts.selfName.toLowerCase()) row.append(h('span', { class: 'badge you' }, 'you'));
    if (!p.connected) row.append(h('span', { class: 'badge off' }, 'offline'));
    if (opts.onKick && !p.isAdmin) {
      const btn = h('button', { class: 'btn-kick', type: 'button' }, 'Kick');
      btn.onclick = () => {
        if (confirm(`Remove ${p.name} from the lobby?`)) opts.onKick!(p.name);
      };
      row.append(btn);
    }
    list.append(row);
  }
  if (players.length === 0) list.append(h('p', { class: 'muted' }, 'Nobody here yet…'));
  return list;
}
