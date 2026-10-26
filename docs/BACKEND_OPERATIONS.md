# Backend operation and recovery contract

This is an engineering runbook, not evidence that a hosted service, backup, identity provider or database migration has been deployed. No live database was used during this work.

## Local development

Use Node 24 and the committed npm lockfile. Run `npm ci`, `npm run typecheck`, `npm run typecheck:tests`, `npm run build`, then `npm test`. The runner awaits promises and reports credential skips separately. The GitHub workflow repeats these checks; its hosted execution remains unverified until this branch is reviewed and shared.

`REP_WARS_ALLOW_DEVELOPMENT_IDENTITY=true npm run server` explicitly enables caller-selected identity on **localhost only**. Never use this bypass for an accessible deployment. `NODE_ENV=production` rejects that entry point. `.env.example` is documentation; the program does not silently load it. With neither Supabase setting, local development is ephemeral. One missing setting or a non-HTTPS URL is an error.

## Production composition

`src/server/production.ts::createProductionHttpServer` composes the existing Supabase world/history RPC path with required trusted authentication and readiness callbacks. It does not listen or deploy. It requires Supabase configuration and has no memory fallback. Development invasion fixtures are forbidden. `createCommandHttpServer` also rejects a memory host when `NODE_ENV=production`.

The deployment adapter must verify the chosen provider's signature, issuer, audience, validity and revocation policy as applicable, then map the verified principal to an existing durable Rep Wars player ID. Do not use a body field, unverified JWT decode, lease ID or request ID as authentication. Do not reassign an old player row by accepting a new arbitrary mapping. Provider choice and account linking require approval.

An omitted provider rejects all protected routes. Invalid credentials return 401; conflicting body identity returns 403; unavailable authentication returns 503. This applies to `/commands`, `/session/open`, `/session/heartbeat` and `/session/end`. Legacy clients may continue sending their own playerId, but it must match the verified principal.

`/health` is process liveness. `/ready` returns 200 only with a configured trusted identity adapter **and a successful explicitly supplied dependency probe**. No probe, a false result or an exception returns 503. The deployment probe must perform bounded, read-only dependency checks (including the actual database/RPC availability), enforce an I/O deadline, and return a boolean. Merely setting credentials does not prove database readiness. No dependency exception is returned to clients.

TLS termination, CORS/CSRF treatment appropriate to the selected authentication transport, request rate limits, adapter I/O cancellation, host scaling, alerts and log retention are deployment gates. They are not implemented by this runbook. Configure and load-test the cache and host-admission limits described below as part of those gates. The existing bounded non-executing HTTP diagnostic snapshot is retained; do not replace it with raw arbitrary-object inspection or log tokens/service keys.

### Player-world cache retention

`createSessionHost` and `createProductionHttpServer` accept the trusted deployment option `maxCachedPlayers`: a non-negative safe integer, default 128. Zero disables idle retention. This is a process-memory policy, not a gameplay capacity, lease duration or time limit. Requests cannot choose it.

The host evicts the least recently requested idle worlds until the retained count is within the limit. Queued/running work pins its player entry so there is always one local command chain for that player. Pending players may temporarily exceed the retention limit, subject to host admission below. The limit counts worlds, not bytes, and does not bound an in-memory development persistence store or the size of one world.

Eviction performs no save, gameplay advancement or lease end. The next request loads persisted canonical state and its receipts/version. The existing commit path must persist successful changes before a request settles; Supabase CAS/world-history RPC remains the final authority. Any thrown request invalidates its cached state. Already queued work reloads before execution; once idle, an invalid entry is discarded. A failed reload returns an error rather than publishing an old draft. An ambiguous commit response is resolved by persisted state/receipts, without automatic re-execution of the failed command. Cache retention does not replace database transaction guarantees.

### Pending host requests

`createSessionHost` and `createProductionHttpServer` also accept positive-safe-integer `maxPendingRequests` (default 256) and `maxPendingRequestsPerPlayer` (default 16). These count queued plus running requests within one host, across commands and all three session-lifecycle methods. They are deployment parameters, not gameplay quotas, time windows, cooldowns or account entitlements. HTTP request fields cannot override them.

Capacity is checked before loading another world or entering its command chain. Rejection produces `RequestCapacityError`; all four protected HTTP routes return **503** with `{ "error": "SERVER_BUSY", "message": "Server is busy. Please retry this request.", "retryable": true }`. No world save, lease renewal, receipt consumption or history update is performed for that rejected attempt. Expected capacity errors are not logged as internal failures. Capacity is released on success, validation failure, persistence conflict, exception and initial load failure.

Clients may retry using the same logical command/session identities and request ID. Preserve the existing sequence and lost-response rules; do not create another reward or command identity to bypass pressure. Use client/deployment retry backoff without making it a gameplay cooldown. There is no server-mandated retry time in this response.

These limits protect the host's accepted queues and pinned worlds. They do not limit connections, request bodies being read, authentication-provider calls, requests per second or the duration of one accepted command. The simulation/persistence path is synchronous: one expensive chunk can still occupy the Node event loop before another HTTP callback runs. Configure upstream request/connection limits separately. Authentication and readiness response budgets are described below; adapters must still enforce I/O cancellation. Historical work is now bounded as described below; no accrued simulation time is discarded.

### External verification budgets

`createCommandHttpServer` and production composition accept trusted `authenticationLimits` and `readinessLimits`, each with optional `maxPending` and `timeoutMs`. Authentication defaults to 64 outstanding callbacks and a 5,000 ms deadline; readiness defaults to one and 2,000 ms. These settings are never read from request JSON. Invalid counts/timer ranges fail at construction.

Authentication saturation, exceptions and elapsed deadlines use the existing 503 `AUTHENTICATION_UNAVAILABLE` response before world access. Readiness returns 503 unless the bounded probe returns exactly true. All four player routes share the authentication budget. A timed-out callback remains counted until it actually settles, and late results cannot authorize a request. `/health` remains independent.

Adapters receive an optional `AbortSignal` and must enforce bounded, nonblocking I/O. Old callback signatures remain compatible. Deadline timers cannot preempt a blocked JavaScript event loop, and cancellation cannot forcibly terminate a promise that ignores it. The monotonic result check still rejects an elapsed identity. Completely stuck adapters fail closed until they recover or the operator replaces the process. See `BACKEND_DEPENDENCY_BOUNDS.md` for tests and limitations.

## Commands, time and retries

### Bounded historical processing

`createSessionHost` and production composition accept trusted `maxCatchUpChunks` (positive safe integer, default 4). Each chunk retains the existing maximum 64 ticks and invasion-boundary ordering. All earned target/fraction metadata is preserved while `worldTick` advances only through completed work.

Sync responses expose `remainingTicks`, `complete`, `accruedTargetWorldTick` and `backlogTicks`. A partial successful sync is a normal receipted command; use a new sequence to continue, and the same sequence only to recover its lost response. If another gameplay command exhausts its catch-up budget first, `WORLD_CATCHUP_PENDING` means its handler has not executed and its sequence remains reusable. Retry that same logical command; do not display it as successful. Historical work may already have committed, so use the returned progress or reload state. No mandatory delay or new gameplay timer is introduced.

This bounds historical chunks per server request, not CPU milliseconds or all work within one chunk. Direct trusted engine/test calls can still drain an explicit target. See `BACKEND_BOUNDED_CATCHUP.md` for compatibility, receipt and validation details.

The trusted session host captures one receipt. `executeAtAuthoritativeReceipt` overrides request `now` before workout/handler execution. Reported exercise measurements remain client-reported evidence under the existing integrity policy; server time is not proof of physical exercise.

Keep the server-issued gameplaySessionId, monotonic commandSequence, renewalSequence and requestId across a lost response. The latest durable command receipt replays the original result; stale sequences are rejected. Older requests are not a permanent replay journal. Reward settlement additionally uses the existing durable applied-reward identity, not a receipt-only or client-side paid flag. On persistence conflict reload canonical state; never merge losing drafts or fabricate another successful result. Newest workout payout/reconnect DTOs are already available from R1-F.

Seven existing player diplomacy commands are now exposed: OFFER_PEACE, RESPOND_PEACE, WITHDRAW_PEACE, TRADE, RESPOND_TRADE, WITHDRAW_TRADE, COUNTEROFFER_TRADE. Exact-plan identity, ownership, reservation, Attention, timing and domain validation remain mandatory. Unsupported historical DECLARE_WAR/NEGOTIATE and internal-only REINFORCE are not advertised publicly. ADVANCE_WORLD, AI_DECIDE and internal operation commands remain unexposed. Use SYNC_PLAYER_WORLD for earned time.

## Schema 30 and world content

Schema 30 adds `definitionContentFingerprint: string | null` to GameState. No SQL table change is required: the existing envelope stores schemaVersion and the JSON payload. New authored worlds pin a canonical SHA-256 fingerprint. Hydration and GET_WORLD_DEFINITION reject a changed pinned definition before rebinding its immutable fields. Responses expose the content identity and actual saved pin for client comparison.

The `rep-wars-world-content.v1` algorithm includes world identity, geometry, adjacency, terrain, resource output, starting military/economic/faction data, regions, diplomacy and completion. Object-key ordering, known set ordering and ring winding/start vertex do not create spurious revisions. Cosmetic composition/camera data and separately versioned, start-locked workout pricing are excluded. This is a compatibility fingerprint, not authentication, a content distribution service, or automatic migration approval.

Schema 29 and older saves migrate with a **null** pin. They retain the existing legacy rebind behavior; the backend cannot reconstruct absent historical geometry. Never describe these saves as protected by a verified historical hash. Audit/archive the old definition bytes before approving a migration. Keep both current Level 1 variants untouched until product/Unity review selects a contract. Do not replace registered content under an existing pinned identity just to make loading succeed.

## Database preparation and verification

Review and apply the existing migrations only to an approved environment:

- `supabase/migrations/20260926012500_persistence_envelope.sql`: player worlds, history, telemetry, RLS and service-role permissions.
- `supabase/migrations/20260926170000_atomic_player_world_commit.sql`: compare-and-swap world/history transaction; execution revoked from public/anon/authenticated roles.

The application uses `state_version` as the final optimistic serialization boundary. Workout world mutations and history upserts use `commit_authoritative_player_world`, not separate production writes. The in-memory tests and local table fakes do not prove deployed SQL grants, isolation, RPC availability or restart durability.

Run live tests only with an explicitly approved disposable/non-production database, both credentials and `REP_WARS_RUN_LIVE_SUPABASE_TESTS=true`. They create and delete test-owned rows. The default suite skips the three live cases and counts them as skips. No production credentials may be used merely to turn a test green.

## Backup, rollback and restore rehearsal

Before enabling schema-30 writes, an operator must take and verify a coordinated database backup, record commit/schema/content hashes, and retain the matching workout catalog/world JSON and secure provider-to-player mapping. Define retention and recovery objectives with the deployment owner. A backup file that has never been restored is not a verified recovery system.

Restore into an isolated database with writes disabled; restore worlds **and history from the same consistent snapshot**, plus content/catalog artifacts. Validate envelope versions, hydrate every sampled schema, run canonical invariants, inspect active operations/claims, leases, receipts, unpaid sessions, pending/applied rewards and history. Rehearse lost-response retries, a stale writer, atomic history failure, server restart and backlog processing before resuming writes. Do not print full player payloads or secrets into logs.

Do not roll a schema-29 binary over schema-30 saves: it should reject the newer schema. Rollback requires restoring the matching pre-upgrade snapshot (with an explicit decision about subsequent legitimate progress) or a separately reviewed reverse migration. Do not erase schema numbers, reward receipts or content pins. Do not restore only the world or only workout history. Do not reroll seeded battle outcomes or process backlog as a migration side effect.

Corrupt or mismatched saves fail closed and require investigation. Preserve the failed payload and diagnostics in approved private storage; do not reset a player's world as an automatic repair. Hosted backups, restore drills and live recovery remain unverified infrastructure work.

## Larger-world evidence

See `BACKEND_VALIDATION_SCALE.md`: eight seeded engineering cases preserve exact canonical results across chunked reload and whole catch-up. A 50-territory/8-AI day case still has a one-chunk request near 4.8 seconds. Chunk bounds are not a CPU deadline; do not promise low latency from the default setting alone. World-definition validation also runs on hydration, and large payloads/history increase persistence costs. No production traffic capacity or hosted monitoring result is inferred from these local tests.
