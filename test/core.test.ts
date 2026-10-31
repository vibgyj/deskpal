import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialState, loopFor, step, type BehaviourEvent, type State } from '../src/core/behaviour.ts';
import { fromDataset, fromJson, resolveConfig } from '../src/core/config.ts';
import { Store } from '../src/core/storage.ts';
import { configCss } from '../src/ui/styles.ts';

test('config layers: data attributes < JSON block < init options', (t) => {
  t.mock.method(console, 'warn', () => {});
  const c = resolveConfig(
    fromDataset({ index: '/a.json', topK: '6', adapter: 'none', bogus: 'x' }),
    fromJson('{"index": "/b.json", "position": "top-left", "minScore": "nope"}'),
    { siteKey: 'site' },
  );
  assert.equal(c.index, '/b.json');
  assert.equal(c.topK, 6);
  assert.equal(c.adapter, 'none');
  assert.equal(c.position, 'top-left');
  assert.equal(c.minScore, undefined);
  assert.equal(c.siteKey, 'site');
  assert.ok(!('bogus' in c));
});

test('invalid enum values and bad JSON are ignored', (t) => {
  t.mock.method(console, 'warn', () => {});
  assert.deepEqual(fromDataset({ adapter: 'gpt', position: 'middle' }), {});
  assert.deepEqual(fromJson('[1,2]'), {});
  assert.deepEqual(fromJson('{oops'), {});
});

test('store survives throwing storage and keeps values in memory', () => {
  const broken = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  } as unknown as Storage;
  const s = new Store('site', broken);
  s.set('hidden', true);
  assert.equal(s.get('hidden'), true);
  assert.equal(new Store('site', null).get('hidden'), undefined);
});

test('store persists per site', () => {
  const data = new Map<string, string>();
  const mem = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) } as Storage;
  new Store('a.example', mem).set('position', { x: 3, y: 4 });
  assert.deepEqual(new Store('a.example', mem).get('position'), { x: 3, y: 4 });
  assert.equal(new Store('b.example', mem).get('position'), undefined);
});

function run(events: BehaviourEvent[], from: State = initialState) {
  const onces: (string | undefined)[] = [];
  let s = from;
  for (const e of events) {
    const r = step(s, e);
    s = r.state;
    onces.push(r.once);
  }
  return { s, onces };
}

test('behaviour: idle drifts to bored, then sleep; a poke wakes it', () => {
  const { s, onces } = run(['bored', 'sleep', 'poke']);
  assert.equal(s.mode, 'idle');
  assert.deepEqual(onces, [undefined, undefined, 'wake']);
});

test('behaviour: first open greets, later opens do not', () => {
  const { s, onces } = run(['open', 'close', 'open']);
  assert.equal(s.mode, 'listening');
  assert.deepEqual(onces, ['greet', undefined, undefined]);
});

test('behaviour: a question runs thinking → talking → pointing, back to listening', () => {
  const { s, onces } = run(['open', 'ask', 'answer-start', 'answer-cited']);
  assert.equal(s.mode, 'listening');
  assert.deepEqual(onces.slice(1), [undefined, undefined, 'pointing']);
  assert.equal(run(['open', 'ask', 'no-answer']).onces[2], 'nope');
});

test('behaviour: waiting on the visitor listens, then thinking resumes', () => {
  const { s } = run(['open', 'ask', 'await-user']);
  assert.equal(s.mode, 'listening');
  assert.equal(step(s, 'ask').state.mode, 'thinking');
});

test('behaviour: fidgets only when idle; drag lands back where it was', () => {
  assert.equal(run(['fidget']).onces[0], 'idle-fidget');
  assert.equal(run(['open', 'fidget']).onces[1], undefined);
  const { s, onces } = run(['open', 'drag-start', 'drag-end']);
  assert.equal(s.mode, 'listening');
  assert.equal(onces[2], 'land');
});

test('behaviour: hidden ignores everything but show', () => {
  const hidden = run(['hide']);
  assert.equal(hidden.onces[0], 'wave-goodbye');
  assert.equal(run(['open', 'poke', 'fidget'], hidden.s).s.mode, 'hidden');
  assert.deepEqual(step(hidden.s, 'show'), { state: { ...hidden.s, mode: 'idle' }, once: 'appear' });
});

test('every mode loops a required animation', () => {
  for (const m of ['hidden', 'idle', 'bored', 'asleep', 'dragging', 'listening', 'downloading', 'thinking', 'talking'] as const) {
    assert.ok(loopFor(m));
  }
});

test('look options: theme, font size and an accent that cannot inject CSS', (t) => {
  t.mock.method(console, 'warn', () => {});
  const ok = fromJson('{"theme":"retro","fontSize":16,"accent":"#0a7d5a"}');
  assert.deepEqual(ok, { theme: 'retro', fontSize: 16, accent: '#0a7d5a' });
  assert.equal(resolveConfig({}).theme, 'modern');
  assert.deepEqual(fromJson('{"theme":"neon","accent":"red; } :host { display: none"}'), {});
  // Hex only, so the text colour on it can be worked out.
  for (const accent of ['rgb(10 125 90)', 'navy', '#12345']) assert.deepEqual(fromJson(JSON.stringify({ accent })), {});
  assert.match(configCss(ok), /--dp-font-size: 16px; --dp-accent: #0a7d5a; --dp-on-accent: #ffffff;/);
  assert.match(configCss({ accent: '#ffd23f' }), /--dp-on-accent: #0f1220/);
  assert.equal(configCss({}), '');
});
