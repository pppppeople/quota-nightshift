'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createStore } = require('../src/todo');

test('add and list', () => {
  const s = createStore();
  s.add('write tests');
  assert.equal(s.list().length, 1);
  assert.equal(s.list()[0].title, 'write tests');
});

test('complete marks done', () => {
  const s = createStore();
  s.add('ship it');
  s.complete(0);
  assert.equal(s.list()[0].done, true);
});
