'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { PROVIDERS, getProvider, providersFor } = require('../src/providers');
const { EXECUTORS, health } = require('../src/executors');
const { probeCodexSessions } = require('../src/quota-probe');
const { buildEvent, payloadFor } = require('../src/notify');
const { SCHEDULERS } = require('../src/schedule');

test('registry covers overseas, domestic, local and web providers', () => {
  assert.ok(PROVIDERS.length >= 15);
  for (const id of ['openai', 'xai', 'deepseek', 'moonshot', 'qwen', 'zhipu', 'doubao', 'ollama', 'chatgpt-web', 'kimi-web']) {
    assert.ok(getProvider(id), `missing preset: ${id}`);
  }
  assert.ok(providersFor('coding').length >= 5);
  // aggregators must not pretend to be a family of their own for §7 checks
  assert.equal(getProvider('openrouter').family, 'multi');
});

test('executor registry health-checks without crashing', () => {
  assert.ok(EXECUTORS.length >= 7);
  const fake = EXECUTORS.find((e) => e.id === 'fake');
  assert.equal(health(fake).installed, true);
  for (const e of EXECUTORS) assert.ok('installed' in health(e));
});

test('quota probe parses the last token_count event from a session fixture', () => {
  const r = probeCodexSessions(path.join(__dirname, 'fixtures'));
  assert.equal(r.confidence, 'high');
  assert.equal(r.primary.used_percent, 42);
  assert.equal(r.primary.type, 'rolling_window');
  assert.equal(r.secondary.window_minutes, 10080);
});

test('quota probe degrades to unknown instead of guessing', () => {
  const r = probeCodexSessions(path.join(__dirname, 'does-not-exist'));
  assert.equal(r.confidence, 'unknown');
  assert.equal(r.primary, null);
});

test('notification payloads match each channel shape', () => {
  const ev = buildEvent('run_1', 'runs/run_1/morning-report.md');
  assert.equal(ev.event, 'run.completed');
  assert.ok(payloadFor('discord', ev, 'hello').content.includes('hello'));
  assert.ok(payloadFor('slack', ev, 'hello').text.includes('hello'));
  assert.deepEqual(payloadFor('webhook', ev, 'hello'), ev);
});

test('scheduler generators produce installable text for all four forms', () => {
  assert.match(SCHEDULERS.cron('/x'), /5 1 \* \* \*/);
  assert.match(SCHEDULERS.launchd('/x'), /StartCalendarInterval/);
  assert.match(SCHEDULERS.windows('/x'), /schtasks/);
  assert.match(SCHEDULERS['github-actions']('/x'), /workflow_dispatch/);
});
