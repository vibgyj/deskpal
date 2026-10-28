export interface Remembered {
  /** Launcher position as left/top in CSS pixels. */
  position?: { x: number; y: number };
  hidden?: boolean;
  tipDismissed?: boolean;
  sound?: boolean;
  /** The visitor's answer to the one-time model download prompt. */
  download?: 'yes' | 'no';
}

/**
 * Per-site memory in localStorage. Every access is guarded: in private
 * windows or with storage blocked it silently falls back to memory.
 */
export class Store {
  private key: string;
  private memory: Remembered = {};
  private storage: Storage | null;

  constructor(siteKey: string, storage: Storage | null = safeLocalStorage()) {
    this.storage = storage;
    this.key = `deskpal:${siteKey}`;
    try {
      const raw = this.storage?.getItem(this.key);
      if (raw) this.memory = JSON.parse(raw) as Remembered;
    } catch {
      this.memory = {};
    }
  }

  get<K extends keyof Remembered>(key: K): Remembered[K] {
    return this.memory[key];
  }

  set<K extends keyof Remembered>(key: K, value: Remembered[K]): void {
    this.memory[key] = value;
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.memory));
    } catch {
      // Storage full or blocked: keep the value for this page view only.
    }
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
