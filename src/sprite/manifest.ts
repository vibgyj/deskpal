/**
 * The skin format: a public contract (SPEC §5). A skin is a JSON manifest
 * plus one or more sprite sheets laid out as a grid of equal frames, numbered
 * left to right, top to bottom.
 */
export interface SkinManifest {
  name: string;
  /** Frame width and height in sheet pixels. */
  frameSize: [number, number];
  /** Sheet image URLs, relative to the manifest. */
  sheets: string[];
  animations: Record<string, AnimationDef>;
}

export interface AnimationDef {
  /** Frame numbers within the sheet. */
  frames: number[];
  fps: number;
  loop: boolean;
  /** Animation to continue with when a one-shot ends and the widget has no other plan. */
  next?: string;
  /** Index into `sheets`. Default 0. */
  sheet?: number;
  /** Frame to show under prefers-reduced-motion. Default: the first frame. */
  still?: number;
}

export const REQUIRED_ANIMATIONS = [
  'idle',
  'idle-fidget',
  'bored',
  'sleep',
  'wake',
  'greet',
  'wave-goodbye',
  'listening',
  'thinking',
  'talking',
  'happy',
  'confused',
  'sorry',
  'pointing',
  'drag',
  'land',
  'hide',
  'appear',
  'download',
] as const;

/** Returns a list of problems; empty when the manifest is usable. */
export function validateManifest(m: unknown): string[] {
  const errors: string[] = [];
  const s = m as Partial<SkinManifest> | null;
  if (!s || typeof s !== 'object') return ['manifest is not an object'];
  if (!Array.isArray(s.frameSize) || s.frameSize.length !== 2 || !s.frameSize.every((n) => Number.isInteger(n) && n > 0)) {
    errors.push('frameSize must be [width, height] in whole pixels');
  }
  if (!Array.isArray(s.sheets) || s.sheets.length === 0) errors.push('sheets must list at least one image');
  const anims = s.animations ?? {};
  for (const name of REQUIRED_ANIMATIONS) if (!anims[name]) errors.push(`missing required animation "${name}"`);
  for (const [name, a] of Object.entries(anims)) {
    if (!Array.isArray(a.frames) || a.frames.length === 0) errors.push(`${name}: frames must not be empty`);
    if (!(a.fps > 0)) errors.push(`${name}: fps must be positive`);
    if (a.next && !anims[a.next]) errors.push(`${name}: next "${a.next}" does not exist`);
    if (a.sheet !== undefined && !(a.sheet >= 0 && a.sheet < (s.sheets?.length ?? 0))) errors.push(`${name}: sheet ${a.sheet} does not exist`);
  }
  return errors;
}
