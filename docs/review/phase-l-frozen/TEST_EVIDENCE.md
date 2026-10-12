# Validation evidence and reproducible commands

Run all commands from `/workspace/REP-WARS-2`. No build output, staging or implementation edits are needed. The bundle preserves the previous implementation logs (`reported-*`) **and fresh freeze-task verification** (`freeze-*`). The fresh full/focused/integration/compiler commands were rerun against the frozen implementation. Review scripts assemble virtual modules in memory; they do not write into `tests/`.

## Results

| Check | Fresh result | Exit | Evidence |
|---|---|---:|---|
| Full suite | **1,833 passed / 0 failed** | 0 | `evidence/freeze-full-suite.log` |
| Phase A–L focused | **754 passed / 0 failed**, includes L **60** | 0 | `evidence/freeze-focused-a-l.log` |
| Integration | **319 passed / 0 failed** | 0 | `evidence/freeze-integration.log` |
| Production TypeScript `--noEmit` | **PASS** | 0 | `evidence/freeze-production-typescript.log` (empty success output) |
| Test-inclusive TypeScript | **FAIL: 28 existing diagnostics**, zero new/removed | 2 | `evidence/freeze-test-inclusive.log`, `test-inclusive-comparison.json`, `phase-k-test-inclusive.log` |
| `git diff --check` | **PASS** | 0 | `evidence/freeze-diff-check.log` (empty success output) |
| Complete patch reconstruction | **46/46 exact content hashes match Phase K + patch** | 0 | `evidence/patch-verification.json` |

The selected test runners report no failing or skipped tests; these counts overlap and must not be added to the full-suite count. The self-audit probes are **separate** from the passing suite: one reproduces an invalid response draft, and one identifies a limited invasion materiality contract. They are not silently counted as passing behavioral regressions.

## Exact fresh commands

```bash
node node_modules/ts-node/dist/bin.js --project tsconfig.tests.json --transpile-only tests/run.ts

TS_NODE_PROJECT=tsconfig.tests.json node -r ./node_modules/ts-node/register/transpile-only docs/review/phase-l-frozen/scripts/l-driver.cjs focus

TS_NODE_PROJECT=tsconfig.tests.json node -r ./node_modules/ts-node/register/transpile-only docs/review/phase-l-frozen/scripts/l-integration.cjs focus

node node_modules/typescript/bin/tsc --noEmit

node node_modules/typescript/bin/tsc --project tsconfig.tests.json --noEmit

git diff --check
```

During freeze, stdout/stderr were redirected into the matching evidence logs; each compiler/test exit code is preserved in its `.exit` file. `git diff --check` checks the unstaged tracked implementation diff; complete patch reconstruction additionally validates inclusion of new files without staging.

## Focused counts by phase

| Phase | Tests | Result |
|---|---:|---|
| A | 17 | PASS |
| B | 28 | PASS |
| C | 60 | PASS |
| D | 41 | PASS |
| E | 55 | PASS |
| F | 73 | PASS |
| G | 78 | PASS |
| H | 85 | PASS |
| I | 90 | PASS |
| J | 83 | PASS |
| K | 84 | PASS |
| L | 60 | PASS |
| **Total** | **754** | **0 failed** |

## Integration counts

Anchors 16; movement 24; strategic attack 32; invasion 24; economy foundation 22; cities 24; developments 15; persistence 45; temporal boundaries 23; presence 18; gameplay-session lease persistence 7; command idempotency 16; session replay 10; lease world accrual 20; gameplay-session lifecycle 23. Total **319**. Group markers in the raw log are cumulative; these individual counts are the differences.

## Known compile diagnostics

The baseline log was compiled from an exported Phase K source tree. Comparison normalizes that exported root and source line/column locations, then compares **repository-relative file, TypeScript code, full diagnostic message and multiplicity**. Both logs contain exactly 28 diagnostics, with zero new and zero removed identities. This is an unchanged failing test-inclusive compile, not a clean compilation. See `evidence/test-inclusive-comparison.json`.

## Review-only probes

```bash
TS_NODE_PROJECT=tsconfig.tests.json node -r ./node_modules/ts-node/register/transpile-only docs/review/phase-l-frozen/scripts/l-driver.cjs aiResponses docs/review/phase-l-frozen/scripts/self-audit-probes.ts
```

Output: `evidence/self-audit-probes.jsonl`. These run production observer/reducer/invariant functions on in-memory authored fixtures only. No source/test changes were made to add these probes to the production suite.

## Original implementation evidence commands

The previous logs used the same commands above except the review driver paths were `/tmp/l-driver.cjs` and `/tmp/l-integration.cjs`. `reported-production-typescript.log` and the previous suite logs are retained unmodified. Benchmark command/provenance is in `PERFORMANCE.md`.
