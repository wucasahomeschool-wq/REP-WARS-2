# R1-F — Workout reward API and Unity handoff

**Backend contract implemented; Unity integration NOT implemented or validated.**
This is the explicitly permitted backend-only fallback, not full R1-F completion.

Parent: `26aea031e401a35eb8c185a6cd8613449374be48`, schema 29.
Worktree: `/workspace/REP-WARS-2-R1-F`.
Branch: `feat/r1-f-workout-reward-api`.

## Verified existing behavior and gaps

- R1-D START_WORKOUT already returns `completionRewardEntitlement` and an
  authoritative selection. `serializeActiveWorkout` already returns that same
  persisted lock on GET_GAME_STATE, including after reload.
- R1-E finalization already returns `applicationId`, `amountOrEffect`, current
  `bankedTroops` and `alreadyProcessed`. Payment is independent of feedback.
  The existing ledger restores the original result on retry. Terminal snapshots
  in workout history permit later feedback using an explicit session ID.
- There was no public historical reward read command and no common paid/unpaid
  representation across start, progress, finalization and reconnect responses.
- `Unity/Assets/RepWars/PublicGameState.cs`, `PublicActiveWorkout`, has no locked
  reward or settlement fields. `PublicGameplay.bankedTroops` is Int32.
- `RepWarsPlayLoop.StartWorkout`, `SendFeedback`, `FinishWorkout` and
  `FinalizeWorkout` in `Unity/Assets/RepWars/RepWarsPlayLoop.cs` drive the current
  flow. FinishWorkout submits fabricated ABOUT_RIGHT feedback before finalizing.
  FinalizeWorkout substitutes `bankedTroopsAfter` when `amount == 0`, which can
  misreport a valid zero reward as the entire bank. It does not deduplicate
  reward presentation by application identity.
- `RepWarsGameInterface.DrawWorkout` in
  `Unity/Assets/RepWars/RepWarsGameInterface.cs` gates FINISH behind the feedback
  branch (feedback/FINISH rendering around lines 189–201 in this pinned source).
- `RepWarsApiClient.PostBoundCommand`, `RepWarsGameplaySession.SubmitMutation`
  and `RepWarsPlayLoop.PostMutating` already preserve mutation identity and
  distinguish stale, conflicting and replayed commands. Reuse them.

Only the Unity source present at the pinned checkpoint was inspected. The active
Windows development checkout and its unrelated uncommitted changes are not
available here. No Unity executable, C# compiler or Unity test environment was
found. No Unity files, scenes, assets, settings, HUD, fonts or map code changed.

## Shared backend presentation contract

`WorkoutRewardView` is defined in `src/rewards/workoutRewardView.ts` and exported
as a type from `src/index.ts` and `src/rewards/index.ts`.
Its `formatVersion` is `workout-reward-view.v1`.

| Field | Meaning |
|---|---|
| `sessionId`, `workoutId`, `purpose` | Server-resolved workout identity and purpose |
| `mode` | `LOCKED_COMPLETION`, `LEGACY`, or `SPECIALIZED` |
| `workoutState` | Current canonical/terminal workout state |
| `workoutSize` | Persisted authored size when known; otherwise null, never inferred |
| `completionRewardEntitlement` | Exact original R1-C lock, or null for legacy/specialized |
| `status` | `NOT_EARNED`, `AWAITING_SETTLEMENT`, `PENDING_RETRY`, `SETTLED`, or `UNKNOWN` |
| `canFinalize` | Active-session completion/feedback prerequisites are satisfied and no ledger payment exists; live domain context is still revalidated by FINALIZE |
| `canSubmitFeedback`, `feedbackState` | Feedback capability/state, independent of soldier payment for locked sessions |
| `currentBankedTroops` | Current canonical balance at this response's observation |
| `settlement` | Null unless the existing ledger has a matching application |

The existing lock contains authoritative size, 60/100/145 base units, promised
soldiers, policy version/revision/fixed-point ratio, catalog identity and origin
world identity. No duplicate calculation or client-supplied terms are introduced.

Settlement is a projection of the ledger only:

```ts
{
  applicationId: string;
  kind: GameRewardKind;
  appliedAtTick: number;
  amountOrEffect: AppliedEffectSummary;
}
```

For `kind === 'TROOPS'`, `amountOrEffect.amount` is the actual credited amount
and `amountOrEffect.bankedTroopsAfter` is the original resulting balance.
`currentBankedTroops` can legitimately differ after spending or world transition.
**Zero is a valid amount. Never substitute either balance for zero.**
Construction, Golden Yield and Defense use their existing effect summaries and
are never labeled ordinary soldier payouts. Legacy normal workouts have no new
promise and retain their existing conversion and feedback requirements.
Historical completions without a retained ledger record are `UNKNOWN`, with no
settlement or claim capability. Pre-R1-E campaign transitions could discard the
ledger. A history audit field cannot prove that such a workout was paid or create
a new right to payment. No historical result or amount is invented.

## Response locations and historical lookup

The same DTO appears at:

- START_WORKOUT: `payload.workoutReward`; the existing top-level lock/selection
  fields remain unchanged.
- RECORD_EXERCISE, SKIP_REST, PAUSE_WORKOUT, RESUME_WORKOUT, ABANDON_WORKOUT,
  RECORD_INTEGRITY_FLAG: `payload.workoutReward`.
- FINALIZE_WORKOUT and SUBMIT_WORKOUT_FEEDBACK: `payload.workoutReward`;
  existing settlement and feedback fields remain available. A failed application
  returns an unpaid DTO, never a fabricated success.
- GET_GAME_STATE: `payload.gameState.playerGameplay.activeWorkout.workoutReward`.
- New GET_WORKOUT_REWARD: `payload.workoutReward`.

Historical read request:

```json
{
  "commandId": "GET_WORKOUT_REWARD",
  "playerId": "resolved-player",
  "requestId": "reward-read-1",
  "parameters": { "sessionId": "previously-returned-server-workout-session-id" }
}
```

The route resolves only the caller's active session or caller-scoped existing
workout history. No raw history, prescribed performance records or fitness
evaluation data are returned. Missing and foreign sessions produce the same
`WORKOUT_SESSION_INVALID` error. Invalid/missing identifiers do not silently
select the active workout. This read does not settle, save an existing world,
renew a gameplay lease, consume RNG or allocate command sequence numbers.

After a new workout or campaign replaces the active session, a known session ID
still retrieves the original promise and ledger result. This is an explicit
resource lookup, not a paginated history browser. The Unity client should retain
the server-issued workout ID across reconnects; GET_GAME_STATE recovers it while
the terminal/active session remains current. No new history-list service exists.

## Errors and security boundary

Missing authored workout size/catalog identity, missing world content, and a
missing/invalid reward policy now use public domain code
`WORKOUT_CONFIGURATION_UNAVAILABLE` with constant safe messages. Configuration
values/internal exception text are not exposed. The START_WORKOUT command catalog
documents this code. State identity inconsistencies remain internal failures.
Malformed world content may also be rejected earlier by existing bootstrap or
hydration validation; those failures retain the existing safe persistence error.

**Pre-existing authentication limitation:** `src/server/identity.ts`,
`resolvePlayerId`, still validates a body-supplied player ID rather than an
authenticated principal. Scope tests prove that session IDs and parameter fields
cannot select a different player's history under the resolved identity. They do
not prove protection against impersonating that identity through the development
HTTP gate. Production deployment requires authenticated server-resolved identity.
This phase does not introduce or claim an authentication system.

The existing applied ledger remains the sole payment authority. History's audit
copy cannot mark a reward paid. The DTO is derived, contains detached data and
does not add a paid flag, schema field, bank, service or ledger. Schema remains 29.
No ratio, catalog, settlement calculation, readiness, progression, battle,
campaign protection, AI, logistics or timing rule is changed.

## Exact Unity implementation handoff — not performed here

1. Review the actual active Unity checkout and preserve its unrelated work. Make
   a fresh isolated integration candidate; do not replace the inspected files
   wholesale or create another Unity project.
2. Extend DTOs in PublicGameState.cs and RepWarsApiClient.cs to read the new nested
   view and lock. Use Int64 (`long`) for soldier amounts, bank totals, reward units
   and fixed-point ratio, not current Int32 fields. Supported server values are
   safe integers up to 2^53−1; never convert quantities through float/Int32.
   Treat nullable fields by mode/kind and nested-object presence. No client math.
3. In RepWarsPlayLoop.StartWorkout and reconnect/RefreshState, display the exact
   locked soldier promise for LOCKED_COMPLETION. Do not infer size or rewards.
   A completed unpaid view offers settlement independently of feedback.
4. In FinishWorkout and the RepWarsGameInterface workout branch, remove automatic
   ABOUT_RIGHT submission for locked sessions. Offer actual feedback separately.
   Preserve legacy/specialized requirements and the live Defense context.
5. In FinalizeWorkout, display TROOPS `amountOrEffect.amount`, even when zero;
   display other kinds' effects using purpose-specific messaging. A settled
   snapshot is a static receipt, not a new grant.
6. Persist the last server workout session ID for recovery after replacement and
   send it explicitly on FINALIZE_WORKOUT, GET_WORKOUT_REWARD and later feedback.
   Do not let a newly active workout receive feedback intended for an old one.
7. Continue using existing mutation sequencing and retry transport. On replay,
   `idempotentReplay` means the original response; `alreadyProcessed` additionally
   identifies a repeated settlement. Deduplicate animations by `applicationId`,
   across reconnects, and never animate merely because a read is SETTLED.
   After stale/conflict responses reconcile with reads; do not mint a new payout.
8. Preserve raw request identity during lost-response retries. Receipt replay can
   carry an older observed bank/state. Read fresh state rather than overwriting
   it with an old receipt or recomputing rewards locally.
9. Surface configuration messages without falling back to a guessed reward or
   production ratio. Keep current HUD/layout/font/map/settings work intact.

Required Unity execution before full R1-F approval: EditMode DTO/Int64/zero/effect
tests; PlayMode unpaid completion without feedback; reconnect, late feedback,
restart and replay animation deduplication; legacy/specialized flows; mobile HUD
smoke checks in the current Unity project. **Zero Unity tests were run here.**

## Backend validation

32 new tests in `tests/workoutRewardApi.ts` use the real session host and several
real HTTP routes/final JSON bodies. They cover all sizes, progress, paid/unpaid
states, optional feedback, large/zero quantities, historical recovery, policy
changes, stale/duplicate/lost responses, caller-scoped lookup, forged fields,
legacy/specialized modes, configuration failures and immutable projections.

- Explicitly awaited C1–C3 and R1-C–F: **208 passed / 0 failed**, no skips
  (16 + 17 + 14 + 46 + 39 + 44 + 32).
- Final full backend suite: **2,124 reported passed / 0 failed**, including
  **3 credential-gated skips** (2,121 non-skipped reported cases). This is the
  R1-E baseline of 2,092 plus 32 new API tests; no tests were removed.
- Production TypeScript build and `--noEmit`: PASS.
- Test-inclusive compilation: the same 28 inherited primary diagnostic identities;
  no new/removals. Two existing diagnostics have reordered union alternatives in
  nested explanatory text, not changed errors or source behavior.
- Current-change whitespace check: PASS before checkpoint.

The first full run reported 2,122 passed / 1 failed because the invalid-policy
fixture attempted hydration while its registered world definition remained
malformed. The fixture now restores valid content before inspecting persisted
state; no production validator was weakened. Final results supersede that run.

Reproduce with `tests/run.ts` through the existing ts-node runner and production
`tsc --noEmit` / `tsc`. Awaited focused scripts, diagnostics and logs are in
`/tmp/repwars-r1-f/`, outside Git. No credentials or external data were changed.

## Remaining blockers and checkpoint scope

Full R1-F is blocked by the unavailable Unity environment and unavailable current
Windows development workspace. Client changes/tests above remain unimplemented.
Production identity authentication and approved production world ratios/authored
content remain separate prerequisites; no such values were invented here.

Changed backend paths: `src/rewards/workoutRewardView.ts`,
`src/orchestration/publicView.ts`, `src/orchestration/gameplayCommands.ts`,
`src/orchestration/handlers.ts`, `src/orchestration/commandIndex.ts`,
`src/orchestration/errors.ts`, `src/server/allowlist.ts`,
`src/gameplay/workoutStart.ts`, `src/rewards/index.ts`, `src/index.ts`.
Tests: `tests/workoutRewardApi.ts`, `tests/run.ts`. Documentation: this report.
Unity and all earlier worktrees/checkpoints remain unchanged. No push, merge,
deployment or R1-G work is authorized by this checkpoint.
