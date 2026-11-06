'use strict';
// real-night: the first REAL end-to-end run (v0.4 milestone).
// DeepSeek proposes (API) -> Codex audits (CLI, different family) ->
// Codex executes approved bug/stability tasks in a workspace COPY ->
// the project's own tests verify. Feature-class verdicts wait for a human.
// Everything lands as protocol artifacts; a parse failure at any layer is
// recorded as a channel failure, never papered over (SPEC §10).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { envelope, writeArtifact, validateChain, newId } = require('./artifacts');
const { checkPath, checkCost } = require('./policy');
const { chat } = require('./openai-compatible');

const ROOT = path.join(__dirname, '..');
const RUNS = path.join(ROOT, 'runs');

function loadConfig() {
  const dflt = JSON.parse(fs.readFileSync(path.join(ROOT, 'nightshift.json'), 'utf8'));
  if (dflt.independence !== undefined && !['strict', 'flexible', 'single-provider'].includes(dflt.independence)) {
    throw new Error(`Invalid independence value ${JSON.stringify(dflt.independence)}; allowed modes: strict, flexible, single-provider`);
  }
  return dflt;
}

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

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in model output');
  return JSON.parse(raw.slice(start, end + 1));
}

// Run Codex non-interactively and return ONLY its final message.
// - stdin is closed immediately (an open stdin makes it hang waiting)
// - the final message goes to a file via -o, keeping stdout banners and
//   transport retries out of the parse path entirely
// - one automatic retry on transport-level failure (timeouts happen)
function codexExec(prompt, { cwd, sandbox, timeoutMs = 600000 }) {
  const outFile = path.join(cwd, `.codex-last-${Date.now()}.txt`);
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      execFileSync(process.env.CODEX_BIN || 'codex', ['exec', '--sandbox', sandbox, '--skip-git-repo-check', '-c', 'model_reasoning_effort="medium"', '-o', outFile, prompt], {
        cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, input: '', stdio: ['pipe', 'pipe', 'pipe'],
      });
      const text = fs.readFileSync(outFile, 'utf8');
      fs.rmSync(outFile, { force: true });
      return text;
    } catch (e) {
      lastErr = e;
      fs.rmSync(outFile, { force: true });
      if (attempt === 2) break;
    }
  }
  throw lastErr;
}

function snapshotFiles(dir) {
  const map = new Map();
  for (const f of listFiles(dir)) {
    try { map.set(f, fs.readFileSync(path.join(dir, f), 'utf8')); } catch { /* binary */ }
  }
  return map;
}

function diffFiles(before, after) {
  const changed = [];
  for (const [f, content] of after) if (!before.has(f) || before.get(f) !== content) changed.push(f);
  for (const f of before.keys()) if (!after.has(f)) changed.push(`${f} (deleted)`);
  return changed;
}

async function main() {
  const cfg = loadConfig();
  const runId = newId('run');
  const runDir = path.join(RUNS, runId);
  const artDir = path.join(runDir, 'artifacts');
  const wsDir = path.join(runDir, 'workspace');
  fs.mkdirSync(artDir, { recursive: true });
  const fail = (stage, err) => {
    fs.writeFileSync(path.join(runDir, 'FAILED.json'), JSON.stringify({ run_id: runId, stage, error: String(err.message || err), at: new Date().toISOString() }, null, 2));
    console.error(`FAILED at ${stage}: ${err.message || err}`);
    process.exit(1);
  };

  // 1) snapshot of the real target project (copied; the original is never touched)
  const targetAbs = path.resolve(ROOT, cfg.project.path);
  copyDir(targetAbs, wsDir);
  const files = listFiles(wsDir);
  const keyFiles = files.filter((f) => /\.(js|md|json)$/.test(f) && !f.startsWith('data/') && !f.startsWith('examples/')).slice(0, 8);
  const excerpts = keyFiles.map((f) => `--- ${f}\n${fs.readFileSync(path.join(wsDir, f), 'utf8').slice(0, f.endsWith('.js') ? 6000 : 1500)}`).join('\n');
  const snapshot = { ...envelope('snapshot', { runId, role: 'host', provider: 'host-lite', family: 'host' }), project: cfg.project.path, files, head: null };
  writeArtifact(artDir, snapshot);
  console.log(`[1/5] snapshot: ${files.length} files from ${cfg.project.path}`);

  // 2) proposer: DeepSeek via the OpenAI-compatible adapter
  let proposals;
  try {
    const text = await chat({
      baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keyEnv: 'DEEPSEEK_API_KEY',
      messages: [
        { role: 'system', content: 'You are the proposer in an autonomous maintenance pipeline. Reply with ONLY a JSON object, no prose.' },
        { role: 'user', content: `Project files: ${files.join(', ')}\n\nCode (read it carefully before proposing):\n${excerpts}\n\nPropose up to 3 concrete, small maintenance tasks (bug fixes or stability improvements preferred; features allowed but marked). IMPORTANT: only propose behavior that is genuinely MISSING or BROKEN in the code above — an auditor with full code access will reject anything that already exists, so verify each gap against the code first. Each needs checkable evidence from the code and an offline acceptance test. JSON shape: {"proposals":[{"task_id":"task_1","title":"...","kind":"bug|stability|feature","evidence":"...","acceptance":"..."}]}` },
      ],
    });
    proposals = extractJson(text).proposals;
    if (!Array.isArray(proposals) || !proposals.length) throw new Error('proposals missing/empty');
  } catch (e) { return fail('propose', e); }
  const proposalArt = { ...envelope('proposal', { runId, parentId: snapshot.artifact_id, role: 'proposer', provider: 'deepseek', family: 'deepseek' }), proposals };
  writeArtifact(artDir, proposalArt);
  console.log(`[2/5] proposer (deepseek): ${proposals.length} proposals`);

  // 3) auditor: Codex CLI (different family), five gates, strict JSON
  let verdicts;
  try {
    const auditPrompt = `You are the AUDITOR in an autonomous maintenance pipeline. Judge each proposal against five gates: (1) evidence is checkable in the project, (2) not a duplicate of existing functionality, (3) in scope (no framework replacement, no secrets, no network), (4) acceptance is verifiable offline by running tests, (5) value order: stability > bug > structure > token cost > new features.\n\nRules: bug/stability proposals that pass all gates -> "approved". Feature proposals that pass -> "awaiting-human". Anything failing a gate -> "rejected" with the gate named. Tasks touching auth, payments, data deletion or security -> "awaiting-human" regardless. Classify by the security IMPACT of the change, not by which file it touches: a change that alters an authorization rule, a validation boundary or a trust decision goes to a human; an ordinary bug fix that merely happens to sit in a policy file does not.\n\nProposals:\n${JSON.stringify(proposals, null, 2)}\n\nProject files: ${files.join(', ')}\n\nReply with ONLY a JSON object: {"verdicts":[{"task_id":"...","verdict":"approved|awaiting-human|rejected","gates":{"evidence":"pass|reject","not-duplicate":"pass|reject","in-scope":"pass|reject","offline-verifiable":"pass|reject","value-order":"pass|reject"},"reason":"..."}]}`;
    const out = codexExec(auditPrompt, { cwd: wsDir, sandbox: 'read-only', timeoutMs: 720000 });
    verdicts = extractJson(out).verdicts;
    if (!Array.isArray(verdicts) || !verdicts.length) throw new Error('verdicts missing/empty');
  } catch (e) { return fail('audit', e); }
  const auditArt = { ...envelope('audit', { runId, parentId: proposalArt.artifact_id, role: 'auditor', provider: 'codex', family: 'openai' }), verdicts };
  writeArtifact(artDir, auditArt);
  console.log(`[3/5] auditor (codex): ${verdicts.map((v) => `${v.task_id}=${v.verdict}`).join(', ')}`);

  // 4) execute approved tasks with Codex in the workspace copy
  const done = [], waiting = [], failed = [], satisfied = [];
  let runSpend = 0;
  for (const v of verdicts) {
    const p = proposals.find((x) => x.task_id === v.task_id);
    if (!p) continue;
    if (v.verdict === 'rejected') { failed.push({ task: p.title, reason: `rejected at audit — ${v.reason}` }); continue; }
    if (v.verdict === 'awaiting-human') { waiting.push({ task: p.title, reason: v.reason }); continue; }
    const brief = { ...envelope('brief', { runId, taskId: v.task_id, parentId: auditArt.artifact_id, role: 'host', provider: 'host-lite', family: 'host' }), task: p.title, scope: cfg.guardrails.allowedPaths, forbidden: ['.env', 'secrets/', '.git/hooks/', 'nightshift.json'], verification: cfg.project.verification };
    writeArtifact(artDir, brief);
    // Cost guard with the config AS WRITTEN (no local overrides): the
    // per-call estimate is a declared config value (budget.perCallEstimate;
    // 0 is legitimate for subscription executors whose marginal cash cost
    // is zero). Undeclared estimate = unknown cost = the configured
    // unknownCost policy decides, deny by default.
    const estimated = cfg.budget && cfg.budget.perCallEstimate !== undefined ? cfg.budget.perCallEstimate : null;
    const cost = checkCost({ estimated, spentThisRun: runSpend, spentThisTask: 0 }, cfg.budget);
    if (!cost.ok) { failed.push({ task: p.title, reason: `cost guard: ${cost.reason}` }); continue; }
    runSpend += estimated || 0;
    const before = snapshotFiles(wsDir);
    let execOk = true, execNote = '';
    try {
      codexExec(`Implement this approved maintenance task in this project copy. Smallest correct change only. Do NOT touch: ${brief.forbidden.join(', ')}. Only edit within: ${brief.scope.join(', ')}. Add or update tests proving the acceptance criterion.\n\nTask: ${p.title}\nEvidence: ${p.evidence}\nAcceptance: ${p.acceptance}`, { cwd: wsDir, sandbox: 'workspace-write', timeoutMs: 900000 });
    } catch (e) { execOk = false; execNote = String(e.message || e).slice(0, 300); }
    const changed = diffFiles(before, snapshotFiles(wsDir));
    for (const f of changed) {
      const chk = checkPath(f.replace(' (deleted)', ''), cfg.guardrails);
      if (!chk.ok) { execOk = false; execNote = `executor touched forbidden path: ${chk.reason}`; }
    }
    // Zero-change handling (refined after external review): zero changes
    // is NEVER "done". If the project's tests still pass, the task is
    // recorded as already-satisfied — the goal evidently already holds —
    // in its own report section, counted neither as done nor as failed.
    // If tests fail, it is a plain failure.
    const zeroChange = execOk && changed.length === 0;
    const execArt = { ...envelope('execution', { runId, taskId: v.task_id, parentId: brief.artifact_id, role: 'executor', provider: 'codex', family: 'openai' }), changed_files: changed, commands: [{ cmd: 'codex exec (workspace-write)', exit_code: execOk ? 0 : 1 }], result: execOk ? 'completed' : 'failed' };
    writeArtifact(artDir, execArt);
    if (!execOk) { failed.push({ task: p.title, reason: `execution failed — ${execNote}` }); console.log(`[4/5] executed ${v.task_id}: FAILED — ${execNote.slice(0, 120)}`); continue; }

    // 5) verify with the project's own tests
    let testCode = 0, testOut = '';
    try {
      testOut = execFileSync(cfg.project.verification.commands[0], cfg.project.verification.commands.slice(1), { cwd: wsDir, timeout: 600000, stdio: 'pipe' }).toString();
    } catch (e) { testCode = e.status ?? 1; testOut = ((e.stdout || '') + (e.stderr || '')).toString(); }
    const passed = testCode === 0;
    const review = { ...envelope('review', { runId, taskId: v.task_id, parentId: execArt.artifact_id, role: 'verifier', provider: 'host-lite', family: 'host' }), verification_level: passed ? 'V2' : 'V0', declared_level: cfg.project.verification.level, checks: [{ name: cfg.project.verification.commands.join(' '), exit_code: testCode, output_tail: testOut.trim().split('\n').slice(-4).join('\n') }], verdict: passed ? 'verified' : 'failed' };
    writeArtifact(artDir, review);
    if (passed && zeroChange) { satisfied.push({ task: p.title, reason: 'executor made no changes and project tests pass — goal already satisfied; not counted as done' }); console.log(`[4/5] executed ${v.task_id}: already-satisfied (0 files changed)`); }
    else if (passed) { done.push({ task: p.title, evidence: `tests passed (V2); changed ${changed.join(', ')}` }); console.log(`[4/5] executed ${v.task_id}: verified (${changed.length} files changed)`); }
    else { failed.push({ task: p.title, reason: `verification failed (exit ${testCode})` }); console.log(`[4/5] executed ${v.task_id}: FAILED verification`); }
  }

  // 6) morning report
  const report = { ...envelope('morning-report', { runId, role: 'host', provider: 'host-lite', family: 'host' }), done, waiting, failed, satisfied, costs: { subscription_quota: 'codex session (see codex usage)', cash_spend: 'deepseek api (small)', local_compute: 'one local run' }, independence: 'flexible (proposer deepseek ⊥ auditor openai; auditor and executor share the openai family)' };
  writeArtifact(artDir, report);
  const all = fs.readdirSync(artDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(artDir, f), 'utf8')));
  const chainErrors = validateChain(all);
  const md = [`# Morning report — ${runId} (REAL RUN)`, '', `Target: ${cfg.project.path} (worked on a copy; original untouched). Independence: ${report.independence}. Chain: ${chainErrors.length ? 'INVALID ' + chainErrors.join('; ') : 'valid'}.`, '', '## Done (with evidence)', ...(done.length ? done.map((d) => `- ${d.task} — ${d.evidence}`) : ['- nothing']), '', '## Already satisfied (not counted as done)', ...(satisfied.length ? satisfied.map((s) => `- ${s.task} — ${s.reason}`) : ['- nothing']), '', '## Waiting for you', ...(waiting.length ? waiting.map((w) => `- ${w.task} — ${w.reason}`) : ['- nothing']), '', '## Failed / not done', ...(failed.length ? failed.map((f) => `- ${f.task} — ${f.reason}`) : ['- nothing']), ''].join('\n');
  fs.writeFileSync(path.join(runDir, 'morning-report.md'), md);
  fs.writeFileSync(path.join(RUNS, 'latest.txt'), runId);
  console.log(`[5/5] morning report written: ${runId}`);
  console.log(md);
}

main().catch((e) => { console.error(e); process.exit(1); });
