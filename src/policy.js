'use strict';

// Host-enforced policy. Models advise; this code decides. Nothing in any
// artifact can widen what is allowed here (SPEC §3, §10).

const DEFAULT_DENIED = ['.env', 'secrets/', '.git/hooks/', 'nightshift.json'];

function isDenied(relPath, policy) {
  const denied = [...DEFAULT_DENIED, ...(policy.deniedPaths || [])];
  return denied.some((d) => relPath === d || relPath.startsWith(d));
}

function checkPath(relPath, policy) {
  if (typeof relPath !== 'string' || !relPath) return { ok: false, reason: 'empty path' };
  // Normalize separators first so Windows-style input cannot sneak past.
  let clean = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  // Absolute paths (POSIX, Windows drive, UNC) are never workspace-relative.
  if (clean.startsWith('/') || /^[a-zA-Z]:/.test(clean) || clean.startsWith('//')) {
    return { ok: false, reason: 'absolute path not allowed' };
  }
  if (clean.split('/').includes('..')) return { ok: false, reason: 'path escapes workspace' };
  if (isDenied(clean, policy)) return { ok: false, reason: `denied path: ${clean}` };
  const allowed = policy.allowedPaths || [];
  if (!allowed.length) return { ok: false, reason: 'no allowlist configured — deny by default' };
  const inAllow = (a) => clean === a.replace(/\/$/, '') || clean.startsWith(a.endsWith('/') ? a : `${a}/`);
  if (!allowed.some(inAllow)) {
    return { ok: false, reason: `outside allowlist: ${clean}` };
  }
  return { ok: true };
}

// Task state machine (SPEC §5). Terminal: verified, failed, rejected, dismissed.
const TRANSITIONS = {
  proposed: ['audited', 'rejected'],
  audited: ['approved', 'awaiting-human', 'rejected'],
  'awaiting-human': ['approved', 'dismissed'],
  approved: ['briefed'],
  briefed: ['executing'],
  executing: ['executed', 'failed'],
  executed: ['verified', 'failed'],
  verified: [], failed: [], rejected: [], dismissed: [],
};

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) throw new Error(`illegal task transition: ${from} -> ${to}`);
}

// Cost guard (SPEC §8): unknown cost denies by default.
function checkCost({ estimated, spentThisRun = 0, spentThisTask = 0 }, budget) {
  if (!budget) return { ok: true };
  if (estimated === null || estimated === undefined) {
    return budget.unknownCost === 'allow'
      ? { ok: true }
      : { ok: false, reason: 'cost unknown and unknown_cost policy is deny' };
  }
  if (budget.maxPerTask && spentThisTask + estimated > budget.maxPerTask) {
    return { ok: false, reason: 'per-task budget exceeded' };
  }
  if (budget.maxPerRun && spentThisRun + estimated > budget.maxPerRun) {
    return { ok: false, reason: 'per-run budget exceeded' };
  }
  return { ok: true };
}

module.exports = { checkPath, canTransition, assertTransition, checkCost, TRANSITIONS };
