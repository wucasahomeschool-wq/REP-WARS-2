# Phase L R2 correction candidate

## Baseline and scope

Clean starting branch: `codex/ai-phase-l-frozen-review`.
Starting HEAD: `8375022d43482658227415f078a40ac13356c9cb`
(`AI: freeze Phase L for independent review`). Its parent is Phase K,
`7b6cf00a639b6ed1b17302713ef13ad6d2ea195f`.
The correction branch did not exist locally or remotely before creation.
Work is confined to `codex/ai-phase-l-r2-correction` and remains uncommitted.
The frozen branch and all 102 frozen artifacts are historical evidence and are
unchanged. The Source of Truth remains the design authority.

Schema remains **27**. No new canonical state, scheduler/store, action, evaluator,
duration rule, balance value or physical recovery policy is introduced.

## Independent findings and corrections

| Finding | Correction | Ownership boundary |
|---|---|---|
| Non-owner urgency escalation erased another thread marker | Central `primaryResponseOwner`, `acquirePrimaryResponse`, `releasePrimaryResponse`, `transferPrimaryResponse`, `resetResponseReasoning` | Canonical response ID and fresh canonical record, never wrapper identity |
| Zero-cost REINFORCE over cap dereferenced absent emergency context | Zero-cost feasibility returns without emergency authorization; acquisition emits no overflow metadata | Existing operation-owned positive charges remain unchanged |
| World event support loss failed to wake emergency observation | `mergeEventStepOntoGameState` marks the existing dirty flag on physical fact change | Real ConsequenceApplier output, not a synthetic response notification |
| Response-only session progress was not saved | Shared open/heartbeat/end save gate includes live contexts and all scheduler fields/maps | Existing full GameState save and CAS |
| Clock attachment granted unearned response work | Translate response timestamps/timer watermarks and scheduler receipt boundaries | Existing initial clock-origin translation only |
| Internal failure exposed private response/proposal IDs | Public internal error projection plus HTTP exception/persistence sanitization and isolated server reporting | Internal diagnostics retained; expected domain errors unchanged |

### Primary-thread transitions

Release only succeeds when the faction marker equals the expected context ID.
Acquisition resolves the canonical record by ID/revision/material signature, checks
its lifecycle, rejects an unrelated owner and rejects an inconsistent owner.
Transfer validates before touching the displaced owner, queues that owner, retains
its timer/sample/earned work, and acquires the next owner in one synchronous reducer.
Resumption resets only the timer watermark to the current boundary; queued time
does not earn work. Material revision intentionally discards stale reasoning and
selection. Cancellation and replacement use owner-aware release.

Urgency escalation uses the same material reset. Required deadline takeover and
restoration use the same transfer/acquire path. Recovery remains dormant when no
authoritative remedy exists. `startResponseIntervention` checks exact ownership;
the nested `startOperation` transaction rechecks it before claims and Attention.
No invariant was weakened. Multiple compatible physical operations still coexist.

### Event wake and durable state

Territory ownership/garrison/fortification/topology and army physical facts are
compared at the existing event merge boundary. Nested movement/intent comparison
is property-order independent. There is no full observer or plan scoring inside
the merge. Empty event output leaves the dirty flag unchanged. Repeated unchanged
boundaries do not rescan the world.

The save gate compares indexed live response contexts, including their timers and
bookkeeping, plus scheduler ownership, coalescing and dirty/observation boundaries.
A live context becoming terminal changes that projection. Terminal history is not
scanned for this detector; the normal persisted payload still includes all records.
No alternate persistence channel or hidden merge is used.

### Clock and private errors

Initial attachment translates `createdAtMs`, every response timer's
`progress.accruedThroughMs` (including queued work), and `lastBoundaryByFaction`.
World-tick observation/arrival thresholds remain world ticks. Required proposal
signatures are translated with their referenced pending receipt time without a
material revision. No sequence, sample or earned-duration value is changed.

Orchestration errors remain detailed for server callers and telemetry. The HTTP
boundary projects `INVALID_GAME_STATE` and `ENGINE_ERROR` to a generic message and
omits private details, including nested world/catch-up error bodies found during
the final common-path audit. Unexpected exceptions and persistence failures also use
generic client messages. The original details reach an isolated server reporter
(default server error log). Validation such as `INVALID_TERRITORY` remains useful
to the player. Reporter failures cannot alter gameplay or the HTTP result.

## Regression coverage

`tests/aiResponseCorrections.ts` is registered by the normal Phase L test module,
so both the focused runner and full suite execute the corrections.

**34 new regressions** cover emergency/emergency and emergency/required escalation,
owner-aware release, rejection of unrelated/inconsistent ownership, invalid transfer
rollback, canonical identity, resumable progress, owner/non-owner cancellation and
material revision, owner/non-owner hostile replacement, deterministic insertion
order, dormant recovery isolation, execution without ownership, reload/coarse/fine
progression, real capacity-6/occupancy-8 zero-cost reinforcement, actual event
garrison consequences, empty/reordered events, idempotent session open/heartbeat/end
saving, active/queued clock attachment, required signature translation, reload
attachment equivalence, nested/outer invariant rollback and actual HTTP privacy.

The nested rollback probes start a real exact physical operation and overflow
charge before forcing invariant rejection. Canonical state remains byte-equivalent;
the outer command returns no events, notifications, state changes or result payload.

## Validation

Focused validation: **788 passed / 0 failed**, including **94 Phase L tests** and
**34 new R2 regressions**. Production TypeScript passes. Test-inclusive compilation
exits with exactly the **same 28 pre-existing diagnostics**, zero new/removed
file/code/full-message identities. Final full/integration results are recorded
below after the last run. No failures or skips are intentionally excluded.

Commands (repository root):

```sh
TS_NODE_PROJECT=tsconfig.tests.json node -r ./node_modules/ts-node/register/transpile-only docs/review/phase-l-frozen/scripts/l-driver.cjs focus
TS_NODE_PROJECT=tsconfig.tests.json node -r ./node_modules/ts-node/register/transpile-only docs/review/phase-l-frozen/scripts/l-integration.cjs focus
node node_modules/ts-node/dist/bin.js --project tsconfig.tests.json --transpile-only tests/run.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --project tsconfig.tests.json --noEmit
git diff --check
```

The frozen scripts are executed against current source without modifying them.
Test-inclusive diagnostics are compared to the frozen Phase K log by file, TS code,
full message and multiplicity, ignoring line-number movement only.

## Quiet performance

The existing frozen diagnostic's quiet prefix was executed unchanged through
`l-driver.cjs aiResponses /dev/stdin`. It uses 12 factions, 10,000 world ticks,
64-tick command chunks, no forces/useful sources and a quiet event simulator.
Measured **3,127 ms**, with the final post-correction rerun **3,241 ms**, versus
frozen **3,152 ms** on this host (Node 24.19.0, Linux 6.18.44).
40,000 cheap queue checks; **zero observations, contexts, deliberations, evaluator
comparison suites, plans, operations or history rows**. This is a fixture
measurement, not a gameplay performance guarantee.

```sh
python3 - <<'PY' | TS_NODE_PROJECT=tsconfig.tests.json node -r ./node_modules/ts-node/register/transpile-only docs/review/phase-l-frozen/scripts/l-driver.cjs aiResponses /dev/stdin
from pathlib import Path
print(Path('docs/review/phase-l-frozen/scripts/l-diagnostics.ts').read_text().split('function manyRequired')[0])
PY
```

## Adversarial self-audit and deferred contracts

The correction audits all primary marker mutations, cancellation/revision/required
takeover paths, nested execution guards, zero-cost callers, event merge consumers,
session save gates, clock-origin fields and HTTP failure exits. Ownership writes
are centralized; no global physical-operation gate or parallel authority is added.
No policy tuning, invariant weakening, historical RNG reroll or new recovery choice
is used. Full validation and final audit outcomes are recorded below.

An additional post-test probe exercised **30 fixtures / 600 canonical scheduler
transitions** with all three lanes, alternating insertion order, urgency changes,
material force/support revisions, non-owner cancellation and repeated reloads.
It found **zero scheduler invariant failures**. A probe fixture initially omitted
required blocked-march boundary/reason metadata; hydration correctly rejected it.
The fixture was corrected to supply existing physical facts, without weakening
invariants or changing production behavior.

The common HTTP-path audit additionally found nested world/catch-up error bodies;
the same privacy correction now projects those too and the HTTP regression checks
both surfaces. No outstanding reproduced defect in the six R2 families or R3/R4
expansion was identified.

## Intended correction-file scope

**13 files: 11 modified, 2 new.** No deletions, generated caches, configuration
changes or frozen review-artifact changes are included.

```text
M docs/AI_PHASE_L_NON_PROACTIVE_COGNITION.md
A docs/AI_PHASE_L_R2_CORRECTIONS.md
M src/engine/nonProactiveCognition.ts
M src/engine/responseRecords.ts
M src/engine/strategicAttention.ts
M src/orchestration/applyEvents.ts
M src/orchestration/errors.ts
M src/orchestration/handlers.ts
M src/server/http.ts
M src/server/session.ts
M src/world/aiTemporal.ts
M tests/aiResponses.ts
A tests/aiResponseCorrections.ts
```

All **102 frozen review artifacts** were compared byte-for-byte with the frozen
commit; zero mismatches. The frozen branch still resolves to
`8375022d43482658227415f078a40ac13356c9cb`. No staging, commit or push is performed.

## Remaining deferred contracts

The following remain explicitly unresolved/deferred:

* spatial recovery;
* blocked cargo remedies;
* broader physical battle-timing/participant lifecycle;
* generic non-player invasion material rearming (current production invasion
  creation primarily targets the local player);
* independently progressing required windows versus serialized recipient assessment;
* final Attention/overflow tuning;
* response/context/history compaction.

These corrections preserve current Phase H/I window behavior. Recovery continues
safe non-action and custody/physical claims; no teleport, reroute, refund, cargo
destination or new timeout is invented. No REP-WARS-3 change, merge, reconciliation,
push, Phase M or Temporal V2 work is authorized or performed.

## Final verification record

| Validation | Final result |
|---|---|
| Targeted R2 regressions | 34 passed / 0 failed |
| Phase L | 94 passed / 0 failed |
| A–L focused | 788 passed / 0 failed |
| A/B/C/D/E/F/G/H/I/J/K/L breakdown | 17 / 28 / 60 / 41 / 55 / 73 / 78 / 85 / 90 / 83 / 84 / 94 |
| Affected integration | 319 passed / 0 failed (includes 16 anchors) |
| Full suite | 1,867 passed / 0 failed |
| Production TypeScript | PASS, exit 0 |
| Test-inclusive TypeScript | Exit 2; identical 28 baseline diagnostics, zero new/removed identities |
| Tracked diff whitespace | `git diff --check`: PASS |
| Both new-file whitespace checks | No diagnostics; no-index exit 1 denotes new-file differences |
| Frozen evidence | All 102 artifact hashes match the frozen commit |
| Post-test adversarial probe | 30 fixtures / 600 scheduler transitions, zero invariant failures |
| Final quiet 10,000 ticks | 3,241 ms; no observations, deliberations, evaluator suites or contexts |

No failing/skipped tests are omitted from these runs. Final working tree: **11
modified, 2 untracked new files**, nothing staged. HEAD and frozen branch both
remain `8375022d43482658227415f078a40ac13356c9cb`; the correction branch is the only
active line. The existing `origin/REP-WARS-3` ref remains
`81dced8239aedb5864e689ae97553cb16c7698ff`. No commit, push, merge or reconciliation
was performed. This candidate awaits independent re-review.
