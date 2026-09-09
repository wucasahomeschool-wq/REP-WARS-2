# Event Engine Correctness (Phase 7)

Status: correctness/stabilization pass. This document records the audit of
`src/events/` (`WorldSimulator`, `EventDefinitions`, `EventTriggers`,
`EventModel`) plus the event demo harness in `src/simulation/eventSimulation.ts`.
It is **not** an Orchestrator design, and it does not add event types or
gameplay rules.

## What was audited

- Active-event cloning / caller-owned state
- Choice cost validation vs. consequence application
- Event instance and history ID generation
- Event-type lookup (definition id vs. `ActiveEvent.typeId`)
- Consequence scope (`resourceOutputPct`, morale, relationships, infrastructure)
- Candidate selection, duplicate/limit rules, chain delays
- Nondeterministic sources (`Date.now`, `Math.random`)
- Output/application flow (returned maps vs. discarded effects)
- Invalid inputs (unknown type, missing event, unaffordable choice)

## A. Fixed correctness issues

1. **Nondeterministic IDs.** `makeInstanceCounter()` used `Date.now()`, and
   every `HistoryEntry.id` used `Date.now()` + `Math.random()`. Same seed +
   same state therefore could not replay IDs. IDs are now
   `{prefix}_{seed36}_{turn}_{seq36}` from a per-call counter. This does
   **not** consume the event-selection `SeededRNG` (that would change which
   events fire).

2. **Unknown type fell back to `EVENT_LIST[0]` (drought).** Per-turn
   resolution mapped `ActiveEvent.typeId` through a ternary and, on miss,
   substituted the first registered event. An unknown/invalid type could
   apply drought effects. Lookup is now `getEventByTypeId` /
   `EVENT_REGISTRY[id]`; unknown types skip per-turn effects and
   `resolveChoice` returns an error without applying anything.

3. **Unaffordable choices still applied consequences.** `resolveChoice`
   logged "Cannot afford" but then still called `def.resolveChoice`, paid
   nothing (or partial, if a later path ran), applied deltas, cleared
   `choicesPending`, and set `choiceTaken`. Cost is now validated **before**
   any pay/apply/status change. Failure returns cloned state with pending
   choices intact.

4. **Territory-local `resourceOutputPct` also scaled faction `resourceIncome`.**
   A local production boost (resource discovery, prosperity, trade boom)
   was applied to the territory **and** to empire-wide income — wrong
   scope. Territory-tagged `resourceOutputPct` now affects only
   `Territory.resourceOutput`. Faction income % applies only when the
   consequence has no `territoryId`.

5. **`moraleDeltaArmy` was calculated and discarded.** Event definitions
   emit army-morale deltas; `applyDelta` had an empty body (a comment
   claimed a stability proxy that was never implemented). When
   `WorldStepInput.armies` is provided, morale is applied to that
   faction's `Army.morale` (clamped 0–100) and returned as
   `mutatedArmies`. Callers that omit armies still cannot apply it
   (see §C).

6. **Shallow nested clones.** `cloneActiveEvent` now copies nested
   `delta.resources` / `resourceOutputPct` / `relationshipDeltaOpinion`
   and choice `cost` objects, and tolerates missing `chainDelays` /
   `choicesPending` arrays so malformed events do not crash.

## B. Intentional existing behavior

- **Expired/resolved events remain in `newActiveEvents`** with
  `status: 'expired' | 'resolved'`. They do not run per-turn or chains
  (`status !== 'active'`). Removal-from-array is not part of the current
  contract (existing tests assert expired events are still returned).
- **Relationship/opinion deltas are one-sided.** Each faction has its own
  `diplomacy` map. No current event definition emits
  `relationshipDeltaOpinion`. When applied, only the named faction's
  opinion of `target` changes. A reverse edge would be a second delta —
  not a hidden two-sided diplomacy model.
- **`stabilityDelta` is faction-wide.** There is no territory-stability
  field; territory events that emit stability change `WarlordSnapshot.stability`.
- **Same-turn isolation of `ctx` vs. applier maps.** `ConsequenceApplier`
  clones territories/factions again, so trigger evaluation in the same
  `simulate()` call still sees start-of-step copies while returned
  `mutatedTerritories`/`mutatedFactions` include applied deltas. Left as-is
  (changing it would alter same-turn trigger weights).
- **One chain fire per parent event per turn** (`break` after the first
  delay that succeeds). Unchanged.
- **Candidate rules** (`territoryChoiceMinPopulation`, owned-only,
  `sameTerritoryMaxConcurrentActive`, `noActiveDuplicate` by typeId,
  `maxEventsPerTurn`, cooldown via history) are unchanged. Thresholds were
  not rebalanced.
- **Choice `ignore` has no cost** and still applies its inaction
  penalties — that is a defined choice, not a failed payment.

## C. Known limitations / future integration (not built)

- **`moraleDeltaGarrison`.** No garrison-morale field exists on
  `Territory` (`garrison` is a headcount). Not mapped onto fortification
  or stability.
- **`infrastructureDeltaPct`.** No infrastructure stat exists. Not mapped
  onto `fortification`.
- **Armies are optional on `WorldStepInput`.** The event demo now passes
  `gameState.armies` through. Other callers (older tests, any future
  orchestrator) must pass armies if they want army-morale effects.
- **`eventSimulation.ts` still `Object.assign`s Maps in a couple of
  choice-resolution paths.** That does not copy `Map` entries. Pre-existing
  harness quirk; not rewritten into an Orchestrator.
- **No continuous-time loop, no Orchestrator, no authoritative runtime
  `GameState`.** `WorldSimulator` remains a pure step:
  `WorldStepInput → WorldStepOutput`.

## Invariants now guaranteed

- Caller-owned `ActiveEvent` / territory / faction / army objects are not
  mutated by `simulate()` or `resolveChoice()`.
- Same seed + same input → same instance IDs, history IDs, triggered
  types, and summaries.
- Unknown event types never resolve as a different event.
- A choice with an unpaid cost applies **zero** resource, relationship,
  territory, or event-status changes.
- Territory-local production % does not rewrite faction-wide income.
- Chain delay objects are per-instance copies; definitions are not mutated.

## Deterministic behavior

Event selection still uses `SeededRNG(input.seed ^ BALANCE.events.world.rngSalt)`
and the existing `fork()` salts. ID generation is a separate counter so it
cannot perturb `weightedPick` / `chance` / `shuffle` streams.
