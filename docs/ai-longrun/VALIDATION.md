# Validation evidence

All commands below were personally executed in `/workspace/REP-WARS-2-AI-SIM` against pinned baseline `6f38eec6516682e64937b08744a5607f54bbba91` plus development harness files.

| Check | Exact result |
|---|---|
| New awaited simulation suite | 19 passed, 0 failed, 0 skipped |
| Existing focused AI A–L | 837 passed, 0 failed |
| Existing backend integration | 319 passed, 0 failed |
| Existing full backend runner | Reported 1,916 passed, 0 failed; three credential-dependent live Supabase checks skipped and included by its legacy reporting in the passed total |
| Production TypeScript | PASS, exit 0 |
| Test-inclusive TypeScript | Exit 2, exactly 28 inherited diagnostics; file/code/message identities match frozen baseline, ignoring shifted line/column positions |
| Simulation corpus | 16/16 main runs completed, zero command/nested errors; troop, siege, and all five resource residuals zero |
| Additional replay | Archived small seed-11 six-hour canonical state SHA-256 reproduced |
| Medium batching probe | Fine versus five-tick batches, seed 29, 60 ticks: identical armies, territories, operations, claims, Peace, Trade, recruitment and conflict ledger |

Commands:

```bash
node node_modules/ts-node/dist/bin.js --project tsconfig.tests.json --transpile-only tests/aiLongRunSimulation.ts
TS_NODE_PROJECT=tsconfig.tests.json node -r ./node_modules/ts-node/register/transpile-only docs/review/phase-l-frozen/scripts/l-driver.cjs focus
TS_NODE_PROJECT=tsconfig.tests.json node -r ./node_modules/ts-node/register/transpile-only docs/review/phase-l-frozen/scripts/l-integration.cjs focus
node node_modules/ts-node/dist/bin.js --project tsconfig.tests.json --transpile-only tests/run.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --project tsconfig.tests.json --noEmit
git diff --check
```

The new suite is standalone rather than changing the production test runner. Its 19 tests are additional to the existing 1,916 reported entries, not included in that old total. It verifies all three world sizes, exact initial troop split, passive fixture exclusion, actual action/combat lifecycle, identical-seed replay, reload, native conservation accounting, live/terminal claims, exact-plan handoff, elimination, duplicate terminal observation, persistence round trip, complete small-world batch equivalence, insertion-order semantic equivalence, offline accrual, and Medium/Large native replay.

The three unavailable live checks are Supabase save/reload, atomic Postgres world/history commit, and server restart. No credentials were injected and no external database mutation was performed. In-memory CAS and the existing mocked adapter/integration coverage executed normally.

Test-inclusive baseline: `docs/review/phase-l-frozen/evidence/freeze-test-inclusive.log`. No test diagnostic identity was introduced or removed by these changes. Existing frozen-review whitespace artifacts were not edited. Current/new harness text is separately checked; ordinary `git diff --check` alone does not examine untracked files.

Logs retained under `evidence/` contain the personally run suite output and TypeScript diagnostics. Native simulation logs/configurations/snapshots are in `results/`. Detailed scoring logs are private developer diagnostics and must not be exposed as player-facing state.
