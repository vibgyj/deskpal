import type { DeskpalConfig } from '../core/config.ts';

/**
 * The page can restyle the widget by setting these on `[data-deskpal]`, since
 * the host page's rules beat `:host`. See docs/configuration.md, Look.
 */
export const CSS = `
:host {
  all: initial;
  position: fixed;
  z-index: 2147483000;
  --dp-font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  --dp-font-size: 15px;
  --dp-radius: 18px;
  --dp-ink: #1d2030;
  --dp-muted: #6a6f82;
  --dp-bg: #ffffff;
  --dp-surface: #f1f2f6;
  --dp-line: #e3e5ec;
  --dp-accent: #2f5fd0;
  --dp-on-accent: #ffffff;
  --dp-mark: #ffe27a;
  --dp-shadow: 0 12px 40px rgb(15 20 40 / 0.18), 0 2px 8px rgb(15 20 40 / 0.08);
  font: var(--dp-font-size)/1.5 var(--dp-font);
  color: var(--dp-ink);
  -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  :host {
    --dp-ink: #ecedf4;
    --dp-muted: #9a9eb3;
    --dp-bg: #1b1d27;
    --dp-surface: #272a37;
    --dp-line: #343848;
    --dp-accent: #7f9fff;
    --dp-on-accent: #0f1220;
    --dp-mark: #6b5600;
    --dp-shadow: 0 12px 40px rgb(0 0 0 / 0.5), 0 2px 8px rgb(0 0 0 / 0.3);
  }
}
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
button { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--dp-accent); outline-offset: 2px; }

.launcher {
  display: block; padding: 0; margin: 0; border: 0; background: none;
  cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none;
}
.launcher.dragging { cursor: grabbing; }
.launcher canvas { display: block; pointer-events: none; }

.bubble, .tip {
  position: absolute;
  background: var(--dp-bg);
  border: 1px solid var(--dp-line);
  border-radius: var(--dp-radius);
  box-shadow: var(--dp-shadow);
}
.bubble {
  width: min(380px, calc(100vw - 32px));
  display: flex; flex-direction: column;
  max-height: min(72vh, 580px);
  overflow: hidden;
}
.above { bottom: calc(100% + 10px); }
.below { top: calc(100% + 10px); }
.align-start { left: 0; }
.align-end { right: 0; }

.header {
  display: flex; align-items: center; gap: 2px;
  padding: 10px 8px 10px 16px;
  border-bottom: 1px solid var(--dp-line);
}
.title { flex: 1; font-weight: 600; font-size: 0.93em; }
.icon {
  width: 30px; height: 30px; padding: 0;
  border: 0; border-radius: 8px;
  background: none; color: var(--dp-muted); cursor: pointer; line-height: 1; font-size: 15px;
}
.icon:hover { background: var(--dp-surface); color: var(--dp-ink); }
.icon[aria-pressed="false"] { opacity: 0.55; }

.log { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.msg { padding: 9px 13px; border-radius: 16px; white-space: pre-wrap; overflow-wrap: anywhere; }
.msg.user {
  align-self: flex-end; max-width: 85%;
  background: var(--dp-accent); color: var(--dp-on-accent); border-bottom-right-radius: 5px;
}
.msg.bot { align-self: flex-start; max-width: 92%; background: var(--dp-surface); border-bottom-left-radius: 5px; }
.msg.note { align-self: flex-start; padding: 2px 4px; color: var(--dp-muted); font-size: 0.87em; }
.msg.thinking { opacity: 0.8; }
.sources { margin: 8px 0 0; padding: 8px 0 0 18px; border-top: 1px solid var(--dp-line); white-space: normal; font-size: 0.9em; }
.sources li { margin: 3px 0; }
/* A label goes above the divider, with its list. */
.sources-label { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--dp-line); }
.sources-label + .sources { margin-top: 2px; padding-top: 0; border-top: 0; }
a { color: var(--dp-accent); text-underline-offset: 2px; }
.snippet { display: block; color: var(--dp-muted); font-size: 0.87em; }
.quote { margin: 6px 0 0; padding: 2px 0 2px 10px; border-left: 3px solid var(--dp-accent); white-space: normal; }
.quote mark { background: var(--dp-mark); color: inherit; padding: 0 2px; border-radius: 3px; }
.from { margin-top: 6px; font-size: 0.85em; color: var(--dp-muted); white-space: normal; }
.choices { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; white-space: normal; }
.choices button {
  padding: 5px 12px; border: 1px solid var(--dp-line); border-radius: 999px;
  background: var(--dp-bg); color: var(--dp-accent); cursor: pointer; font-size: 0.9em;
}
.choices button:hover { border-color: var(--dp-accent); }

.followups { margin-top: 8px; }
.followups button { font-size: 0.85em; padding: 3px 10px; }

.progress { height: 4px; margin: 0 16px 10px; border-radius: 2px; background: var(--dp-surface); overflow: hidden; }
.progress > div { height: 100%; width: 0; background: var(--dp-accent); transition: width 0.2s; }

.ask { display: flex; gap: 8px; padding: 12px; border-top: 1px solid var(--dp-line); }
.ask input {
  flex: 1; min-width: 0; padding: 9px 14px; font: inherit; color: inherit;
  background: var(--dp-surface); border: 1px solid transparent; border-radius: 999px; outline: none;
}
.ask input::placeholder { color: var(--dp-muted); }
.ask input:focus { border-color: var(--dp-accent); background: var(--dp-bg); }
.ask button {
  padding: 0 16px; border: 0; border-radius: 999px; font-weight: 600;
  background: var(--dp-accent); color: var(--dp-on-accent); cursor: pointer;
}
.ask button:hover { filter: brightness(1.08); }

.tip { width: min(260px, calc(100vw - 32px)); padding: 12px 36px 12px 14px; font-size: 0.93em; }
.tip .open { all: unset; cursor: pointer; display: block; }
.tip .dismiss { position: absolute; top: 6px; right: 6px; width: 24px; height: 24px; }

.restore {
  width: 36px; height: 36px; border-radius: 18px; padding: 0;
  border: 1px solid var(--dp-line); background: var(--dp-bg); color: var(--dp-accent);
  box-shadow: var(--dp-shadow); cursor: pointer; font-weight: 600;
}

@media (prefers-reduced-motion: no-preference) {
  .bubble, .tip { animation: dp-pop 160ms ease-out; transform-origin: bottom right; }
  @keyframes dp-pop { from { transform: translateY(6px) scale(0.98); opacity: 0; } }
}

/* theme: "retro", the original 90s look: ink outlines and hard drop shadows. */
:host([data-deskpal-theme="retro"]) {
  --dp-font: Tahoma, Verdana, "Segoe UI", system-ui, sans-serif;
  --dp-font-size: 13px;
  --dp-radius: 10px;
  --dp-ink: #2b2b3a;
  --dp-bg: #fffbe6;
  --dp-surface: #ffffff;
  --dp-line: #2b2b3a;
  --dp-hard: #2b2b3a;
}
@media (prefers-color-scheme: dark) {
  :host([data-deskpal-theme="retro"]) {
    --dp-ink: #ecebf5;
    --dp-bg: #26263a;
    --dp-surface: #1c1c2b;
    --dp-line: #ecebf5;
    --dp-hard: #000000;
  }
}
:host([data-deskpal-theme="retro"]) .bubble, :host([data-deskpal-theme="retro"]) .tip { border: 2px solid var(--dp-ink); box-shadow: 4px 4px 0 var(--dp-hard); }
:host([data-deskpal-theme="retro"]) .header, :host([data-deskpal-theme="retro"]) .ask { border-color: var(--dp-ink); border-width: 2px; }
:host([data-deskpal-theme="retro"]) .title { font-size: 1em; font-weight: bold; }
:host([data-deskpal-theme="retro"]) .icon { border: 1px solid var(--dp-ink); border-radius: 4px; background: var(--dp-surface); color: inherit; font-size: inherit; }
:host([data-deskpal-theme="retro"]) .msg { border-radius: 8px; padding: 6px 9px; }
:host([data-deskpal-theme="retro"]) .msg.user { background: color-mix(in srgb, var(--dp-accent) 18%, var(--dp-surface)); color: inherit; }
:host([data-deskpal-theme="retro"]) .msg.bot { border: 1px solid var(--dp-ink); }
:host([data-deskpal-theme="retro"]) .msg.note { font-size: 1em; font-style: italic; padding: 6px 9px; }
:host([data-deskpal-theme="retro"]) .msg.thinking { opacity: 1; border-style: dashed; }
:host([data-deskpal-theme="retro"]) .ask input { background: var(--dp-surface); border: 1px solid var(--dp-ink); border-radius: 4px; }
:host([data-deskpal-theme="retro"]) .ask button, :host([data-deskpal-theme="retro"]) .choices button, :host([data-deskpal-theme="retro"]) .restore {
  border: 1px solid var(--dp-ink); border-radius: 4px; background: var(--dp-surface); color: inherit;
  box-shadow: 2px 2px 0 var(--dp-hard); font-weight: normal;
}
:host([data-deskpal-theme="retro"]) .ask button { background: var(--dp-accent); color: var(--dp-on-accent); }
:host([data-deskpal-theme="retro"]) .choices button, :host([data-deskpal-theme="retro"]) .restore { color: var(--dp-accent); }
:host([data-deskpal-theme="retro"]) .ask button:active { box-shadow: none; transform: translate(2px, 2px); }
:host([data-deskpal-theme="retro"]) .sources, :host([data-deskpal-theme="retro"]) .sources-label { border-top-style: dashed; border-top-color: var(--dp-muted); }
:host([data-deskpal-theme="retro"]) .progress { height: 10px; border: 1px solid var(--dp-ink); border-radius: 0; }
:host([data-deskpal-theme="retro"]) .restore { border-radius: 16px; font-weight: bold; }
`;

/** Rules for the `fontSize` and `accent` options, added after the stylesheet. */
export function configCss(config: Pick<DeskpalConfig, 'fontSize' | 'accent'>): string {
  const vars: string[] = [];
  if (config.fontSize) vars.push(`--dp-font-size: ${config.fontSize}px;`);
  if (config.accent) {
    vars.push(`--dp-accent: ${config.accent};`, `--dp-on-accent: ${isLight(config.accent) ? '#0f1220' : '#ffffff'};`);
  }
  // The retro selector too, which would otherwise win on specificity.
  return vars.length ? `\n:host, :host([data-deskpal-theme="retro"]) { ${vars.join(' ')} }` : '';
}

/** Whether a hex colour (all `accent` allows) wants dark text on it. */
export function isLight(colour: string): boolean {
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(colour)?.[1];
  if (!hex) return false;
  const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  // Relative luminance; above ~0.18 dark text has the better contrast.
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.18;
}
