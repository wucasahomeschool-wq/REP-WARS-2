# Final behavioral-fix validation

Baseline HEAD: `6f38eec6516682e64937b08744a5607f54bbba91`; branch: `dev/ai-longrun-simulation`. Production scope is pinned by `evidence/final-production-fingerprints.json`. Tests and final simulations were run after the last production edit; documentation and additional test cases do not change the simulated production code.

| Personally run | Result | Evidence |
|---|---|---|
| Targeted behavioral tests | 31 passed / 0 failed / 0 skipped | `evidence/behavioral-tests.log` |
| Existing long-run harness tests | 19 passed / 0 failed / 0 skipped | `evidence/existing-harness-tests.log` |
| Existing A–L focused | 837 passed / 0 failed | `evidence/focused-a-l.log` |
| Existing integration | 319 passed / 0 failed | `evidence/integration.log` |
| Existing full backend | Runner reports 1,916 passed / 0 failed; **three credential-gated live Supabase checks skipped**, included in legacy passed total | `evidence/full-backend.log` |
| Production TypeScript | Exit 0, no diagnostics | `evidence/production-typescript.log` |
| Test-inclusive TypeScript | Exit 2, same 28 inherited file/code/message identities | `evidence/test-inclusive-typescript.log`, `evidence/integrity-verification.json` |
| Exact original reference replay | 16/16 canonical final digests equal archived corpus | `results/COMPARISON.json`, `evidence/matrix-before.log` |
| Final corrected runs | 16/16 completed, zero nested errors; zero troop/siege/five-resource residuals | `results/COMPARISON.json`, `evidence/matrix-final-after.log` |
| Original manifest entries | 118/118 unchanged; original manifest retained | `evidence/integrity-verification.json` |
| Production fingerprints | 8/8 unchanged since final matrix freeze | `evidence/integrity-verification.json` |
| Tracked diff check | PASS | `evidence/repository-hygiene.json` |
| New text whitespace | No trailing whitespace in follow-up text | `evidence/repository-hygiene.json` |

The three unavailable live checks are save/reload, atomic Postgres world/workout-history commit, and server restart. No credentials or live database writes were used. In-memory CAS and mocked persistence coverage ran. New standalone suites are not included in the existing runner's 1,916 entries.

Two original-problem regressions intentionally failed against the actual baseline (0 passed / 2 failed), and pass against the corrected code. See `evidence/expected-baseline-regression-failures.log`. These expected baseline failures are kept separate from final pass evidence.

Exact reproduction commands are in `../AI_LONGRUN_BEHAVIORAL_FIXES.md`. The original batching, reload, identical-seed and reversed-insertion tests executed against the corrected engine. This is current implementation coverage, not a claim of unimplemented Temporal guarantees or a proof of every future long-run event sequence.

All generated/private logs remain development evidence. No commit, stage, push or automatic log cleanup was performed.
