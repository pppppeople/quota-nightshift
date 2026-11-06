# quota-nightshift

**A model-agnostic, budget-aware, human-governed protocol for autonomous
software maintenance.**

> The protocol should adapt to the developer, not force the developer to
> adapt to the protocol.

## The story

You pay for an AI coding subscription. Its quota resets every few hours —
and most nights, the leftover expires unused. Letting an AI loose on your
repo overnight without supervision, though, is how you wake up to a mess.

quota-nightshift is the middle path. Its design was informed by the
author's own two-week production workflow (20 proposal/audit rounds, a
five-gate decision ledger, no red-line incidents) — that workflow is the
protocol's origin, not a claim about this code: **the reference host in
this repo is a separate, reproducible offline implementation.**
**Proposers suggest, an auditor judges, an executor builds, tests verify,
and a human decides.** Every step is a file on disk that you can read,
diff, and audit. Nothing pushes. Nothing merges. In the morning you get
one report — done (with evidence), waiting for you, failed (with
reasons) — and you decide.

> **Safety boundary, stated plainly:** the Host enforces protocol-level
> policy checks and execution authorization. OS-level sandboxing and
> network isolation are deployment responsibilities and are **not
> provided** by this reference implementation. Two runnable paths exist:
> the offline fake-provider demo (start here), and a real execution path
> (`src/real-night.js`, plus `src/pick-run.js` for human-approved items)
> that drives a real proposer API and a real executor CLI — proven
> unattended in production (see Field record). Unattended execution
> covers eligible tasks only: **security-sensitive changes always stop
> for a human**, and every failure is reported, never retried blind.

## Run it in 60 seconds (no keys, no cost)

```bash
# after cloning this repository (or downloading the release archive):
cd quota-nightshift
node src/cli.js doctor     # check your environment
node src/cli.js demo       # one full fake night, offline
node src/cli.js status     # read the morning report it produced
```

The demo uses built-in **fake providers** against a copy of
`examples/todo-app`: a snapshot is taken, 3 ideas are proposed, the auditor
approves one, narrows one to "waiting for a human", and rejects one with
reasons; the approved fix is really applied, the project's own tests really
run (verification level V2), and 7 schema-validated artifacts are written
under `runs/<run_id>/artifacts/`. A sample report is in
`examples/sample-run/`.

## How it works

```
        ┌──────────── Host (layer 0: hands + referee, enforces rules in code)
        │   moves files · runs tests · keeps the ledger · cannot be overruled by any model
        ▼
 Snapshot ─► Proposer ─► Auditor ─► Executor ─► Verifier ─► Morning report
 (files)    (any cheap   (any strong  (any coding  (tests first,    (done /
              model)       model,       agent CLI)   diff review      waiting /
                           five gates)               by another       failed)
                                                     family)
                                                    Decider: you.
```

- **Roles are capabilities, not brands.** Swap any layer: overseas or
  domestic, API, CLI, web, local model — see the capability registry idea
  in `SPEC.md` §2 and the adapter in `src/openai-compatible.js`.
- **Independence is graded, not faked.** strict / flexible /
  single-provider — and single-provider runs are labeled as such.
- **The brief is not an authorization.** Path deny-lists (`.env`,
  `secrets/`, `.git/hooks/`), no-push, and cost caps are enforced by the
  Host in code, whatever any model says.

## What's in the box

| Part | Where | What it is |
|---|---|---|
| Protocol spec | `SPEC.md` | roles, artifacts, state machine, five gates, quota & cost model, verification levels V0–V4, security policy |
| Reference host | `src/cli.js` (+ `artifacts.js`, `policy.js`) | zero-dependency Node: `init / doctor / demo / dry-run / status / validate` |
| Artifact schemas | `schemas/` | the seven artifact types, with a shared evidence-chain envelope |
| Adapters | `src/providers.js`, `src/executors.js`, `src/notify.js`, `src/openai-compatible.js`, `src/fake.js` | **19 model providers** (overseas, domestic, local, web-manual), **8 executor CLIs** with health checks, 5 notification channels, one OpenAI-compatible adapter for real models, offline fakes |
| Quota probe | `src/quota-probe.js` | reads leftover Codex quota from local session files; degrades to `unknown`, never guesses |
| Presets & schedulers | `presets/`, `src/schedule.js` | verification presets for Node/Python/Go/Rust/make; installable cron / launchd / Windows Task / GitHub Actions forms (`node src/cli.js schedule <kind>`) |

Run `node src/cli.js adapters` for the full live matrix, including which
executor CLIs are actually installed on your machine. Provider presets are
starting points — verify each base_url against the provider's current
official docs before relying on it.
| Real execution path | `src/real-night.js`, `src/pick-run.js`, `run-nightly.sh` | real proposer API → real CLI auditor → real CLI executor on a workspace copy → project tests → morning report; pick-run executes human-approved items through the same channel |
| Templates | `templates/` | snapshot, proposer prompts A/B, backlog ledger, morning report, project scope |
| Examples | `examples/` | a runnable Node app, a Python verification config, a sample morning report |
| Tests | `test/` | artifact validation, path policy, state machine, cost guard |

## Use it with your own project

1. `node src/cli.js init` — creates `nightshift.json`.
2. Point `project.path` at your repo and set
   `project.verification.commands` to your test command (any language;
   the protocol reads exit codes, not languages).
3. Start at trust level L1: `node src/cli.js dry-run` — proposals and
   audits only, nothing executes. Move up when the reports earn it.
4. Wire real providers per layer in the config when you're ready;
   keys come from environment variables, never from the config file.

## Field record (facts, not claims)

- The protocol grew out of a two-week production workflow: 20
  proposal/audit rounds against a live project, zero red-line incidents.
- The reference implementation then ran **against itself**: a series of
  unattended real runs (scheduler-started, no human at the machine,
  exit code 0, morning report on disk). The pipeline found two real
  security bugs in its own code (a fail-open path check; an unvalidated
  config field), routed both to the human channel by its own rules, and
  the fixes passed verification through that channel.
- Independent external reviews of this codebase scored it 72/100
  (documentation), 54/100 (first source review), 74/100 (run reports)
  and 83/100 (source-evidence review of v0.5.0). The reviews' main
  finding — mechanisms defined and tested but not wired into the main
  flow — was fixed and re-verified with adversarial tests.
- Known limits, stated plainly: the scheduler generator still emits
  the demo entry point (production deployments use `run-nightly.sh`);
  the state machine is enforced in the demo host, with unification
  across the real/pick entry points on the roadmap; costs are
  config-declared estimates, not metered billing; artifact chains are
  integrity-checked within a run, not cryptographically signed.

## Trust ladder

L0 observe (report leftover quota only) → L1 propose + audit, no execution
→ L2 execute test-only changes → L3 full pipeline. Climb at your own pace.

## Capability status (protocol defined / host implemented / live-verified)

| Capability | SPEC | Host | Live-verified |
|---|---|---|---|
| Artifact chain + morning report (fake providers) | ✓ | ✓ | ✓ in-repo demo, chain-verified |
| Five-gate audit, state machine, cost guard | ✓ | ✓ | ✓ wired into the run path + tests (v0.3) |
| Provider registry (19 presets) | ✓ | ✓ | △ one adapter path live (DeepSeek via OpenAI-compatible); other presets unverified |
| Executor registry + health checks (8) | ✓ | ✓ | ✓ detection works; Codex CLI driven by the real path |
| Codex quota probe | ✓ | ✓ | ✓ against session fixtures |
| Real executor driving a brief | ✓ | ✓ (`src/real-night.js`) | ✓ unattended production runs (see Field record) |
| Git snapshot / rollback | ✓ | ✗ | ✗ roadmap |
| OS sandbox / network isolation | deployment duty | ✗ | ✗ not provided |
| Artifact parent-chain validation | ✓ | ✓ basic (existence/run/task) | ✓ tests |
| Artifact hash chain / tamper evidence | partial | ✗ | ✗ roadmap |
| Locale (UI / artifacts / project) | ✓ | ✗ config reserved, not consumed | ✗ known gap |

## Status & roadmap

v0.4.0: first real unattended night completed on the author's Mac (launchd self-start, DeepSeek proposing, Codex auditing and executing in a workspace copy, tests verifying, morning report written — zero human involvement, 4m35s). The real-run driver is src/real-night.js with run-nightly.sh as the scheduler entry.
v0.3.0: two external audits applied (document-level 72/100, source-level
54/100 — both by an independent model reviewer; the fixes below are the
response, not a re-grade). Wired the cost guard into the execution path,
unified the state-machine entry, evidence-capped verification levels,
hardened path checks (absolute/Windows/backslash), quoted scheduler
output, validated quota-probe data before trusting it, made artifacts
exclusive-create with parent-chain validation, deep-merged config, and
added run-failure markers. Tests: 16, including one regression test per
audit finding.
Next: artifact hash chain → real model output parsing (ingestion layer)
→ git snapshot/rollback/idempotent resume → sandboxed real executors →
mixed-family live runs → daemon.
Positioning note: governance protocol — executors like OpenHands, Codex
and Claude Code do the work; this protocol governs who may propose,
approve, execute, and how it is verified.

## License

MIT — see `LICENSE`.
