'use strict';
// Regression tests for the external source-level audit (2026-11-06, 54/100).
// Each test names the finding it closes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkPath } = require('../src/policy');
const { validateArtifact, validateChain, writeArtifact, envelope } = require('../src/artifacts');
const { cronLine, launchdPlist } = require('../src/schedule');
const { probeCodexSessions } = require('../src/quota-probe');
const { fakeExecutor } = require('../src/fake');

const POL = { allowedPaths: ['src/', 'test/', 'docs/'], deniedPaths: [] };

test('audit(f): absolute and windows paths are rejected', () => {
  assert.equal(checkPath('/etc/passwd', { allowedPaths: [], deniedPaths: [] }).ok, false);
  assert.equal(checkPath('C:\\Windows\\system32\\x', POL).ok, false);
  assert.equal(checkPath('src\\..\\.env', POL).ok, false);
  assert.equal(checkPath('src2/evil.js', POL).ok, false); // prefix boundary
  assert.equal(checkPath('src/ok.js', POL).ok, true);
});

test('audit(2): scheduler output quotes/escapes the working directory', () => {
  const line = cronLine('/tmp/x; touch /tmp/pwn');
  assert.ok(line.includes("cd '/tmp/x; touch /tmp/pwn'"), line);
  const plist = launchdPlist('/tmp/a&b<c>');
  assert.ok(plist.includes('/tmp/a&amp;b&lt;c&gt;'), plist);
});

test('audit(a): forged artifact no longer validates; chain catches missing parent', () => {
  const forged = { protocol_version: '1.0', artifact_id: 'art_forged', type: 'execution', run_id: 'run_fake', task_id: 'task_fake', parent_artifact_id: 'art_nonexistent', created_at: 'not-a-date', producer: {}, changed_files: [], commands: [], result: 'completed' };
  const errs = validateArtifact(forged);
  assert.ok(errs.some((e) => e.includes('created_at')), errs.join());
  assert.ok(errs.some((e) => e.includes('producer.role')), errs.join());
  const child = { ...envelope('execution', { runId: 'run_1', taskId: 't1', parentId: 'art_missing', role: 'executor', provider: 'fake', family: 'fake' }) };
  assert.ok(validateChain([child]).some((e) => e.includes('not found in run')));
});

test('audit(6): writeArtifact never overwrites an existing artifact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-art-'));
  const a = { ...envelope('snapshot', { runId: 'run_1', role: 'host', provider: 'host-lite', family: 'host' }), project: 'x', files: [], head: null };
  writeArtifact(dir, a);
  assert.throws(() => writeArtifact(dir, a), /EEXIST|file already exists/);
});

test('audit(3): quota probe refuses to report garbage with high confidence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-probe-'));
  fs.writeFileSync(path.join(dir, 's.jsonl'), JSON.stringify({ payload: { token_count: { rate_limits: { primary: { used_percent: 'not-a-number', resets_at: 'tomorrow' } } } } }) + '\n');
  const r = probeCodexSessions(dir);
  assert.equal(r.confidence, 'unknown');
  assert.equal(r.primary, null);
});

test('audit(5): fake executor throws instead of faking a change when the anchor is gone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-fake-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'todo.js'), 'function add (title) { return title; }\n');
  assert.throws(() => fakeExecutor({}, dir), /anchor not found/);
});
