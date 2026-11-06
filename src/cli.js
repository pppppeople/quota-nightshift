#!/usr/bin/env node
'use strict';
// quota-nightshift host-lite: init / doctor / demo / dry-run / status / validate
// Zero dependencies. Demo & dry-run use the built-in fake providers, so the
// full protocol runs offline with no API keys (SPEC §10, zero-cost trial).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { envelope, writeArtifact, validateArtifact, validateChain, newId } = require('./artifacts');
const { assertTransition, checkPath, checkCost } = require('./policy');
const { fakeProposer, fakeAuditor, fakeExecutor } = require('./fake');
const { PROVIDERS } = require('./providers');
const { EXECUTORS, health } = require('./executors');
const { probeCodexSessions } = require('./quota-probe');
const { SCHEDULERS } = require('./schedule');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const RUNS = path.join(ROOT, 'runs');

const DEFAULT_CONFIG = {
  project: { path: 'examples/todo-app', verification: { level: 'V2', commands: ['node', '--test'] } },
  layers: {
    proposer: { provider: 'fake', family: 'fake' },
    auditor: { provider: 'fake', family: 'fake' },
    executor: { provider: 'fake', family: 'fake' },
  },
  independence: 'single-provider',
  guardrails: { allowedPaths: ['src/', 'test/', 'docs/'], deniedPaths: [], maxTasksPerNight: 3 },
  budget: { maxPerRun: null, maxPerTask: null, unknownCost: 'deny' },
  locale: { ui: 'en', artifacts: 'en', project_content: 'auto' },
};

function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]))
      ? deepMerge(base[k], v) : v;
  }
  return out;
}

function loadConfig() {
  const file = path.join(ROOT, 'nightshift.json');
  if (!fs.existsSync(file)) return structuredClone(DEFAULT_CONFIG);
  // Deep merge: a partial override (e.g. only budget.maxPerRun) must not
  // silently drop sibling defaults such as budget.unknownCost (audit fix).
  const cfg = deepMerge(structuredClone(DEFAULT_CONFIG), JSON.parse(fs.readFileSync(file, 'utf8')));
  if (cfg.independence !== undefined && !['strict', 'flexible', 'single-provider'].includes(cfg.independence)) {
    throw new Error(`Invalid independence value ${JSON.stringify(cfg.independence)}; allowed modes: strict, flexible, single-provider`);
  }
  return cfg;
}

function cmdInit() {
  const file = path.join(ROOT, 'nightshift.json');
  if (fs.existsSync(file)) { console.log('nightshift.json already exists — not overwriting.'); return; }
  fs.writeFileSync(file, JSON.stringify(DEFAULT_CONFIG, null, 2));
  console.log('Created nightshift.json (fake providers by default).');
  console.log('Next: node src/cli.js doctor   then   node src/cli.js demo');
}

function cmdDoctor() {
  const checks = [];
  const major = parseInt(process.versions.node.split('.')[0], 10);
  checks.push(['node >= 18', major >= 18, process.version]);
  try { execFileSync('git', ['--version'], { stdio: 'pipe' }); checks.push(['git available', true, '']); }
  catch { checks.push(['git available', false, 'not found — executor commits will be skipped']); }
  const cfg = loadConfig();
  checks.push(['config loads', true, cfg.project.path]);
  checks.push(['example project present', fs.existsSync(path.join(ROOT, cfg.project.path)), cfg.project.path]);
  let fail = 0;
  for (const [name, ok, note] of checks) { console.log(`${ok ? '✓' : '✗'} ${name}${note ? ` — ${note}` : ''}`); if (!ok) fail++; }
  console.log(fail ? `\n${fail} check(s) failed.` : '\nAll good. Try: node src/cli.js demo');
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base)); else out.push(path.relative(base, p));
  }
  return out.sort();
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

function runNight(opts) {
  const runId = newId('run');
  const runDir = path.join(RUNS, runId);
  try {
    return runNightInner(opts, runId, runDir);
  } catch (e) {
    // A crashed run must be distinguishable from a finished one: leave a
    // failure marker with the error instead of a silent half-run.
    try {
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'FAILED.json'), JSON.stringify({ run_id: runId, failed_at: new Date().toISOString(), error: String(e.message || e) }, null, 2));
    } catch { /* marker is best-effort; the original error still propagates */ }
    throw e;
  }
}

function runNightInner({ execute }, runId, runDir) {
  const cfg = loadConfig();
  const artDir = path.join(runDir, 'artifacts');
  const wsDir = path.join(runDir, 'workspace');
  fs.mkdirSync(artDir, { recursive: true });
  copyDir(path.join(ROOT, cfg.project.path), wsDir);

  const states = {};
  const setState = (taskId, to) => {
    if (states[taskId]) assertTransition(states[taskId], to);
    else if (to !== 'proposed') throw new Error(`task ${taskId} must enter via 'proposed', not '${to}'`);
    states[taskId] = to;
  };

  // 1) snapshot
  const snapshot = {
    ...envelope('snapshot', { runId, role: 'host', provider: 'host-lite', family: 'host' }),
    project: cfg.project.path, files: listFiles(wsDir), head: null,
  };
  writeArtifact(artDir, snapshot);

  // 2) proposals
  const proposals = fakeProposer(snapshot);
  const proposalArt = {
    ...envelope('proposal', { runId, parentId: snapshot.artifact_id, role: 'proposer', provider: cfg.layers.proposer.provider, family: cfg.layers.proposer.family }),
    proposals,
  };
  writeArtifact(artDir, proposalArt);
  for (const p of proposals) setState(p.task_id, 'proposed');

  // 3) audit
  const verdicts = fakeAuditor(proposals);
  const auditArt = {
    ...envelope('audit', { runId, parentId: proposalArt.artifact_id, role: 'auditor', provider: cfg.layers.auditor.provider, family: cfg.layers.auditor.family }),
    verdicts,
  };
  writeArtifact(artDir, auditArt);
  for (const v of verdicts) {
    setState(v.task_id, 'audited');
    if (v.verdict === 'rejected') setState(v.task_id, 'rejected');
    if (v.verdict === 'approved') setState(v.task_id, 'approved');
    if (v.verdict === 'awaiting-human') setState(v.task_id, 'awaiting-human');
  }

  const done = [], waiting = [], failed = [];
  for (const v of verdicts) {
    const p = proposals.find((x) => x.task_id === v.task_id);
    if (v.verdict === 'rejected') failed.push({ task: p.title, reason: `rejected at audit — ${v.reason}` });
    if (v.verdict === 'awaiting-human') waiting.push({ task: p.title, reason: v.reason });
  }

  // 4) execute approved tasks (demo: exactly one)
  const LEVELS = ['V0', 'V1', 'V2', 'V3', 'V4'];
  let verificationLevel = 'V0';
  let declaredLevel = cfg.project.verification.level;
  let runSpend = 0;
  for (const v of verdicts.filter((x) => x.verdict === 'approved')) {
    const p = proposals.find((x) => x.task_id === v.task_id);
    const brief = {
      ...envelope('brief', { runId, taskId: v.task_id, parentId: auditArt.artifact_id, role: 'host', provider: 'host-lite', family: 'host' }),
      task: p.title, scope: cfg.guardrails.allowedPaths, forbidden: ['.env', 'secrets/', '.git/hooks/', 'nightshift.json'],
      verification: cfg.project.verification,
    };
    writeArtifact(artDir, brief);
    setState(v.task_id, 'briefed');
    if (!execute) { failed.push({ task: p.title, reason: 'dry-run: execution skipped by request' }); continue; }
    // Cost guard, actually wired (audit fix): fake layers have a known
    // cost of 0; any non-fake layer without a cost estimate is "unknown"
    // and the configured policy decides — deny by default.
    const estimated = cfg.layers.executor.provider === 'fake' ? 0 : null;
    const cost = checkCost({ estimated, spentThisRun: runSpend, spentThisTask: 0 }, cfg.budget);
    if (!cost.ok) { setState(v.task_id, 'executing'); setState(v.task_id, 'failed'); failed.push({ task: p.title, reason: `cost guard: ${cost.reason}` }); continue; }
    runSpend += estimated || 0;
    setState(v.task_id, 'executing');
    // Host policy check on every path the executor claims it will touch is
    // demonstrated on the result below; the fake executor is in-process.
    const execResult = fakeExecutor(brief, wsDir);
    for (const f of execResult.changed_files) {
      const chk = checkPath(f, cfg.guardrails);
      if (!chk.ok) throw new Error(`executor touched a forbidden path: ${chk.reason}`);
    }
    const execArt = {
      ...envelope('execution', { runId, taskId: v.task_id, parentId: brief.artifact_id, role: 'executor', provider: cfg.layers.executor.provider, family: cfg.layers.executor.family }),
      ...execResult,
    };
    writeArtifact(artDir, execArt);
    setState(v.task_id, 'executed');

    // 5) verify: run the project's own test command in the workspace copy
    let testOut = '', testCode = 0;
    try {
      testOut = execFileSync(cfg.project.verification.commands[0], cfg.project.verification.commands.slice(1), { cwd: wsDir, stdio: 'pipe' }).toString();
    } catch (e) { testCode = e.status ?? 1; testOut = (e.stdout || '').toString(); }
    const passed = testCode === 0;
    // Achieved level is evidence-bound, never just the configured claim:
    // running the project's commands and passing is V2 evidence. V3 needs
    // diff review and V4 unattended multi-project runs — neither exists in
    // host-lite yet, so the achieved level is capped at V2 and any higher
    // declared level is reported as declared-only (audit fix).
    const achieved = passed ? LEVELS[Math.min(LEVELS.indexOf(declaredLevel), 2)] : 'V0';
    verificationLevel = achieved;
    const review = {
      ...envelope('review', { runId, taskId: v.task_id, parentId: execArt.artifact_id, role: 'verifier', provider: 'host-lite', family: 'host' }),
      verification_level: achieved,
      declared_level: declaredLevel,
      checks: [{ name: cfg.project.verification.commands.join(' '), exit_code: testCode, output_tail: testOut.trim().split('\n').slice(-4).join('\n') }],
      verdict: passed ? 'verified' : 'failed',
    };
    writeArtifact(artDir, review);
    if (passed) { setState(v.task_id, 'verified'); done.push({ task: p.title, evidence: `tests passed at ${verificationLevel}; changed ${execResult.changed_files.join(', ')}` }); }
    else { setState(v.task_id, 'failed'); failed.push({ task: p.title, reason: 'verification failed' }); }
  }

  // 6) morning report
  const report = {
    ...envelope('morning-report', { runId, role: 'host', provider: 'host-lite', family: 'host' }),
    done, waiting, failed,
    costs: { subscription_quota: 'n/a (fake providers)', cash_spend: 0, local_compute: 'one local test run' },
    independence: cfg.independence === 'single-provider' ? 'insufficient (single-provider mode, demo)' : cfg.independence,
  };
  writeArtifact(artDir, report);
  const md = [
    `# Morning report — ${runId}`, '',
    `Verification level reached: ${verificationLevel}${declaredLevel !== verificationLevel ? ` (declared ${declaredLevel}; higher levels need evidence host-lite does not produce yet)` : ''}. Independence: ${report.independence}.`, '',
    '## Done (with evidence)', ...(done.length ? done.map((d) => `- ${d.task} — ${d.evidence}`) : ['- nothing']), '',
    '## Waiting for you', ...(waiting.length ? waiting.map((w) => `- ${w.task} — ${w.reason}`) : ['- nothing']), '',
    '## Failed / not done', ...(failed.length ? failed.map((f) => `- ${f.task} — ${f.reason}`) : ['- nothing']), '',
    `Costs: cash spend ${report.costs.cash_spend}; quota n/a in demo.`,
  ].join('\n');
  fs.writeFileSync(path.join(runDir, 'morning-report.md'), md);
  fs.writeFileSync(path.join(RUNS, 'latest.txt'), runId);
  const allArtifacts = fs.readdirSync(artDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(artDir, f), 'utf8')));
  const chainErrors = validateChain(allArtifacts);
  if (chainErrors.length) throw new Error(`artifact chain broken: ${chainErrors.join('; ')}`);
  console.log(md);
  console.log(`\nArtifacts: ${path.relative(ROOT, artDir)} (${allArtifacts.length} files, schema-validated, chain-verified)`);
  return runDir;
}

function cmdStatus() {
  const latest = path.join(RUNS, 'latest.txt');
  if (!fs.existsSync(latest)) { console.log('No runs yet. Try: node src/cli.js demo'); return; }
  const runId = fs.readFileSync(latest, 'utf8').trim();
  console.log(`Latest run: ${runId}`);
  const failedMarker = path.join(RUNS, runId, 'FAILED.json');
  if (fs.existsSync(failedMarker)) { console.log(`THIS RUN FAILED: ${JSON.parse(fs.readFileSync(failedMarker, 'utf8')).error}`); return; }
  console.log(fs.readFileSync(path.join(RUNS, runId, 'morning-report.md'), 'utf8'));
}

function cmdValidate(file) {
  const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validateArtifact(obj);
  if (errors.length) { console.log(`INVALID: ${errors.join('; ')}`); return; }
  console.log(`STRUCTURALLY VALID ${obj.type} artifact (${obj.artifact_id})`);
  // If the file lives in a run's artifacts directory, also verify the
  // whole set forms a trusted chain (parents exist, same run, same task).
  const dir = path.dirname(path.resolve(file));
  if (path.basename(dir) === 'artifacts') {
    const siblings = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    const chainErrors = validateChain(siblings);
    console.log(chainErrors.length ? `CHAIN INVALID: ${chainErrors.join('; ')}` : `CHAIN VALID (${siblings.length} artifacts, parents linked within run ${obj.run_id})`);
  }
}

function cmdAdapters() {
  console.log(`Model providers (${PROVIDERS.length}) — roles depend on capabilities, not brands:`);
  for (const p of PROVIDERS) console.log(`  ${p.id.padEnd(14)} ${p.name.padEnd(28)} family=${p.family.padEnd(10)} region=${p.region.padEnd(7)} via=${p.api.padEnd(19)} caps=${p.capabilities.join('/')}`);
  console.log(`\nExecutor CLIs (${EXECUTORS.length}) — health on this machine:`);
  for (const e of EXECUTORS) { const h = health(e); console.log(`  ${e.id.padEnd(14)} ${e.name.padEnd(24)} ${h.installed ? `installed (${h.version})` : 'not installed'}`); }
  console.log('\nNotification adapters: file · webhook · discord · slack · ntfy');
  console.log('Verification presets: node · python · go · rust · make (presets/)');
  console.log('Schedulers: node src/cli.js schedule cron|launchd|windows|github-actions');
}

function cmdProbe(dir) {
  const target = dir || path.join(os.homedir(), '.codex', 'sessions');
  console.log(JSON.stringify(probeCodexSessions(target), null, 2));
}

function cmdSchedule(kind) {
  const gen = SCHEDULERS[kind];
  if (!gen) { console.log('usage: schedule cron|launchd|windows|github-actions'); return; }
  console.log(gen(ROOT));
}

const [cmd, arg] = process.argv.slice(2);
switch (cmd) {
  case 'init': cmdInit(); break;
  case 'doctor': cmdDoctor(); break;
  case 'demo': runNight({ execute: true }); break;
  case 'dry-run': runNight({ execute: false }); break;
  case 'status': cmdStatus(); break;
  case 'validate': cmdValidate(arg); break;
  case 'adapters': cmdAdapters(); break;
  case 'probe': cmdProbe(arg); break;
  case 'schedule': cmdSchedule(arg); break;
  default:
    console.log('quota-nightshift host-lite\n  init      create nightshift.json\n  doctor    check your environment\n  demo      run one full fake night (offline, no keys)\n  dry-run   propose + audit only, execute nothing\n  status    show the latest morning report\n  validate  validate an artifact JSON against its schema\n  adapters  list every provider / executor / notifier that plugs in\n  probe     read leftover Codex quota from local session files\n  schedule  print an installable scheduler (cron|launchd|windows|github-actions)');
}
