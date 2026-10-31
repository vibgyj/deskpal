#!/usr/bin/env node
// Generates the default skin's sprite sheet (SVG) and manifest from code.
//
// PLACEHOLDER: a plain blob that implements every required animation so the
// engine and widget can be built and tested. It is replaced by the chosen
// mascot concept (SPEC §10.3), which should keep this generate-from-code
// approach and the same animation names.
//
//   node skins/default/generate.mjs

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 32;
const H = 32;
const COLS = 8;

const INK = '#2b2b3a';
const BODY = '#ffd866';
const CHEEK = '#ff9e7a';
const ACCENT = '#4a7dff';

// A pose describes one frame. Every field has a neutral default.
const base = { dy: 0, sx: 1, sy: 1, eyes: 'open', look: 0, mouth: 'smile', extra: [], opacity: 1 };

function body(p) {
  const cy = 20 + p.dy + (1 - p.sy) * 10;
  const rx = 11 * p.sx;
  const ry = 10 * p.sy;
  return `<ellipse cx="16" cy="${cy}" rx="${rx}" ry="${ry}" fill="${BODY}" stroke="${INK}" stroke-width="1.5"/>` +
    `<rect x="${16 - rx * 0.75}" y="${cy + 2}" width="2" height="1" fill="${CHEEK}"/>` +
    `<rect x="${16 + rx * 0.75 - 2}" y="${cy + 2}" width="2" height="1" fill="${CHEEK}"/>`;
}

function eyes(p) {
  const y = 17 + p.dy + (1 - p.sy) * 10;
  const out = [];
  for (const x of [12 + p.look, 19 + p.look]) {
    switch (p.eyes) {
      case 'open': out.push(`<rect x="${x}" y="${y}" width="2" height="3" fill="${INK}"/>`); break;
      case 'up': out.push(`<rect x="${x}" y="${y - 1}" width="2" height="2" fill="${INK}"/>`); break;
      case 'half': out.push(`<rect x="${x}" y="${y + 1}" width="2" height="2" fill="${INK}"/>`); break;
      case 'closed': out.push(`<rect x="${x - 0.5}" y="${y + 2}" width="3" height="1" fill="${INK}"/>`); break;
      case 'happy': out.push(`<polyline points="${x - 0.5},${y + 2} ${x + 1},${y} ${x + 2.5},${y + 2}" fill="none" stroke="${INK}"/>`); break;
      case 'sad': out.push(`<polyline points="${x - 0.5},${y} ${x + 1},${y + 1.5} ${x + 2.5},${y}" fill="none" stroke="${INK}"/>`); break;
      case 'wide': out.push(`<rect x="${x - 0.5}" y="${y - 1}" width="3" height="4" fill="${INK}"/>`); break;
    }
  }
  return out.join('');
}

function mouth(p) {
  const y = 23 + p.dy + (1 - p.sy) * 10;
  switch (p.mouth) {
    case 'smile': return `<polyline points="13,${y} 14.5,${y + 1.5} 17.5,${y + 1.5} 19,${y}" fill="none" stroke="${INK}"/>`;
    case 'flat': return `<rect x="14" y="${y + 1}" width="4" height="1" fill="${INK}"/>`;
    case 'open': return `<rect x="14" y="${y}" width="4" height="3" fill="${INK}"/>`;
    case 'o': return `<rect x="15" y="${y}" width="2" height="2" fill="${INK}"/>`;
    case 'frown': return `<polyline points="13,${y + 2} 14.5,${y + 0.5} 17.5,${y + 0.5} 19,${y + 2}" fill="none" stroke="${INK}"/>`;
    case 'wavy': return `<polyline points="13,${y + 1} 14.5,${y} 16,${y + 1} 17.5,${y} 19,${y + 1}" fill="none" stroke="${INK}"/>`;
    default: return '';
  }
}

// Decorations drawn around the body, each a function of a phase number.
const extras = {
  z: (n) => {
    const s = 3 + n;
    const x = 24 - n;
    const y = 8 - n * 2;
    return `<polyline points="${x},${y} ${x + s},${y} ${x},${y + s} ${x + s},${y + s}" fill="none" stroke="${ACCENT}"/>`;
  },
  dots: (n) => [0, 1, 2].map((i) => (i <= n ? `<rect x="${22 + i * 3}" y="${5 - i}" width="2" height="2" fill="${ACCENT}"/>` : '')).join(''),
  question: () => `<polyline points="25,4 27,3 29,4 29,6 27,7 27,9" fill="none" stroke="${ACCENT}" stroke-width="1.5"/><rect x="26.5" y="10.5" width="1.5" height="1.5" fill="${ACCENT}"/>`,
  bang: () => `<rect x="27" y="3" width="2" height="6" fill="${ACCENT}"/><rect x="27" y="10" width="2" height="2" fill="${ACCENT}"/>`,
  drop: (n) => `<rect x="25" y="${11 + n}" width="2" height="3" fill="${ACCENT}"/>`,
  sparkle: (n) => {
    const r = 1 + n;
    return `<g stroke="${ACCENT}"><line x1="5" y1="${7 - r}" x2="5" y2="${7 + r}"/><line x1="${5 - r}" y1="7" x2="${5 + r}" y2="7"/></g>`;
  },
  armUp: (n) => `<line x1="25" y1="17" x2="${29 + n}" y2="${10 - n}" stroke="${INK}" stroke-width="1.5"/>`,
  armWave: (n) => `<line x1="25" y1="17" x2="${n ? 30 : 28}" y2="${n ? 9 : 8}" stroke="${INK}" stroke-width="1.5"/>`,
  armPoint: (n) => `<line x1="25" y1="17" x2="${29 + n}" y2="${6 - n}" stroke="${INK}" stroke-width="1.5"/><rect x="${29 + n}" y="${4 - n}" width="2" height="2" fill="${INK}"/>`,
  arrow: (n) => `<g fill="${ACCENT}"><rect x="27" y="${1 + n}" width="2" height="4"/><polygon points="25,${5 + n} 31,${5 + n} 28,${8 + n}"/></g>`,
  blush: (n) => [9, 23].map((x) => `<ellipse cx="${x}" cy="${22 + n * 0.5}" rx="2.5" ry="1.2" fill="${CHEEK}" opacity="0.85"/>`).join(''),
  haha: (n) => `<g fill="${ACCENT}"><rect x="${24 + n}" y="${4 - n}" width="1" height="3"/><rect x="${26 + n}" y="${4 - n}" width="1" height="3"/><rect x="${24 + n}" y="${5 - n}" width="3" height="1"/></g>`,
  // Working very seriously: furrowed brow, tiny glasses, a laptop, steam.
  brows: () => `<g stroke="${INK}" stroke-width="1.2"><line x1="10.5" y1="14" x2="14.5" y2="15.5"/><line x1="17.5" y1="15.5" x2="21.5" y2="14"/></g>`,
  glasses: (n) => `<g fill="none" stroke="${INK}" stroke-width="0.75"><rect x="10.5" y="${15.5 - n}" width="5" height="4.5"/><rect x="17.5" y="${15.5 - n}" width="5" height="4.5"/><line x1="15.5" y1="${17 - n}" x2="17.5" y2="${17 - n}"/></g>` +
    `<rect x="11.5" y="${16 - n}" width="1" height="1" fill="#ffffff" opacity="0.9"/>`,
  laptop: () => `<rect x="8" y="26" width="16" height="5" fill="#c9cfdb" stroke="${INK}"/><rect x="15" y="27.5" width="2" height="2" fill="${ACCENT}"/>` +
    `<rect x="5" y="31" width="22" height="1" fill="${INK}"/>`,
  // Hands hammering the keys in turn, with key-clack ticks.
  typing: (n) => [[9, n], [21, 1 - n]].map(([x, up]) => `<rect x="${x}" y="${up ? 23.5 : 25}" width="3" height="2" fill="${BODY}" stroke="${INK}" stroke-width="0.75"/>`).join('') +
    `<g stroke="${ACCENT}" stroke-width="0.75">${n ? '<line x1="8" y1="22" x2="7" y2="21"/><line x1="10" y1="21.5" x2="10" y2="20.5"/>' : '<line x1="24" y1="22" x2="25" y2="21"/><line x1="22" y1="21.5" x2="22" y2="20.5"/>'}</g>`,
  adjust: () => `<rect x="9" y="25" width="3" height="2" fill="${BODY}" stroke="${INK}" stroke-width="0.75"/><rect x="15.5" y="18" width="2" height="2.5" fill="${BODY}" stroke="${INK}" stroke-width="0.75"/>`,
  // Puffs of steam rising off the head, growing and fading.
  steam: (n) => [0, 1].map((i) => {
    const k = (n + i * 2) % 4;
    return `<circle cx="${(i ? 22 : 10) + (k % 2 ? 1 : -1) * (i ? 1 : -1)}" cy="${9 - k * 2}" r="${1 + k * 0.4}" fill="#9aa6bf" opacity="${0.85 - k * 0.18}"/>`;
  }).join(''),
  swish: (n) => `<g stroke="${ACCENT}"><line x1="${n ? 28 : 2}" y1="16" x2="${n ? 30 : 4}" y2="15"/><line x1="${n ? 28 : 2}" y1="20" x2="${n ? 30 : 4}" y2="21"/></g>`,
  bar: (n) => `<rect x="4" y="2" width="24" height="3" fill="none" stroke="${INK}" stroke-width="0.75"/><rect x="5" y="3" width="${(n / 3) * 22}" height="1" fill="${ACCENT}"/>`,
};

function frame(p, col, row) {
  const pose = { ...base, ...p };
  const deco = pose.extra.map(([name, n = 0]) => extras[name](n)).join('');
  return `<g transform="translate(${col * W} ${row * H})" opacity="${pose.opacity}">` +
    `${body(pose)}${eyes(pose)}${mouth(pose)}${deco}</g>`;
}

// Animations as lists of poses. `still` names the key pose for reduced motion.
const animations = {
  idle: { fps: 2, loop: true, poses: [{}, { dy: 0.5 }] },
  'idle-fidget': {
    fps: 6, loop: false, next: 'idle',
    poses: [{ eyes: 'closed' }, {}, { look: -2 }, { look: -2 }, { look: 2 }, { look: 2 }, {}],
  },
  bored: { fps: 2, loop: true, poses: [{ eyes: 'half', mouth: 'flat' }, { eyes: 'half', mouth: 'flat', look: 1 }] },
  sleep: {
    fps: 2, loop: true,
    poses: [
      { eyes: 'closed', mouth: 'o', sy: 0.95, extra: [['z', 0]] },
      { eyes: 'closed', mouth: 'o', sy: 0.92, extra: [['z', 1]] },
      { eyes: 'closed', mouth: 'o', sy: 0.95, extra: [['z', 2]] },
    ],
  },
  wake: {
    fps: 8, loop: false, still: 2,
    poses: [{ eyes: 'closed', sy: 0.95 }, { eyes: 'half' }, { eyes: 'wide', mouth: 'o', extra: [['bang']] }, { eyes: 'wide', dy: -2, extra: [['bang']] }, {}],
  },
  greet: {
    fps: 8, loop: false, still: 2,
    poses: [{ dy: -2 }, { dy: -3, eyes: 'happy', mouth: 'open', extra: [['armWave', 0]] }, { eyes: 'happy', mouth: 'open', extra: [['armWave', 1]] },
      { eyes: 'happy', mouth: 'open', extra: [['armWave', 0]] }, { eyes: 'happy', mouth: 'open', extra: [['armWave', 1]] }, {}],
  },
  'wave-goodbye': {
    fps: 8, loop: false, still: 1,
    poses: [{ extra: [['armWave', 0]] }, { eyes: 'happy', extra: [['armWave', 1]] }, { eyes: 'happy', extra: [['armWave', 0]] }, { eyes: 'happy', extra: [['armWave', 1]] }],
  },
  listening: { fps: 2, loop: true, poses: [{ eyes: 'up', mouth: 'flat' }, { eyes: 'up', mouth: 'flat', dy: 0.5 }] },
  thinking: {
    fps: 4, loop: true,
    poses: [0, 1, 2, 2].map((n) => ({ eyes: 'up', look: 1, mouth: 'wavy', extra: [['dots', n]] })),
  },
  talking: { fps: 8, loop: true, poses: [{ mouth: 'open' }, { mouth: 'o' }, { mouth: 'open', dy: 0.5 }, { mouth: 'smile' }] },
  happy: {
    fps: 8, loop: false, still: 2,
    poses: [{ dy: -2, eyes: 'happy' }, { dy: -4, eyes: 'happy', mouth: 'open', extra: [['sparkle', 0]] }, { dy: -2, eyes: 'happy', mouth: 'open', extra: [['sparkle', 1]] }, { eyes: 'happy', sy: 0.92 }, {}],
  },
  confused: {
    fps: 4, loop: false, still: 1,
    poses: [{ look: -1, mouth: 'wavy' }, { look: 1, mouth: 'wavy', extra: [['question']] }, { look: -1, mouth: 'wavy', extra: [['question']] }, { look: 1, mouth: 'wavy', extra: [['question']] }],
  },
  sorry: {
    fps: 4, loop: false, still: 1,
    // Two seconds: the tear falls, then the sad face lingers.
    poses: [{ eyes: 'sad', mouth: 'frown' }, { eyes: 'sad', mouth: 'frown', sy: 0.94, extra: [['drop', 0]] }, { eyes: 'sad', mouth: 'frown', sy: 0.94, extra: [['drop', 1]] }, { eyes: 'sad', mouth: 'frown', extra: [['drop', 2]] },
      ...Array(4).fill({ eyes: 'sad', mouth: 'frown' })],
  },
  pointing: {
    fps: 6, loop: false, still: 2,
    poses: [{ extra: [['armUp', 0]] }, { look: 1, extra: [['armPoint', 0]] }, { look: 1, mouth: 'open', extra: [['armPoint', 1]] }, { look: 1, extra: [['armPoint', 0]] }, { look: 1, mouth: 'open', extra: [['armPoint', 1]] }, { look: 1, extra: [['armPoint', 0]] }],
  },
  drag: { fps: 4, loop: true, poses: [{ eyes: 'wide', mouth: 'o', sy: 1.1, sx: 0.9 }, { eyes: 'wide', mouth: 'o', sy: 1.1, sx: 0.9, look: 1 }] },
  land: {
    fps: 10, loop: false, still: 1,
    poses: [{ sy: 0.8, sx: 1.15, eyes: 'closed', mouth: 'flat' }, { sy: 1.05, sx: 0.95 }, { sy: 0.97, sx: 1.03 }, {}],
  },
  hide: {
    fps: 10, loop: false, still: 4,
    poses: [{ sy: 0.9 }, { sy: 0.6, sx: 0.8, opacity: 0.8 }, { sy: 0.35, sx: 0.5, opacity: 0.5, eyes: 'closed' }, { sy: 0.15, sx: 0.3, opacity: 0.25, mouth: 'none', eyes: 'none' }, { opacity: 0 }],
  },
  appear: {
    fps: 10, loop: false, next: 'idle', still: 4,
    poses: [{ sy: 0.15, sx: 0.3, opacity: 0.25, mouth: 'none', eyes: 'none' }, { sy: 0.5, sx: 0.6, opacity: 0.6, eyes: 'closed' }, { sy: 1.15, sx: 0.9 }, { sy: 0.95, sx: 1.05, eyes: 'happy' }, {}],
  },
  // Optional animations (SPEC §5): skins without them fall back to a required one.
  wave: {
    fps: 8, loop: false, still: 1,
    poses: [0, 1, 0, 1, 0, 1].map((n) => ({ eyes: 'happy', mouth: 'smile', extra: [['armWave', n]] })),
  },
  unsure: {
    fps: 4, loop: false, still: 2,
    poses: [{ eyes: 'half', mouth: 'flat', look: -1 }, { eyes: 'half', mouth: 'wavy', look: 1 }, { eyes: 'up', mouth: 'flat', extra: [['question']] }, { eyes: 'half', mouth: 'flat', look: 1, extra: [['question']] }],
  },
  blush: {
    fps: 6, loop: false, still: 2,
    poses: [{ eyes: 'happy', extra: [['blush', 0]] }, { eyes: 'happy', sy: 0.94, extra: [['blush', 1]] }, { eyes: 'closed', mouth: 'smile', sy: 0.94, extra: [['blush', 1]] }, { eyes: 'happy', extra: [['blush', 0]] }],
  },
  laugh: {
    fps: 10, loop: false, still: 1,
    poses: [0, 1, 0, 1, 0, 1].map((n) => ({ dy: n ? -2 : 0, eyes: 'happy', mouth: 'open', extra: [['haha', n]] })),
  },
  // A long wait on the model: hammering the keys, then a dignified push of the glasses.
  working: {
    fps: 8, loop: true, still: 0,
    poses: [
      ...[0, 1, 2, 3, 0, 1, 2, 3].map((n) => ({ eyes: 'half', mouth: 'flat', look: n % 2 ? 1 : 0, dy: n % 2 ? 0.5 : 0, extra: [['brows'], ['glasses', 0], ['laptop'], ['typing', n % 2], ['steam', n]] })),
      ...[0, 1, 2, 3].map((n) => ({ eyes: 'half', mouth: 'wavy', dy: n % 2 ? 0.5 : 0, extra: [['brows'], ['glasses', 0], ['laptop'], ['typing', n % 2], ['steam', n], ['drop', n % 3]] })),
      { eyes: 'half', mouth: 'flat', extra: [['brows'], ['glasses', 1], ['laptop'], ['adjust'], ['steam', 0]] },
      { eyes: 'half', mouth: 'flat', extra: [['brows'], ['glasses', 0], ['laptop'], ['adjust'], ['steam', 1]] },
      { eyes: 'open', mouth: 'flat', extra: [['brows'], ['glasses', 0], ['laptop'], ['typing', 0], ['steam', 2]] },
      { eyes: 'open', mouth: 'flat', extra: [['brows'], ['glasses', 0], ['laptop'], ['typing', 0], ['steam', 3]] },
    ],
  },
  // No answer in the docs: a firm shake of the head.
  nope: {
    fps: 10, loop: false, still: 1,
    poses: [
      ...[0, 1, 0, 1, 0, 1].map((n) => ({ look: n ? 2 : -2, sx: 0.96, mouth: 'flat', eyes: 'half', extra: [['swish', n]] })),
      // Then holds a sad face for 1.2 s, so the shake doesn't read as a twitch.
      ...Array(12).fill({ eyes: 'sad', mouth: 'frown' }),
    ],
  },
  download: {
    fps: 4, loop: true,
    poses: [0, 1, 2, 3].map((n) => ({ eyes: 'up', mouth: 'o', extra: [['arrow', n % 2], ['bar', n]] })),
  },
};

const parts = [];
const manifestAnimations = {};
let n = 0;
// Identical poses share a cell, so holding a pose costs no sheet space.
const drawn = new Map();
for (const [name, a] of Object.entries(animations)) {
  const frames = a.poses.map((pose) => {
    const key = JSON.stringify(pose);
    if (!drawn.has(key)) {
      parts.push(frame(pose, n % COLS, Math.floor(n / COLS)));
      drawn.set(key, n++);
    }
    return drawn.get(key);
  });
  manifestAnimations[name] = {
    frames,
    fps: a.fps,
    loop: a.loop,
    ...(a.next ? { next: a.next } : {}),
    ...(a.still !== undefined ? { still: frames[a.still] } : {}),
  };
}

const rows = Math.ceil(n / COLS);
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${COLS * W}" height="${rows * H}" ` +
  `viewBox="0 0 ${COLS * W} ${rows * H}" shape-rendering="crispEdges">${parts.join('')}</svg>\n`;

const manifest = { name: 'placeholder', frameSize: [W, H], sheets: ['sheet.svg'], animations: manifestAnimations };

writeFileSync(join(HERE, 'sheet.svg'), svg);
writeFileSync(join(HERE, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`default skin: ${n} frames, ${Object.keys(animations).length} animations, ${svg.length} bytes`);
