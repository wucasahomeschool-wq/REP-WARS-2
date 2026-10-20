# C3 — Backend-owned battle randomness

Base: C2 `5f510813ace5571967706ed8697c22d8f3d3c355`, whose parent is
C1 `67d3bfb490327d8875859f9a67610c99cbd5bf91`.
Worktree/branch: `/workspace/REP-WARS-2-C3`, `fix/c3-battle-rng-authority`.

## Audit and reproduced exploit

Three production request reads authorized client-selected randomness:

- `resolveStrategicBattle` preferred `parameters.seed` over backend derivation.
- `startStrategicAttack` stored that override in a delayed attack intent.
- `executeAttack` forwarded it into immediate player-targeted invasions.

`paramNumber` accepted finite numbers and numeric strings. ATTACK's command
catalog explicitly advertised an override. HTTP passes JSON parameters to the
session host; it did not strip that field. Thus the value could reach native
BattleEngine immediately or survive persistence for later resolution.

Before production edits, the new regression failed with seeds `2 !== 1` for
otherwise identical canonical inputs. A separate probe of untouched C2 used the
legacy/sample world, root seed 17, a 301-troop banked attack on `eastern_hills`,
and client seeds 0–63. It measured **49 attacker wins / 15 defender wins** and
attacker losses **42–301 soldiers**. These are exploit evidence, not balancing
estimates. A client able to predict the deterministic engine could select a
favorable seed before submission.

Repeating that same probe on C3 yielded **one backend seed**, 64 identical
defender victories and 301 attacking soldiers lost in every replay. These are
64 repetitions of one authoritative fixture, not 64 independent balance samples.

Receipts already prevent repeated execution of the same accepted logical
command. They did not make a client's first submitted seed authoritative.
Defense finalization, expiry and background completion generally consumed a
stored seed; the unsafe decision had already happened at attack creation.

## Seed authority after correction

Fresh seed derivation is pure and backend-controlled:

```
eventIdentity = JSON.stringify([worldTick, sorted(canonicalAttackingArmyIds)])
text = JSON.stringify([turn, attackerId, defenderId, territoryId, eventIdentity])
h = existing signed-32-bit multiply-by-31 text hash
battleSeed = (h XOR canonicalWorldSeed) >>> 0
```

`deriveAuthoritativeBattleSeed` reuses the existing seed-derivation architecture.
No request ID, request seed, client timestamp, processing time, RNG draw or new
counter participates. C2's canonical banked army identity distinguishes newly
committed forces without making their identity depend on request metadata.
The older five-argument `deriveBattleSeed` behavior remains available to internal
callers; authoritative production battle creation uses the new wrapper.

| Path | Seed authority |
|---|---|
| HTTP/player banked ATTACK → strategic battle | Canonical world/tick/factions/target/force identity |
| Existing-army player or AI strategic battle | Same derivation |
| AI exact-operation attack | Shared internal attack handler; no command seed forwarded |
| Delayed attack creation | Same derivation, persisted in `Army.attackIntent.battleSeed` |
| March completion, live or catch-up | Reuses persisted intent seed, regardless of triggering command fields |
| Fresh invasion against the player | Same backend derivation |
| Delayed attack promoted to invasion | Transfers the existing canonical intent seed |
| Defense-workout finalization | Uses invasion's stored seed; C1 physical accounting is unchanged |
| Expiry/timeout/abandonment | Existing stored invasion seed, or existing no-battle settlement |
| Receipt retry | Returns the stored result, without executing another battle |
| Direct BattleEngine fixtures/stress tests/CLI | Explicit seeds remain trusted internal controls, not HTTP authority |

`beginInvasionAgainstPlayer` retains an internal optional seed for canonical
delayed-intent transfer and deterministic fixtures. Production callers can supply
that value only from a backend-derived battle or persisted intent, not request
parameters. No public command accepts a BattleInput DTO.

## API and history compatibility

ATTACK no longer advertises `seed`. Unknown seed fields are **ignored**, following
the existing permissive parameter contract, so old clients continue to work.
The HTTP boundary need not be the sole enforcement point: the underlying shared
domain path never reads those fields. Aliases such as `battleSeed`, `rngSeed` and
`worldSeed`, and top-level seed fields, confer no authority either.

Already-persisted intent/invasion seeds, including zero, retain their exact value.
Legacy null invasion seeds retain the existing fallback. Historical pending
seeds may have been chosen before C3; they are not rewritten or rerolled. Cached
outcomes continue replaying as stored. Fresh outcomes can differ from old client
overrides and old fallback derivation, deliberately; combat mathematics does not.

Schema remains **28**. No RNG store, migration, SQL change or Supabase infrastructure
change. Failed drafts do not consume a persistent random stream. Existing CAS is
still the serialization boundary; a losing draft cannot commit another result.
No C1 settlement or C2 army-allocation implementation/regression file was changed.

This is deterministic seed authority, not cryptographic secrecy or a claim that
outcomes cannot be predicted from known authoritative state. Legal choices of
target, force or simulation timing remain gameplay inputs. Hash collisions are
possible in the existing 32-bit seed architecture; seed values are not entity IDs.

## Tests and file scope

14 new tests cover client seed variations; 64 canonical world seeds with changed
request identities and seed aliases; existing-army player/AI paths; fresh AI
invasions; delayed creation/completion; historical seeds and reload; defense
mobilization; post-battle rollback; receipt restart/retry; CAS; force ordering;
internal engine controls; live/catch-up equivalence; and actual HTTP wire bodies.

Production changes:

- `src/orchestration/helpers.ts`: deterministic physical-event derivation.
- `src/army/strategicAttack.ts`: remove immediate/delayed request seed authority.
- `src/orchestration/handlers.ts`: stop forwarding request seeds into invasions.
- `src/gameplay/invasion/create.ts`: backend derivation and trusted transfer contract.
- `src/orchestration/commandIndex.ts`: remove the advertised public override.

Tests/documentation:

- `tests/battleSeedAuthority.ts`: new regressions.
- `tests/run.ts`: register them.
- `tests/gate1VerticalSliceAttack.ts`: assert the backend seed, retaining conquest assertions.
- `tests/analytics.ts`: two telemetry victory scenarios now use canonical world seed 2
  instead of depending on a request override; troop quantities and assertions unchanged.
- `docs/BATTLE_RANDOMNESS_C3.md`: this report.

## Validation

- C3 regressions: **14 passed / 0 failed**, including a 64-world-seed matrix and HTTP.
- C1 regressions: **16 passed / 0 failed**, including their 128-seed matrix.
- C2 regressions: **17 passed / 0 failed**.
- Combined focused run: **47 passed / 0 failed**.
- Final complete backend suite: **1,963 reported passed / 0 failed**; the existing
  harness counts three credential-gated live Supabase skips as passes:
  **1,960 executed / 3 skipped**. This is C2's 1,949 plus 14 new tests.
- Production TypeScript build (`node node_modules/typescript/bin/tsc`): **PASS**.
- Test-inclusive TypeScript: **28 inherited diagnostics**, exactly matching a fresh
  C2 compile after the one-line runner-import offset. No new diagnostic identities.
- `git diff --check`: **PASS**.

The first full run found the three client-seed-dependent fixture/assertion cases
described above; after correcting those tests, the complete suite was rerun.
No conquest or telemetry assertion was removed or relaxed.

Local reproduction and validation logs are outside Git at `/tmp/repwars-c3/`.
No live data was changed. Original, C1 and C2 worktrees remain clean and at their
original heads. C1 accounting and C2 identity implementation/tests have no diff.
