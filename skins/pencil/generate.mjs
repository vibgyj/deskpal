#!/usr/bin/env node
// Generates the pencil skin's sprite sheet (SVG) and manifest from code: a
// yellow pencil with an eraser hat that scribbles when it works hard. Every
// required and optional animation, so it never falls back.
//
//   node skins/pencil/generate.mjs

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 32;
const H = 48;
const COLS = 8;

const INK = '#2b2b3a';
const FACET = ['#f2b705', '#ffd23f', '#ffe48a']; // left, middle, right
const WOOD = '#f5d3a1';
const LEAD = '#3d3d4f';
const METAL = ['#9aa3b5', '#c9cfdb'];
const ERASER = '#ff8fab';
const CHEEK = '#ff9e7a';
const ACCENT = '#4a7dff';
const STEAM = '#9aa6bf';

// The pencil stands on its tip at (16, 44). Poses move, tilt and squash it from there.
const TIP = [16, 44];
const base = { dx: 0, dy: 0, tilt: 0, pivot: TIP, sx: 1, sy: 1, eyes: 'open', look: 0, mouth: 'smile', extra: [], opacity: 1 };

function pencil(p) {
  const x0 = 9;
  const x1 = 23;
  const facets = [[x0, 4], [x0 + 4, 6], [x0 + 10, 4]]
    .map(([x, w], i) => `<rect x="${x}" y="11" width="${w}" height="25" fill="${FACET[i]}"/>`)
    .join('');
  return (
    // Eraser and its metal band.
    `<rect x="${x0 + 0.5}" y="2" width="13" height="6" rx="2.5" fill="${ERASER}" stroke="${INK}"/>` +
    `<rect x="${x0}" y="7" width="14" height="4" fill="${METAL[1]}" stroke="${INK}"/>` +
    `<line x1="${x0}" y1="9" x2="${x1}" y2="9" stroke="${METAL[0]}"/>` +
    // Hexagonal body, shown as three facets.
    facets +
    `<rect x="${x0}" y="11" width="14" height="25" fill="none" stroke="${INK}"/>` +
    // Sharpened wood and graphite.
    `<polygon points="${x0},36 ${x1},36 ${TIP[0]},${TIP[1]}" fill="${WOOD}" stroke="${INK}" stroke-linejoin="round"/>` +
    `<polygon points="${TIP[0] - 2},${TIP[1] - 3.5} ${TIP[0] + 2},${TIP[1] - 3.5} ${TIP[0]},${TIP[1]}" fill="${LEAD}"/>` +
    `<rect x="${x0 + 0.5}" y="23" width="2" height="1" fill="${CHEEK}"/><rect x="${x1 - 2.5}" y="23" width="2" height="1" fill="${CHEEK}"/>`
  );
}

function eyes(p) {
  const y = 17;
  const out = [];
  for (const x of [12 + p.look, 18 + p.look]) {
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
  const y = 23;
  switch (p.mouth) {
    case 'smile': return `<polyline points="13.5,${y} 15,${y + 1.5} 17,${y + 1.5} 18.5,${y}" fill="none" stroke="${INK}"/>`;
    case 'flat': return `<rect x="14" y="${y + 1}" width="4" height="1" fill="${INK}"/>`;
    case 'open': return `<rect x="14" y="${y}" width="4" height="3" fill="${INK}"/>`;
    case 'o': return `<rect x="15" y="${y}" width="2" height="2" fill="${INK}"/>`;
    case 'frown': return `<polyline points="13.5,${y + 2} 15,${y + 0.5} 17,${y + 0.5} 18.5,${y + 2}" fill="none" stroke="${INK}"/>`;
    case 'wavy': return `<polyline points="13,${y + 1} 14.5,${y} 16,${y + 1} 17.5,${y} 19,${y + 1}" fill="none" stroke="${INK}"/>`;
    default: return '';
  }
}

const arm = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/>`;

// Decorations, each a function of a phase number. `on` ones move with the
// pencil, `off` ones float in the frame, `under` ones sit behind it.
const extras = {
  // On the pencil.
  armsRest: { on: () => arm(9, 27, 6, 31) + arm(23, 27, 26, 31) },
  armWave: { on: (n) => arm(9, 27, 6, 31) + arm(23, 26, n ? 29 : 28, n ? 19 : 18) + `<rect x="${n ? 28 : 27}" y="${n ? 17 : 16}" width="2" height="2" fill="${INK}"/>` },
  armPoint: { on: (n) => arm(9, 27, 6, 31) + arm(23, 25, 28 + n, 17 - n) + `<rect x="${28 + n}" y="${15 - n}" width="2" height="2" fill="${INK}"/>` },
  armChin: { on: () => arm(9, 27, 6, 31) + `<polyline points="23,29 27,27 24,24.5" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` },
  // Elbows pumping while it scribbles.
  armsBusy: { on: (n) => `<g fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9,27 ${n ? 4 : 5},${n ? 25 : 28} 7,${n ? 30 : 32}"/><polyline points="23,27 ${n ? 27 : 28},${n ? 28 : 25} 25,${n ? 32 : 30}"/></g>` },
  armsUp: { on: (n) => arm(9, 26, 4 - n, 18 - n) + arm(23, 26, 28 + n, 18 - n) },
  armsFlail: { on: (n) => arm(9, 26, n ? 3 : 5, n ? 21 : 30) + arm(23, 26, n ? 29 : 27, n ? 30 : 21) },
  shrug: { on: () => arm(9, 27, 5, 24) + arm(23, 27, 27, 24) },
  brows: { on: () => `<g stroke="${INK}" stroke-width="1.2"><line x1="10.5" y1="14" x2="14.5" y2="15.5"/><line x1="17.5" y1="15.5" x2="21.5" y2="14"/></g>` },
  glasses: {
    on: (n) => `<g fill="none" stroke="${INK}" stroke-width="0.75"><rect x="10.5" y="${15.5 - n}" width="5" height="4.5"/><rect x="16.5" y="${15.5 - n}" width="5" height="4.5"/><line x1="15.5" y1="${17 - n}" x2="16.5" y2="${17 - n}"/></g>` +
      `<rect x="11.5" y="${16 - n}" width="1" height="1" fill="#ffffff" opacity="0.9"/>`,
  },
  sweat: { on: (n) => `<rect x="24.5" y="${12 + n}" width="1.5" height="2.5" fill="${ACCENT}"/>` },
  blush: { on: (n) => [10.5, 21.5].map((x) => `<ellipse cx="${x}" cy="${22 + n * 0.5}" rx="2" ry="1.1" fill="${CHEEK}" opacity="0.85"/>`).join('') },
  // Floating around it.
  z: {
    off: (n) => {
      const s = 3 + n;
      const x = 2 + n;
      const y = 14 - n * 3;
      return `<polyline points="${x},${y} ${x + s},${y} ${x},${y + s} ${x + s},${y + s}" fill="none" stroke="${ACCENT}"/>`;
    },
  },
  dots: { off: (n) => [0, 1, 2].map((i) => (i <= n ? `<rect x="${24 + i * 3}" y="${7 - i}" width="2" height="2" fill="${ACCENT}"/>` : '')).join('') },
  question: { off: () => `<polyline points="25,3 27,2 29,3 29,5 27,6 27,8" fill="none" stroke="${ACCENT}" stroke-width="1.5"/><rect x="26.5" y="9.5" width="1.5" height="1.5" fill="${ACCENT}"/>` },
  bang: { off: () => `<rect x="27" y="2" width="2" height="6" fill="${ACCENT}"/><rect x="27" y="9" width="2" height="2" fill="${ACCENT}"/>` },
  drop: { off: (n) => `<rect x="25" y="${12 + n}" width="2" height="3" fill="${ACCENT}"/>` },
  sparkle: {
    off: (n) => {
      const r = 1 + n;
      return `<g stroke="${ACCENT}"><line x1="4" y1="${8 - r}" x2="4" y2="${8 + r}"/><line x1="${4 - r}" y1="8" x2="${4 + r}" y2="8"/>` +
        `<line x1="28" y1="${14 - r}" x2="28" y2="${14 + r}"/><line x1="${28 - r}" y1="14" x2="${28 + r}" y2="14"/></g>`;
    },
  },
  haha: { off: (n) => `<g fill="${ACCENT}"><rect x="${26 + n}" y="${10 - n}" width="1" height="3"/><rect x="${28 + n}" y="${10 - n}" width="1" height="3"/><rect x="${26 + n}" y="${11 - n}" width="3" height="1"/></g>` },
  arrow: { off: (n) => `<g fill="${ACCENT}"><rect x="2" y="${4 + n}" width="2" height="4"/><polygon points="0,${8 + n} 6,${8 + n} 3,${11 + n}"/></g>` },
  // A thermometer-style bar beside it, filling from the bottom.
  bar: { off: (n) => `<rect x="27" y="12" width="3.5" height="28" fill="none" stroke="${INK}" stroke-width="0.75"/><rect x="28" y="${39 - (n / 3) * 26}" width="1.5" height="${(n / 3) * 26}" fill="${ACCENT}"/>` },
  steam: {
    off: (n) => [0, 1].map((i) => {
      const k = (n + i * 2) % 4;
      return `<circle cx="${(i ? 28 : 4) + (k % 2 ? 1 : -1) * (i ? 1 : -1)}" cy="${12 - k * 2.5}" r="${1 + k * 0.35}" fill="${STEAM}" opacity="${0.85 - k * 0.18}"/>`;
    }).join(''),
  },
  swish: { off: (n) => `<g stroke="${ACCENT}"><line x1="${n ? 27 : 2}" y1="16" x2="${n ? 30 : 5}" y2="15"/><line x1="${n ? 27 : 2}" y1="20" x2="${n ? 30 : 5}" y2="21"/></g>` },
  // Crumbs rubbed off the eraser, for apologies.
  crumbs: { off: (n) => [[4, 10], [2, 14], [6, 16]].slice(0, n + 1).map(([x, y], i) => `<rect x="${x}" y="${y + (n - i) * 2}" width="2" height="1.5" fill="${ERASER}" stroke="${INK}" stroke-width="0.4"/>`).join('') },
  // Behind it: a strip of paper, and the scribble it has written so far.
  paper: { under: () => `<rect x="1" y="44" width="30" height="3.5" fill="#ffffff" stroke="${INK}" stroke-width="0.75"/>` },
  scribble: {
    under: (n) => {
      const pts = [];
      for (let i = 0; i <= n; i++) pts.push(`${scribbleX(i)},${i % 2 ? 44.6 : 46.4}`);
      return n ? `<polyline points="${pts.join(' ')}" fill="none" stroke="${LEAD}" stroke-width="0.75"/>` : '';
    },
  },
  doodle: { under: (n) => `<path d="M3 46.5 q2 -2 4 0 t4 0${n ? ' t4 0' : ''}${n > 1 ? ' t4 0' : ''}" fill="none" stroke="${LEAD}" stroke-width="0.75"/>` },
};

function frame(p, col, row) {
  const pose = { ...base, ...p };
  const layer = (kind) => pose.extra.map(([name, n = 0]) => extras[name][kind]?.(n) ?? '').join('');
  const [px, py] = pose.pivot;
  const squash = `translate(${TIP[0]} ${TIP[1]}) scale(${pose.sx} ${pose.sy}) translate(${-TIP[0]} ${-TIP[1]})`;
  const move = `translate(${pose.dx} ${pose.dy}) rotate(${pose.tilt} ${px} ${py}) ${squash}`;
  // A nested <svg> clips the frame to its cell, so nothing spills into its neighbours.
  return `<svg x="${col * W}" y="${row * H}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" overflow="hidden"><g opacity="${pose.opacity}">` +
    layer('under') +
    `<g transform="${move}">${pencil(pose)}${eyes(pose)}${mouth(pose)}${layer('on')}</g>` +
    layer('off') +
    '</g></svg>';
}

const rest = ['armsRest'];
/** Where the scribble's n-th stroke ends, and so where the tip is. */
function scribbleX(n) {
  return 10.5 + Math.min(n, 12) * 0.9;
}
const working = (n, more = {}) => ({
  eyes: 'half', mouth: 'flat', dx: scribbleX(n) - TIP[0], tilt: n % 2 ? 5 : -3,
  extra: [['paper'], ['scribble', n], ['brows'], ['glasses', 0], ['armsBusy', n % 2], ['steam', n % 4]], ...more,
});

// Animations as lists of poses. `still` names the key pose for reduced motion.
const animations = {
  idle: { fps: 2, loop: true, poses: [{ extra: [rest] }, { dy: 0.5, tilt: 1, extra: [rest] }] },
  // A blink, a look around, then a quick spin on the tip.
  'idle-fidget': {
    fps: 8, loop: false, next: 'idle',
    poses: [{ eyes: 'closed', extra: [rest] }, { extra: [rest] }, { look: -2, extra: [rest] }, { look: -2, extra: [rest] }, { look: 2, extra: [rest] }, { look: 2, extra: [rest] },
      { sx: 0.6, mouth: 'o', extra: [rest] }, { sx: 0.2, mouth: 'none', eyes: 'none' }, { sx: -0.6, mouth: 'none', eyes: 'none' }, { sx: 0.6, eyes: 'happy', extra: [rest] }, { eyes: 'happy', extra: [rest] }],
  },
  // Leaning on nothing, drawing a slow doodle.
  bored: {
    fps: 2, loop: true,
    poses: [0, 1, 2, 1].map((n) => ({ eyes: 'half', mouth: 'flat', tilt: 8 + (n % 2), look: 1, extra: [['paper'], ['doodle', n], rest] })),
  },
  sleep: {
    fps: 2, loop: true,
    poses: [0, 1, 2].map((n) => ({ eyes: 'closed', mouth: 'o', tilt: 14, sy: n === 1 ? 0.97 : 1, extra: [['z', n], rest] })),
  },
  wake: {
    fps: 8, loop: false, still: 2,
    poses: [{ eyes: 'closed', tilt: 14, extra: [rest] }, { eyes: 'half', tilt: 6, extra: [rest] }, { eyes: 'wide', mouth: 'o', dy: -3, extra: [['bang'], ['armsUp', 0]] }, { eyes: 'wide', dy: -2, extra: [['bang'], ['armsUp', 1]] }, { extra: [rest] }],
  },
  greet: {
    fps: 8, loop: false, still: 2,
    poses: [{ dy: -2, extra: [rest] }, { dy: -3, eyes: 'happy', mouth: 'open', extra: [['armWave', 0]] }, { eyes: 'happy', mouth: 'open', tilt: -3, extra: [['armWave', 1]] },
      { eyes: 'happy', mouth: 'open', tilt: 3, extra: [['armWave', 0]] }, { eyes: 'happy', mouth: 'open', tilt: -3, extra: [['armWave', 1]] }, { extra: [rest] }],
  },
  'wave-goodbye': {
    fps: 8, loop: false, still: 1,
    poses: [{ extra: [['armWave', 0]] }, { eyes: 'happy', extra: [['armWave', 1]] }, { eyes: 'happy', extra: [['armWave', 0]] }, { eyes: 'happy', extra: [['armWave', 1]] }],
  },
  // Leaning in towards the chat.
  listening: { fps: 2, loop: true, poses: [{ eyes: 'up', mouth: 'flat', tilt: -4, look: -1, extra: [rest] }, { eyes: 'up', mouth: 'flat', tilt: -4, look: -1, dy: 0.5, extra: [rest] }] },
  // Hand on chin, tapping its tip.
  thinking: {
    fps: 4, loop: true,
    poses: [0, 1, 2, 2].map((n) => ({ eyes: 'up', look: 1, mouth: 'wavy', dy: n === 1 ? -1 : 0, extra: [['dots', n], ['armChin']] })),
  },
  talking: { fps: 8, loop: true, poses: [{ mouth: 'open', extra: [rest] }, { mouth: 'o', extra: [rest] }, { mouth: 'open', dy: 0.5, extra: [rest] }, { mouth: 'smile', extra: [rest] }] },
  happy: {
    fps: 8, loop: false, still: 2,
    poses: [{ dy: -2, eyes: 'happy', extra: [['armsUp', 0]] }, { dy: -5, eyes: 'happy', mouth: 'open', extra: [['sparkle', 0], ['armsUp', 1]] }, { dy: -3, eyes: 'happy', mouth: 'open', extra: [['sparkle', 1], ['armsUp', 1]] },
      { eyes: 'happy', sy: 0.92, extra: [rest] }, { extra: [rest] }],
  },
  confused: {
    fps: 4, loop: false, still: 1,
    poses: [{ look: -1, mouth: 'wavy', tilt: -3, extra: [['shrug']] }, { look: 1, mouth: 'wavy', tilt: 3, extra: [['question'], ['shrug']] }, { look: -1, mouth: 'wavy', tilt: -3, extra: [['question'], ['shrug']] }, { look: 1, mouth: 'wavy', tilt: 3, extra: [['question'], ['shrug']] }],
  },
  // A bow so deep the eraser sheds crumbs.
  sorry: {
    fps: 4, loop: false, still: 2,
    poses: [{ eyes: 'sad', mouth: 'frown', extra: [rest] }, { eyes: 'sad', mouth: 'frown', tilt: -10, extra: [rest, ['crumbs', 0]] },
      { eyes: 'sad', mouth: 'frown', tilt: -14, extra: [rest, ['crumbs', 1]] }, { eyes: 'sad', mouth: 'frown', tilt: -6, extra: [rest, ['crumbs', 2]] },
      // Two seconds: stays bowed a moment before straightening up.
      ...Array(3).fill({ eyes: 'sad', mouth: 'frown', tilt: -6, extra: [rest] }), { eyes: 'sad', mouth: 'frown', extra: [rest] }],
  },
  pointing: {
    fps: 6, loop: false, still: 2,
    poses: [{ tilt: 4, extra: [rest] }, { tilt: 6, look: 1, extra: [['armPoint', 0]] }, { tilt: 6, look: 1, mouth: 'open', extra: [['armPoint', 1]] }, { tilt: 6, look: 1, extra: [['armPoint', 0]] }, { tilt: 6, look: 1, mouth: 'open', extra: [['armPoint', 1]] }, { tilt: 6, look: 1, extra: [['armPoint', 0]] }],
  },
  // Held by the eraser, swinging.
  drag: { fps: 4, loop: true, poses: [-10, 10].map((tilt) => ({ eyes: 'wide', mouth: 'o', pivot: [16, 3], tilt, extra: [['armsFlail', tilt > 0 ? 1 : 0]] })) },
  land: {
    fps: 10, loop: false, still: 1,
    poses: [{ sy: 0.8, sx: 1.2, eyes: 'closed', mouth: 'flat', extra: [rest] }, { sy: 1.05, sx: 0.95, extra: [rest] }, { sy: 0.97, sx: 1.03, extra: [rest] }, { extra: [rest] }],
  },
  // Sinks into the paper, tip first.
  hide: {
    fps: 10, loop: false, still: 4,
    poses: [{ sy: 0.9, extra: [rest] }, { sy: 0.6, opacity: 0.8 }, { sy: 0.35, opacity: 0.5, eyes: 'closed' }, { sy: 0.15, opacity: 0.25, mouth: 'none', eyes: 'none' }, { opacity: 0 }],
  },
  appear: {
    fps: 10, loop: false, next: 'idle', still: 4,
    poses: [{ sy: 0.15, opacity: 0.25, mouth: 'none', eyes: 'none' }, { sy: 0.5, opacity: 0.6, eyes: 'closed' }, { sy: 1.12, sx: 0.9, extra: [rest] }, { sy: 0.95, sx: 1.05, eyes: 'happy', extra: [rest] }, { extra: [rest] }],
  },
  download: {
    fps: 4, loop: true,
    poses: [0, 1, 2, 3].map((n) => ({ eyes: 'up', mouth: 'o', extra: [['arrow', n % 2], ['bar', n], rest] })),
  },
  // Optional animations (SPEC §5).
  wave: { fps: 8, loop: false, still: 1, poses: [0, 1, 0, 1, 0, 1].map((n) => ({ eyes: 'happy', tilt: n ? -2 : 2, extra: [['armWave', n]] })) },
  unsure: {
    fps: 4, loop: false, still: 2,
    poses: [{ eyes: 'half', mouth: 'flat', look: -1, extra: [rest] }, { eyes: 'half', mouth: 'wavy', look: 1, tilt: 4, extra: [['shrug']] }, { eyes: 'up', mouth: 'flat', tilt: 4, extra: [['question'], ['shrug']] }, { eyes: 'half', mouth: 'flat', look: 1, extra: [['question'], rest] }],
  },
  blush: {
    fps: 6, loop: false, still: 2,
    poses: [{ eyes: 'happy', extra: [['blush', 0], rest] }, { eyes: 'happy', sy: 0.95, tilt: 3, extra: [['blush', 1], rest] }, { eyes: 'closed', sy: 0.95, tilt: -3, extra: [['blush', 1], rest] }, { eyes: 'happy', extra: [['blush', 0], rest] }],
  },
  laugh: { fps: 10, loop: false, still: 1, poses: [0, 1, 0, 1, 0, 1].map((n) => ({ dy: n ? -2 : 0, tilt: n ? 4 : -4, eyes: 'happy', mouth: 'open', extra: [['haha', n], rest] })) },
  // No answer in the docs: shakes its head, swivelling on the tip.
  nope: {
    fps: 10, loop: false, still: 1,
    poses: [
      ...[0, 1, 0, 1, 0, 1].map((n) => ({ tilt: n ? 4 : -4, look: n ? 2 : -2, eyes: 'half', mouth: 'flat', extra: [['swish', n], ['armsRest']] })),
      // Then holds a sad face for 1.2 s, so the shake doesn't read as a twitch.
      ...Array(12).fill({ eyes: 'sad', mouth: 'frown', extra: [['armsRest']] }),
    ],
  },
  // A long wait on the model: furious scribbling, then a push of the glasses.
  working: {
    fps: 8, loop: true, still: 4,
    poses: [
      ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => working(n, n > 7 ? { mouth: 'wavy', extra: [...working(n).extra, ['sweat', n % 3]] } : {})),
      { ...working(12), tilt: 0, extra: [['paper'], ['scribble', 12], ['brows'], ['glasses', 1], ['armChin'], ['steam', 0]] },
      { ...working(12), tilt: 0, extra: [['paper'], ['scribble', 12], ['brows'], ['glasses', 0], ['armChin'], ['steam', 1]] },
      { ...working(12), tilt: 0, eyes: 'open', extra: [['paper'], ['scribble', 12], ['brows'], ['glasses', 0], ['armsRest'], ['steam', 2]] },
      // Back to the start of the line, like a typewriter carriage.
      { ...working(6), tilt: 0, eyes: 'open', mouth: 'o', extra: [['paper'], ['brows'], ['glasses', 0], ['armsRest']] },
    ],
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

const voice = {
  greeting: ["Hi! I'm {name}. I've read all the docs, margins included.", 'Hello! Sharpened and ready. What can I look up?'],
  thinking: ['Sharpening my thoughts…', 'Let me jot that down…', 'Scribbling through the docs…'],
  dontKnow: ["I've looked, but that's not in my notes.", "Hmm, nothing on that in the docs. I'd hate to make it up."],
  thanks: ['Glad to help! Pencils love being useful.', 'Any time. I never run out of lead.'],
  joke: ["Why did the pencil get the job? It had a good point.", "I'd tell you a joke about a broken pencil, but it's pointless."],
};

const manifest = { name: 'pencil', frameSize: [W, H], sheets: ['sheet.svg'], voice, animations: manifestAnimations };

writeFileSync(join(HERE, 'sheet.svg'), svg);
writeFileSync(join(HERE, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`pencil skin: ${n} frames, ${Object.keys(animations).length} animations, ${svg.length} bytes`);
