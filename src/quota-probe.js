'use strict';
// Codex quota probe: reads the newest Codex session transcript under a
// sessions directory and extracts the last token_count event's rate_limits
// (primary = short window, secondary = weekly window).
//
// Trust level (SPEC §8): this is "official CLI exposed information" — the
// numbers come from the tool's own session files, not a scraped web page.
// If the format changes, the probe returns unknown rather than guessing:
// an inferred number must never be presented as a measured one.
const fs = require('fs');
const path = require('path');

function newestJsonl(dir) {
  if (!fs.existsSync(dir)) return null;
  let best = null;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl')) {
        const m = fs.statSync(p).mtimeMs;
        if (!best || m > best.m) best = { file: p, m };
      }
    }
  };
  walk(dir);
  return best?.file || null;
}

function probeCodexSessions(sessionsDir) {
  const file = newestJsonl(sessionsDir);
  if (!file) return { source: 'codex-session', confidence: 'unknown', primary: null, secondary: null, note: 'no session transcripts found' };
  let last = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const tc = obj?.payload?.token_count || obj?.token_count;
      if (tc?.rate_limits) last = tc.rate_limits;
    } catch { /* skip malformed lines */ }
  }
  if (!last) return { source: 'codex-session', confidence: 'unknown', primary: null, secondary: null, note: 'no token_count event in latest session' };
  const norm = (w) => w ? {
    used_percent: w.used_percent ?? w.usedPercent ?? null,
    resets_at: w.resets_at ?? w.resetsAt ?? null,
    window_minutes: w.window_minutes ?? w.windowMinutes ?? null,
    type: 'rolling_window',
  } : null;
  // Validate before trusting: a parsed number is not a credible number.
  // Garbage field types or out-of-range percentages downgrade the whole
  // reading to unknown instead of reporting it with high confidence.
  const validWindow = (w) => !w || (typeof w.used_percent === 'number' && Number.isFinite(w.used_percent) && w.used_percent >= 0 && w.used_percent <= 100);
  const primary = norm(last.primary), secondary = norm(last.secondary);
  if (!validWindow(primary) || !validWindow(secondary)) {
    return { source: 'codex-session', confidence: 'unknown', file: path.basename(file), primary: null, secondary: null, note: 'rate_limits present but field values failed validation (type/range) — not reporting untrusted numbers' };
  }
  return {
    source: 'codex-session', confidence: 'high',
    file: path.basename(file),
    primary, secondary,
    note: 'per-account figures must be recorded against the account that produced the session; never merge percentages across accounts',
  };
}

module.exports = { probeCodexSessions };
