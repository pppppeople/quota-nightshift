'use strict';
// Adversarial evidence tests for the external re-audit (74/100 round).
// Each test attacks one mechanism the reviewer refused to close on
// report evidence alone: cost guard, verification-level honesty,
// artifact parent-chain integrity.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const { checkCost } = require('../src/policy');
const { envelope, writeArtifact, validateChain } = require('../src/artifacts');

// ---------- checkCost: the three refusals the reviewer demanded ----------
test('evidence(cost): unknown cost is denied by default policy', () => {
  const r = checkCost({ estimated: null, spentThisRun: 0, spentThisTask: 0 }, { unknownCost: 'deny', maxPerTask: 10, maxPerRun: 20 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /unknown/);
});

test('evidence(cost): per-task overage is denied even when run budget remains', () => {
  const r = checkCost({ estimated: 6, spentThisRun: 0, spentThisTask: 5 }, { unknownCost: 'deny', maxPerTask: 10, maxPerRun: 100 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /per-task/);
});

test('evidence(cost): per-run overage is denied even when task budget remains', () => {
  const r = checkCost({ estimated: 6, spentThisRun: 95, spentThisTask: 0 }, { unknownCost: 'deny', maxPerTask: 100, maxPerRun: 100 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /per-run/);
});

test('evidence(cost): known cost within both budgets passes', () => {
  const r = checkCost({ estimated: 3, spentThisRun: 4, spentThisTask: 2 }, { unknownCost: 'deny', maxPerTask: 10, maxPerRun: 20 });
  assert.equal(r.ok, true);
});

// ---------- integration: the guard actually fires in the demo entry point ----------
function withTempConfig(cfg, fn) {
  const file = path.join(ROOT, 'nightshift.json');
  const backup = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  try { return fn(); } finally {
    if (backup === null) fs.rmSync(file, { force: true }); else fs.writeFileSync(file, backup);
  }
}

const BASE_CFG = {
  project: { path: 'examples/todo-app', verification: { level: 'V2', commands: ['node', '--test'] } },
  layers: { proposer: { provider: 'fake', family: 'fake' }, auditor: { provider: 'fake', family: 'fake' }, executor: { provider: 'fake', family: 'fake' } },
  independence: 'single-provider',
  guardrails: { allowedPaths: ['src/', 'test/', 'docs/'], deniedPaths: [], maxTasksPerNight: 3 },
  budget: { maxPerRun: null, maxPerTask: null, unknownCost: 'deny' },
  locale: { ui: 'en', artifacts: 'en', project_content: 'auto' },
};

test('evidence(cost): demo with a non-fake executor and unknown cost is blocked by the guard', () => {
  const cfg = structuredClone(BASE_CFG);
  cfg.layers.executor = { provider: 'codex', family: 'openai' };
  const out = withTempConfig(cfg, () => spawnSync('node', ['src/cli.js', 'demo'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 }));
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /cost guard: cost unknown/);
});

test('evidence(level): declaring V4 does not raise the achieved level above the evidence cap', () => {
  const cfg = structuredClone(BASE_CFG);
  cfg.project.verification.level = 'V4';
  const out = withTempConfig(cfg, () => spawnSync('node', ['src/cli.js', 'demo'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 }));
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /Verification level reached: V2 \(declared V4/);
});

// ---------- artifact chain: forgery, cross-run, task mismatch, tampering ----------
function art(type, opts) { return { ...envelope(type, opts) }; }

test('evidence(chain): a parent from a different run is rejected', () => {
  const parent = { ...art('proposal', { runId: 'run_A', role: 'proposer', provider: 'x', family: 'x' }), proposals: [] };
  const child = { ...art('audit', { runId: 'run_B', parentId: parent.artifact_id, role: 'auditor', provider: 'y', family: 'y' }), verdicts: [] };
  const errs = validateChain([parent, child]);
  assert.ok(errs.some((e) => e.includes('different run')), errs.join());
});

test('evidence(chain): a task_id that diverges from the parent chain is rejected', () => {
  const brief = { ...art('brief', { runId: 'run_A', taskId: 'task_1', parentId: null, role: 'host', provider: 'h', family: 'h' }), task: 't', scope: [], forbidden: [], verification: {} };
  const exec = { ...art('execution', { runId: 'run_A', taskId: 'task_2', parentId: brief.artifact_id, role: 'executor', provider: 'e', family: 'e' }), changed_files: [], commands: [], result: 'completed' };
  const errs = validateChain([brief, exec]);
  assert.ok(errs.some((e) => e.includes('task_id does not match')), errs.join());
});

test('evidence(chain): tampering with a written artifact on disk is detected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-chain-'));
  const snap = { ...art('snapshot', { runId: 'run_T', role: 'host', provider: 'h', family: 'h' }), project: 'x', files: [], head: null };
  const prop = { ...art('proposal', { runId: 'run_T', parentId: snap.artifact_id, role: 'proposer', provider: 'p', family: 'p' }), proposals: [] };
  writeArtifact(dir, snap);
  const file = writeArtifact(dir, prop);
  // attacker rewrites the stored proposal to point at a nonexistent parent
  const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  obj.parent_artifact_id = 'art_forged_parent';
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  const all = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const errs = validateChain(all);
  assert.ok(errs.some((e) => e.includes('not found in run')), errs.join());
});
