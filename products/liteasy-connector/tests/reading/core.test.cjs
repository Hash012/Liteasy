'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../src/reading/shared.js');
test('conversation identity ignores GPT route aliases; drafts are isolated', () => {
  assert.equal(C.scope('/g/g-example/c/abc', 'x'), C.scope('/c/abc', 'y'));
  assert.notEqual(C.scope('/c/abc', 'x'), C.scope('/share/abc', 'x'));
  assert.notEqual(C.scope('/', 'tab-one'), C.scope('/', 'tab-two'));
});
test('message and section keys are deterministic and validated', () => {
  assert.match(C.key(C.scope('/c/a','x'), 'message-1'), C.KEY_RE);
  assert.match(C.hash('hello'), C.SECTION_RE);
  assert.equal(C.hash('hello'), C.hash('hello'));
  assert.notEqual(C.hash('hello'), C.hash('Hello'));
});
test('merge preserves independent section edits', () => {
  const a = C.hash('a'), b = C.hash('b');
  const first = C.merge(null, {[a]: {checked:true,t:100,op:'a'}});
  const next = C.merge(first, {[b]: {checked:true,t:101,op:'b'}});
  assert.equal(Object.keys(next.sections).length, 2);
  assert.equal(next.sections[a].checked, true);
});
test('false tombstone beats an older checked backup and retry is idempotent', () => {
  const id = C.hash('a');
  const newer = C.merge(null, {[id]: {checked:false,t:200,op:'b'}});
  const merged = C.merge(newer, {[id]: {checked:true,t:100,op:'a'}});
  assert.equal(merged.sections[id].checked, false);
  assert.deepEqual(C.merge(merged, merged.sections), merged);
});
test('timestamp ties use deterministic operation ordering', () => {
  const id=C.hash('a'), yes={[id]:{checked:true,t:42,op:'a'}}, no={[id]:{checked:false,t:42,op:'b'}};
  assert.deepEqual(C.merge(C.merge(null, yes), no), C.merge(C.merge(null, no), yes));
});
test('invalid/prototype keys cannot enter progress records', () => {
  const raw=JSON.parse('{"__proto__":{"checked":true,"t":1,"op":"x"},"bad":{"checked":true,"t":1,"op":"x"}}');
  assert.equal(Object.keys(C.merge(null,raw).sections).length,0);
  assert.equal({}.checked, undefined);
  assert.equal(C.validEntry({checked:true,t:NaN,op:'x'}),false);
});
