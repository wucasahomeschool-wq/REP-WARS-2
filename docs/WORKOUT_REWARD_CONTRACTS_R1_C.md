# R1-C — Workout reward data contracts and persistence

## Scope and provenance

Parent: C3 `68d566063cffc237281acfd2bbc4a69ef207b21d` (schema 28).
Isolated branch: `feat/r1-c-workout-reward-contracts`.

This checkpoint adds inert contracts. It does **not** lock rewards in
START_WORKOUT, change the existing PhysicalResult conversion, finalize or pay
entitlements, alter feedback requirements, or change specialized effects.
The existing applied-reward ledger remains the only settlement authority.
C1 temporary defense accounting, C2 army allocation and C3 battle randomness
implementations are unchanged.

No checked-in R1-A audit was available in this environment. Its relevant
assumptions were checked directly against session creation/cloning, authored
catalog metadata, reward conversion/application, history adapters, world
loading/projection, snapshot/hydration and schema migration on C3.

## World policy and compatibility

`WorldDefinition.workoutRewards?: WorldWorkoutRewardPolicy`:

```ts
{
  version: 'workout-soldiers.v1',
  revision: string, // nonempty authored revision, independent of format version
  soldiersPerRewardUnitMicros: number // positive safe integer, millionths
}
```

There is no production default ratio. Existing registered worlds omit the
policy, remain valid, and retain legacy behavior. No world JSON changed.
`requireWorldWorkoutRewardPolicy` rejects absence; a future new-policy caller
must use an explicitly authored policy. A present malformed policy fails world
validation. Unknown policy keys, including workout-specific overrides, fail.
GET_WORLD_DEFINITION's existing JSON projection preserves this additive field;
the world format remains `rep-wars-world.v1`.

Pure constants are SHORT = 60, STANDARD = 100, LONG = 145. No difficulty,
duration, naming, readiness or universal fitness-score inference is used.
The fixed-point scale is 1,000,000 millionths per soldier/reward-unit ratio.
For nonnegative integer units U and positive integer ratio R:

```text
soldiers = (BigInt(U) * BigInt(R) + 500000n) / 1000000n
```

This is round-half-up for nonnegative quantities. Inputs must be safe integers;
output exceeding Number.MAX_SAFE_INTEGER is rejected before conversion to
Number. BigInt never appears in persisted JSON. A tiny explicitly authored
positive ratio may round to zero; no minimum grant or balance cap is invented.
The test ratio 1,250,000 is synthetic test data, not approved game balance.

## Entitlement and identity

`WorkoutSession.completionRewardEntitlement?` is a readonly
`CompletionRewardEntitlement` (`workout-completion.v1`) containing:

- player and session identity; NORMAL_TROOPS purpose;
- workout ID, catalog ID/version, explicit authoritative size and exact units;
- originating world ID, world format and level;
- policy version/revision, fixed-point ratio and calculated soldiers;
- stable logical entitlement identity.

The ID is `workout-completion:` followed by JSON encoding of the ordered
`[playerId, sessionId]` pair. Pair encoding avoids delimiter collisions. It
excludes policy version, revision, ratio, amount, workout and world metadata.
Future policy changes must not turn the same logical session into a second
payment identity. R1-C does not substitute this identity into the existing
applied-reward ledger or rewrite any historical reward ID.

The pure factory derives units and amount; neither is a caller-supplied term.
Validation rejects unsupported versions/purposes, missing/extra fields,
inconsistent arithmetic/identity and mismatched player/session/workout/catalog
bindings. When a session has authored catalog metadata, size and catalog
identity must agree. Legacy workouts are not assigned inferred sizes.

Factory/clone outputs freeze the entitlement and all three nested records.
Cloning revalidates and copies rather than mutating or aliasing source data.
The session property is readonly by TypeScript contract. Absence means LEGACY;
a valid defined value means LOCKED_COMPLETION; malformed values are rejected.

The origin world deliberately need not equal the current campaign world and
is not looked up to recalculate the entitlement during hydration. Catalog or
world policy updates cannot rewrite an already stored lock. This prepares for
campaign carryover without changing transition behavior in this checkpoint.

These are authored/persisted JSON contracts, not an executable-object HTTP
sanitizer or cryptographic attestation. Structural validation detects malformed
or inconsistent forged terms. A database actor capable of replacing all
self-consistent canonical facts remains outside this protection; canonical
state must remain trusted server storage. No public command accepts entitlement
terms. Actual server-only start-time minting is deferred to R1-D.

## Persistence and projection

GameState schema **29** introduces the optional session contract. Schema 28 and
older migrate without creating an entitlement. Existing armies, counters,
receipts, pending rewards and applied ledger records retain their values.
A pre-29 session purporting to contain this future field is rejected rather
than silently accepted or converted. Schema-29 malformed terms fail canonical
invariants before hydration or snapshotting. Migration is idempotent.

The active session clone, canonical clone, snapshot/JSON/hydration, owner-only
active-workout projection, terminal history conversion and history clone retain
the lock. History has an optional audit copy within the existing
`workout-history.v1` JSON payload; it is not another payout store. Existing
Supabase JSON payload mapping and atomic/CAS infrastructure need no SQL change.
Legacy session/history/public shapes omit the field rather than gaining a
fabricated null lock. Older runtime versions must not write schema-29 saves.

## Validation

- New R1-C regressions: **46 passed / 0 failed**.
- C1/C2/C3: **16 / 17 / 14 passed**, **47 / 0** combined, including C1's
  128-seed matrix, C3's 64-world-seed matrix and HTTP seed-authority coverage.
- Final focused run: **93 passed / 0 failed**.
- Final full backend runner: **2,009 reported passed / 0 failed** = C3's 1,963
  plus 46 new tests. Three credential-gated live Supabase checks were skipped
  and counted by the existing runner: **2,006 actually executed**, 3 skipped.
  Both complete runs passed, including the final export/fixture state.
- Production TypeScript: **PASS**, both `--noEmit` and emitting build.
- Test-inclusive TypeScript: **28 inherited diagnostic identities**, compared
  against a fresh C3 compile; none added or removed (locations may shift).
- Diff whitespace: **PASS**, including staged checks before checkpoint.

An additional read-only probe compared explicit-clock session construction
against the C3 worktree for all four purposes: all four were identical. This
does not claim new payout behavior or additional full-runner test cases.

Tests include all sizes, half-up boundaries, exact large intermediates,
overflow, malformed/missing policies, JSON world export, stable identity,
deep freeze/copy isolation, session/history/public round trips, memory and
Supabase-table adapters (in memory), schema-28 preservation with nonempty
receipts and pending specialized effects, pending-reward retry, malformed
persisted terms, stale CAS writers, ignored client entitlement parameters and
unchanged legacy finalization amounts/identity.

Commands (run from the isolated worktree; logs under `/tmp/repwars-r1-c`):

```sh
node node_modules/ts-node/dist/bin.js --project tsconfig.tests.json --transpile-only tests/run.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc
node node_modules/typescript/bin/tsc --project tsconfig.tests.json --noEmit
git diff --check
```

The focused run registers `registerWorkoutRewardContractTests`,
`registerDefenseTroopAccountingTests`, `registerArmyIdentityTests` and
`registerBattleSeedAuthorityTests`, then awaits every registered test.

## Files and remaining work

Production contract/integration files:

- `src/rewards/completionPolicy.ts`, `src/rewards/completionEntitlement.ts`,
  `src/rewards/index.ts`, `src/index.ts`;
- `src/worldDefinition/types.ts`, `src/worldDefinition/validate.ts`;
- `src/fitness/session/types.ts`, `src/fitness/session/clone.ts`;
- `src/fitness/history/types.ts`, `src/fitness/history/record.ts`;
- `src/orchestration/publicView.ts`, `src/state/gameStateInvariants.ts`;
- `src/types/GameState.ts`, `src/persistence/versioning.ts`.

Tests: `tests/workoutRewardContracts.ts`, registration in `tests/run.ts`, and
mechanical current-schema expectation updates (28 → 29 only) in
`aiCognition.ts`, `aiConflict.ts`, `aiPeace.ts`, `aiRecruitment.ts`,
`aiResponses.ts`, `aiStrategicPressure.ts`, `aiTrade.ts`,
`commandIdempotency.ts`, `economyFoundation.ts`, `gameplaySessionLeases.ts`,
`gameplaySessionLifecycle.ts`, `invasionLifecycle.ts`, `leaseWorldAccrual.ts`,
`persistence.ts`, `presenceLeases.ts`, `sessionReplay.ts`,
`temporalBoundaries.ts`. Historical migration input versions remain unchanged.

This document is the only documentation change. No world/catalog JSON, SQL,
Unity, battle, army, AI, economy, timing, payout or fitness progression code
changed.

Before activation: obtain approved authored world ratios; implement server-only
start locking, full-completion-only exactly-once settlement through the existing
ledger and atomic world/history boundary, feedback-independent payment, and
campaign transition preservation. Those overall R1 requirements remain
unimplemented here by scope. R1-C introduces neither a payment endpoint nor an
additional entitlement settlement ledger. Do not begin R1-D automatically.
