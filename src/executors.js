'use strict';
// Executor registry: coding-agent CLIs the Host can drive. An executor
// adapter's job (SPEC, ChatGPT review §13): detect presence, version and
// login state; translate the brief into the CLI's invocation; enforce the
// timeout; recognize abnormal exits. The protocol core never learns any
// CLI's flags — they live here, one entry per tool.
const { execFileSync } = require('child_process');

const EXECUTORS = [
  { id: 'codex',       name: 'Codex CLI',        family: 'openai',    command: 'codex',       versionArgs: ['--version'], quota: 'codex-session-probe' },
  { id: 'claude-code', name: 'Claude Code',      family: 'anthropic', command: 'claude',      versionArgs: ['--version'], quota: null },
  { id: 'qwen-code',   name: 'Qwen Code',        family: 'alibaba',   command: 'qwen',        versionArgs: ['--version'], quota: null },
  { id: 'gemini-cli',  name: 'Gemini CLI',       family: 'google',    command: 'gemini',      versionArgs: ['--version'], quota: null },
  { id: 'aider',       name: 'Aider',            family: 'multi',     command: 'aider',       versionArgs: ['--version'], quota: null, note: 'model-agnostic: family = the model Aider is configured with' },
  { id: 'opencode',    name: 'OpenCode',         family: 'multi',     command: 'opencode',    versionArgs: ['--version'], quota: null, note: 'model-agnostic: family = the configured model' },
  { id: 'codebuddy',   name: 'CodeBuddy Code',   family: 'tencent',   command: 'codebuddy',   versionArgs: ['--version'], quota: null },
  { id: 'fake',        name: 'Fake executor (demo)', family: 'fake',  command: null,          versionArgs: [],            quota: null },
];

function health(executor) {
  if (!executor.command) return { id: executor.id, installed: true, version: 'built-in', login: 'n/a' };
  try {
    const version = execFileSync(executor.command, executor.versionArgs, { stdio: 'pipe', timeout: 5000 }).toString().trim().split('\n')[0];
    return { id: executor.id, installed: true, version, login: 'unknown (check the tool itself)' };
  } catch {
    return { id: executor.id, installed: false, version: null, login: 'unknown' };
  }
}

function getExecutor(id) { return EXECUTORS.find((e) => e.id === id) || null; }

module.exports = { EXECUTORS, health, getExecutor };
