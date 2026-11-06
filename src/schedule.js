'use strict';
// Scheduler generators: the Host has to be woken up by *something*.
// These produce the four mainstream answers as text the user installs:
// cron (Linux/macOS), launchd (macOS), Task Scheduler (Windows),
// GitHub Actions (cloud host — for machines that sleep at night, SPEC §3-D).

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cronLine(cwd) {
  return `# quota-nightshift — nightly at 01:05 local time\n5 1 * * *  cd ${shellQuote(cwd)} && node src/cli.js demo >> runs/night.log 2>&1`;
}

function launchdPlist(cwd, label = 'com.quota-nightshift') {
  if (!/^[a-zA-Z0-9.-]+$/.test(label)) throw new Error('launchd label may only contain letters, digits, dot and dash');
  const dir = xmlEscape(cwd);
  return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>Label</key><string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/env</string><string>node</string><string>src/cli.js</string><string>demo</string>
  </array>
  <key>WorkingDirectory</key><string>${dir}</string>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>1</integer><key>Minute</key><integer>5</integer></dict>
  <key>StandardOutPath</key><string>${dir}/runs/night.log</string>
  <key>StandardErrorPath</key><string>${dir}/runs/night.log</string>
</dict></plist>`;
}

function windowsTask(cwd) {
  if (/["&|;<>^%]/.test(cwd)) throw new Error('windows task: cwd contains characters that cannot be quoted safely');
  return `:: quota-nightshift — register a nightly 01:05 task (run once, as your user)\nschtasks /Create /TN "quota-nightshift" /SC DAILY /ST 01:05 /TR "cmd /c cd /d \\"${cwd}\\" && node src\\cli.js demo >> runs\\night.log 2>&1"`;
}

function githubActions() {
  return `# quota-nightshift cloud host: runs on a schedule in CI.
# In this form the pipeline operates on THIS repository in the cloud —
# point the config at your project and store provider keys as secrets.
name: quota-nightshift
on:
  schedule:
    - cron: "5 17 * * *"   # 01:05 Asia/Shanghai = 17:05 UTC
  workflow_dispatch: {}
jobs:
  night:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: node src/cli.js doctor
      - run: node src/cli.js demo
      - uses: actions/upload-artifact@v4
        with: { name: morning-report, path: runs/ }`;
}

const SCHEDULERS = { cron: cronLine, launchd: launchdPlist, windows: windowsTask, 'github-actions': githubActions };

module.exports = { SCHEDULERS, cronLine, launchdPlist, windowsTask, githubActions };
