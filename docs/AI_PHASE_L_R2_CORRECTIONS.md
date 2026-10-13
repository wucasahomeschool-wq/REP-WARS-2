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

## Follow-up: final R2 HTTP privacy serialization correction

This addendum records follow-up work from reviewed R2 checkpoint
`70b7529e07954069e77eddee9e4cbf3ec5018e29`, on
`codex/ai-phase-l-r2-privacy-correction`. The independent re-review verdict was
**C — REVISION REQUIRED**, architecture **R2 — SMALL CORRECTION STILL REQUIRED**:
five original corrections passed; HTTP serialization remained blocked. This does
not replace that verdict or rewrite the frozen evidence. Final approval remains
subject to independent review.

Before changing production code, real HTTP tests reproduced private NPC Trade
proposal/context leakage from null-prototype dictionaries, OrchestrationError
instances, mixed arrays, and own/inherited `toJSON` transformations. The original
projection accepted only exact Object.prototype objects; untouched representations
then reached JSON.stringify, including its executable transformation hooks.

The outward boundary now creates fresh JSON data using property descriptors,
without invoking getters, `toJSON`, or proxy traps. Own serializable data from
ordinary objects, null-prototype dictionaries and class instances takes the same
recursive path. Known internal codes redact the complete error, even without a
message, retaining the original diagnostic server-side. An independent probe found
and then verified closure of inherited-code, boxed-code and function-code
representation bypasses.
Unknown native Error instances also receive a safe internal error body; expected
domain Error instances retain code/message/details without stack traces.

Fresh object/array outputs have no prototype hooks. JSON scalar, array, undefined
omission, non-finite number and repeated-alias behavior is preserved. Executable
serialization hooks/accessors, proxies, boxed primitives, cycles and BigInt fail
closed through the
existing sanitized HTTP 500 path. They are not executed to discover a wire shape.
The actual command/session DTO implementations contain data rather than custom
`toJSON`/Date serialization; no such hook support is added. This is an outward DTO
contract, not a general JavaScript serialization framework.

Command and session success bodies share this boundary. Existing expected domain
errors remain useful, and existing exception/persistence catches remain sanitized.
The isolated reporter retains original internal error objects and safe request
correlation; encountered diagnostics are retained even if a later malformed value
prevents serialization. Input objects are not mutated. Projection only runs while
producing HTTP responses, never in simulation progression.

**19 new real-HTTP regressions** cover plain/null-prototype/class internal errors
in top-level errors and nested payloads, mixed arrays, public domain representations,
own/inherited `toJSON`, getters, cycles, BigInt, absent-message/alternate-field
errors, unknown Error stacks, inherited internal codes, boxed/function-transforming
codes and safe JSON/alias behavior.
All inspect final wire text for realistic hidden NPC proposal/context IDs; all
compare canonical fixture state and input identity before/after projection.

A separate HTTP probe verified null-prototype, OrchestrationError, inherited-code
and session-response cases, plus a proxy variation outside the authored regressions
(zero executed traps). No private IDs reached those final responses.

Validation commands remain those listed above. Final results for this follow-up:

| Check | Result |
|---|---|
| New privacy regressions | 19 passed / 0 failed |
| Privacy HTTP focused (existing + new) | 20 passed / 0 failed |
| Phase L | 113 passed / 0 failed |
| A–L focused | 807 passed / 0 failed |
| Integration (including anchors/session/temporal/persistence) | 319 passed / 0 failed |
| Full suite | 1,886 passed / 0 failed |
| HTTP bridge | 1 passed / 0 failed; also exercised in the full suite |
| Production TypeScript | PASS, exit 0 |
| Test-inclusive TypeScript | Exit 2; same 28 baseline identities, zero new/removed |
| Diff whitespace | `git diff --check`: PASS |

No scheduler, timing, AI policy, canonical state, schema, RNG, CAS, reservation or
operation behavior is changed. Schema remains 27. All previously listed deferred
contracts remain deferred. Scope is HTTP source, its existing regression module,
and this addendum only. The reviewed R2 and frozen branches are preserved; changes
remain unstaged/uncommitted, with no push, merge, REP-WARS-3 modification, Phase M,
Temporal V2 or reconciliation.

The post-test self-audit traced every projector output to the final stringify call:
original container objects do not survive projection, whole internal errors are
redacted irrespective of field names, and the freshly normalized tree cannot
invoke a second JSON transformation. Repeated aliases are allowed, cycles fail
safely, and expected domain classification still uses error codes rather than a
message blacklist. No remaining bypass was found in the independently exercised
representations. All 102 frozen artifacts still match their frozen commit bytes.
No simulation benchmark was needed: this path executes only at the HTTP boundary.

## Follow-up: complete HTTP failure-boundary hardening

The final independent privacy review returned **C — REVISION REQUIRED**,
**R2 — SMALL CORRECTION STILL REQUIRED**, and **PHASE L NOT YET APPROVED**.
It found the main projector sound in exercised cases, but reproduced three
surrounding failure-path gaps: persistence codes bypassed normalization; default
console formatting executed custom inspection/stack getters; and exception
`instanceof` checks executed thrown-proxy prototype traps. Those historical
findings and the previous reports remain unchanged. This is a further candidate
on the same privacy branch, not an approval checkpoint.

Before production changes, the new wire tests reproduced hidden-ID leaks through
both `/commands` and `/session/open`. The initial 29 hardening regressions had
4 passes / 25 failures against the reviewed candidate. One additional regression
now protects the adjacent empty/non-JSON response failure case.

### Trust boundary and implemented invariant

Server-authored constants, codes validated against the existing
`PERSISTENCE_ERROR_CODES` list, known public validation contracts, and explicitly
configured server callbacks are trusted. Arbitrary thrown values, their fields,
prototypes, accessors, serialization/inspection hooks and boxed/proxy values are
untrusted. No message-text heuristic or additional persistence authority is used.

All dynamic response data crosses `sendPublicJson` before final stringify. The
only unprojected send is the last-resort internal-error envelope, constructed as a
prototype-free object containing trusted primitive constants. Unsupported values
produce that safe failure; an undefined/non-JSON serialization result cannot
become an empty successful response. Diagnostics never re-enter the public body.

| Outward path | Protection |
|---|---|
| Command results, including nested world/catch-up errors | Full recursive public normalization |
| Session open/heartbeat/end results | Same normalization |
| HTTP envelope/JSON validation failures | Known public validation type + own primitive message, then normalization |
| Command not exposed | Public message derived from validated caller command ID, then normalization |
| Stale session receipt | Fixed public receipt message, then normalization |
| Persistence failure on command/session paths | Own data descriptor only; existing known primitive code retained, otherwise `persistence.save_failed`; then normalization |
| Unexpected exceptions, projection/serialization failures | Safe diagnostics + trusted constant internal-error envelope |
| Outer command/session fallback catches | Same trusted internal-error envelope |
| Health and unknown-route responses | Normalization with safe internal fallback |

Persistence code validation never coerces, formats or calls methods on the
original code. Missing, unknown-string, object, class, boxed, accessor or proxy
codes fall back without exposing the source; real enum codes remain unchanged.

Exception classification does not use `instanceof` on arbitrary thrown values.
Node 24.19.0's native `util.types.isProxy` detector is checked before each bounded
prototype lookup, including revoked proxies and proxy links. Only known server
error prototypes authorize expected handling; everything else defaults internal.
Classification walks at most eight links. Public BadRequest messages must be own
primitive data; receipt/command messages do not read potentially malformed error
message fields. This changes no session or persistence behavior.

The default reporter snapshots at most 64 visited values, four levels, 12 fields
or array entries per container, and 1,024 characters per string/key. It records
own primitive data and accessor/function/proxy/truncation markers. It does not
invoke getters, coercion, custom inspection or `toJSON`. Stack is deliberately
omitted without reading its descriptor/value. Only serialized snapshot text
reaches console formatting. Original diagnostics remain available to explicitly
configured trusted server reporters under the existing API; reporter exceptions
remain isolated from public responses.

### Regression and adversarial evidence

**30 additional real-HTTP regressions** cover both persistence routes with boxed,
null-prototype, class, accessor, proxy, unknown-string and valid primitive codes;
actual default logger inspection/accessor/serialization hooks and bounded output;
all four thrown-proxy routes; revoked/prototype proxies; malformed public messages;
useful public validation/receipt/command errors; reporter exceptions; and an
unserializable top-level response. Hidden NPC Trade proposal/context IDs are
checked against final wire text. All earlier privacy regressions remain intact.

An initial full-run failure exposed overlapping stderr interception in the test
harness: the legacy full runner starts registered async cases concurrently. The
shared default-logger capture now has serialized ownership and restores the sink
in `finally`; production scheduling is unaffected and no assertion was removed.
Focused validation explicitly awaits every registered case. The corrected full
run completed successfully.

A separate post-test probe recreated the boxed persistence bypass on both routes
and added array-code/accessor and inherited-code-getter variations, unknown Error
hooks, native stack formatting and all four thrown-proxy routes. Across ten actual
HTTP requests: **zero hidden-ID occurrences**, **10 useful diagnostic entries**,
and measured counters **toJSON 0 / custom inspection 0 / accessors 0 / proxy traps 0
/ native prepareStackTrace 0**. Canonical fixture state remained identical.

| Final validation | Result |
|---|---|
| New hardening regressions | 30 passed / 0 failed |
| Privacy/HTTP focused | 50 passed / 0 failed |
| HTTP bridge | 1 passed / 0 failed |
| Phase L | 143 passed / 0 failed |
| Phase A–L | 837 passed / 0 failed |
| Integration | 319 passed / 0 failed |
| Full suite | 1,916 passed / 0 failed |
| Production TypeScript | PASS |
| Test-inclusive TypeScript | Same 28 baseline file/code/full-message identities, zero new/removed; expected exit 2 |
| Diff whitespace | `git diff --check`: PASS |

The same validation commands documented above are used. Privacy-focused filtering
includes `Phase L privacy:`, `Phase L R2: HTTP`, and `Phase L HTTP boundary:` cases.
The increase from 1,886 to 1,916 is exactly the 30 added regressions. No simulation
benchmark is needed: these helpers run only at the HTTP/diagnostic boundary.

Scope remains the same three files: HTTP source, its regression module and this
record. Schema 27, GameState, RNG, simulation ordering, CAS, persistence semantics,
Attention, reservations, operations and all five approved R2 corrections are
unchanged. Spatial/cargo recovery, broader battle timing, non-player invasion
rearming, required-window interpretation, Attention tuning and compaction remain
deferred. Changes remain unstaged/uncommitted for independent re-review; no push,
merge, REP-WARS-3 change, Phase M, Temporal V2 or reconciliation is performed.
