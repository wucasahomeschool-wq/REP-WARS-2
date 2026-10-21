# R1-E — Locked completion settlement and campaign safety

Parent: `09677c38a54c4d438639f82ec7422eb988b54490` (R1-D).
Branch: `feat/r1-e-workout-reward-settlement`.
Worktree: `/workspace/REP-WARS-2-R1-E`.

## Audit

R1-D locks validated NORMAL_TROOPS terms in the canonical session but explicitly
rejects their finalization. The three initial SHORT/STANDARD/LONG regressions
reproduced this rejection before implementation. Legacy finalization evaluates
fitness evidence, calculates PhysicalResult, converts a reward, applies it and
clears the session. Its feedback gate is unsuitable for the new policy.

The existing world transition builds a new world and clears active sessions and
pending rewards without checking obligations. It also starts a fresh applied
ledger. That would discard unpaid work and permit historical reward identities
to lose their payment protection. The implementation now guards replacement and
carries the existing applied records, without transferring unsettled sessions.
An additional parent probe confirmed that an active workout is cleared by a
successful transition. A later real session-host probe also exposed a separate
transition failure: world replacement cleared the gameplay lease before the
host could renew it and write the command receipt. The transition now preserves
validated leases/receipts; world clock initialization and accrual rules do not
change. The new regression covers the sequenced command, restart/replay and
optional feedback after transition.

## Settlement flow

`FINALIZE_WORKOUT` resolves the active session, or an explicitly named paid
historical locked session. `runWorkoutRewardPipeline` dispatches a defined lock
to `settleLockedWorkout`; absence continues to mean the unchanged legacy path.

`applyLockedCompletionReward` validates the lock against the session, checks
actual mandatory prescribed repetitions/durations and terminal completion, then
reads **lock.soldiers**. Snapshot arithmetic is checked by the R1-C contract;
current world policy, catalog, readiness and fitness are never used to reprice.
No PhysicalResult is manufactured. Existing application-result metadata marks
the source as `workout-completion.v1` / `reward-units.v1`, with zero physical
output because physical output is not the source of this reward.

Both old and new paths share application authorization, safe-integer overflow
checks, clone/invariants, bank credit, result recording and replay. The new
application ID is the existing stable entitlement ID, independent of policy
revision. A session cannot receive another application under a different ID.
The legacy conversion cap is unchanged; it is not imposed on an independently
validated new-policy entitlement. Zero rounded entitlements remain valid.

Incomplete or abandoned workouts do not pay. Application failure leaves the
unpaid canonical session available for retry and blocking replacement/transition;
it does not synthesize a legacy pending reward. Existing pending rewards keep
their original identities, amounts and retry path.

## Feedback and permanent fitness

Payment does not require feedback and does not fabricate fitness evidence.
Completed locked sessions remain terminal and available for older clients'
unqualified finalize/feedback requests. Once paid they may be replaced normally.
The existing workout-history JSON payload gains optional `sessionSnapshot` and
`rewardSettlement` audit fields. These retain the terminal facts, pause data,
authored reference, lock and original ledger result for later feedback/retries.
They are not a second payment ledger or a paid flag.

Both commands accept optional `parameters.sessionId`. After replacement or a
campaign change, only a matching paid ledger record permits a historical locked
snapshot to be targeted. Historical feedback does not replace a newer active
session. Same-value feedback retries are idempotent; changing submitted feedback
still fails. Feedback invokes existing fitness and authored-progression rules,
without invoking soldier application. Previously evaluated history evidence
deduplicates fitness application across retries/reloads. Late feedback preserves
the original completion timestamp and cannot rewind the estimate's clock.
The existing workout-based invasion protection stamp is set on first successful
settlement even without feedback. Feedback, settlement retries and historical
feedback after a campaign change cannot refresh it. Targeted pre-fix probes
reproduced both missing protection before feedback and new-world protection
granted by historical feedback; the dedicated regression prevents both.

Missing feedback yields no invented progression. If current catalog availability
prevents authored progression, raw workout facts and valid evaluated evidence
remain in history; this phase does not reconstruct or invent removed content.
Existing specialized and legacy feedback/evaluation rules remain unchanged.

## Atomicity and exactly once

Production commands retain the existing session-host boundary: cloned command
state, canonical command receipts, serialized commands and optimistic world CAS.
Supabase's existing `RoutingHistoryStore` buffers history upserts for the same
`commit_authoritative_player_world` transaction as world/bank/ledger changes.
No SQL, database table, RPC or independent service was added. Memory persistence
retains its history backup and rollback behavior.

The ledger alone determines payment. Duplicate finalizations restore its original
result. Original completion ticks and settlement audit snapshots are preserved
on replay. Changed lock terms cannot overwrite the original history snapshot.
Paid identities survive world transition, including legacy records. New worlds
still initialize their bank and world-bound effects under existing rules; this
phase does not redesign already-settled resource carryover.

The focused tests exercise same-host concurrency, receipt replay after a lost
response, different command IDs, restart, snapshot hydration, stale CAS, failed
world saves, buffered atomic-history failure and late-feedback rollback. Injected
transaction failures prove local coordination behavior; they are not a substitute
for a live Supabase transaction test.

## Campaign transition

`evaluateWorldTransition` hides eligibility while the shared workout-obligation
guard blocks. `buildNextWorldState` rejects before replacing any state when there
is an active/paused workout, an unpaid completed workout, or any pending reward.
This covers legacy and new-policy obligations. Direct build, orchestrated and
persistent transition paths use the same builder. Abandoned terminal sessions
without pending rewards do not block. Paid completion does not require optional
feedback before transition. No timer, cooldown or inter-world entitlement transfer
was introduced.

## Compatibility and scope

- GameState remains schema **29**. No new GameState field or migration is needed.
- History additions are optional fields in the existing JSON payload; old rows
  and existing application records remain readable.
- The active-session/command contracts gain historical session targeting. No
  Unity changes or client-controlled entitlement terms were introduced.
- Production worlds still need approved explicitly authored reward policies and
  authored workout sizes before fresh normal starts can succeed. No production
  ratios, world content or catalog entries were invented.
- C1 defense power accounting, C2 identities and C3 RNG authority are unchanged.
- No combat, AI, resource/logistics, reward-unit, fitness-coefficient or time-rule
  changes were made. Legacy and specialized rewards retain their calculations.

## Regression coverage and validation

44 new R1-E tests cover all three sizes, fixed-point payout, high-ratio payout
outside the legacy cap, incomplete/abandoned work, mandatory-work validation,
feedback independence and later submission, original-term preservation, retries,
CAS, restart, rollback, campaign guards, legacy pending settlement, specialized
isolation, history round trips/bindings, wrong-player rejection and determinism.
The R1-D test that expected settlement to remain disabled now expects the exact
locked payment while retaining its unpaid-session replacement assertions.

Personally rerun on Node **24.19.0**:

- Explicitly awaited C1/C2/C3/R1-C/R1-D/R1-E: **176 passed / 0 failed**
  (16 + 17 + 14 + 46 + 39 + 44); no credential-gated tests in this focused run.
- Final full backend runner: **2,092 reported passed / 0 failed**, including
  **3 credential-gated skips** (2,089 non-skipped reported cases). This is the
  R1-D baseline of 2,048 plus 44 new R1-E tests; no tests were deleted.
- Production TypeScript emitting build and `--noEmit`: **PASS**.
- Test-inclusive compile: **28 inherited diagnostic identities**, identical to
  a fresh parent compile after removing source coordinates; no new/removals.
- Current-change whitespace check: **PASS** before checkpoint.

The first intermediate full run passed **2,076 / 0** with the initial 28 added
cases; subsequent runs passed **2,090 / 0** with 42 and **2,091 / 0** with 43.
They are superseded by the final run including the protection-timing regression.
Their three live credential checks were skipped. The old runner includes those skip-return cases in its
reported pass count; they are not claimed as executed database coverage.

Reproduction:

```sh
node node_modules/ts-node/dist/bin.js --project tsconfig.tests.json --transpile-only tests/run.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc
node node_modules/typescript/bin/tsc --project tsconfig.tests.json --noEmit
git diff --check
```

Focused scripts, parent/final compiler diagnostics and test logs are retained
outside Git at `/tmp/repwars-r1-e/`. No external data was modified. All earlier
worktrees/checkpoints remain preserved. R1-F, Unity integration, production policy
authoring and live credential validation were not begun.

## Changed files

Production:

- `src/fitness/history/persistSession.ts`
- `src/fitness/history/record.ts`
- `src/fitness/history/types.ts`
- `src/fitness/session/summary.ts`
- `src/gameplay/workoutStart.ts`
- `src/gameplay/worldTransition.ts`
- `src/orchestration/commandIndex.ts`
- `src/orchestration/gameplayCommands.ts`
- `src/rewards/application/apply.ts`
- `src/rewards/pipeline/runWorkoutRewardPipeline.ts`
- `src/rewards/pipeline/settleLockedWorkout.ts` (new)

Tests: `tests/run.ts`, `tests/workoutStartRewards.ts`, and
`tests/workoutSettlementRewards.ts` (new). Documentation: this report (new).
