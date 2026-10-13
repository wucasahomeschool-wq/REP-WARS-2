# AI implementation Phase A — canonical reasoning-state correctness

The final `REP_WARS_AI_Decision_Engine_Source_of_Truth_v1.0.md` remains the
product authority. This phase fixes canonical freshness and identity only;
it does not implement that document's replacement decision architecture.

## Authority and transaction boundary

The Orchestrator no longer owns a retained WarlordState map. Each command has
disposable working data. AI decision, resolution, and terminal handlers build
their wrappers from the current transaction draft, including changes made
earlier in that same transaction. Rebinding rebuilds from canonical data.

DecisionEngine also refreshes its faction, MemorySystem, and GoalSystem from
the faction in its supplied snapshot before reasoning, so a stale adapter
cannot provide stale goals/memory. The existing algorithms are reused. Goal
objects and memory entries (including nested details) are copied into disposable helper views. Existing
missing-target goal normalization remains local to that view; this phase
does not add canonical Goal Lifecycle transitions.

WarlordState remains a compatibility working/output object for the legacy
single-commitment engine. It is not a second canonical authority. Production
commitment copies are seeded from GameState, and handlers write back only
the factions they processed. Unrelated canonical commitment changes are not
overwritten by stale working copies.
Direct DecisionEngine calls using the canonical adapter also refresh the
single commitment slot before gating cognition; retained compatibility
wrappers cannot keep holding a commitment that canonical state has ended.

Decision history and identity bookkeeping mutate the draft's canonical
faction. The existing clone/invariants/commit path isolates the preceding
state; failed transactions discard those changes. Persistence and CAS are
unchanged.

## Persisted identity

Schema 17 adds `WarlordSnapshot.nextAiCommitmentSequence`, a nonnegative safe
integer initialized to zero. Existing cloning and serialization preserve it.
It replaces the private wrapper counter without changing the commitment ID
format, RNG algorithm, or single-commitment storage model. Holding a current
commitment does not consume another sequence value.

Migration from schemas below 17 derives a minimum next sequence from generated
IDs in the stored commitment and owned army/invasion references. It preserves
any higher valid persisted counter. Custom historical IDs have no recoverable
sequence; without another recorded ID or counter the initial value is zero.
Existing IDs and operation references remain intact. Earlier discarded,
unpersisted counter history cannot be recovered. Schemas 17 and 18 reject
malformed counters and counters below the recorded-ID minimum rather than
silently reusing IDs. No new operation-ID architecture is introduced.

## Validation

`tests/aiCanonicalReasoning.ts` covers actual scorer input freshness, removed
memory, canonical goals, same-transaction mutations, preceding-state
isolation, history round-trip, rebind/restart equivalence, rollback/retry
identity, canonical outcome feedback, legacy sequence migration, corruption
rejection, and faction-scoped commitment writeback.
The final combined review adds nested-memory isolation, retained commitment
freshness, high-water preservation, schema-17/18 sequence rollback rejection,
and physical-reference migration regressions. Memory details are deep-cloned
both at the transaction boundary and when creating disposable cognition.

Run the existing full suite and production type check:

```sh
node node_modules/ts-node/dist/bin.js --project tsconfig.tests.json --transpile-only tests/run.ts
node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

The explicit Node invocation is equivalent to the repository's test script
and works when dependency launcher files lack executable permission.

## Deferred boundaries

The existing action vocabulary, scoring, WAIT behavior, goal/memory semantics,
single commitment, movement, battle, construction, economy, and temporal
policies remain legacy behavior. Their documented conflicts with the final
Source of Truth require later bounded phases. No Pressure, Attention,
concrete-plan, multi-operation, faction epistemic view, recruitment, or
diplomacy architecture is introduced here.
