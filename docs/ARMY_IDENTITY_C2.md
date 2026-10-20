# C2 — Banked-attack army identity continuity

Base: C1 `67d3bfb490327d8875859f9a67610c99cbd5bf91`, parent
`6f38eec6516682e64937b08744a5607f54bbba91`.
Isolated branch/worktree: `fix/c2-army-id-uniqueness`,
`/workspace/REP-WARS-2-C2`. Original checkout and C1 are preserved.

## Reproduction before correction

Two invariant-valid regression scenarios failed on unmodified C1:

1. Create a banked attack army, delete another army, attack again with the same
   amount at the same world tick: `ACTION_NOT_ALLOWED: A committed attack army id collided`.
2. Delete the banked army instead, then create again: the retired ID
   `banked_iron_kingdom_0_101_2` was reused.

The old suffix was `state.armies.size`, a live population count rather than a
durable allocation sequence. Neither simulation tick nor committed quantity
distinguishes these cases. Save/reload preserves the same flaw; distinct request
IDs do not correct it. Session receipts prevent repeated logical execution but
do not make separate commands' generated identities unique.

IDs are referenced by faction army lists, moving/attacking forces, operation
plans and force claims, invasion participants, conflict receipt identities and
fingerprints, and persisted command responses. Removing an army does not make
all such historical references disappear.

## Creation-path audit

- `src/gameplay/attacks/commitBankedTroops.ts`: affected runtime creator; corrected.
- `src/worldDefinition/instantiate.ts`: local `armySeq` creates authored-world
  starting armies once in a fresh map (`army_1`, etc.); no count-based runtime reuse.
- `src/simulation/SampleMap.ts`: deterministic faction-based starting identities
  in a fresh legacy/sample snapshot; no runtime allocator.
- `src/orchestration/applyEvents.ts`: merges disposable event army output; the
  current event simulator updates existing armies, rather than allocating armies.
- `src/gameplay/recruitment/reinforcement.ts`: transfers local troops to an
  existing army/garrison; does not form armies in this baseline.
- Factual-support maps and clone/hydration paths copy entities, not new identities.

Separate unintegrated military-recovery development is not part of this checkout
and was not imported. Any future runtime formation path should use the shared
army allocator in its authoritative transaction.

## Correction and compatibility

GameState schema **28** adds one required `nextArmySequence` high-water mark.
`allocateArmyId` produces opaque `army:v1:<sequence>` IDs and increments the mark
inside the existing draft transaction. It uses no tick, quantity, map size, wall
clock, RNG or process state. Exhaustion and active collision fail closed. No
allocation authority exists outside canonical GameState.

An AI commitment sequence has different identity semantics; the last-command
receipt is deliberately bounded. Neither is repurposed as an army counter.

The counter is initialized by canonical factories, copied by transaction cloning
and adoption, serialized by existing persistence, and retained across campaign
transitions. A rejected draft rolls back its allocation, force and bank debit.
Concurrent drafts may propose the same next ID; CAS commits one, and a stale
writer must reload before allocating the subsequent ID. Existing production
session receipts return the original result on duplicate delivery.

Schema 27 and older supported saves migrate forward without renaming existing
armies or reconstructing historical entities. The new namespace is distinct from
all IDs emitted by the old creators. Migration initializes the mark at zero (or
retains a supplied valid higher mark), flooring any imported active IDs already
in the reserved namespace. Current-schema missing, malformed or below-active-ID
marks are rejected rather than reset. Existing schema-27 command receipts still
replay their legacy IDs after migration.

This is a persistent JSON shape change, not a SQL table/RPC change. The envelope
already stores an integer schema version and canonical payload. No live save or
database was modified here. Older schema-27 runtimes reject schema-28 payloads;
deployment/rollback must respect that forward-version boundary.

No combat, C1 settlement, reward, economy, AI policy, workout, timing, geography or
Unity behavior was changed. Prior ambiguous historical identity reuse is not
retroactively reconstructed. Starting-world IDs retain their existing world scope.

## Regression coverage

17 new tests exercise live collision and retired reuse; multiple same-tick
creations; troops/bank/resources/claims conservation; identical replay; independence
from insertion order and clock; reload after deletion; old-schema migration and
idempotence; imported identity floors; corrupt-current-state rejection; exhaustion;
post-allocation rollback; competing CAS writers; lost response/restart; preserved
campaign sequence; actual consecutive battle losses; and migrated legacy receipt
replay followed by another attack.

C1's three production files and its 16 regression tests are byte-identical to C1.
Existing tests change only for the new required fixture field, current schema
expectation, documented state-key set and opaque-ID retry assertion.

## Exact file scope

Production/tooling:

- `src/army/identity.ts`
- `src/gameplay/attacks/commitBankedTroops.ts`
- `src/gameplay/worldTransition.ts`
- `src/persistence/versioning.ts`
- `src/simulation/cli.ts`
- `src/state/cloneGameState.ts`
- `src/state/createGameState.ts`
- `src/state/gameStateInvariants.ts`
- `src/types/GameState.ts`
- `src/worldDefinition/instantiate.ts`

Tests:

- `tests/armyIdentity.ts`
- `tests/armyMovement.ts`
- `tests/strategicAttack.ts`
- `tests/run.ts`
- `tests/commandIdempotency.ts`
- `tests/aiCognition.ts`
- `tests/aiConflict.ts`
- `tests/aiPeace.ts`
- `tests/aiRecruitment.ts`
- `tests/aiResponses.ts`
- `tests/aiStrategicPressure.ts`
- `tests/aiTrade.ts`
- `tests/economyFoundation.ts`
- `tests/gameplaySessionLeases.ts`
- `tests/gameplaySessionLifecycle.ts`
- `tests/invasionLifecycle.ts`
- `tests/leaseWorldAccrual.ts`
- `tests/persistence.ts`
- `tests/presenceLeases.ts`
- `tests/sessionReplay.ts`
- `tests/temporalBoundaries.ts`

Documentation: this file, `docs/ARMY_IDENTITY_C2.md`.

## Validation

- C2: **17 passed / 0 failed**.
- C1 defense accounting: **16 passed / 0 failed**, including its 128-seed matrix.
- Combined focused run: **33 passed / 0 failed**.
- Complete backend runner, including army, attack, orchestration, persistence,
  migration, session, retry and world-transition tests: **1,949 reported passed /
  0 failed**. Three live Supabase checks were credential-gated skips counted as
  passes by the existing harness: **1,946 executed / 3 skipped**. The total is
  C1's 1,932 plus 17 new tests, with no test removals.
- Production TypeScript build (`node node_modules/typescript/bin/tsc`): **PASS**.
- Test-inclusive TypeScript: the same **28 inherited diagnostics** as a fresh
  C1 compile, exactly equal after four known fixture/import line offsets.
- `git diff --check`: **PASS**.
- Original and C1 checkouts remain clean and at their original commits; C1
  settlement source and regression file have no diff.

The first complete run found the state-domain shape assertion needed the new
field. It was updated, two further regressions were added, and the complete
runner was rerun successfully. No gameplay assertions were removed or relaxed.

Local logs and before-fix reproduction evidence reside outside the repository
in `/tmp/repwars-c2/`, excluded from the checkpoint. No live database writes or
SQL migrations were performed.
