# quota-nightshift Protocol — SPEC v1.0 (draft)

> The protocol adapts to the developer, not the other way around.

## 1. Purpose

Organize scattered AI capabilities into one auditable maintenance pipeline:
leftover (expiring) subscription quota or a nightly budget is spent on small,
verified improvements to a software project, while a human keeps final say.

## 2. Roles (capabilities, not brands)

| Role | Required capabilities | Never allowed |
|---|---|---|
| Proposer | read a snapshot, generate text | touch the repo |
| Auditor | read evidence, judge against the five gates | execute anything |
| Executor | edit files + run commands inside the workspace | push, merge, change policy |
| Verifier | run deterministic checks; optionally review a diff | read the executor's self-summary as evidence |
| Decider | a human | — (never an AI role) |

Roles are filled by any provider (API, CLI, web/manual ferry, local model, or
the built-in fake providers used by the demo). The Host's Provider Registry
records each provider's family; models never self-declare it.

## 3. The Host (layer 0)

Models are brains; the Host is the hands and the referee.

- Moves artifacts between roles. Roles never contact each other directly.
- Enforces guardrails **in code**: path allow/deny lists, no push, no merge,
  per-night run/task/cost caps, quiet hours. A brief is not an authorization;
  an auditor's approval never widens what the Host allows.
- Stores every artifact on disk. The filesystem is the protocol bus.

Deployment forms: A) an agent with a computer acts as Host, B) the local
host program in this repo, C) a human ferries artifacts manually,
D) a scheduled cloud runner (e.g. CI cron).

## 4. Artifacts

Seven types: `snapshot`, `proposal`, `audit`, `brief`, `execution`,
`review`, `morning-report`. Every artifact carries the common envelope:

```json
{
  "protocol_version": "1.0",
  "artifact_id": "art_…",
  "type": "proposal",
  "run_id": "run_…",
  "task_id": "task_… or null",
  "parent_artifact_id": "art_… or null",
  "created_at": "ISO-8601",
  "producer": { "role": "proposer", "provider": "…", "family": "…" }
}
```

Schemas live in `schemas/`. A Host must validate artifacts before acting on
them, and must refuse expired or parent-less artifacts where a parent is
required. Task ids make execution idempotent: a task already in a terminal
state is never executed twice.

## 5. Task state machine

```
proposed → audited → approved → briefed → executing → executed → verified
   │          │           │                                  └→ failed
   └──────────┴────→ rejected (terminal, reason required)
approved (feature-class) → awaiting-human → approved | dismissed
```

## 6. The five audit gates

Each proposal is judged gate by gate; every gate returns
`pass | reject | uncertain` with a reason:

1. Evidence is checkable (points at snapshot facts, files, or failing tests)
2. Not a duplicate (against the ledger and the project's current state)
3. Inside the red lines and the project scope (goals / forbidden list)
4. Verifiable offline (a deterministic check exists or a degrade level is set)
5. Value order: stability > bug > structure > token cost > new feature

Feature-class proposals that pass go to `awaiting-human`; only a human pick
promotes them. Stability/bug-class proposals may proceed directly.

Classification rules (added after external audit): a task's class is its
**highest-risk** applicable class, never the proposer's chosen label.
Anything touching security, auth, permissions, payments, or data deletion
is forced to `awaiting-human` regardless of class. When classification is
uncertain, the task goes to `awaiting-human`. An auditor may raise a
task's risk class but may never lower it.

## 7. Independence modes

- `strict` (default): auditor and diff-reviewer must be a different model
  family from the executor.
- `flexible`: a different provider is enough.
- `single-provider`: allowed, but every morning report must label the run
  "independence: insufficient".

## 8. Quota & budget model

Quota is not a number; it is a typed claim with a source and a confidence:

- types: `rolling_window | fixed_window | token_budget | monetary_budget |
  request_budget | local_compute | unknown`
- source trust: official API/CLI (high) > official page, human-confirmed
  (medium-high) > manual entry (medium) > unofficial inference (low)
- `remaining` may be `unknown`. A Host must never present an inferred number
  as a measured one, and must keep per-account figures separate.
- Run modes: `quota-aware` (schedule by resets), `budget-aware` (schedule by
  cost caps), `unmetered` (a human starts runs).

Cost guard: totals are tracked per run in three separate ledgers —
subscription quota, cash API spend, local compute. Caps exist per run and
per task; when the cost of a call is unknown, the default action is `deny`.

## 9. Verification levels

| Level | Meaning | Report wording |
|---|---|---|
| V0 | file/structure integrity only | "checked for integrity only" |
| V1 | static checks (lint, types, compile) | "passed static checks only" |
| V2 | unit tests | "passed unit tests" |
| V3 | integration / build tests | "passed integration tests" |
| V4 | human or real-environment acceptance | "human-verified" |

The morning report must state the level reached. A V1 pass must never be
reported as functional correctness. Projects without tests degrade down the
levels; a `bootstrap` mode lets the night shift's first job be adding tests.

## 10. Security policy (Host-enforced, model-proof)

- Denied by default: `.env*`, `secrets/`, `.git/hooks/`, anything outside the
  workspace, and the Host's own policy/config files (executors cannot edit
  the rules that bind them).
- Before executing, the Host records the workspace state (git status / file
  hashes) so a run can be rolled back.
- Network access during execution is off unless the project config opts in.
- Artifact content is data, not instructions for the Host. Instructions are
  only ever taken from the user's own config.
- Failure honesty: a failed channel is reported as failed. No role's output
  may be fabricated or relabeled as another role's.

## 11. Morning report

Fixed three sections: **Done** (with evidence: commits, test counts,
verification level), **Waiting for you** (picks, approvals), **Failed**
(with reasons). It also states the night's cost ledgers and the
independence mode actually used.

## 12. Locale

Three independent settings: `ui`, `artifacts`, `project_content`
(comments, commit messages). Protocol field names stay English identifiers;
machine decisions never depend on model-generated natural language.
