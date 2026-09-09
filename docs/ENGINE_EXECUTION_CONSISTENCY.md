# Engine Execution Consistency (Phase 6)

Status: engine-integration consistency pass. This document describes how
`src/simulation/cli.ts` (the temporary simulation harness) now executes
`ATTACK`/`EXPAND` decisions through the authoritative engines/formulas
instead of duplicating or contradicting them, plus a compatibility matrix
covering every currently-implemented action. It is **not** the
Orchestrator design — see "Why the CLI is not the final Orchestrator"
below.

## 1. Current simulation-harness architecture

```
SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, seed)
        │
        ▼
GameStateSnapshot (territories/armies/factions Maps) + WarlordState[]
        │
        ▼  each turn:
DecisionEngine.decideAll(...)  ──►  Decision[] (one per faction: action + target + score)
        │
        ▼
simulateDecisionOutcomes(decisions, warlordStates, gameState, turn, seed, verbose)
        │   (src/simulation/cli.ts — THIS pass's focus)
        │
        ├─ ATTACK   → BattleEngine.resolve() → applyBattleResult()  [NEW]
        ├─ EXPAND   → ScoringHelpers.computeLocalUsableMilitaryPower() [FIXED]
        ├─ REINFORCE/BUILD → BALANCE-sourced costs [already/now centralized]
        └─ DECLARE_WAR/OFFER_PEACE/TRADE/NEGOTIATE/SCOUT/WAIT → diplomacy/memory-only bookkeeping
```

`gameState`/`warlordStates` are the harness's own in-memory mutable state.
No engine (`BattleEngine`, `MapEngine`, `ActionScorer`, `GoalSystem`,
`PersonalitySystem`, `MemorySystem`) mutates this shared state itself —
`cli.ts` is the only place that writes back into `GameStateSnapshot`/
`WarlordSnapshot` after calling an engine.

## 2. ATTACK → BattleEngine flow

Previously, `ATTACK` execution only recorded `attack_made`/`attack_received`
memory entries and nudged diplomatic opinion — **no battle was ever actually
fought**, regardless of the armies or garrisons involved.

Now, `simulateDecisionOutcomes`'s `ATTACK` case:

1. Resolves the target territory and its current owner (`victimId`) fresh
   at execution time (not from cached decision-time data — see §8 for why).
2. Selects the attacking force via
   `ScoringHelpers.armiesBorderingTerritory(...)` filtered by the same
   `soldiers + knights > 100` eligibility `ActionScorer.scoreAttack` uses.
   This is the **same helper**, not a re-implementation — see §8.
3. Selects defending field armies as `Army`s physically located at the
   target (`a.location === t.id`) — matching the Phase 5 fix to
   `estimateMilitaryAdvantage`.
4. Builds a `BattleInput` directly from canonical `Army`/`Territory`
   objects — no adapter/DTO conversion needed. `Territory` already
   structurally satisfies `BattleInput.territory`'s shape (`id`, `name`,
   `owner`, `fortification`, `isCapital`, `garrison`, plus `TerritoryLike`'s
   `terrain`), and `Army` already satisfies `ArmyLike` (`soldiers`,
   `knights`, `siegeEngines`, `morale`, `supply`). See
   `src/battle/BattleEngine.ts`'s `BattleInput` doc comment.
5. A deterministic per-battle seed is derived from the simulation seed plus
   the battle's identity (`deriveBattleSeed(seed, turn, attackerId,
   defenderId, territoryId)`) — a plain string hash, not battle math.
   `BattleEngine` still owns 100% of the probability/casualty calculation.
6. Calls `battleEngine.validate(input)`; if invalid (e.g. no eligible
   attacker after a same-turn state change — see §8), the attack is a
   silent no-op: no battle, no diplomatic hit.
7. If valid, applies the pre-existing diplomatic/memory consequences of
   attacking (unchanged from before this pass), then calls
   **`battleEngine.resolve(input)`** — the one and only battle-resolution
   call — and prints `battleEngine.formatResult(result, verbose)`.
8. Calls `applyBattleResult(...)` to write the result into simulation
   state (§3).

No win-probability, power, or casualty formula is duplicated in `cli.ts`.
A regression test (`tests/run.ts`, "Engine execution consistency — ATTACK
uses BattleEngine") asserts this by source-scanning `cli.ts` for
`battleEngine.resolve(` and asserting the absence of
`computeWinProbability`/`computeCasualtyRates`/`computeAttackerPower`/
`computeDefenderPower`.

## 3. BattleResult application flow

`applyBattleResult(...)` in `cli.ts` applies an already-resolved
`BattleResult` using only existing `Territory`/`Army`/`WarlordSnapshot`/
`MemorySystem` fields:

- **Garrison**: `targetTerritory.garrison = result.defender.remaining.garrison`
  — applied unconditionally (garrison casualties happen even when the
  defender wins, since the winning side still takes a nonzero casualty
  rate; see `BattleEngine.resolve`'s `winnerCasRate`).
- **Winner survivors**: `applySurvivingArmies(...)` writes
  `result.attacker.remaining`/`result.defender.remaining`
  (`soldiers`/`knights`/`siegeEngines`) and the corresponding
  `moraleChange` back onto the winning side's `Army` object(s). When more
  than one army fought on a side, the aggregate is distributed
  proportionally to each army's pre-battle share (BattleEngine resolves
  combat as one aggregate per side; it has no per-army breakdown to give
  back). In the current SAMPLE_MAP scenario every faction starts with
  exactly one army, so this is normally a 1-army identity assignment.
- **No-retreat rule (Phase 4) preserved**: the *losing* side's armies that
  fought are fully removed from `gameState.armies` and from the owning
  faction's `WarlordSnapshot.armies` id list via `eliminateArmies(...)` —
  eliminated outright, never left with survivors or a "retreated" status.
  `applyBattleResult` never introduces retreat behavior.
- **Territory capture**: only when `result.territoryOutcome === 'captured'`
  (attacker won and cleared the capture threshold) — ownership transfers,
  the territory id moves from the defender's to the attacker's
  `territories` list, and the surviving attacking army's `location` is set
  to the captured territory (a direct, minimal consequence of capture
  using the existing `Army.location` field — not a troop-movement/
  logistics system).
- **Memory**: `battle_won`/`battle_lost` and, on capture,
  `territory_gained`/`territory_lost` entries are recorded using
  `MemoryEventType`s that already existed in `src/types/index.ts` but were
  previously never emitted for `ATTACK` — no new event types were added.
- **Stalemate (`result.winner === 'draw'`)**: both sides' armies get their
  graduated casualties applied via `applySurvivingArmies`; neither side is
  eliminated and the territory's ownership is untouched
  (`territoryOutcome` is `'contested'`).
- **Not modeled** (unchanged from before this pass — no resource/plunder
  mechanic exists anywhere in the codebase for battles): no gold/resources
  change hands as a result of a battle. This isn't a gap introduced here;
  there was never a looting/plunder system to wire up.

## 4. EXPAND consistency

**Before**: `cli.ts` compared `ws.snapshot.totalMilitaryPower` — the
faction's *entire* empire-wide military power (every army and every
garrison it owns, anywhere on the map) — against the target's garrison.
`ActionScorer.scoreExpand` (fixed in Phase 5) instead used a local/usable
strength concept: field armies stationed adjacent to the target, plus
garrisons of the faction's own territories bordering the target. These two
concepts could disagree — a faction with a huge army on a distant front
could "expand" via the CLI even though nothing it actually had nearby could
plausibly act on that unclaimed territory.

**Now**: the local-strength formula is extracted once, into
`ScoringHelpers.computeLocalUsableMilitaryPower(selfId, myArmies,
allTerritories, targetTerritoryId)` (in `src/scoring/ActionScorer.ts`), and
both `ActionScorer.scoreExpand` and `cli.ts`'s `EXPAND` execution call it.
Only the *military-strength term* changed — the surrounding formula
(`needed = (garrison + 100) * soldierValue`, `myPower > needed * 1.5`) is
untouched, so this is a wiring fix, not a rebalance.

`MapEngine`'s territory-generation/graph algorithm was not touched. The
"local strength" concept only gates whether the AI-driven `EXPAND` *action*
succeeds; it has nothing to do with how `MapEngine` procedurally generates
territories or their neighbor graph (verified unaffected by an existing +
a new regression test — see §9).

## 5. Action compatibility matrix

| Action | Scored by AI? | Executed by CLI? | Uses authoritative engine/balance? | Modifies state? | Notes |
|---|---|---|---|---|---|
| ATTACK | Yes (`scoreAttack`) | Yes | **Yes — `BattleEngine.resolve()`** (fixed this pass) | Yes (territory owner/garrison, armies, memory, diplomacy) | Was diplomacy/memory-only before this pass; no battle was ever fought. |
| DEFEND | Yes (`scoreDefend`) | No case in `simulateDecisionOutcomes` | n/a | No | Passive/vigilance action; no state mutation exists to apply. Not a bug — there is nothing in the current model for "defending" to change. |
| REINFORCE | Yes (`scoreReinforce`) | Yes | Yes — both read `BALANCE.economy.reinforcementCost` (fixed in Phase 5) | Yes (gold/food, garrison) | Already consistent going into this pass. |
| EXPAND | Yes (`scoreExpand`) | Yes | **Yes — both read `ScoringHelpers.computeLocalUsableMilitaryPower()`** (fixed this pass) | Yes (territory owner, garrison, gold, diplomacy) | Gold cost (100) / garrison floor (50) / reduction (30) / safety margin (100) / multiplier (1.5) constants are defined once, only in `cli.ts` — not duplicated elsewhere, so left as-is (see §6). The scorer does not check gold affordability at all — documented gap, not fixed (§8). |
| SCOUT | Yes (`scoreScout`) | Yes (shares a `case` with EXPAND) | n/a (no cost anywhere) | Yes (knowledge reveal only) | Consistent; no cost to centralize. |
| BUILD | Yes (`scoreBuild`) | Yes | **Yes — both read `BALANCE.territory.fortificationCostPerLevel`** (fixed this pass) | Yes (gold/stone, fortification) | Was two independent hardcoded `100`/`50` literals that happened to match by coincidence. |
| MOVE | Yes (`scoreMove`) | No case in `simulateDecisionOutcomes` | n/a | No | No troop-movement/logistics model exists to apply this to. Documented gap for the Orchestrator phase, not fixed here (would require inventing movement mechanics). |
| NEGOTIATE | Yes | Yes | n/a (no cost) | Yes (small opinion bump both sides) | Consistent. |
| OFFER_PEACE | Yes | Yes | n/a (no cost) | Partial — opinion bump only; does **not** transition `rel.state` away from `'at_war'` | Real gap: an accepted peace offer should presumably end a war, but deciding *acceptance criteria* is new diplomacy-mechanic design, out of scope for this pass. Documented, not fixed. |
| DECLARE_WAR | Yes | Yes | n/a (no cost) | Yes (`rel.state = 'at_war'`, opinion hit both sides) | Consistent. |
| TRADE | Yes (`scoreTrade`, complex resource-complementarity scoring) | Yes | n/a | Partial — diplomacy/memory only; **no resources are ever actually exchanged** | Scoring evaluates a resource trade that execution never performs. Implementing a real exchange means deciding trade quantities/mechanics — a new economy mechanic, explicitly out of scope. Documented as a placeholder, not fixed. |
| WAIT | Yes | Yes | n/a | Yes (half of normal resource income) | Consistent; simplification, not a bug. |

Base scores (`BALANCE.scoring.baseScores`) exist for `RETREAT` too, but
`GoalSystem`/`ActionScorer` treat it as a pre-battle repositioning action
distinct from in-battle retreat (removed in Phase 4); it has no
`simulateDecisionOutcomes` case either, for the same "no movement model"
reason as `MOVE`.

## 6. Authoritative balance-cost sources

| Cost | Authoritative source | Read by |
|---|---|---|
| REINFORCE (gold/food/garrison gain) | `BALANCE.economy.reinforcementCost` | `ActionScorer.scoreReinforce`, `cli.ts` REINFORCE execution (fixed in Phase 5) |
| BUILD (gold/stone) | `BALANCE.territory.fortificationCostPerLevel` (`.iron` present but not charged by either caller — not wired up, not invented here) | `ActionScorer.scoreBuild`, `cli.ts` BUILD execution (fixed this pass) |
| EXPAND (gold cost, garrison floor/reduction, safety margin, multiplier) | inline literals in `cli.ts` only | `cli.ts` EXPAND execution only — not duplicated elsewhere, so not centralized this pass (see §5 note) |
| ATTACK | none — combat has no separate "cost" resource, only troops/casualties | `BattleEngine` |
| SCOUT, NEGOTIATE, DECLARE_WAR, OFFER_PEACE, WAIT | none defined anywhere | n/a |
| TRADE | none — no resource exchange is executed at all | n/a |

## 7. Discrepancies fixed this pass

1. `ATTACK` execution now calls `BattleEngine.resolve()` instead of never
   fighting a battle at all.
2. `BattleResult` is applied to territory ownership/garrison, army
   survivor counts, army elimination (no-retreat), and memory using only
   existing structures.
3. `EXPAND` execution now uses the same local/usable military-strength
   concept (`ScoringHelpers.computeLocalUsableMilitaryPower`) as
   `ActionScorer.scoreExpand`, instead of empire-wide `totalMilitaryPower`.
4. `ATTACK` army-selection formula (`armiesBorderingTerritory` + the >100
   eligibility filter) is now a single shared helper used by both the
   scorer and the executor, instead of two independent inline filters.
5. `BUILD` cost (100 gold / 50 stone) is now read from the previously
   unused `BALANCE.territory.fortificationCostPerLevel` by both the scorer
   and the executor, instead of two independent hardcoded literals.

## 8. Discrepancies intentionally deferred (documented, not fixed)

- **EXPAND's own cost constants** (100 gold, +100 garrison safety margin,
  1.5 required-power multiplier, -30 garrison reduction, 50 garrison floor)
  live only in `cli.ts`, not centralized into `BALANCE`. They are not
  *duplicated* anywhere else, so there is no cross-file disagreement to
  fix — only the military-strength *concept* (§4) needed reconciling. Left
  as low-priority cleanup for whoever eventually builds real EXPAND
  balance tuning.
- **`scoreExpand` never checks gold affordability at all.** Execution
  charges 100 gold on a successful expansion; the scorer never penalizes
  or gates on whether the faction can pay it. Fixing this would mean
  adding a brand-new affordability check to the scorer (changing AI
  scores), which is more than a wiring fix — deferred, analogous to (but
  not the same class of bug as) the REINFORCE cost-mismatch fixed in
  Phase 5.
- **`OFFER_PEACE` never actually ends a war.** It only nudges diplomatic
  opinion; `rel.state` never transitions away from `'at_war'`. A correct
  fix requires designing acceptance criteria (does the other faction
  agree?) — new diplomacy-mechanic design, out of scope for an
  integration-consistency pass.
- **`TRADE` never exchanges resources.** `scoreTrade` evaluates detailed
  resource complementarity; execution only logs diplomacy/memory. A real
  fix means designing trade-quantity mechanics — a new economy mechanic,
  explicitly excluded from this pass.
- **`DEFEND`, `MOVE`, `RETREAT`** have no `simulateDecisionOutcomes` case
  at all. There is no troop-movement/logistics or passive-defense state
  mutation model in this codebase to apply their effects to. Not fixed —
  doing so means inventing movement mechanics.
- **Multi-army result distribution is a proportional approximation.**
  `BattleEngine` resolves each side as one aggregate; `applySurvivingArmies`
  splits the aggregate remaining count back across that side's original
  `Army` objects proportionally to pre-battle share. This never happens
  today (every SAMPLE_MAP faction starts with exactly one army) but is
  documented in case additional armies are introduced later.
- **Same-turn decision staleness.** `DecisionEngine.decideAll` computes all
  factions' decisions against one shared snapshot, then
  `simulateDecisionOutcomes` applies them serially; an earlier faction's
  action this same turn can change a later faction's attack target's
  owner or deplete its own army. `ATTACK` execution re-derives the
  attacking force and target owner at execution time (not from
  decision-time cache) specifically to degrade safely (silently skip) in
  that case rather than acting on stale data — but this ordering issue
  itself is inherent to the "decide-all-then-apply-serially" harness
  design, not something this pass resolves structurally.

## 9. Why the CLI is not the final Orchestrator

`src/simulation/cli.ts` remains what it has always been: a temporary
simulation/integration harness used to exercise `DecisionEngine`,
`ActionScorer`, `BattleEngine`, and `MapEngine` together from the command
line. This pass made its execution path *consistent* with the engines it
calls — it did not give it any of the properties a real orchestrator needs:

- No command routing / command index — `simulateDecisionOutcomes` is one
  big `switch` over a fixed action list, not a generalized command system.
- No persistence — `GameStateSnapshot` lives only in process memory for
  the duration of one CLI run.
- No authoritative runtime `GameState` — `src/types/GameState.ts`'s
  canonical interface (Phase 3) is still an architecture-only target; the
  harness still runs on the older `GameStateSnapshot`/`WarlordSnapshot`
  shapes.
- No Supabase/frontend/real-time loop integration.
- No command validation/rejection layer beyond `BattleEngine.validate()`
  (which is battle-specific, not a general command gate).

## 10. Intended future engine/orchestrator boundary

```
UI / command input
        ↓
Game Interface & Orchestration Engine   (not built — future phase)
        ↓
Authoritative GameState                 (canonical shape drafted, Phase 3)
        ↓
specialized engines (BattleEngine, MapEngine, ActionScorer, GoalSystem, ...)
        ↓
results (BattleResult, ScoredAction[], ...)
        ↓
Orchestrator applies results
        ↓
new GameState
```

This pass is a rehearsal of the middle three layers (`GameState` snapshot →
engine call → result → applied back) inside the existing harness, so that
when the real Orchestrator is built, `ATTACK`/`EXPAND`'s engine-call and
result-application logic already exist in a form that generalizes rather
than needing to be invented from scratch under a new architecture.

## Testing

See `tests/run.ts`, sections "Engine execution consistency — ATTACK uses
BattleEngine", "Engine execution consistency — EXPAND local/usable
military strength", and "Engine execution consistency — balance/cost
centralization" (12 new tests). These use minimal, self-contained
two-territory/two-faction fixtures (not `SAMPLE_MAP`) built directly from
canonical types, so `ATTACK`/`EXPAND` execution can be tested in isolation
and deterministically, independent of `SAMPLE_MAP`'s specific geography.
