import { OPTIONAL_ANIMATIONS, type AnimationDef } from './manifest.ts';
import type { Skin } from './loader.ts';

/** How long a one-shot's key pose is held under reduced motion. */
const STILL_HOLD_MS = 900;

/**
 * Draws a skin's animations on a canvas. `play` runs a one-shot (resolving
 * when it ends) and then settles into `then`, or into the manifest's `next`.
 */
export class SpritePlayer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private current: { name: string; def: AnimationDef; started: number; then?: string; done?: () => void } | null = null;
  private raf = 0;
  private lastFrame = -1;
  private holdTimer: ReturnType<typeof setTimeout> | undefined;
  private skin: Skin;
  private reducedMotion: () => boolean;

  constructor(skin: Skin, scale: number, reducedMotion: () => boolean) {
    this.skin = skin;
    this.reducedMotion = reducedMotion;
    const [w, h] = skin.manifest.frameSize;
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = `${w * scale}px`;
    this.canvas.style.height = `${h * scale}px`;
    const dpr = Math.max(1, Math.round(globalThis.devicePixelRatio || 1));
    this.canvas.width = w * scale * dpr;
    this.canvas.height = h * scale * dpr;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
  }

  get playing(): string | null {
    return this.current?.name ?? null;
  }

  has(name: string): boolean {
    return name in this.skin.manifest.animations;
  }

  /** The animation this skin plays for `name`: itself, or an optional animation's fallback. */
  resolve(name: string): string {
    return this.has(name) ? name : (OPTIONAL_ANIMATIONS[name] ?? name);
  }

  /** Plays `name`. For a loop the promise resolves at once. */
  play(requested: string, then?: string): Promise<void> {
    const name = this.resolve(requested);
    const def = this.skin.manifest.animations[name];
    if (!def) return Promise.resolve();
    this.finishCurrent();
    return new Promise((resolve) => {
      this.current = { name, def, started: performance.now(), then, done: resolve };
      this.lastFrame = -1;
      if (def.loop) {
        this.current.done = undefined;
        resolve();
      }
      this.start();
    });
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.holdTimer);
    this.raf = 0;
  }

  private finishCurrent(): void {
    clearTimeout(this.holdTimer);
    this.current?.done?.();
  }

  private start(): void {
    this.stop();
    const cur = this.current!;
    if (this.reducedMotion()) {
      this.draw(cur.def.still ?? cur.def.frames[0]!, cur.def.sheet ?? 0);
      if (!cur.def.loop) this.holdTimer = setTimeout(() => this.ended(), Math.min(STILL_HOLD_MS, this.duration(cur.def)));
      return;
    }
    const tick = (now: number) => {
      const c = this.current;
      if (!c) return;
      const i = Math.floor(((now - c.started) / 1000) * c.def.fps);
      if (!c.def.loop && i >= c.def.frames.length) {
        this.ended();
        return;
      }
      const frameIndex = c.def.loop ? i % c.def.frames.length : i;
      if (frameIndex !== this.lastFrame) {
        this.lastFrame = frameIndex;
        this.draw(c.def.frames[frameIndex]!, c.def.sheet ?? 0);
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private ended(): void {
    const c = this.current!;
    const next = c.then ?? c.def.next;
    const done = c.done;
    c.done = undefined;
    const name = next && this.resolve(next);
    if (name && this.has(name)) {
      this.current = { name, def: this.skin.manifest.animations[name]!, started: performance.now() };
      this.lastFrame = -1;
      this.start();
    } else {
      this.stop();
    }
    done?.();
  }

  private duration(def: AnimationDef): number {
    return (def.frames.length / def.fps) * 1000;
  }

  private draw(frame: number, sheetIndex: number): void {
    const sheet = this.skin.sheets[sheetIndex]!;
    const [w, h] = this.skin.manifest.frameSize;
    const cols = Math.max(1, Math.floor(sheet.naturalWidth / w));
    const sx = (frame % cols) * w;
    const sy = Math.floor(frame / cols) * h;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(sheet, sx, sy, w, h, 0, 0, this.canvas.width, this.canvas.height);
  }
}
