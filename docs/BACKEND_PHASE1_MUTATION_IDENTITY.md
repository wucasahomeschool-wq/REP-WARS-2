# Backend Phase 1 — Durable Mutation Identity and Retry Safety

Implementation branch: `fix/backend-durable-mutation-identity`. Isolated worktree: `/workspace/REP-WARS-2-MUTATION-IDENTITY`.
Parent: `67280e363fd89f256cd770566a5676d6415af695` (the documentation-only audit atop gameplay checkpoint `e3f1781f8a53424462fabbd943cc01b0e2725154`). Schema **31 → 32**.

## Verdict and scope

**PASS for Phase 1 local/integration acceptance.** The original duplicate-deployment defect is fixed and the final backend suite reports **2,370 passed, 0 failed, 3 skipped**. Live Supabase concurrency remains a documented staging requirement, not a claimed completed proof. This phase addresses AUD-001 only. It does not finish the backend or authorize deployment. Tutorial compatibility, event persistence/eligibility/choices, catalog activation, gameplay balance and Unity implementation remain outside this change.

## Root cause, reproduced before the correction

The real authenticated `/commands` route called `createSessionHost.execute`. It checked `committedCommandReplay` only when a mutation included a gameplay-session lease. A request without sequencing could therefore run its handler, spend troops, and save again under a new state version on every retry. CAS prevented competing stale versions from both committing, but did not identify a sequential retry against the latest version.

The original regression started with 100 banked troops and sent the same identified deployment of 10 twice without a lease. The persisted bank was **80**, rather than **90**. The unchanged regression now expects and observes one deployment, one deduction and a replayed army ID. Temporary pre-fix evidence: `/tmp/backend-phase1/reproduction.log`.

The former per-lease receipt kept only the latest command. It compared sequence and requestId, not command meaning; tests even expected altered quantities or workout terms to replay. Final unmutated rejections were not retained. World restarts retained leases but had no attempt fence. Session lifecycle retries could accrue new time before detecting an old open/heartbeat/end.

## Authoritative design

The existing `GameplayCommandReceipt` is extended as `MutationReceipt`, retained in `GameState.commandReceipts`, keyed by the existing `requestId`. It adds an intent fingerprint and the originating `worldAttempt`. There is no new database, payment ledger, distributed lock, or gameplay authority. `lastCommandReceipt` is retained for lease/schema compatibility; logical replay reads only the retained collection. Both representations are written within the same world CAS.

`worldAttempt` starts at zero on initial creation/migration and advances exactly once on an actual world restart or transition. A rejected or rolled-back transition does not advance it. It does not replace the authored world ID, content fingerprint, army sequence, simulation tick or permanent reward identity.

The public execution order is:

1. HTTP authentication resolves the player row; the command allowlist remains unchanged.
2. Validate logical ID and attempt before loading/mutating a world. Capture the trusted receipt clock once.
3. Verify actor/faction authorization and ownership of any presented gameplay lease.
4. Look up the retained identity. Compare intent and original attempt before replay.
5. For a new request, enforce the current attempt, existing command ordering and lease-renewal rules.
6. Execute the existing Orchestrator/transaction/catch-up/handler/invariant path.
7. Retain the definitive result (or bind pending catch-up intent); commit it with the world and buffered history through CAS.
8. On a lost write acknowledgement or CAS conflict, reload authoritative state and resolve the same identity. Never rerun the handler automatically against newer gameplay state.

Same-ID replay does not advance clocks, renew leases, execute handlers, spend resources or save another version. A replay can recover its own historical outcome after a world change, explicitly carrying the **current** attempt in the response; it never applies that old action to the new world. Unknown requests bearing an old attempt are rejected. Reusing a retained ID with a different attempt is an identity conflict.

## Canonical intent and validation

- `requestId`: 1–128 ASCII characters; first character a letter or digit, remaining characters letters, digits, `.`, `_`, `:`, `-`. UUID strings are valid. The server never substitutes a fresh ID for a missing public mutation ID.
- `worldAttempt`: nonnegative safe integer obtained from the authoritative world view; it is required for every public mutation and session lifecycle request.
- SHA-256 over canonical command type plus parameters. Object keys are sorted recursively; arrays retain order. No raw-JSON-order comparison.
- `parameters.now` is excluded because `executeAtAuthoritativeReceipt` replaces it with the server clock. Envelope timestamp, clientContext, commandSequence and renewalSequence do not choose the gameplay meaning.
- Other supplied parameters participate, including unsupported extra fields. Changing an obsolete client seed is an identity conflict, not a way to reroll combat. C3 still ignores client seeds when deriving battle randomness.
- Direct host intent input must be finite JSON data, with bounded nesting. Accessors/proxies/coercive objects are rejected; no `toJSON` or user coercion is used for hashing.
- Different IDs with identical parameters remain independent actions and pass through normal ownership, availability, reservation and balance checks.

## Complete public mutation coverage

Inventory comes from `src/server/allowlist.ts` intersected with `src/orchestration/commandIndex.ts`: **27 mutating commands**, all implemented. The single host gate applies to every row.

| Command | Category | Protection |
|---|---|---|
| `ATTACK` | COMBAT | Required ID + attempt; retained receipt + CAS |
| `MOVE` | ARMY | Required ID + attempt; retained receipt + CAS |
| `BUILD` | TERRITORY | Required ID + attempt; retained receipt + CAS |
| `OFFER_PEACE` | DIPLOMACY | Required ID + attempt; retained receipt + CAS |
| `RESPOND_PEACE` | DIPLOMACY | Required ID + attempt; retained receipt + CAS |
| `WITHDRAW_PEACE` | DIPLOMACY | Required ID + attempt; retained receipt + CAS |
| `TRADE` | DIPLOMACY | Required ID + attempt; retained receipt + CAS |
| `RESPOND_TRADE` | DIPLOMACY | Required ID + attempt; retained receipt + CAS |
| `WITHDRAW_TRADE` | DIPLOMACY | Required ID + attempt; retained receipt + CAS |
| `COUNTEROFFER_TRADE` | DIPLOMACY | Required ID + attempt; retained receipt + CAS |
| `SYNC_PLAYER_WORLD` | WORLD | Required ID + attempt; retained receipt + CAS |
| `RESTART_WORLD` | WORLD | Required ID + attempt; retained receipt + CAS |
| `DEPLOY_TROOPS` | ARMY | Required ID + attempt; retained receipt + CAS |
| `TRANSITION_TO_NEXT_WORLD` | WORLD | Required ID + attempt; retained receipt + CAS |
| `START_CONSTRUCTION` | TERRITORY | Required ID + attempt; retained receipt + CAS |
| `APPLY_CONSTRUCTION_ACCELERATION` | TERRITORY | Required ID + attempt; retained receipt + CAS |
| `COLLECT_RESOURCES` | ECONOMY | Required ID + attempt; retained receipt + CAS |
| `SET_PLAYER_PAUSE` | TERRITORY | Required ID + attempt; retained receipt + CAS |
| `START_WORKOUT` | FITNESS | Required ID + attempt; retained receipt + CAS |
| `PAUSE_WORKOUT` | FITNESS | Required ID + attempt; retained receipt + CAS |
| `RESUME_WORKOUT` | FITNESS | Required ID + attempt; retained receipt + CAS |
| `RECORD_EXERCISE` | FITNESS | Required ID + attempt; retained receipt + CAS |
| `SKIP_REST` | FITNESS | Required ID + attempt; retained receipt + CAS |
| `SUBMIT_WORKOUT_FEEDBACK` | FITNESS | Required ID + attempt; retained receipt + CAS |
| `FINALIZE_WORKOUT` | FITNESS | Required ID + attempt; retained receipt + CAS |
| `ABANDON_WORKOUT` | FITNESS | Required ID + attempt; retained receipt + CAS |
| `RECORD_INTEGRITY_FLAG` | FITNESS | Required ID + attempt; retained receipt + CAS |

| Other public entry point | Protection |
|---|---|
| `POST /session/open` | Same retained receipt namespace, attempt fence, CAS; replays original issued session without accrual |
| `POST /session/heartbeat` | Same contract; session ID and renewal sequence are part of heartbeat intent |
| `POST /session/end` | Same contract; session ID is part of end intent |
| Seven public reads (`GET_COMMAND_INDEX`, `GET_GAME_STATE`, `GET_VISIBLE_WORLD`, `GET_WORLD_DEFINITION`, `GET_FITNESS_CATALOG`, `GET_WORKOUT_SELECTION`, `GET_WORKOUT_REWARD`) | No logical mutation ID required; no command receipt acquired |
| Health/readiness and unknown/unexposed routes | No gameplay handler; existing rejection/health behavior |

First world provisioning still uses the existing ensure/create/CAS mechanism. Reads may initialize a missing player row; they cannot repeat a deployment or reward. Internal AI, world progression and direct trusted Orchestrator harness commands retain their existing identities and execution rules. They are not alternate public mutation endpoints. Defense and other specialized workout effects enter through the existing workout commands. No event-choice endpoint was added.

## Retry outcomes for clients

| Situation | Result / action |
|---|---|
| First successful committed command | Existing response plus `mutationOutcome: "committed"`, current `worldAttempt` |
| Same ID, intent and originating attempt already committed | `idempotentReplay: true`, `mutationOutcome: "replayed"`; original compact payload and error code/message; no effects repeated |
| Definitive gameplay rejection | Retained `mutationOutcome: "rejected"`; the same ID stays rejected even if balances later improve. A genuinely new attempt needs a new ID |
| ID reused with different type, terms or attempt | `COMMAND_IDENTITY_CONFLICT`; no write, no replacement of original result |
| Missing/malformed ID or attempt | `COMMAND_IDENTITY_INVALID` in command envelope; session routes return existing bad-request response (HTTP 400); no world load/mutation |
| New/unknown ID from another attempt | `COMMAND_ATTEMPT_STALE`; no write. Do not automatically attach the new attempt to a delayed old action |
| Unknown/invalid actor or lease | Existing authorization/session rejection before replay; no other player's data disclosed |
| New ID using consumed/stale lease sequence | Existing `COMMAND_SEQUENCE_CONFLICT` / `COMMAND_STALE`; logical replay is checked first |
| CAS loss, same ID won elsewhere | Reload and return winner's receipt, or identity conflict if winner used different intent |
| CAS loss, no final receipt | Existing `persistence.conflict`; no hidden re-execution/merge. Refresh/reconcile before retrying the unchanged logical action |
| Capacity/authentication timeout, unavailable configuration, engine/invariant failure | No final gameplay rejection receipt; existing retryable failure handling. Keep the same ID and terms |
| Uncertain commit acknowledgement | Command execution reads the persisted receipt immediately if possible; a thrown session-lifecycle save acknowledgement is resolved by its next retry, which reloads before applying anything. If re-read fails, propagate the safe infrastructure error and discard/mark stale the cached draft. Retry with the same ID after reconnect |
| `WORLD_CATCHUP_PENDING` | Commit earned historical progress plus intent binding, not final execution or lease sequence. Same ID continues catch-up; changed intent conflicts |
| Successful partial `SYNC_PLAYER_WORLD` | One slice is a completed logical sync request. Retry replays that slice. A deliberate next sync uses a new ID/sequence, preserving the existing bounded-sync contract |

Compact replay follows the former receipt format: payload is JSON-normalized, errors retain code/message, and transient events, presentation, state-change lists and notifications are empty. Clients must not animate/spend/apply the outcome twice; GET_GAME_STATE refreshes current state. Session responses use `outcome: "idempotent_replay"` and `replayedOutcome` to distinguish the original result (including unknown/expired sessions), plus current `worldAttempt`. An identity conflict/stale attempt is `outcome: "rejected"` with an explicit `error` code. Existing session outcomes remain otherwise intact.

Final rejection means a durably committed handler/domain outcome, not an authentication, admission, sequence, CAS or infrastructure failure. Transient `ENGINE_ERROR`, `ENGINE_UNAVAILABLE`, `INVALID_GAME_STATE` and `WORKOUT_CONFIGURATION_UNAVAILABLE` are deliberately not finalized.

## Workout history and commit safety

Production retains the existing Supabase `commit_authoritative_player_world` RPC, `state_version` CAS and `RoutingHistoryStore`. Receipts are fields in its same JSON world payload; no SQL table or separate identity store is added. A production Supabase host now fails closed if configured without buffered atomic world/history capability.

The development memory provider previously wrote history before a world save. It now implements the same buffered `commitWorld` interface: no history is published until CAS wins, and synchronous history failure rolls back the memory world, receipt and partial history together. Its lost-acknowledgement test path resolves only an exact candidate at the expected next version. This is a test/development equivalent, not durable storage across machine loss.

`RoutingHistoryStore.replacePlayer` now restores only its pending buffer when the Orchestrator rolls back a handler; it cannot overwrite/delete committed base history inside an open transaction. This lets a definitive invalid workout command retain a safe rejection without turning rollback into an internal formatter/storage error.

Legacy injected test adapters without the atomic interface retain their old fallback. They are not the production persistence composition and are not evidence of multi-worker history atomicity. Both built-in providers and all new workout concurrency tests use the buffered contract.

## Migration and compatibility

Schema **32** adds `worldAttempt` and retained receipts; cloning, transaction adoption, snapshots and invariants include them. Migration from schema 31 (and earlier supported schemas) initializes attempt zero and retains identifiable legacy latest-command/open/latest-renewal IDs with `intentHash: null`. It preserves old result payloads, armies, resource balances, rewards, receipts, fitness and lease data. No historical terms or older discarded receipts are invented.

A legacy retained identity with unknown intent returns `COMMAND_IDENTITY_CONFLICT` rather than accepting altered terms or executing again. Old clients lacking `worldAttempt` fail closed. Before rollout, reconcile/drain old pending client queues against authoritative state; never relabel an uncertain legacy action with a fresh ID/attempt automatically. Older discarded history cannot be reconstructed.

The new schema is not readable by older server builds. Back up saves and coordinate client/server rollout; do not downgrade schema 32 payloads by changing a number. No live database migration was executed here.

Unity must first read `payload.gameState.worldAttempt`, then persist the exact logical request until it has an authoritative outcome. Example:

```json
{
  "commandId": "DEPLOY_TROOPS",
  "requestId": "deploy-550e8400-e29b-41d4-a716-446655440000",
  "worldAttempt": 0,
  "parameters": {"territoryId": "t_02", "quantity": 10}
}
```

If the reply is lost, resend that same request. A second intentional deployment uses a new UUID. Sequenced clients additionally preserve the original gameplaySessionId/commandSequence/renewalSequence; they remain ordering/presence metadata, not payment authority. A new action after successful restart uses the newly returned attempt. `POST /session/open` likewise sends `{ "requestId": "open-<uuid>", "worldAttempt": 0 }`. Authentication selects the player; body IDs cannot select another player's row. No Unity files changed.

## Validation evidence

Personally executed on this isolated candidate using Node v24.19.0 (TypeScript backend; no Unity or live database mutation):

| Check | Command | Result |
|---|---|---|
| New identity regressions | `node node_modules/ts-node/dist/bin.js --project tsconfig.tests.json tests/mutationIdentity.ts` | **23 passed, 0 failed** |
| Full backend | `npm test` | **2,370 passed, 0 failed, 3 skipped** |
| Production TypeScript | `npm run typecheck` | **PASS**, no diagnostics |
| Test-inclusive TypeScript | `npm run typecheck:tests` | **PASS**, no diagnostics |
| Production build | `npm run build` | **PASS** |
| Whitespace | `git diff --check` | **PASS** |

The original duplicate-deployment regression failed before the implementation (80 banked instead of 90). Intermediate runs exposed expected old-protocol fixture mismatches, then one source-text lease-isolation assertion matched a newly added comment. The comment was corrected; the isolation assertion was retained. These intermediate runs are not presented as final passing evidence.

Existing tests were updated for explicit public identity/attempt fields and intentional replay semantics, not removed. In particular:

- Altered-payload retries now assert identity conflict; identical retries still assert conserved troops/resources and original results.
- Older retained receipts replay; unseen old sequences remain stale.
- Legacy unbound receipts are fenced rather than claiming unverifiable exact-intent replay.
- Different catch-up schedules naturally have different transport receipts. Those comparisons omit **only** `commandReceipts`, retaining all gameplay, attempt, clocks, RNG, reservations and lease fields. Duplicate replay tests still compare the complete snapshot byte-for-byte/structurally unchanged.
- New tests exercise real authenticated HTTP, independent host caches through shared CAS, reload/restart, movement/construction, campaign attempt changes, definitive rejection, session routes, atomic workout history rollback and production adapter enforcement.

The audited baseline reported 2,347 passes and three skips. The final count increases by exactly the 23 new identity tests; no existing tests were deleted. The three skips are live Supabase save/reload, atomic world/history rollback, and server restart durability, all requiring explicit non-production opt-in and credentials. Mock/shared-memory CAS and atomicity regressions executed successfully; they are not live database evidence.

The complete final run is `/tmp/backend-phase1/full-verified.log`; focused evidence is `/tmp/backend-phase1/identity-final-v2.log`. An earlier full run ended with 2,368 passes and the comment-only lease assertion failure; it is superseded by the clean final run. Production and test-inclusive compilation both have zero diagnostics; none were suppressed.

Repository preservation checks compare HEAD, full Git status and dirty-file SHA-256 hashes against the pre-work snapshot: all **20 earlier worktrees are unchanged**. Only this isolated branch receives the checkpoint; no merge, deployment or further roadmap implementation is authorized by this phase.

Temporary logs and analysis scripts are under `/tmp/backend-phase1/`; the committed regression tests are the reproducible artifact. No credential values or large generated logs belong in the checkpoint.

## Remaining limitations and next phase

1. **Live Supabase concurrency is not verified here.** Three existing credential-gated tests are skips, not passes. Before staging approval, use an explicitly authorized disposable database: two independent authenticated workers loaded at version N submit the same ID; assert one version/one effect/one receipt and one history row; inject lost acknowledgement and a failed history insert, then restart and retry. Also exercise a distinct-ID stale writer. Do not run this against live player data.
2. Receipts are retained without a silent expiration window. Save size and clone cost grow with accepted commands/heartbeats. A future retention/compaction design must preserve retired-ID protection and cannot simply delete old IDs. This phase does not claim unbounded lifetime-storage performance certification.
3. The direct internal Orchestrator remains a trusted engine/testing API, not a public retry boundary. Custom persistence adapters must implement the documented atomic contract; an arbitrary test callback is not a production storage guarantee.
4. Client protocol/schema rollout and reconciliation of uncertain pre-32 actions are required. No live data, production branches or Unity worktrees were changed.
5. The next roadmap phase is **Phase 2 — tutorial and deployed-force compatibility**. It was not started.

## Exact checkpoint file inventory

Production changes are limited to the public mutation boundary, canonical receipt migration/cloning, attempt carry-forward and atomic history buffering. Gameplay handlers, combat, AI policy, maps, workout rewards, balance and Unity were not changed.

### Production (17 files)

- `src/gameplay/worldRestart.ts`
- `src/gameplay/worldTransition.ts`
- `src/orchestration/authorization.ts`
- `src/orchestration/errors.ts`
- `src/orchestration/protocol.ts`
- `src/orchestration/publicView.ts`
- `src/persistence/supabase/commandHistoryBuffer.ts`
- `src/persistence/versioning.ts`
- `src/server/gameplaySessionLifecycle.ts`
- `src/server/http.ts`
- `src/server/persistencePort.ts`
- `src/server/session.ts`
- `src/state/cloneGameState.ts`
- `src/state/gameStateInvariants.ts`
- `src/types/GameState.ts`
- `src/world/mutationReceipts.ts`
- `src/world/presenceLeases.ts`

### Regression tests and contract fixtures (37 files)

`mutationIdentity.ts` contains the new regressions. `mutationTestRequests.ts` supplies explicit test-client IDs and canonical gameplay comparison. Other edits update schema assertions, public request envelopes and intentional retry expectations; no tests were deleted.

- `tests/aiCognition.ts`
- `tests/aiConflict.ts`
- `tests/aiPeace.ts`
- `tests/aiRecruitment.ts`
- `tests/aiResponseCorrections.ts`
- `tests/aiResponses.ts`
- `tests/aiStrategicPressure.ts`
- `tests/aiTrade.ts`
- `tests/armyIdentity.ts`
- `tests/backendBoundary.ts`
- `tests/backendScale.ts`
- `tests/battleSeedAuthority.ts`
- `tests/boundedCatchup.ts`
- `tests/commandIdempotency.ts`
- `tests/dependencyHttp.ts`
- `tests/economyFoundation.ts`
- `tests/gameplayContracts.ts`
- `tests/gameplaySessionLeases.ts`
- `tests/gameplaySessionLifecycle.ts`
- `tests/httpBridge.ts`
- `tests/invasionLifecycle.ts`
- `tests/leaseWorldAccrual.ts`
- `tests/mutationIdentity.ts`
- `tests/mutationTestRequests.ts`
- `tests/persistence.ts`
- `tests/presenceLeases.ts`
- `tests/requestAdmission.ts`
- `tests/run.ts`
- `tests/serverRestartDurability.ts`
- `tests/sessionCache.ts`
- `tests/sessionReplay.ts`
- `tests/strategicAccess.ts`
- `tests/temporalBoundaries.ts`
- `tests/workoutRewardApi.ts`
- `tests/workoutRewardContracts.ts`
- `tests/workoutSettlementRewards.ts`
- `tests/workoutStartRewards.ts`

### Documentation

- `docs/BACKEND_PHASE1_MUTATION_IDENTITY.md` (this report).
