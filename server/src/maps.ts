import type { Tile } from '../../shared/types.js';

// Maps are drawn as ASCII art, top row first (so the drawing matches what
// players see). Legend: S = start (must be bottom-left), G = goal (must be
// top-right), L = lava, . = safe.
const RAW_MAPS: { id: string; name: string; rows: string[] }[] = [
  {
    id: 'warmup',
    name: 'Warm-up (3×4)',
    rows: [
      '.LG',
      '...',
      'L..',
      'S.L',
    ],
  },
  {
    id: 'classic',
    name: 'Classic (4×5)',
    rows: [
      '..LG',
      '.L..',
      '...L',
      'LL..',
      'S..L',
    ],
  },
  {
    id: 'medium',
    name: 'Winding (5×6)',
    rows: [
      '..L.G',
      '.L...',
      '...L.',
      'LL...',
      '...LL',
      'S.L..',
    ],
  },
  {
    id: 'hard',
    name: 'Inferno (6×7)',
    rows: [
      'L.L..G',
      'L...LL',
      '......',
      'LL.LL.',
      '......',
      '.L.L.L',
      'S...L.',
    ],
  },
];

export interface GameMap {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Keys are `${x},${y}` with y=0 at the bottom. */
  lava: Set<string>;
}

export const tileKey = (t: Tile): string => `${t.x},${t.y}`;

function parseMap(raw: (typeof RAW_MAPS)[number]): GameMap {
  const height = raw.rows.length;
  const width = raw.rows[0].length;
  const lava = new Set<string>();

  for (const [rowIdx, row] of raw.rows.entries()) {
    if (row.length !== width) throw new Error(`Map ${raw.id}: ragged row ${rowIdx}`);
    const y = height - 1 - rowIdx;
    for (let x = 0; x < width; x++) {
      const c = row[x];
      if (c === 'L') lava.add(tileKey({ x, y }));
      else if (c === 'S' && (x !== 0 || y !== 0)) throw new Error(`Map ${raw.id}: S must be bottom-left`);
      else if (c === 'G' && (x !== width - 1 || y !== height - 1)) throw new Error(`Map ${raw.id}: G must be top-right`);
      else if (!'SG.'.includes(c)) throw new Error(`Map ${raw.id}: unknown char '${c}'`);
    }
  }

  const map: GameMap = { id: raw.id, name: raw.name, width, height, lava };
  if (!hasSafePath(map)) throw new Error(`Map ${raw.id}: no safe path from start to goal`);
  return map;
}

/** BFS from bottom-left to top-right avoiding lava — sanity check at startup. */
function hasSafePath(map: GameMap): boolean {
  const queue: Tile[] = [{ x: 0, y: 0 }];
  const seen = new Set<string>([tileKey({ x: 0, y: 0 })]);
  while (queue.length) {
    const { x, y } = queue.shift()!;
    if (x === map.width - 1 && y === map.height - 1) return true;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const next = { x: x + dx, y: y + dy };
      const key = tileKey(next);
      if (next.x < 0 || next.y < 0 || next.x >= map.width || next.y >= map.height) continue;
      if (map.lava.has(key) || seen.has(key)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return false;
}

export const MAPS: GameMap[] = RAW_MAPS.map(parseMap);
