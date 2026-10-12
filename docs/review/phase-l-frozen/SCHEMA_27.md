# Schema 27 — actual implemented persistence contract

**IMPLEMENTED**, relative to Phase K/schema 26. This is a review record, not product doctrine.

| Surface | Exact change | Authority / serialization |
|---|---|---|
| `GameState.aiResponses` | New `Map<string, AIResponseContext>` | Canonical context identity/lifecycle references; persisted using existing Map codec. |
| `GameState.aiResponseScheduler` | New scheduler object | Canonical primary-thread keys, boundary keys, observer dirty flag and optional next threat boundary. |
| `AIResponseContext` | New type | `id`, `factionId`, `lane`, referenced `subject`, severity/irreversibility, creation time, revision/material signature, status, timer, outcome, selected exact plan, operation ID and exact blocker alternatives. |
| `AIResponseScheduler` | New type | `primaryByFaction`, `lastBoundaryByFaction`, `observedWorldTick`, `dirty`, optional `nextThreatBoundaryTick`. |
| `AIOperation.responseContextId` | New optional field | Private provenance for non-proactive initiation. No duplicate physical operation. |
| `OperationAttention.emergency` | New optional field | `{contextId, revision, overflow}`; persists the operation's critical overflow authorization. |
| Schema constants | `GAME_STATE_SCHEMA_VERSION` 26 → 27 | Persistence versioning uses the shared constant. |
| Removed state fields | **None** | Existing operation/claim, proposal, cargo, recruitment, Goals, Opinion and ledger authority remains. |

Context `timer` is a persisted `ProactiveTimer` structure reused as a duration process, not a proactive scheduling policy. Required Peace/Trade timers stay on their proposals; required contexts must have `timer === null`. A context's material signature contains decision-relevant classes/plan identities, not a copied world. Armies, territory ownership, resources and domain lifecycles are freshly read from the transaction draft.

## Defaults and migration

`types/GameState.ts::emptyWorldClock` initializes an indexed empty response map, empty primary/boundary maps, `observedWorldTick: 0`, `dirty: false`; no response event is fabricated.

`persistence/versioning.ts::migrateGameStatePayload`, schema <27:

1. Creates empty `aiResponses` and an empty scheduler with `observedWorldTick: null`, `dirty: true`.
2. Registers references to *currently pending* Peace/Trade proposals for eligible AI recipients. Existing proposal timers are retained; no new response-duration draw is made.
3. Leaves prior physical state, proposal/cargo state, operations, claims, Attention, recruitment, cognition, factual ledger, histories and ID/timer sequences in their preceding migration paths.
4. Defers emergency/recovery discovery to current domain facts. No historical threat, remedy, outcome, relief or conflict fact is reconstructed.

Schema 27 requires response maps/scheduler presence. `hydratePersistedPayload` applies migrations, world-definition checks, invariants, then returns a canonical clone. This is one-way current hydration; schema-26 software is not promised to read schema-27 saves.

## Clone / persistence impact

`cloneGameState` deep-copies response JSON-compatible nested records/plans/timer progress, creates a new response map with rebuilt derived indexes, and copies both scheduler Maps. `adoptOwnedTransactionState` transfers the owned draft fields. `cloneOperation` deep-copies emergency metadata; terminal freezing also freezes that nested metadata.

`serialization.ts::encodePersistable/decodePersistable` uses the existing `$map` JSON representation. Derived WeakMap indexes and metrics are not serialized. No new persistence service, database table, CAS boundary or parallel runtime store was added. Current generic JSON copy assumes the response-record type remains JSON-compatible; extensions would need corresponding clone review.

## Invariant impact

`state/responseInvariants.ts::responseStateProblems` checks context semantic identity, faction ownership, lane/subject binding, lifecycle/outcome pairing, non-WAIT exact plans, operation provenance, timer precision/progress, no duplicated required timer, dormant timer absence and one canonical owner for every thinking context. Scheduler boundaries cannot exceed current authoritative AI time/world tick.

`gameStateInvariants` adds response violations and bounded operation-owned emergency charges to the existing claims/Attention validation. Ordinary positive costs are unchanged. An active emergency charge must refer to its operation's own response context/revision; aggregate reserved overflow cannot exceed the provisional allowance.

**UNRESOLVED / reviewer attention:** these checks detect the thread-ownership defect reproduced in `SELF_AUDIT.md`; passing existing tests does not mean every transition satisfies the invariants. Recovery choices, world-event response subjects and final physical battle timing are not added by schema 27.
