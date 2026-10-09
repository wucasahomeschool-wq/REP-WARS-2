# Independent Phase H review

## Verdict and scope

Review passes after four Phase-H-scoped corrections and the validation below.
The checkpoint's direct parent is
`2812e3547feed67191f13ef6a9ceef1e081d7983` on local `work`. Schema remains 23.
Final scope is 52 files: 42 modified and 10 new, including this review record.
The checkpoint includes only Phase H and these review corrections. Nothing is
pushed and Phase I / Trade is not started.

The final AI Source of Truth remains the product authority. Section 33 requires
hostile clearance before finalization. No older tentative ordering is revived.

## Defects reproduced and corrected

1. **Direct hostile travel lost clearance ownership after invalidation.**
   `invalidateStaleAttackIntents` preserved movement but cleared its intent.
   `hostileLifecyclesBetween` could then overlook a direct player attack with no
   AI operation wrapper, and prematurely start Peace finalization. A regression
   reproduced this using authoritative ATTACK, OFFER/response, third-party
   occupation and save/reload. Staging `ArmyMovement` now retains the original
   hostile counterparty. Clearance includes moving/blocked hostile marches;
   physical arrival naturally clears the movement. Migration populates the
   field only from known intent/operation linkage. Invariants prevent a march
   from impersonating another pair. No spatial recovery policy is invented.
2. **Negative historical treaty dates could fabricate a Peace exception.**
   `migratePeaceState` accepted safe-integer negative `signedTurn`. Migration
   now requires a nonnegative signed boundary. Invalid scalar dates are not
   imported; structurally corrupt legacy payloads fail closed. Tests cover
   negative, malformed, future and expired dates plus idempotent hydration.
3. **Factual danger hid already-committed attacks after acceptance.**
   `StrategicEvaluators.localDanger` filtered every force through current WAR
   legality. That incorrectly erased actual committed threats during clearance.
   The evaluator now retains exact valid committed attacks while excluding
   uncommitted forces that cannot legally initiate new hostility. The regression
   proves both distinctions and reload equivalence. No score weight, combat
   calculation or evaluator registry is changed.
4. **Historical helpers still advertised DECLARE_WAR as executable.**
   The canonical command already rejected declarations, but
   `EXECUTABLE_COMMITMENT_ACTIONS` contradicted that boundary. Declarations now
   belong to the unsupported historical set, with a regression covering both
   helper and command classifications. Serialized symbolic compatibility remains;
   declarations cannot create WAR or terminate Peace.

The earlier Phase H corrections for third-party objective invalidation,
expired-spacing wakes, and zero-defender invasion occupation were independently
checked. The latter still uses existing occupation semantics after the existing
invasion lifecycle. Real field defenders and earned mobilization still invoke
BattleEngine; duplicate invasion resolution cannot capture or resolve twice.

## Authority and lifecycle findings

| Review area | Evidence and result |
| --- | --- |
| Default WAR | `relationships.relationshipBetween` reads only canonical bilateral exceptions; missing records, neutral/friendly/allied sentiment and positive Opinion cannot create non-hostility. |
| Legacy migration | `peaceMigration.migratePeaceState` imports only explicit signed unexpired non-aggression treaties, retains authored expiry, preserves operations/claims and fabricates no offers, acceptance, relief or historical outcomes. Active physical hostility imports as clearance. |
| Pending offer | Bidirectional authoritative ATTACK tests succeed while status is pending; the pair remains WAR. No scoring-only ceasefire exists. |
| Acceptance serialization | Real `InMemoryGameStateStore` CAS tests cover both writer orders. An attack committed first survives acceptance; an acceptance committed first rejects the stale attack on reload/retry without sequence, Attention, claim or domain mutation. |
| Existing hostilities | Operation/intent/movement/invasion links remain physical authorities. Acceptance changes legal relationship only; claims, exact target, travel and invasion continue. |
| Complete clearance | `hostileLifecyclesBetween` checks both factions' relevant active work. Finishing one of two different attacks does not start finalization or release the other's Attention. Terminal history does not block clearance. |
| Third-party transfer | Existing occupation reducer supplies the ownership transition. Objective invalidates, elapsed travel and force commitment remain, and no attack retargets to the new owner. Direct and operation-linked cases are protected. |
| Interrupted topology | A direct hostile march retains its route, start boundary, halted progress and unavailable `blocked` status across reload; clearance remains pending. No destination-selection policy was added. |
| Fresh hostility blocks | Compatibility plus domain initiation reject bilateral fresh attacks symmetrically during clearance and PEACE. Direct stale command tests preserve canonical state on failure. |
| Ordering | Acceptance -> clearance -> 2/10-second finalization -> PEACE. Finalization cannot begin while actual hostilities remain. Promotion after clearance preserves no-demotion semantics. |
| Proposer Attention | Acquired atomically at initiation, retained while pending, centrally released once at ACCEPT/DECLINE/expiry/withdrawal/invalidation. No charge remains through clearance or PEACE. |
| Initiation | 1/30 seconds, exact counterparty, persisted progress. Initiating ledger records identify unpublished intent; invalidation publishes no offer. Failed starts grant no relief/spacing. |
| Relief/spacing | Publication closes the primary initiation and applies source relief/spacing once. Recipient response and physical completion cannot repeat proposer relief. |
| Required lane | Recipient response requires neither Pressure nor ordinary Attention availability nor proactive spacing. It produces ACCEPT_PEACE/DECLINE_PEACE, not WAIT/OFFER/NEGOTIATE. Unfinished thought can be preempted; committed initiation is preserved. |
| Timers | AI response is sampled once at 3–8/30–80 seconds; player window 300/7200. Timers persist with promotion/no-demotion and no client-time authority. |
| Wakeup/coalescing | Expired spacing cannot produce tiny repeated wakes while a required response is pending. An unexpired spacing timer does not block a due required response. |
| Multiple responses | Real required responses from different counterparties to one faction are ordered by deadline urgency, publication boundary, then stable identity; reversing persisted map/index order does not alter responses or history. |
| Pair uniqueness | Unordered full-ID pair keys prevent reverse/same duplicate offers; different pairs coexist. Terminal history is separate from the live-pair index. |
| Withdrawal/expiry/invalidation | Only a player can withdraw their own pending offer. AI never voluntarily withdraws. Expiry creates no consent/cognition; invalidation creates no accept/decline. Pair index, response timing and Attention settle once. |
| WAR_VALUE | Still factual and intentionally low-information: current border position and contingent committed facts, no Memory history, invented weariness/casualties or economic war penalty. Conflict Ledger is deferred. |
| Counterparty estimate | Minimal proposer/recipient/relationship input, acceptance bounds `[0,1]`, limited confidence and no private recipient model. It is support, not evaluator eight or recursive AI. |
| Actual response | `peaceAssessment.assessRequiredPeaceResponse` separately reads the recipient's own current canonical facts and bounded own Goal/Opinion/risk interpretation. Raw Memory is excluded. |
| Goal/Opinion boundaries | Own modifiers can affect comparison/response but cannot alter legal relationship, factual WAR_VALUE, timers or lifecycle. No Goal/Opinion lifecycle redesign. |
| Treaty time domain | New 24-hour expiry is an absolute REAL_WORLD deadline (`expiresAtMs` against receipt-anchored `aiClock.nowMs`), not rated simulation work. Presence never multiplies the term. SOT says real-world deadlines ignore presence multipliers; the term itself remains provisional, not locked design. Imported historical turn deadlines retain their authored domain. |
| Peace end | Exception removal returns automatically to WAR, once. No declaration, forced attack or forced new proposal. Ordinary observation resumes normally. |
| Same-instant order | Production `executeAtAuthoritativeReceipt` regression aligns a physical arrival/capture and player response expiry. Arrival applies before the deadline gate. Client timestamp cannot jump the receipt frontier. |
| Privacy | `publicPeaceState` exposes only participant-visible published status/player window and legal relationship exceptions. No private evaluator output, estimate, modifiers, Pressure, Goals/Opinion/Memory, RNG or internal timer progress is exposed. |
| History | Stable lifecycle event IDs plus terminal guards prevent duplicate response, settlement, activation or end. History is not relationship authority. Existing recent-event retention remains unchanged. |
| Pressure | Exact DIPLOMACY_PEACE source plans require legal WAR pair, no live pair thread, current proposer feasibility/Attention. Pending offers block duplicate offers instead of full reconsideration churn. |
| Seven evaluators | BATTLE_OUTLOOK, TERRITORY_VALUE, LOCAL_DANGER, FORCE_POSITION_VALUE, RESOURCE_VALUE, BUILD_VALUE, WAR_VALUE. No PEACE_VALUE or extra desirability authority. |
| Persistence | Deep proposal/relationship timer clones, stable pair/operation IDs, linkage/timing/terminal invariants, retained operation high-water marks. Schema remains 23; caches/diagnostics are derived. |

## Tests and scope

Sixteen additional regressions strengthen Phase H from 69 to 85 tests. These
exercise authoritative command/receipt paths, real CAS saves/reloads, simultaneous
physical/deadline boundaries, own-state response ordering, active hostility,
corrupted linkage, invasion defense and factual baseline semantics.

No existing assertion was weakened to hide a failure. Previous fixture updates
retain their schema or explicitly isolated noncombat/recruitment purpose. Review
corrections change no packages, settings, assets, Unity, workout/reward systems,
battle math, movement/construction duration, recruitment tuning, CAS semantics
or unrelated balance. Provisional term/weight values remain centralized and
unchanged.

## Final validation

| Check | Result |
| --- | --- |
| Phase A | 17 passed |
| Phase B | 28 passed |
| Phase C | 60 passed |
| Phase D | 41 passed |
| Phase E | 55 passed |
| Phase F | 73 passed |
| Phase G | 78 passed |
| Phase H | 85 passed |
| Independent anchors | 16 passed |
| Affected invasion | 24 passed |
| Affected economy foundation / cities / developments | 22 / 24 / 15 passed |
| Affected persistence | 45 passed |
| Affected temporal/schema/session/replay group | 117 passed |
| Complete suite | 1,516 passed, 0 failed |
| Production TypeScript `--noEmit` | Passed |
| Test-inclusive TypeScript | Same 28 pre-existing diagnostics; identical diagnostic fingerprints excluding source line/column shifts |
| `git diff --check` | Passed |

Tests ran through the installed Node TypeScript/ts-node entrypoints. Temporary
focused runners and diagnostic instrumentation remained outside the checkout.
Focused/integration suites are subsets of the complete suite, not extra tests
to add to its count.

## Performance diagnostics

Final measurements were rerun after the regression suites finished, using the
same production progression and temporary instrumentation as the initial report.
Elapsed times are diagnostics of this environment, not product guarantees.

| Fixture | Elapsed ms | Timer updates | Required deliberations | Responses | Clearance checks | Relationship transitions | Proactive deliberations | Retained history / resolution rows |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| No proposals, 66 pairs, 10,000 ticks | 4,565 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 0 |
| Six simultaneous pairs | 16 | 24 | 6 | 6 | 12 | 12 | 0 | 24 / 0 |
| Accepted offer during long attack | 35 | 3 | 0 | 1 player response | 71 | 1 activation | 0 | 0 after existing retention / 0 |
| Reload required response, two branches | 4 | 9 | 2 across branches | 1 per branch | 4 across branches | 4 across branches | 0 | 4 per final branch / 0 |
| Player expiry | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 2 / 0 |
| Peace expiry | 1 | 2 | 1 | 1 | 2 | 3 | 0 | 5 / 0 |
| Mixed WAR, pending, clearance, Peace and unrelated MOVE | 8 | 6 | 1 | 2 including player acceptance | 27 | 2 | 0 | 8 / 0 |

The no-proposal world has twelve active factions but no forces/useful funded
plans. WAR alone is not actionable pressure. It performs 240,000 cheap observer
calls and zero proposal timers, full diplomacy/proactive deliberations, proposals
or history/resolution rows. This is legitimate dormancy, not disabled cognition.

The mixed fixture uses authoritative exact ATTACK/MOVE/OFFER commands and real
response progression. It retains a pending player offer, a clearance pair with
actual hostile travel, an active Peace pair, several default-WAR pairs and an
unrelated moving force simultaneously. Three operations remain active without
overwriting one another. No unrelated proactive thought is generated.

Reload branches produce equal encoded canonical results. Branch-level metrics
are explicitly aggregated across two equivalent runs, not duplicate outcomes.
History-created instrumentation excludes manual command transitions; retained
canonical event rows include them. Long-travel history is trimmed by the
existing WorldSimulator policy, while durable proposal and operation outcomes
remain. The reported WorldAdvance resolution-row collector produces zero rows
for these fixtures even where the linked attack becomes terminal; its actual
canonical terminal status is independently asserted.

Classification: **bounded expected lifecycle workload**, with the earlier tiny
wakeup defect protected by regression. No pairwise full-cognition polling,
terminal-operation/proposal-history scan in live progression, new pacing rule
or compaction policy was introduced. Existing cloning/persistence/invariants
still validate retained records; historical compaction remains deferred.

## Checkpoint

Validated local checkpoint message: `AI: peace lifecycle and required responses`.
Its exact hash is available from Git and the completion report; this document
does not embed a self-referential commit hash. The direct parent remains the
Phase G checkpoint named above. The working tree must be clean after commit.
No remote branch is changed.

## Deferred contracts

- Original counterparties missing from ambiguous pre-H records cannot be
  fabricated from history. Existing domain linkage is preferred where available.
- Blocked-route spatial recovery remains undefined. Physical truth and clearance
  ownership stay preserved while that domain policy is unresolved.
- The 24-hour term and Peace comparison weight 70 remain initial non-final tuning.
- Conflict Ledger, richer authorized public counterparty estimates, Goal/Opinion
  lifecycle, general reactive/recovery scheduling, resource logistics, history
  compaction and Trade remain outside this review.

No push is authorized. Phase I is not started.
