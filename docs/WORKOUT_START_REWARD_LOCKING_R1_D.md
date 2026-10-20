# R1-D — Authoritative start-time workout reward locking

## Baseline and audit

Parent: `942cec126859628108f4f42305f546694f61a1ed`, branch
`feat/r1-c-workout-reward-contracts`, GameState schema **29**.
Worktree: `/workspace/REP-WARS-2-R1-D`.
Branch: `feat/r1-d-workout-reward-locking`.

The parent was clean and verified before creating this isolated worktree.
R1-C was read directly, including its policy/entitlement contracts, session
cloning, history persistence, canonical invariants and migration. Its report is
`docs/WORKOUT_REWARD_CONTRACTS_R1_C.md`.

Audit findings on the actual parent implementation:

| Area | Finding | R1-D action |
| --- | --- | --- |
| Automatic selection | Existing authored selection checks the progression window and movement-specific readiness. | Reuse it. |
| Explicit IDs | `resolveStartWorkout` could return an authored workout without checking eligibility. The tutorial branch could also resolve an authored/legacy ID collision. | Check every resolved authored definition at the common start boundary using `eligibleAuthoredWorkouts`. |
| Legacy content | Legacy workout definitions have no authoritative size; registered production worlds have no reward policy. | Reject fresh normal starts without the required server content. No inferred size, default ratio or legacy payout fallback. |
| Workout identity | The old start path accepted a client session ID or derived one from the session clock. | New normal IDs use existing durable gameplay lease/command identity. |
| Replacement | COMPLETED did not necessarily mean paid, but a new start could replace it. | Reject pending rewards and unpaid completed sessions, including legacy sessions. |
| Settlement | The existing finalizer calls the legacy PhysicalResult reward pipeline. | An admission guard keeps entitled sessions out of that path until R1-E. No formula, ledger or legacy finalization algorithm changes. |
| Campaign transition | `carryPlayerScopedFitness` explicitly clears `activeSession` and `pendingReward`; `buildNextWorldState` invokes it. | Report the adoption blocker. Do not change campaign behavior in R1-D. |

## Authoritative start flow

`CommandRequest → session-host receipt gate → Orchestrator draft →
handleStartWorkout → canonical invariant check → session/receipt CAS` remains
the authority path. There is no new economy store, allocation counter or ledger.

For a new NORMAL_TROOPS start:

1. Enforce existing tutorial rules and reject an active workout, unpaid
   completed workout or pending reward.
2. Resolve the definition using the existing selector/registry. Check the
   resolved authored workout's actual size against the existing movement
   requirements and authored progression window, including explicit IDs.
3. Require an existing server-issued gameplay session and valid monotonic
   command sequence. Build the workout session identity from
   `['playerId', 'gameplaySessionId', commandSequence]` values, encoded as a JSON
   tuple after the fixed `wses_reward:` namespace. Client workout `sessionId`
   and `now` do not allocate this identity. The gameplay lease UUID is already
   canonical state; no new UUID or authoritative counter is consumed here.
4. Build the workout session using the existing prescription/session domain.
   Use its server-resolved authored catalog metadata, not client size assertions.
5. Resolve the current world by canonical `definitionWorldId` through the
   server catalog, verify its identity, and require R1-C's validated authored
   policy. Reuse `createCompletionRewardEntitlement` and its checked BigInt
   arithmetic. SHORT=60, STANDARD=100, LONG=145; no additional multipliers.
6. Attach the frozen entitlement to the session before assigning that session
   to the canonical draft. The session and lock commit together.
7. Return a copied lock in START_WORKOUT. Existing R1-C owner-facing active
   session projection and persistence cloning retain the same terms.

All authoritative ratio data comes from the server's authored world catalog.
There is no new runtime approval flag: content approval remains the existing
server content-deployment responsibility. R1-D authors no production ratio.
The 1,250,000-micro ratio in new tests is explicitly synthetic fixture content.
No production world JSON or workout catalog content changed.

An explicit workout ID may legitimately differ from a client `size` preference;
the actual resolved workout's size wins. The returned selection size now also
uses authored metadata rather than echoing the client's preference.

## Identity, retry and transaction protection

The existing session host owns command replay, monotonic sequence checks,
renewal and CAS. A lost-response retry returns the committed receipt, including
the original lock, before reading changed workout/world configuration. Stale
sequences cannot mint another entitlement. A CAS loser reloads and cannot
replace the winner with a differently priced lock. Missing policy, ineligible
workouts, post-lock invariant failure and failed persistence leave no committed
session/lock or consumed allocation counter. Retrying the same canonical
lease/command identity yields the same workout ID.

R1-C's entitlement ID still depends only on player/workout-session identity;
policy revision/version and calculated amount never create another payment
identity. Existing ledger entries and reward IDs are not rewritten.

Known active, pending, applied, compact-history, progression and configured
history-store identities cannot be reused. The server namespace is unavailable
to client-selected specialized workout IDs. Specialized defaults can collide
when the old session clock has not moved; a deterministic free suffix is found
from existing canonical/history references instead of imposing a time gate.
Defense attachment and response both use that final allocated identity.
The normal-workout identity guarantee uses durable lease/sequence authority,
not suffix allocation or a history-derived new counter.

## Purpose separation and phase boundary

DEFENSE, EXTRA_CONSTRUCTION_WORKERS and GOLDEN_YIELD receive no ordinary
soldier entitlement. Their existing purpose/context checks and effect formulas
remain in place. Defense still requires a fresh qualifying session bound to an
open invasion and the inclusive existing 30-minute start deadline; its
completion window may extend beyond that deadline. C1 temporary-power troop
accounting, C2 army identity and C3 battle RNG implementations are unchanged.

An entitled workout can record exercise progress, pause/resume, finish and
submit feedback without changing its lock. **FINALIZE_WORKOUT for that session
is intentionally rejected pending R1-E**, before the legacy pipeline is called.
No banked soldiers, pending payout or applied-ledger row is created for it in
this phase. The legacy converter/application pipeline is unchanged and is not
a new-policy settlement API. Existing active legacy workouts and pending
rewards still use their original amounts and identities, including retry.

Abandoned workouts remain ineligible for completion payment and can be
replaced. Completed unpaid workouts cannot be abandoned or replaced to lose
the source record. The single active-workout slot is not redesigned. Until
R1-E, an unpaid completed lock therefore blocks another workout, including a
fresh specialized start. This is an intermediate checkpoint, not an activation
or production-readiness claim.

## Compatibility and known adoption blockers

- Schema remains **29**; no persistence shape, SQL/RPC or migration change.
- New normal starts require the existing gameplay-session/command-sequence
  envelope. Legacy specialized clients retain their context-specific behavior;
  known/restricted workout IDs are rejected, and default collisions get a free
  suffix. New normal clients must use the returned server workout ID.
- Fresh normal starts using currently size-less legacy/tutorial workouts or
  worlds without authored policy fail explicitly. Existing stored sessions
  remain valid. Selection can still display legacy content; displaying it
  does not provide the missing authoritative size or ratio.
- Existing active locks retain their origin world/policy/catalog snapshots.
  Changing global definitions or movement readiness does not reprice them
  during progress, reconnect, hydration or receipt replay.
- **Campaign carryover remains a blocker.** An independent temporary probe
  passed a valid locked session and a genuine legacy pending reward through
  the actual `carryPlayerScopedFitness` function. Both destination fields were
  null afterward. Source objects were retained; the transition destination
  discards them. No transition code was edited. Resolve this before adoption.
- R1-E must implement full-completion-only settlement through the existing
  applied ledger and atomic world/history boundary, credit banked troops,
  preserve optional-feedback independence and check bank-total arithmetic.
  Approved world ratios and authoritative workout-size content must be
  supplied separately. R1-D does not implement those later capabilities.

## Tests and evidence

New tests in `tests/workoutStartRewards.ts` exercise actual commands,
session-host persistence/receipts and a real HTTP route. Its asynchronous cases
are explicitly awaited in sequence, with scoped fixture catalog installation.

Coverage includes all sizes; half-up boundaries; forged client terms/size/ID;
missing/malformed world policy; size-less legacy content; explicit readiness
and progression-window rejection; tutorial-ID collision; immutable progress;
policy/catalog/readiness changes; full-state deterministic replay; hydration;
lost responses; stale commands; competing hosts/CAS; failed transactions and
failed saves; unapplied and pending legacy sessions; exactly-once legacy
finalization; fresh identities after abandonment; specialized isolation;
defense deadlines and identity binding; telemetry order; and final wire output.

Existing legacy payout/progression tests now seed explicit pre-R1-D sessions
using `tests/legacyWorkoutFixture.ts`, then execute real progress/finalization
and persistence commands. The helper creates no entitlement or reward and does
not impersonate START_WORKOUT. These cases are labeled legacy compatibility.
Generic current-start/receipt and telemetry coverage uses specialized workouts
where no soldier payout is under test. Start telemetry assertions that cannot
apply to a historical-session fixture moved to a real new-normal start test.
No old test case was removed. The R1-C client-forgery case now expects rejection
when authoritative new-start data is absent, instead of a fresh legacy start.
C1's full defense pipeline fixture begins with an existing legacy normal
session; its defense and conservation assertions remain in place.

Validation at the final candidate:

- R1-D: **39 passed / 0 failed**.
- C1/C2/C3/R1-C: **16 / 17 / 14 / 46 passed**, **93 / 0** combined.
- Combined explicitly awaited focused run: **132 / 0**.
- Affected legacy/integration subset: **132 / 0** (overlapping coverage, not
  additional tests to add to the full-runner count).
- Final full backend runner: **2,048 reported passed / 0 failed**, exactly the
  2,009 parent cases plus 39 new R1-D cases. The runner includes **3 skipped
  credential-gated live Supabase checks** in its pass count; they were not
  executed against a remote database (2,045 non-skipped cases).
- Production TypeScript emitting build and `--noEmit`: **PASS**.
- Test-inclusive TypeScript: **28 inherited diagnostic identities**, compared
  against a fresh parent compile; no new or removed identities.
- Working-tree and staged whitespace checks: **PASS** before checkpoint.

The first full run before legacy-fixture adaptation reported 1,990 / 47.
Those failures exposed the old tests' assumptions about fresh legacy normal
starts and two JSON receipt assertions. They were not treated as pre-existing
failures or hidden with production fallbacks. An intermediate complete run
with 36 new cases passed 2,045 / 0 before the final three identity regressions.
The same-instant specialized-ID probe failed before its narrow allocation fix
and is retained as a deterministic regression.

Reproduction (Node 24.19.0; logs/probes in `/tmp/repwars-r1-d`, outside Git):

```sh
node node_modules/ts-node/dist/bin.js --project tsconfig.tests.json --transpile-only tests/run.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc
node node_modules/typescript/bin/tsc --project tsconfig.tests.json --noEmit
git diff --check
```

## Exact file inventory

Production:

- `src/gameplay/workoutStart.ts`
- `src/gameplay/workoutSelection.ts`
- `src/orchestration/gameplayCommands.ts`
- `src/orchestration/commandIndex.ts`
- `src/fitness/session/types.ts` (comment only)
- `src/rewards/completionPolicy.ts` (comment only)
- `src/rewards/completionEntitlement.ts` (comment only)

Tests:

- `tests/workoutStartRewards.ts`, `tests/legacyWorkoutFixture.ts`, `tests/run.ts`
- `tests/analytics.ts`, `tests/commandIdempotency.ts`
- `tests/defenseTroopAccounting.ts`, `tests/fitnessLibrary.ts`
- `tests/gameplaySessionLifecycle.ts`, `tests/serverRestartDurability.ts`
- `tests/gate1VerticalSlicePersistence.ts`, `tests/gate1VerticalSliceWorkout.ts`
- `tests/level1Production.ts`, `tests/level1Tutorial.ts`
- `tests/orchestratorIntegration.ts`, `tests/playerIdentity.ts`
- `tests/workoutPauseResume.ts`, `tests/workoutProgression.ts`
- `tests/workoutRewardContracts.ts`, `tests/workoutSelection.ts`

Documentation: this report only. No Unity, world geography, workout catalog,
combat, army allocation, AI, economy/logistics, world clock, campaign transition,
reward converter/application/pipeline or persistence infrastructure source changed.
