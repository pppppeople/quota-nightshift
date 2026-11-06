'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { envelope, validateArtifact } = require('../src/artifacts');
const { checkPath, canTransition, assertTransition, checkCost } = require('../src/policy');

test('artifact envelope validates; missing fields fail', () => {
  const art = {
    ...envelope('snapshot', { runId: 'run_x', role: 'host', provider: 'host-lite', family: 'host' }),
    project: 'demo', files: [], head: null,
  };
  assert.deepEqual(validateArtifact(art), []);
  const bad = { ...art }; delete bad.files;
  assert.ok(validateArtifact(bad).some((e) => e.includes('files')));
});

test('policy denies secrets and escapes, allows source paths', () => {
  const policy = { allowedPaths: ['src/', 'test/'], deniedPaths: [] };
  assert.equal(checkPath('src/todo.js', policy).ok, true);
  assert.equal(checkPath('.env', policy).ok, false);
  assert.equal(checkPath('.git/hooks/pre-commit', policy).ok, false);
  assert.equal(checkPath('../outside.js', policy).ok, false);
  assert.equal(checkPath('README.md', policy).ok, false); // outside allowlist
});

test('policy denies by default without a configured allowlist', () => {
  assert.equal(checkPath('src/x.js', {}).ok, false);
  assert.equal(checkPath('src/x.js', { allowedPaths: [] }).ok, false);
  assert.equal(checkPath('src/x.js', { allowedPaths: ['src/'] }).ok, true);
});

test('state machine allows the happy path and blocks skips', () => {
  assert.equal(canTransition('proposed', 'audited'), true);
  assert.equal(canTransition('proposed', 'verified'), false);
  assert.throws(() => assertTransition('verified', 'executing'), /illegal/);
});

test('cost guard denies unknown cost by default and caps spend', () => {
  const budget = { maxPerRun: 1, maxPerTask: 0.5, unknownCost: 'deny' };
  assert.equal(checkCost({ estimated: null }, budget).ok, false);
  assert.equal(checkCost({ estimated: 0.4, spentThisTask: 0 }, budget).ok, true);
  assert.equal(checkCost({ estimated: 0.4, spentThisTask: 0.2 }, budget).ok, false);
});
