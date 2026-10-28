import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { INTENT_ANIMATION, matchSmallTalk, SmallTalkMatcher, INTENT_EXAMPLES } from '../src/persona/smalltalk.ts';
import { DEFAULT_VOICE, INTENTS, LINE_SETS, mergeVoice, Speaker } from '../src/persona/voice.ts';
import { OPTIONAL_ANIMATIONS, REQUIRED_ANIMATIONS, validateManifest } from '../src/sprite/manifest.ts';
import { step, initialState } from '../src/core/behaviour.ts';

test('small talk: whole messages match their intent', () => {
  const cases: [string, string][] = [
    ['hi', 'hello'],
    ['Hello there!', 'hello'],
    ['good morning', 'hello'],
    ['hey deskpal', 'hello'],
    ['Thanks!', 'thanks'],
    ['ok thank you so much', 'thanks'],
    ['thanks deskpal', 'thanks'],
    ['bye', 'bye'],
    ["that's all", 'bye'],
    ['Who are you?', 'who'],
    ['are you a bot', 'who'],
    ['what can you do?', 'help'],
    ['help', 'help'],
    ['how are you doing today?', 'howAreYou'],
    ["you're awesome", 'praise'],
    ['good bot', 'praise'],
    ['you are useless', 'insult'],
    ['tell me a joke please', 'joke'],
  ];
  for (const [text, intent] of cases) assert.equal(matchSmallTalk(text, 'deskpal') ?? '', intent, text);
});

test('small talk: a question with a greeting in it is still a question', () => {
  for (const text of ['hi, how do I install it?', 'thanks but what CSP does it need?', 'what is deskpal', 'help me with CSP', 'how do I hide it?', 'Can it tell jokes in French?', '']) {
    assert.equal(matchSmallTalk(text, 'deskpal'), null, text);
  }
});

test('every reply has lines and an expression the default skin can play', () => {
  const manifest = JSON.parse(readFileSync(new URL('../skins/default/manifest.json', import.meta.url), 'utf8'));
  const required = new Set<string>(REQUIRED_ANIMATIONS);
  for (const intent of INTENTS) {
    assert.ok(DEFAULT_VOICE[intent].length > 0, intent);
    assert.ok(INTENT_EXAMPLES[intent].length > 0, intent);
    const anim = INTENT_ANIMATION[intent];
    assert.ok(required.has(anim) || OPTIONAL_ANIMATIONS[anim], `${intent}: ${anim}`);
    assert.ok(manifest.animations[anim], `default skin lacks ${anim}`);
  }
  for (const [name, fallback] of Object.entries(OPTIONAL_ANIMATIONS)) assert.ok(required.has(fallback), name);
});

test('voice: layers replace whole line sets and skip bad entries', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const voice = mergeVoice({ found: ['Gotcha!'], nope: ['x'] }, { found: 'Voilà !', thanks: [] }, undefined);
  assert.deepEqual(voice.found, ['Voilà !']);
  assert.deepEqual(voice.thanks, DEFAULT_VOICE.thanks);
  assert.deepEqual(voice.dontKnow, DEFAULT_VOICE.dontKnow);
  assert.equal(warn.mock.callCount(), 2);
  for (const set of LINE_SETS) assert.ok(voice[set].length > 0, set);
});

test('speaker: fills in the name and never repeats a line twice in a row', () => {
  let r = 0;
  const speaker = new Speaker(mergeVoice({ who: "I'm {name}!", thanks: ['a', 'b', 'c'] }), 'Penny', () => r);
  assert.equal(speaker.say('who'), "I'm Penny!");
  const said = Array.from({ length: 6 }, () => speaker.say('thanks'));
  for (let i = 1; i < said.length; i++) assert.notEqual(said[i], said[i - 1]);
  r = 0.99;
  assert.equal(speaker.say('thanks'), 'c');
});

/** A toy embedder: one dimension per word, normalised. */
function bagOfWords(text: string): Float32Array {
  const vocab = ['thanks', 'helpful', 'joke', 'funny', 'install', 'csp', 'hello', 'you'];
  const v = new Float32Array(vocab.length);
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const i = vocab.indexOf(w);
    if (i >= 0) v[i]! += 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

test('small talk by meaning: nearest example above the threshold, short messages only', async () => {
  let calls = 0;
  const matcher = new SmallTalkMatcher(async (t) => (calls++, bagOfWords(t)), 0.9);
  assert.equal(await matcher.match('something funny'), 'joke');
  const examples = calls;
  assert.equal(await matcher.match('install csp'), null);
  assert.equal(calls, examples + 1, 'examples are embedded once');
  assert.equal(await matcher.nearest('a very long question that rambles on about thanks and jokes forever'), null);
});

test('behaviour: unsure answers and small talk return to listening', () => {
  const open = step(initialState, 'open').state;
  assert.deepEqual(step(open, 'answer-unsure'), { state: { ...open, mode: 'listening' }, once: 'unsure' });
  assert.equal(step(open, 'chat').state.mode, 'listening');
});

test('skin voice must be an object', () => {
  const manifest = JSON.parse(readFileSync(new URL('../skins/default/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateManifest({ ...manifest, voice: { found: 'Yes!' } }), []);
  assert.ok(validateManifest({ ...manifest, voice: ['nope'] }).includes('voice must be an object of line sets'));
});

test('behaviour: a long wait on the model turns thinking into serious work', () => {
  const thinking = step(step(initialState, 'open').state, 'ask').state;
  assert.equal(thinking.mode, 'thinking');
  const working = step(thinking, 'busy').state;
  assert.equal(working.mode, 'working');
  assert.equal(step(working, 'answer-start').state.mode, 'talking');
  const downloading = step(thinking, 'download').state;
  assert.equal(step(downloading, 'busy').state.mode, 'downloading', 'busy only applies while thinking');
});
