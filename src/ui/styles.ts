export const CSS = `
:host {
  all: initial;
  position: fixed;
  z-index: 2147483000;
  --dp-ink: #2b2b3a;
  --dp-paper: #fffbe6;
  --dp-panel: #ffffff;
  --dp-muted: #5c5c70;
  --dp-accent: #2f5fd0;
  --dp-user: #e8eefc;
  --dp-shadow: #2b2b3a;
  --dp-mark: #ffe27a;
  font: 13px/1.45 Tahoma, Verdana, "Segoe UI", system-ui, sans-serif;
  color: var(--dp-ink);
}
@media (prefers-color-scheme: dark) {
  :host {
    --dp-ink: #ecebf5;
    --dp-paper: #26263a;
    --dp-panel: #1c1c2b;
    --dp-muted: #a9a9c0;
    --dp-accent: #8fb0ff;
    --dp-user: #33395a;
    --dp-shadow: #000000;
    --dp-mark: #6b5600;
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
  background: var(--dp-paper);
  border: 2px solid var(--dp-ink);
  border-radius: 10px;
  box-shadow: 4px 4px 0 var(--dp-shadow);
}
.bubble {
  width: min(340px, calc(100vw - 32px));
  display: flex; flex-direction: column;
  max-height: min(70vh, 520px);
}
.above { bottom: calc(100% + 8px); }
.below { top: calc(100% + 8px); }
.align-start { left: 0; }
.align-end { right: 0; }

.header {
  display: flex; align-items: center; gap: 4px;
  padding: 6px 6px 6px 10px;
  border-bottom: 2px solid var(--dp-ink);
}
.title { flex: 1; font-weight: bold; }
.icon {
  width: 26px; height: 26px; padding: 0;
  border: 1px solid var(--dp-ink); border-radius: 4px;
  background: var(--dp-panel); cursor: pointer; line-height: 1;
}
.icon[aria-pressed="false"] { opacity: 0.6; }

.log { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.msg { padding: 6px 9px; border-radius: 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
.msg.user { align-self: flex-end; background: var(--dp-user); max-width: 85%; }
.msg.bot { align-self: flex-start; background: var(--dp-panel); border: 1px solid var(--dp-ink); max-width: 100%; }
.msg.note { color: var(--dp-muted); font-style: italic; }
.sources { margin: 6px 0 0; padding: 6px 0 0 18px; border-top: 1px dashed var(--dp-muted); white-space: normal; }
.sources li { margin: 2px 0; }
.sources a { color: var(--dp-accent); }
.snippet { display: block; color: var(--dp-muted); font-size: 12px; }
.quote { margin: 0; padding: 2px 0 2px 9px; border-left: 3px solid var(--dp-accent); white-space: normal; }
.quote mark { background: var(--dp-mark); color: inherit; padding: 0 2px; border-radius: 2px; }
.from { margin-top: 4px; font-size: 12px; white-space: normal; }
.from a { color: var(--dp-accent); }
.choices { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; white-space: normal; }
.choices button {
  padding: 4px 10px; border: 1px solid var(--dp-ink); border-radius: 4px;
  background: var(--dp-panel); box-shadow: 2px 2px 0 var(--dp-shadow); cursor: pointer;
}

.progress { height: 10px; margin: 0 10px 8px; border: 1px solid var(--dp-ink); background: var(--dp-panel); }
.progress > div { height: 100%; width: 0; background: var(--dp-accent); }

.ask { display: flex; gap: 6px; padding: 8px; border-top: 2px solid var(--dp-ink); }
.ask input {
  flex: 1; min-width: 0; padding: 5px 8px; font: inherit; color: inherit;
  background: var(--dp-panel); border: 1px solid var(--dp-ink); border-radius: 4px;
}
.ask button, .tip .open {
  padding: 4px 12px; border: 1px solid var(--dp-ink); border-radius: 4px;
  background: var(--dp-panel); box-shadow: 2px 2px 0 var(--dp-shadow); cursor: pointer;
}
.ask button:active { box-shadow: none; transform: translate(2px, 2px); }

.tip { width: min(240px, calc(100vw - 32px)); padding: 8px 30px 8px 10px; }
.tip .open { all: unset; cursor: pointer; display: block; }
.tip .dismiss { position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; }

.restore {
  width: 32px; height: 32px; border-radius: 16px; padding: 0;
  border: 2px solid var(--dp-ink); background: var(--dp-paper);
  box-shadow: 2px 2px 0 var(--dp-shadow); cursor: pointer; font-weight: bold;
}

@media (prefers-reduced-motion: no-preference) {
  .bubble, .tip { animation: dp-pop 120ms ease-out; }
  @keyframes dp-pop { from { transform: scale(0.96); opacity: 0; } }
}
`;
