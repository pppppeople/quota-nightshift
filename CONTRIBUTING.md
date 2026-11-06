# Contributing

Ways to contribute, in the order the project needs them:

- **Providers**: add a preset to `src/providers.js` (id, family, region,
  base_url, key env, capabilities). Mark its verification status honestly —
  a preset is not "supported" until a live call has been made.
- **Executors**: add an entry to `src/executors.js` (command, version args,
  family). Health detection must work without any login side effects.
- **Schemas**: artifact changes need a schema update, a validator test,
  and a SPEC.md note in the same PR.
- **Everything**: `npm test` must pass, and the offline demo
  (`node src/cli.js demo`) must still complete. Claims in README must be
  backed by something reproducible in this repo.

Changes to guardrail enforcement (`src/policy.js`) and the state machine
require a test demonstrating the boundary, not just the happy path.
