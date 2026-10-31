import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { OPTIONAL_ANIMATIONS, REQUIRED_ANIMATIONS, validateManifest } from '../src/sprite/manifest.ts';
import { ANNOUNCE, loopFor } from '../src/core/behaviour.ts';
import { mergeVoice } from '../src/persona/voice.ts';

const manifest = JSON.parse(readFileSync(new URL('../skins/default/manifest.json', import.meta.url), 'utf8'));

test('the default skin satisfies the skin contract', () => {
  assert.deepEqual(validateManifest(manifest), []);
});

test('validation reports missing animations and bad references', () => {
  const broken = structuredClone(manifest);
  delete broken.animations.sleep;
  broken.animations.wake.next = 'nowhere';
  broken.animations.idle.frames = [];
  const errors = validateManifest(broken);
  assert.ok(errors.includes('missing required animation "sleep"'));
  assert.ok(errors.includes('wake: next "nowhere" does not exist'));
  assert.ok(errors.includes('idle: frames must not be empty'));
});

test('announcements name known animations; loops only required ones', () => {
  const required = new Set<string>(REQUIRED_ANIMATIONS);
  for (const name of Object.keys(ANNOUNCE)) assert.ok(required.has(name) || OPTIONAL_ANIMATIONS[name], name);
  assert.ok(required.has(loopFor('downloading')));
});

test('the pencil skin is valid and has every optional animation too', () => {
  const pencil = JSON.parse(readFileSync(new URL('../skins/pencil/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateManifest(pencil), []);
  for (const name of Object.keys(OPTIONAL_ANIMATIONS)) assert.ok(pencil.animations[name], name);
  assert.deepEqual(mergeVoice(pencil.voice).joke, pencil.voice.joke, 'its voice lines are all valid');
});
