import { createGenerativeAdapter, type ExtractiveAdapter, type GenerativeAdapter } from './adapters/index.ts';
import { RUNTIME_DOWNLOAD_MB, startRuntime } from './adapters/runtime-loader.ts';
import { ANNOUNCE, initialState, loopFor, step, type BehaviourEvent, type State } from './core/behaviour.ts';
import type { DeskpalConfig } from './core/config.ts';
import { DownloadProgress } from './core/progress.ts';
import { Store } from './core/storage.ts';
import { DEFAULT_EMBEDDING } from './rag/embedding.ts';
import { DEFAULT_EXTRACTIVE, type Extract } from './rag/extract.ts';
import { loadIndex } from './rag/loader.ts';
import { buildPrompt } from './rag/prompt.ts';
import { MIN_SCORE_KEYWORD, MIN_SCORE_VECTOR, Searcher } from './rag/search.ts';
import type { DeskpalIndex, Embedder, Hit } from './rag/types.ts';
import { INTENT_ANIMATION, matchSmallTalk, SmallTalkMatcher } from './persona/smalltalk.ts';
import { mergeVoice, Speaker, type Intent, type LineSet } from './persona/voice.ts';
import { loadSkin, loadSkinFromUrl, type Skin } from './sprite/loader.ts';
import { SpritePlayer } from './sprite/player.ts';
import { buildDom, type WidgetDom } from './ui/dom.ts';
import { makeDraggable } from './ui/drag.ts';
import { Sounds } from './ui/sound.ts';
import defaultManifest from '../skins/default/manifest.json' with { type: 'json' };
import defaultSheet from '../skins/default/sheet.svg';

const MARGIN = 16;
const FIDGET_MS: [number, number] = [6_000, 14_000];
const BORED_MS = 45_000;
const SLEEP_MS = 150_000;
const SNIPPET_CHARS = 220;
/** Characters of context shown on each side of an extracted answer. */
const QUOTE_CONTEXT = 140;
/** Answers quicker than this never show a thinking line. */
const THINKING_DELAY_MS = 400;
const DONT_KNOW = /\bi don'?t know\b/i;

export class Deskpal {
  private dom: WidgetDom;
  private store: Store;
  private sounds: Sounds;
  private speaker: Speaker;
  private player: SpritePlayer | null = null;
  private state: State = initialState;
  private index: Promise<DeskpalIndex | null>;
  private keywordSearcher: Searcher | null = null;
  private vectorSearcher: Searcher | null = null;
  private extractive: ExtractiveAdapter | null = null;
  private embedder: Embedder | null = null;
  private smallTalkMatcher: SmallTalkMatcher | null = null;
  private generative: GenerativeAdapter | null;
  private generativeReady = false;
  /** The lazily loaded runtime, for the `browser` adapter and query embeddings. */
  private runtime: 'idle' | 'loaded' | 'declined' | 'failed' = 'idle';
  private inFlight: AbortController | null = null;
  private thinkingTimer: ReturnType<typeof setTimeout> | undefined;
  private thinkingMsg: HTMLElement | null = null;
  /** The follow-up buttons under the latest answer. */
  private followups: HTMLElement | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private idleTimers: ReturnType<typeof setTimeout>[] = [];
  private tipShown = false;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private pos = { x: 0, y: 0 };
  private config: DeskpalConfig;
  private dragOrigin = { x: 0, y: 0 };

  constructor(config: DeskpalConfig) {
    this.config = config;
    this.store = new Store(config.siteKey);
    this.sounds = new Sounds(this.store.get('sound') ?? false);
    this.speaker = new Speaker(mergeVoice(config.voice), config.name);
    this.generative = createGenerativeAdapter(config);
    this.dom = buildDom(config.name);
    this.index = this.loadIndex();
    this.wire();
    document.body.append(this.dom.host);
    this.placeInitially();
    void this.loadCharacter();
  }

  // ---- public API -------------------------------------------------------

  open(): void {
    if (this.state.mode === 'hidden' || this.state.open) return;
    this.hideTip();
    this.dom.bubble.hidden = false;
    this.dom.launcher.setAttribute('aria-expanded', 'true');
    this.placeBubble();
    if (!this.dom.log.childElementCount) this.addMessage('bot', this.config.greeting ?? this.speaker.say('greeting'));
    this.dispatch('open');
    this.sounds.play('open');
    this.dom.input.focus();
  }

  close(): void {
    if (!this.state.open) return;
    this.inFlight?.abort();
    this.dom.bubble.hidden = true;
    this.dom.launcher.setAttribute('aria-expanded', 'false');
    this.dispatch('close');
    this.sounds.play('close');
    this.dom.launcher.focus();
  }

  async hide(): Promise<void> {
    if (this.state.mode === 'hidden') return;
    this.close();
    this.hideTip();
    this.store.set('hidden', true);
    await this.dispatch('hide');
    await this.player?.play('hide');
    this.dom.launcher.hidden = true;
    this.dom.restore.hidden = false;
  }

  show(): void {
    if (this.state.mode !== 'hidden') return;
    this.store.set('hidden', false);
    this.dom.restore.hidden = true;
    this.dom.launcher.hidden = false;
    void this.dispatch('show');
    this.resetIdle();
    this.dom.launcher.focus();
  }

  ask(question: string): Promise<void> {
    this.open();
    return this.answer(question);
  }

  destroy(): void {
    this.inFlight?.abort();
    this.player?.stop();
    for (const t of this.timers) clearTimeout(t);
    this.idleTimers.forEach(clearTimeout);
    removeEventListener('resize', this.onResize);
    this.dom.host.remove();
  }

  // ---- setup ------------------------------------------------------------

  private async loadIndex(): Promise<DeskpalIndex | null> {
    if (!this.config.index) return null;
    try {
      const index = await loadIndex(new URL(this.config.index, document.baseURI).href);
      // Keyword search works at once; vectors need the runtime (and consent).
      this.keywordSearcher = new Searcher(index);
      if (index.model && (index.model.id !== DEFAULT_EMBEDDING.id || index.model.dim !== DEFAULT_EMBEDDING.dim)) {
        console.error(
          `deskpal: the index was built with "${index.model.id}" but this widget embeds with "${DEFAULT_EMBEDDING.id}". ` +
            'Searching by keyword only; rebuild the index with this version of deskpal.',
        );
      }
      return index;
    } catch (err) {
      console.error(err);
      return null;
    }
  }

  /** Whether this index's vectors can be used: built with the model the runtime embeds with. */
  private hasUsableVectors(index: DeskpalIndex): boolean {
    return index.model?.id === DEFAULT_EMBEDDING.id && index.model.dim === DEFAULT_EMBEDDING.dim;
  }

  private async loadCharacter(): Promise<void> {
    let skin: Skin;
    try {
      skin = this.config.skin ? await loadSkinFromUrl(this.config.skin) : await this.defaultSkin();
    } catch (err) {
      console.error(err);
      skin = await this.defaultSkin();
    }
    this.player = new SpritePlayer(skin, this.config.scale, () => this.reducedMotion.matches);
    // Site config wins over the skin's voice, which wins over the defaults.
    this.speaker = new Speaker(mergeVoice(skin.manifest.voice, this.config.voice), this.config.name);
    this.dom.launcher.append(this.player.canvas);
    this.placeInitially();

    if (this.store.get('hidden')) {
      this.state = { ...this.state, mode: 'hidden' };
      this.dom.launcher.hidden = true;
      this.dom.restore.hidden = false;
      return;
    }
    void this.player.play('appear', loopFor('idle'));
    this.resetIdle();
    this.scheduleTip();
  }

  private defaultSkin(): Promise<Skin> {
    return loadSkin({ ...defaultManifest, sheets: [defaultSheet] }, document.baseURI);
  }

  private wire(): void {
    const d = this.dom;
    makeDraggable(d.launcher, {
      onClick: () => (this.state.open ? this.close() : this.open()),
      onStart: () => {
        d.launcher.classList.add('dragging');
        this.dragOrigin = { ...this.pos };
        void this.dispatch('drag-start');
      },
      onMove: (dx, dy) => this.moveTo(this.dragOrigin.x + dx, this.dragOrigin.y + dy),
      onEnd: () => {
        d.launcher.classList.remove('dragging');
        this.store.set('position', { ...this.pos });
        this.placeBubble();
        void this.dispatch('drag-end');
      },
    });
    d.launcher.addEventListener('pointerenter', () => this.poke());
    d.closeButton.addEventListener('click', () => this.close());
    d.hideButton.addEventListener('click', () => void this.hide());
    d.restore.addEventListener('click', () => this.show());
    d.soundButton.setAttribute('aria-pressed', String(this.sounds.enabled));
    d.soundButton.addEventListener('click', () => {
      this.sounds.enabled = !this.sounds.enabled;
      this.store.set('sound', this.sounds.enabled);
      d.soundButton.setAttribute('aria-pressed', String(this.sounds.enabled));
      this.sounds.play('open');
    });
    d.root.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape' && this.state.open) {
        e.stopPropagation();
        this.close();
      }
    });
    d.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = d.input.value.trim();
      if (!q) return;
      d.input.value = '';
      void this.answer(q);
    });
    d.tipText.addEventListener('click', () => this.open());
    d.tipDismiss.addEventListener('click', () => {
      this.store.set('tipDismissed', true);
      this.hideTip();
    });
    this.reducedMotion.addEventListener('change', () => void this.dispatch('poke'));
    addEventListener('resize', this.onResize);
  }

  // ---- behaviour --------------------------------------------------------

  /** Feeds the state machine; `expression` replaces its one-shot animation. */
  private async dispatch(event: BehaviourEvent, expression?: string): Promise<void> {
    const before = this.state;
    const stepped = step(this.state, event);
    const { state } = stepped;
    const once = expression ?? stepped.once;
    this.state = state;
    if (!this.player) return;
    const announce = ANNOUNCE[once ?? ''] ?? (state.mode !== before.mode ? ANNOUNCE[loopFor(state.mode)] : undefined);
    if (announce) this.dom.status.textContent = announce;
    if (once) await this.player.play(once, loopFor(state.mode));
    else if (state.mode !== before.mode || this.player.playing !== loopFor(state.mode)) void this.player.play(loopFor(state.mode));
  }

  private poke(): void {
    void this.dispatch('poke');
    this.resetIdle();
  }

  /** Fidgets now and then; bored, then asleep, after long inactivity. */
  private resetIdle(): void {
    this.idleTimers.forEach(clearTimeout);
    const [lo, hi] = FIDGET_MS;
    const fidget = () => {
      void this.dispatch('fidget');
      this.idleTimers.push(setTimeout(fidget, lo + Math.random() * (hi - lo)));
    };
    this.idleTimers = [
      setTimeout(fidget, lo + Math.random() * (hi - lo)),
      setTimeout(() => void this.dispatch('bored'), BORED_MS),
      setTimeout(() => void this.dispatch('sleep'), SLEEP_MS),
    ];
  }

  // ---- tip --------------------------------------------------------------

  private scheduleTip(): void {
    if (!this.config.tip || this.store.get('tipDismissed')) return;
    this.later(() => {
      if (this.tipShown || this.state.greeted || this.state.mode === 'hidden') return;
      this.tipShown = true;
      this.dom.tipText.textContent = this.config.tip!;
      this.dom.tip.hidden = false;
      this.placeBubble();
      void this.dispatch('poke');
      this.later(() => this.hideTip(), 15_000);
    }, this.config.tipDelay);
  }

  private hideTip(): void {
    this.dom.tip.hidden = true;
  }

  // ---- answering --------------------------------------------------------

  private async answer(question: string): Promise<void> {
    this.inFlight?.abort();
    const ctrl = new AbortController();
    this.inFlight = ctrl;
    this.resetIdle();
    this.clearFollowups();
    this.addMessage('user', question);
    const intent = this.config.smallTalk ? matchSmallTalk(question, this.config.name) : null;
    if (intent) return this.chat(intent);
    await this.dispatch('ask');

    const index = await this.index;
    if (ctrl.signal.aborted) return;
    if (!index || !this.keywordSearcher) {
      this.addMessage('bot', this.speaker.say('noDocs'));
      await this.dispatch('error');
      return;
    }

    if (this.runtime === 'idle' && this.wantsRuntime(index)) {
      const yes = await this.askToDownload(index, ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (yes) await this.loadModels(index, ctrl.signal);
      else this.runtime = 'declined';
      if (ctrl.signal.aborted) return;
    }

    this.startThinking();
    try {
      const searcher = this.vectorSearcher ?? this.keywordSearcher;
      const minScore = this.config.minScore ?? (searcher.usesVectors ? MIN_SCORE_VECTOR : MIN_SCORE_KEYWORD);
      const hits = await searcher.search(question, { topK: this.config.topK, minScore });
      if (ctrl.signal.aborted) return;
      if (hits.length === 0) {
        const chatty = await this.smallTalkByMeaning(question);
        if (ctrl.signal.aborted) return;
        return chatty ? this.chat(chatty) : this.dontKnow(searcher, question);
      }

      if (this.extractive) return await this.answerExtractive(question, hits, ctrl.signal);
      if (this.generative) return await this.answerGenerative(question, hits, searcher, ctrl.signal);
      await this.answerSnippets(hits);
    } finally {
      if (this.inFlight === ctrl) this.stopThinking();
    }
  }

  /** A small-talk reply and its expression (SPEC §7). */
  private async chat(intent: Intent): Promise<void> {
    this.addMessage('bot', this.speaker.say(intent));
    this.sounds.play('answer');
    await this.dispatch('chat', INTENT_ANIMATION[intent]);
  }

  /** Paraphrased small talk, by similarity, once the docs matched nothing. Needs the query embedder. */
  private async smallTalkByMeaning(question: string): Promise<Intent | null> {
    if (!this.config.smallTalk || !this.embedder) return null;
    const embedder = this.embedder;
    this.smallTalkMatcher ??= new SmallTalkMatcher((text) => embedder.embedQuery(text));
    try {
      return await this.smallTalkMatcher.match(question);
    } catch (err) {
      console.error(err);
      return null;
    }
  }

  /** After THINKING_DELAY_MS, a `thinking` line, until the next bot message replaces it. */
  private startThinking(): void {
    this.stopThinking();
    this.thinkingTimer = setTimeout(() => {
      this.thinkingMsg = this.addMessage('note', this.speaker.say('thinking'));
      this.thinkingMsg.classList.add('thinking');
    }, THINKING_DELAY_MS);
  }

  private stopThinking(): void {
    clearTimeout(this.thinkingTimer);
    this.thinkingMsg?.remove();
    this.thinkingMsg = null;
  }

  /** The runtime is needed for the `browser` adapter, or to embed queries for an index with vectors. */
  private wantsRuntime(index: DeskpalIndex): boolean {
    return this.config.adapter === 'browser' || this.hasUsableVectors(index);
  }

  /** The one-time download prompt (SPEC §4). The answer is remembered per site. */
  private askToDownload(index: DeskpalIndex, signal: AbortSignal): Promise<boolean> {
    const saved = this.store.get('download');
    if (saved) return Promise.resolve(saved === 'yes');
    const mb = this.expectedDownloadMB(index) + RUNTIME_DOWNLOAD_MB;
    const privacy = this.config.adapter === 'browser' ? ' Everything then runs on your device.' : '';
    const msg = this.addMessage('bot', `To answer properly I need to download about ${Math.round(mb / 10) * 10} MB, once. It stays in your browser's cache.${privacy}`);
    const choices = document.createElement('div');
    choices.className = 'choices';
    const yes = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Download' });
    const no = Object.assign(document.createElement('button'), { type: 'button', textContent: 'No thanks, just links' });
    choices.append(yes, no);
    msg.append(choices);
    this.scrollLog();
    void this.dispatch('await-user');
    yes.focus();
    return new Promise((resolve) => {
      const done = (answer: 'yes' | 'no' | null) => {
        choices.remove();
        if (answer) {
          this.store.set('download', answer);
          this.addMessage('user', answer === 'yes' ? 'Download' : 'No thanks, just links');
          void this.dispatch('ask');
          this.dom.input.focus();
        }
        resolve(answer === 'yes');
      };
      yes.addEventListener('click', () => done('yes'));
      no.addEventListener('click', () => done('no'));
      signal.addEventListener('abort', () => done(null));
    });
  }

  private expectedDownloadMB(index: DeskpalIndex): number {
    return (this.hasUsableVectors(index) ? DEFAULT_EMBEDDING.sizeMB : 0) + (this.config.adapter === 'browser' ? DEFAULT_EXTRACTIVE.sizeMB : 0);
  }

  /** Loads the runtime and the models this page needs, with the progress bar and `download` animation. */
  private async loadModels(index: DeskpalIndex, signal: AbortSignal): Promise<void> {
    if (!this.config.runtimeUrl) {
      console.error('deskpal: no runtimeUrl, and it could not be worked out from the script tag.');
      this.runtime = 'failed';
      return;
    }
    this.dom.progress.hidden = false;
    this.setProgress(0);
    void this.dispatch('download');
    const progress = new DownloadProgress(this.expectedDownloadMB(index), (f) => this.setProgress(f));
    try {
      const rt = await startRuntime(this.config.runtimeUrl, { modelHost: this.config.modelHost, worker: this.config.worker });
      // One model at a time keeps peak memory down on small devices.
      if (this.hasUsableVectors(index)) {
        this.embedder = await rt.loadEmbedder(DEFAULT_EMBEDDING, progress.update);
        this.vectorSearcher = new Searcher(index, this.embedder);
      }
      if (this.config.adapter === 'browser') this.extractive = await rt.loadExtractive(DEFAULT_EXTRACTIVE, this.config.minAnswerScore, progress.update);
      this.runtime = 'loaded';
    } catch (err) {
      console.error(err);
      this.runtime = 'failed';
      if (!signal.aborted) this.addMessage('note', "I couldn't load my answer model, so I'll show you the matching docs instead.");
    } finally {
      this.dom.progress.hidden = true;
      if (!signal.aborted) void this.dispatch('ask');
    }
  }

  private setProgress(fraction: number): void {
    const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
    this.dom.progressBar.style.width = `${pct}%`;
    this.dom.progress.setAttribute('aria-valuenow', String(pct));
  }

  /**
   * The answer span from `hits`, introduced by how sure the model is. Below
   * minAnswerScore the sections themselves are shown: they already passed the
   * relevance cutoff, and in testing the right span often scored low.
   */
  private async answerExtractive(question: string, hits: Hit[], signal: AbortSignal, intro?: LineSet, tried = new Set<Hit>()): Promise<void> {
    let found: Extract | null;
    try {
      found = await this.extractive!.extract(question, hits.map((h) => h.chunk.text), signal);
    } catch (err) {
      if (signal.aborted) return;
      console.error(err);
      this.renderSnippets(hits);
      await this.dispatch('error');
      return;
    }
    if (signal.aborted) return;
    if (!found) return this.answerSnippets(hits, intro === 'nextBest' ? 'outOfIdeas' : 'snippets');
    const sure = found.score >= this.config.sureAnswerScore;
    const hit = hits[found.passage]!;
    tried.add(hit);
    const msg = this.renderExtract(this.speaker.say(intro ?? (sure ? 'found' : 'unsure')), found, hits);
    this.addFollowups(msg, question, hit, found, hits, tried);
    this.sounds.play('answer');
    await this.dispatch(sure ? 'answer-cited' : 'answer-unsure');
  }

  private async answerSnippets(hits: Hit[], intro: LineSet = 'snippets'): Promise<void> {
    this.renderSnippets(hits, this.speaker.say(intro));
    this.sounds.play('answer');
    await this.dispatch('answer-cited');
  }

  /** "Show more" and "Not what I meant" under the latest extracted answer (SPEC §7). */
  private addFollowups(msg: HTMLElement, question: string, hit: Hit, found: Extract, hits: Hit[], tried: Set<Hit>): void {
    const bar = document.createElement('div');
    bar.className = 'choices followups';
    const more = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Show more' });
    const other = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Not what I meant' });
    more.addEventListener('click', () => {
      msg.querySelector('.quote')?.replaceWith(this.quote(hit, found, true));
      more.remove();
      other.focus();
    });
    other.addEventListener('click', () => void this.nextBest(question, hits, tried));
    bar.append(more, other);
    msg.append(bar);
    this.followups = bar;
    this.scrollLog();
  }

  private clearFollowups(): void {
    this.followups?.remove();
    this.followups = null;
  }

  /** The best answer from the sections not shown yet. */
  private async nextBest(question: string, hits: Hit[], tried: Set<Hit>): Promise<void> {
    this.inFlight?.abort();
    const ctrl = new AbortController();
    this.inFlight = ctrl;
    this.clearFollowups();
    this.resetIdle();
    this.addMessage('user', 'Not what I meant');
    const rest = hits.filter((h) => !tried.has(h));
    if (!rest.length) {
      const msg = this.addMessage('bot', this.speaker.say('outOfIdeas'));
      this.appendSources(msg, hits, false);
      await this.dispatch('no-answer');
      return;
    }
    await this.dispatch('ask');
    this.startThinking();
    try {
      await this.answerExtractive(question, rest, ctrl.signal, 'nextBest', tried);
    } finally {
      if (this.inFlight === ctrl) this.stopThinking();
    }
  }

  private async answerGenerative(question: string, hits: Hit[], searcher: Searcher, signal: AbortSignal): Promise<void> {
    // The bubble appears with the first words, so the thinking line shows until then.
    let msg: HTMLElement | null = null;
    let full = '';
    try {
      await this.ensureGenerative(signal);
      this.dom.log.setAttribute('aria-busy', 'true');
      for await (const piece of this.generative!.generate(buildPrompt(question, hits), signal)) {
        if (!msg) {
          msg = this.addMessage('bot', '');
          void this.dispatch('answer-start');
        }
        full += piece;
        msg.querySelector('.text')!.textContent = full;
        this.scrollLog();
      }
    } catch (err) {
      if (signal.aborted) return;
      // Includes a refusal: a partial answer is discarded, never shown as complete.
      console.error(err);
      msg?.remove();
      this.addMessage('note', this.speaker.say('error'));
      this.renderSnippets(hits);
      await this.dispatch('error');
      return;
    } finally {
      this.dom.log.removeAttribute('aria-busy');
      this.dom.progress.hidden = true;
    }

    if (!msg || !full.trim() || DONT_KNOW.test(full)) {
      msg?.remove();
      return this.dontKnow(searcher, question, hits);
    }
    const cited = [...full.matchAll(/\[(\d+)\]/g)].map((m) => hits[Number(m[1]) - 1]).filter((h): h is Hit => !!h);
    this.appendSources(msg, cited.length ? [...new Set(cited)] : hits, false, 'Sources:');
    await this.dispatch('answer-cited');
    this.sounds.play('answer');
  }

  private async ensureGenerative(signal: AbortSignal): Promise<void> {
    if (this.generativeReady || !this.generative) return;
    let shown = false;
    await this.generative.ready((p) => {
      if (signal.aborted) return;
      if (!shown) {
        shown = true;
        this.dom.progress.hidden = false;
        void this.dispatch('download');
      }
      this.setProgress(p);
    });
    this.generativeReady = true;
    if (shown) void this.dispatch('ask');
  }

  private async dontKnow(searcher: Searcher, question: string, near?: Hit[]): Promise<void> {
    const closest = near ?? (await searcher.search(question, { topK: 3, minScore: 0.05 }));
    const msg = this.addMessage('bot', this.speaker.say('dontKnow'));
    if (closest.length) this.appendSources(msg, closest, false, 'These might be close:');
    await this.dispatch('no-answer');
    this.sounds.play('sorry');
  }

  private renderSnippets(hits: Hit[], intro = this.speaker.say('snippets')): void {
    const msg = this.addMessage('bot', intro);
    this.appendSources(msg, hits, true);
  }

  // ---- rendering --------------------------------------------------------

  private addMessage(kind: 'user' | 'bot' | 'note', text: string): HTMLElement {
    if (kind !== 'user') this.stopThinking();
    const msg = document.createElement('div');
    msg.className = kind === 'note' ? 'msg bot note' : `msg ${kind}`;
    const span = document.createElement('span');
    span.className = 'text';
    span.textContent = text;
    msg.append(span);
    this.dom.log.append(msg);
    this.scrollLog();
    return msg;
  }

  /** A persona line, the answer highlighted in context, where it came from and what else matched. */
  private renderExtract(intro: string, found: Extract, hits: Hit[]): HTMLElement {
    const hit = hits[found.passage]!;
    const msg = this.addMessage('bot', intro);
    msg.append(this.quote(hit, found, false));
    const from = document.createElement('div');
    from.className = 'from';
    from.append('— ', this.sourceLink(hit));
    msg.append(from);
    const others = hits.filter((h) => h !== hit);
    if (others.length) this.appendSources(msg, others, false, 'Also see:');
    this.scrollLog();
    return msg;
  }

  /** The answer marked within its section: some context around it, or the whole section. */
  private quote(hit: Hit, found: Extract, whole: boolean): HTMLElement {
    const quote = document.createElement('blockquote');
    quote.className = 'quote';
    const mark = document.createElement('mark');
    const text = hit.chunk.text;
    if (found.start === undefined || found.end === undefined) {
      mark.textContent = found.answer;
      quote.append(mark);
      if (whole) quote.append(document.createElement('br'), text);
      return quote;
    }
    const { start, end } = found;
    const from = whole ? 0 : Math.max(0, start - QUOTE_CONTEXT);
    const to = whole ? text.length : end + QUOTE_CONTEXT;
    mark.textContent = text.slice(start, end);
    // Cut at word boundaries, and say so with an ellipsis.
    const before = text.slice(from, start).replace(/^\S*\s/, (m) => (from > 0 ? '' : m));
    const after = text.slice(end, to).replace(/\s\S*$/, (m) => (to < text.length ? '' : m));
    quote.append((from > 0 ? '…' : '') + before, mark, after + (to < text.length ? '…' : ''));
    return quote;
  }

  private sourceLink(hit: Hit): HTMLElement {
    const href = safeHref(hit.chunk.url);
    const link = document.createElement(href ? 'a' : 'span');
    if (href) (link as HTMLAnchorElement).href = href;
    link.textContent = [hit.chunk.title, ...hit.chunk.path.slice(1)].join(' › ');
    return link;
  }

  private appendSources(msg: HTMLElement, hits: Hit[], withSnippets: boolean, label?: string): void {
    if (label) {
      const heading = document.createElement('div');
      heading.className = 'snippet';
      heading.textContent = label;
      msg.append(heading);
    }
    const list = document.createElement('ol');
    list.className = 'sources';
    for (const hit of hits) {
      const { chunk } = hit;
      const li = document.createElement('li');
      li.append(this.sourceLink(hit));
      if (withSnippets) {
        const s = document.createElement('span');
        s.className = 'snippet';
        s.textContent = clip(chunk.text, SNIPPET_CHARS);
        li.append(s);
      }
      list.append(li);
    }
    msg.append(list);
    this.scrollLog();
  }

  private scrollLog(): void {
    this.dom.log.scrollTop = this.dom.log.scrollHeight;
  }

  // ---- position ---------------------------------------------------------

  private onResize = (): void => {
    if (this.store.get('position')) this.moveTo(this.pos.x, this.pos.y);
    else this.placeInitially();
    this.placeBubble();
  };

  private size(): { w: number; h: number } {
    const r = this.dom.launcher.getBoundingClientRect();
    return { w: r.width || 96, h: r.height || 96 };
  }

  private placeInitially(): void {
    const saved = this.store.get('position');
    if (saved) return this.moveTo(saved.x, saved.y);
    const { w, h } = this.size();
    const [v, hz] = this.config.position.split('-');
    this.moveTo(hz === 'left' ? MARGIN : innerWidth - w - MARGIN, v === 'top' ? MARGIN : innerHeight - h - MARGIN);
  }

  private moveTo(x: number, y: number): void {
    const { w, h } = this.size();
    this.pos = {
      x: Math.round(Math.min(Math.max(0, x), Math.max(0, innerWidth - w))),
      y: Math.round(Math.min(Math.max(0, y), Math.max(0, innerHeight - h))),
    };
    this.dom.host.style.left = `${this.pos.x}px`;
    this.dom.host.style.top = `${this.pos.y}px`;
  }

  /** Opens the bubble toward the roomier side of the screen. */
  private placeBubble(): void {
    const { w, h } = this.size();
    const above = this.pos.y + h / 2 > innerHeight / 2;
    const start = this.pos.x + w / 2 < innerWidth / 2;
    for (const e of [this.dom.bubble, this.dom.tip]) {
      e.classList.toggle('above', above);
      e.classList.toggle('below', !above);
      e.classList.toggle('align-start', start);
      e.classList.toggle('align-end', !start);
    }
  }

  private later(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }
}

function safeHref(url: string): string | null {
  try {
    const u = new URL(url, document.baseURI);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, t.lastIndexOf(' ', max) > max * 0.6 ? t.lastIndexOf(' ', max) : max)}…`;
}
