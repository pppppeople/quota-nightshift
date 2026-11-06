'use strict';
// Built-in fake providers: deterministic, offline, zero cost.
// They exist so anyone can run the full protocol (demo / dry-run) before
// wiring any real model. Real providers plug into the same shapes:
//   proposer(snapshot)            -> [{task_id, title, kind, evidence, acceptance}]
//   auditor(proposals, snapshot)  -> [{task_id, verdict, gates, reason}]
//   executor(brief, workspaceDir) -> {changed_files, commands, result}
const fs = require('fs');
const path = require('path');

function fakeProposer(snapshot) {
  return [
    {
      task_id: 'task_demo_1',
      title: 'Add clearCompleted() to the todo store',
      kind: 'feature',
      evidence: 'snapshot lists src/todo.js with add/list/complete but no way to clear completed items',
      acceptance: 'unit tests pass (V2), including a new test for clearCompleted',
    },
    {
      task_id: 'task_demo_2',
      title: 'Reject empty todo titles',
      kind: 'bug',
      evidence: 'src/todo.js add() does not validate its input; empty titles create blank items',
      acceptance: 'unit tests pass (V2), including a new test that empty titles throw',
    },
    {
      task_id: 'task_demo_3',
      title: 'Replace the whole store with a database',
      kind: 'feature',
      evidence: 'none — proposer speculation',
      acceptance: 'none stated',
    },
  ];
}

const GATE_NAMES = ['evidence', 'not-duplicate', 'in-scope', 'offline-verifiable', 'value-order'];

function fakeAuditor(proposals) {
  return proposals.map((p) => {
    if (p.task_id === 'task_demo_3') {
      return {
        task_id: p.task_id, verdict: 'rejected',
        gates: { evidence: 'reject', 'not-duplicate': 'pass', 'in-scope': 'reject', 'offline-verifiable': 'reject', 'value-order': 'reject' },
        reason: 'No evidence, outside project scope (framework replacement is forbidden), no offline acceptance. Rejected at gates 1/3/4/5.',
      };
    }
    if (p.task_id === 'task_demo_1') {
      return {
        task_id: p.task_id, verdict: 'awaiting-human',
        gates: Object.fromEntries(GATE_NAMES.map((g) => [g, 'pass'])),
        reason: 'Passes all five gates, but it is feature-class: a human must pick it before execution (SPEC §6). In demo mode the built-in human stand-in picks the bug fix instead, so this stays waiting.',
      };
    }
    return {
      task_id: p.task_id, verdict: 'approved',
      gates: Object.fromEntries(GATE_NAMES.map((g) => [g, 'pass'])),
      reason: 'Bug-class with checkable evidence and offline acceptance; proceeds directly (SPEC §6).',
    };
  });
}

// The fake executor performs one real, pre-agreed change for task_demo_2:
// input validation in the copied example project. It edits code and adds a
// test, exactly like a real executor would — but deterministically.
function fakeExecutor(brief, workspaceDir) {
  const target = path.join(workspaceDir, 'src', 'todo.js');
  const before = fs.readFileSync(target, 'utf8');
  let code = before;
  const changed = [];
  if (!code.includes('title must not be empty')) {
    const anchor = 'function add(title) {';
    if (!code.includes(anchor)) {
      // Never claim success on an edit that did not happen (audit fix).
      throw new Error('fake executor: anchor not found in src/todo.js — refusing to fake the change');
    }
    code = code.replace(
      anchor,
      "function add(title) {\n  if (!title || !String(title).trim()) throw new Error('title must not be empty');"
    );
    fs.writeFileSync(target, code);
  }
  if (code !== before) changed.push('src/todo.js');
  const testFile = path.join(workspaceDir, 'test', 'validation.test.js');
  fs.writeFileSync(testFile, `'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createStore } = require('../src/todo');
test('empty titles are rejected', () => {
  const s = createStore();
  assert.throws(() => s.add(''), /must not be empty/);
  assert.throws(() => s.add('   '), /must not be empty/);
});
`);
  changed.push('test/validation.test.js');
  return {
    changed_files: changed,
    commands: [{ cmd: 'edit src/todo.js (input validation)', exit_code: 0 }, { cmd: 'write test/validation.test.js', exit_code: 0 }],
    result: 'completed',
  };
}

module.exports = { fakeProposer, fakeAuditor, fakeExecutor };
