# C1 — Temporary defensive-workout troop accounting

Base: `6f38eec6516682e64937b08744a5607f54bbba91`.
Isolated branch: `fix/c1-defense-troop-accounting`.

## Reproduction and root cause

The new successful-defense regression failed before the production correction:
101 real soldiers became 141 after adding 44 temporary defensive-workout units.
An additional probe using invariant-valid states reproduced 141 on the untouched
baseline and 98 on the corrected branch with the same seed and inputs. Both
battles were defender victories; the reward bank stayed at zero.
`resolveInvasionBattle` included temporary power in combat participants, then
`applyBattleResultToGameState` distributed combined survivors into real armies.
The conflict ledger's non-negative loss clamp did not prevent this creation.

## Correction

The invasion resolver identifies the temporary soldiers already included in the
combat input. BattleEngine derives a physical-only defender settlement using the
same sampled casualty rate and existing per-category rounding. It draws no extra
RNG and changes no power, probability, winner, combined casualty or narrative
calculation. Ordinary battles retain their existing result shape.

Authoritative settlement uses physical survivors for real armies and garrisons,
and physical casualties for conflict facts. It checks the initial physical unit
categories against the real defenders before mutation. The existing replay
fingerprint includes physical settlement when present, so an identical replay is
idempotent and altered consequences are rejected.

Physical and combined casualty totals are rounded independently from the same
native rate; their difference is not a new troop source. Temporary-only defense
may win a battle but cannot create an army or garrison.

## Regression coverage

16 new tests cover successful and failed defense; mixed soldiers, knights, siege
and garrison; multiple armies; garrison-only and temporary-only defense;
undefended, abandoned and timed-out responses; attacker disappearance; changed
ownership; snapshot/hydration; duplicate and conflicting settlement; transactional
rollback; and the real workout/attack/defense command lifecycle across reconnect
and retry. A 128-seed matrix verifies physical conservation and exact equality of
the pre-existing combat result with the same unmarked combat input.

The existing Phase K virtual-defense test now explicitly marks its 100 temporary
participants. Its assertion of 20 real garrison losses remains unchanged.

## Boundaries

No GameState schema, reward policy, fitness progression, combat formula, AI,
economy, geography or Unity changes. Timeout/abandonment/undefended paths continue
to ignore attached workout power. Interrupted invasions create no physical units.
Previously persisted troop gains are not inferred or retroactively removed.

## Validation

- New C1 regressions: **16 passed / 0 failed**, including 128 seeded cases.
- Focused defense, invasion, reward, consumption and tutorial coverage:
  **126 passed / 0 failed** (includes those 16).
- Final complete backend runner: **1,932 reported passed / 0 failed**.
  Three credential-gated live Supabase checks were skipped by the existing
  harness and counted as passes: **1,929 executed / 3 skipped**.
- Production TypeScript build (`node node_modules/typescript/bin/tsc`): **PASS**.
- Test-inclusive TypeScript: **28 inherited diagnostics**, exact match to a
  fresh compile of the untouched baseline after accounting for the one-line
  import offset in `tests/run.ts`. No new diagnostic identities.
- `git diff --check`: **PASS**.

The first full run exposed the old virtual-participant test fixture described
above. After explicitly marking those participants, the complete suite was
rerun successfully. No assertion was removed or relaxed.

Local execution logs and the independent baseline/candidate reproduction script
are outside the repository under `/tmp/repwars-c1/`; they are not checkpoint
content. No live database writes were performed.
