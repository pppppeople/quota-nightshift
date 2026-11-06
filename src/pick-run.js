'use strict';
// pick-run: execute tasks a human picked from a previous morning report's
// "Waiting for you" section. The human decision is recorded as an artifact;
// execution then follows the same path as an approved task (workspace copy,
// Codex, path checks, zero-change guard, project tests, review artifact).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { envelope, writeArtifact, validateChain, newId } = require('./artifacts');
const { checkPath } = require('./policy');

const ROOT = path.join(__dirname, '..');
const RUNS = path.join(ROOT, 'runs');

const PICKS = [
  {
    task_id: 'pick_1',
    title: 'Fix checkPath fail-open: deny by default when allowedPaths is absent or empty',
    brief: `In src/policy.js, checkPath() currently returns ok:true for any non-denied relative path when policy.allowedPaths is missing or an empty array. That is fail-open. Change it to deny-by-default: when the allowlist is absent or empty, return { ok: false, reason: 'no allowlist configured — deny by default' } (exact wording flexible). Keep all other behavior (absolute/Windows/backslash rejection, denied list, boundary matching) unchanged. Add regression tests to test/ (a suitable existing test file or a new one): checkPath('src/x.js', {}) is not ok; checkPath('src/x.js', { allowedPaths: [] }) is not ok; checkPath('src/x.js', { allowedPaths: ['src/'] }) is still ok. If an existing test asserts the old fail-open behavior, update that test to the new policy — this is a human-approved security policy change. Run the full test suite and make it pass.`,
  },
  {
    task_id: 'pick_2',
    title: 'Validate independence mode in loadConfig against the three documented modes',
    brief: `SPEC section 7 defines exactly three independence modes: 'strict', 'flexible', 'single-provider'. src/cli.js loadConfig() currently accepts any string silently. Add validation: after loading/merging the config, if cfg.independence is present and not one of the three modes, throw a clear Error naming the bad value and the allowed modes. Apply the same guard in src/real-night.js where it reads nightshift.json (a small local check is fine). Add tests: unknown independence value throws/rejected; each of the three documented modes loads fine. Run the full test suite and make it pass.`,
  },
];

function listFiles(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'runs'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base)); else out.push(path.relative(base, p));
  }
  return out.sort();
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'runs') continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

function snapshotFiles(dir) {
  const map = new Map();
  for (const f of listFiles(dir)) { try { map.set(f, fs.readFileSync(path.join(dir, f), 'utf8')); } catch { /* binary */ } }
  return map;
}

function diffFiles(before, after) {
  const changed = [];
  for (const [f, c] of after) if (!before.has(f) || before.get(f) !== c) changed.push(f);
  for (const f of before.keys()) if (!after.has(f)) changed.push(`${f} (deleted)`);
  return changed;
}

function codexExec(prompt, { cwd, sandbox, timeoutMs = 900000 }) {
  const outFile = path.join(cwd, `.codex-last-${Date.now()}.txt`);
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      execFileSync(process.env.CODEX_BIN || 'codex', ['exec', '--sandbox', sandbox, '--skip-git-repo-check', '-c', 'model_reasoning_effort="medium"', '-o', outFile, prompt], { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, input: '', stdio: ['pipe', 'pipe', 'pipe'] });
      const text = fs.readFileSync(outFile, 'utf8');
      fs.rmSync(outFile, { force: true });
      return text;
    } catch (e) { lastErr = e; fs.rmSync(outFile, { force: true }); if (attempt === 2) break; }
  }
  throw lastErr;
}

async function main() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'nightshift.json'), 'utf8'));
  const runId = newId('run');
  const runDir = path.join(RUNS, runId);
  const artDir = path.join(runDir, 'artifacts');
  const wsDir = path.join(runDir, 'workspace');
  fs.mkdirSync(artDir, { recursive: true });
  copyDir(ROOT, wsDir);

  const decision = { ...envelope('morning-report', { runId, role: 'human', provider: 'owner', family: 'human' }), note: 'Human pick recorded from chat instruction 2026-11-06: both awaiting-human items approved for execution ("都要交验").', picks: PICKS.map((p) => p.task_id), done: [], waiting: [], failed: [], costs: { subscription_quota: 'n/a', cash_spend: 0, local_compute: 'n/a' }, independence: 'human-decision' };
  writeArtifact(artDir, decision);
  console.log(`pick run ${runId}: ${PICKS.length} human-picked tasks`);

  const done = [], failed = [];
  for (const pick of PICKS) {
    const brief = { ...envelope('brief', { runId, taskId: pick.task_id, parentId: decision.artifact_id, role: 'host', provider: 'host-lite', family: 'host' }), task: pick.title, scope: cfg.guardrails.allowedPaths, forbidden: ['.env', 'secrets/', '.git/hooks/', 'nightshift.json'], verification: cfg.project.verification };
    writeArtifact(artDir, brief);
    const before = snapshotFiles(wsDir);
    let execOk = true, execNote = '';
    try {
      codexExec(`Implement this human-approved task in this project copy. Smallest correct change only. Do NOT touch: ${brief.forbidden.join(', ')}. Only edit within: ${brief.scope.join(', ')}.\n\n${pick.brief}`, { cwd: wsDir, sandbox: 'workspace-write' });
    } catch (e) { execOk = false; execNote = String(e.message || e).slice(0, 300); }
    const changed = diffFiles(before, snapshotFiles(wsDir));
    for (const f of changed) {
      const chk = checkPath(f.replace(' (deleted)', ''), cfg.guardrails);
      if (!chk.ok) { execOk = false; execNote = `executor touched forbidden path: ${chk.reason}`; }
    }
    if (execOk && changed.length === 0) { execOk = false; execNote = 'executor finished with zero file changes — treated as not done'; }
    const execArt = { ...envelope('execution', { runId, taskId: pick.task_id, parentId: brief.artifact_id, role: 'executor', provider: 'codex', family: 'openai' }), changed_files: changed, commands: [{ cmd: 'codex exec (workspace-write)', exit_code: execOk ? 0 : 1 }], result: execOk ? 'completed' : 'failed' };
    writeArtifact(artDir, execArt);
    if (!execOk) { failed.push({ task: pick.title, reason: execNote }); console.log(`pick ${pick.task_id}: FAILED — ${execNote.slice(0, 120)}`); continue; }
    let testCode = 0, testOut = '';
    try { testOut = execFileSync('npm', ['test'], { cwd: wsDir, timeout: 600000, stdio: 'pipe' }).toString(); }
    catch (e) { testCode = e.status ?? 1; testOut = ((e.stdout || '') + (e.stderr || '')).toString(); }
    const passed = testCode === 0;
    const review = { ...envelope('review', { runId, taskId: pick.task_id, parentId: execArt.artifact_id, role: 'verifier', provider: 'host-lite', family: 'host' }), verification_level: passed ? 'V2' : 'V0', declared_level: 'V2', checks: [{ name: 'npm test', exit_code: testCode, output_tail: testOut.trim().split('\n').slice(-4).join('\n') }], verdict: passed ? 'verified' : 'failed' };
    writeArtifact(artDir, review);
    if (passed) { done.push({ task: pick.title, evidence: `tests passed (V2); changed ${changed.join(', ')}` }); console.log(`pick ${pick.task_id}: verified (${changed.length} files)`); }
    else { failed.push({ task: pick.title, reason: `verification failed (exit ${testCode})` }); console.log(`pick ${pick.task_id}: verification FAILED`); }
  }

  const report = { ...envelope('morning-report', { runId, role: 'host', provider: 'host-lite', family: 'host' }), done, waiting: [], failed, costs: { subscription_quota: 'codex session', cash_spend: 0, local_compute: 'one local run' }, independence: 'human-picked execution (decision recorded in artifacts)' };
  writeArtifact(artDir, report);
  const all = fs.readdirSync(artDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(artDir, f), 'utf8')));
  const chainErrors = validateChain(all);
  const md = [`# Pick report — ${runId} (human-approved tasks)`, '', `Chain: ${chainErrors.length ? 'INVALID ' + chainErrors.join('; ') : 'valid'}.`, '', '## Done (with evidence)', ...(done.length ? done.map((d) => `- ${d.task} — ${d.evidence}`) : ['- nothing']), '', '## Failed / not done', ...(failed.length ? failed.map((f) => `- ${f.task} — ${f.reason}`) : ['- nothing']), ''].join('\n');
  fs.writeFileSync(path.join(runDir, 'morning-report.md'), md);
  console.log(md);
  console.log(`PICKRUN_DIR=${runDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
