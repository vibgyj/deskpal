export type Bleep = 'open' | 'close' | 'answer' | 'sorry';

const TUNES: Record<Bleep, [number, number][]> = {
  open: [[660, 0.06], [880, 0.08]],
  close: [[880, 0.06], [660, 0.08]],
  answer: [[523, 0.06], [659, 0.06], [784, 0.1]],
  sorry: [[392, 0.1], [330, 0.16]],
};

/** Retro square-wave bleeps. Muted until the visitor turns them on. */
export class Sounds {
  private ctx: AudioContext | null = null;
  enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  play(kind: Bleep): void {
    if (!this.enabled) return;
    try {
      this.ctx ??= new AudioContext();
      let t = this.ctx.currentTime;
      for (const [freq, len] of TUNES[kind]) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.04, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
        osc.connect(gain).connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + len);
        t += len;
      }
    } catch {
      // No audio available: stay silent.
    }
  }
}
