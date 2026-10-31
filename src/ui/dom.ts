import type { DeskpalConfig } from '../core/config.ts';
import { CSS, configCss } from './styles.ts';

export interface WidgetDom {
  host: HTMLElement;
  root: ShadowRoot;
  launcher: HTMLButtonElement;
  bubble: HTMLElement;
  title: HTMLElement;
  log: HTMLElement;
  progress: HTMLElement;
  progressBar: HTMLElement;
  form: HTMLFormElement;
  input: HTMLInputElement;
  soundButton: HTMLButtonElement;
  hideButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
  tip: HTMLElement;
  tipText: HTMLButtonElement;
  tipDismiss: HTMLButtonElement;
  restore: HTMLButtonElement;
  status: HTMLElement;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/**
 * Builds the widget inside a shadow root. Styles go in through a constructed
 * stylesheet where supported, which strict CSPs allow; the <style> fallback
 * is for older browsers.
 */
export function buildDom(config: Pick<DeskpalConfig, 'name' | 'theme' | 'fontSize' | 'accent'>): WidgetDom {
  const { name } = config;
  // An attribute only the widget uses: the host sits in the page, whose CSS may style `.retro`.
  const host = el('div', {}, { 'data-deskpal': '', 'data-deskpal-theme': config.theme ?? 'modern' });
  const css = CSS + configCss(config);
  const root = host.attachShadow({ mode: 'open' });
  if ('adoptedStyleSheets' in root && typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
  } else {
    root.append(el('style', { textContent: css }));
  }

  const bubbleId = 'deskpal-bubble';
  const launcher = el('button', { type: 'button', className: 'launcher' }, {
    'aria-label': `Open ${name}, the help assistant`,
    'aria-haspopup': 'dialog',
    'aria-expanded': 'false',
    'aria-controls': bubbleId,
  });

  const title = el('span', { className: 'title', id: 'deskpal-title', textContent: name });
  const soundButton = el('button', { type: 'button', className: 'icon', textContent: '♪' }, { 'aria-label': 'Sound effects', 'aria-pressed': 'false' });
  const hideButton = el('button', { type: 'button', className: 'icon', textContent: '⌄' }, { 'aria-label': `Hide ${name} on this site` });
  const closeButton = el('button', { type: 'button', className: 'icon', textContent: '×' }, { 'aria-label': 'Close' });
  const header = el('div', { className: 'header' });
  header.append(title, soundButton, hideButton, closeButton);

  const log = el('div', { className: 'log' }, { 'aria-live': 'polite', 'aria-relevant': 'additions text' });
  const progressBar = el('div');
  const progress = el('div', { className: 'progress', hidden: true }, { role: 'progressbar', 'aria-label': 'Loading the language model', 'aria-valuemin': '0', 'aria-valuemax': '100' });
  progress.append(progressBar);

  const input = el('input', { type: 'text', autocomplete: 'off', placeholder: 'Ask a question…' }, { 'aria-label': 'Your question', enterkeyhint: 'send' });
  const form = el('form', { className: 'ask' });
  form.append(input, el('button', { type: 'submit', textContent: 'Ask' }));

  const bubble = el('div', { className: 'bubble', id: bubbleId, hidden: true }, { role: 'dialog', 'aria-labelledby': 'deskpal-title' });
  bubble.append(header, log, progress, form);

  const tipText = el('button', { type: 'button', className: 'open' });
  const tipDismiss = el('button', { type: 'button', className: 'icon dismiss', textContent: '×' }, { 'aria-label': 'Dismiss tip' });
  const tip = el('div', { className: 'tip', hidden: true }, { role: 'status' });
  tip.append(tipText, tipDismiss);

  const restore = el('button', { type: 'button', className: 'restore', textContent: '?', hidden: true }, { 'aria-label': `Show ${name}, the help assistant` });
  const status = el('div', { className: 'sr-only' }, { 'aria-live': 'polite' });

  root.append(launcher, bubble, tip, restore, status);
  return { host, root, launcher, bubble, title, log, progress, progressBar, form, input, soundButton, hideButton, closeButton, tip, tipText, tipDismiss, restore, status };
}
