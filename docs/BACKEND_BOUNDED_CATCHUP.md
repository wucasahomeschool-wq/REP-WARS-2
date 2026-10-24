# Backend continuation: bounded catch-up

Parent: `9a9c84685029c0b518678cfb9bd751c6d6c911cf`.
Isolated worktree: `/workspace/REP-WARS-2-CATCHUP`.
Branch: `feat/backend-bounded-catchup`.

## Contract

The server host processes at most `maxCatchUpChunks` historical chunks per mutating request (default **4**, trusted positive safe integer). Each existing chunk advances at most 64 ticks and still stops at invasion expiry boundaries. The limit is a work budget, never an earned-time cap. No schema change is needed: `accruedTargetWorldTick`, the fractional remainder, the accrual watermark and processed `worldTick` already persist independently.

`catchUpWorld` stops only between its existing chunks, keeping completion/AI/event ordering unchanged. Internal direct engine/tool calls retain their existing unlimited behavior unless supplied a limit; public clients cannot select that limit. One chunk can still be expensive, so this is not a hard elapsed-millisecond deadline or a worker-thread implementation.

### Sync

`SYNC_PLAYER_WORLD` commits the completed slice and returns its existing fields plus `remainingTicks`, `complete`, `accruedTargetWorldTick` and `backlogTicks`. `complete` and `remainingTicks` refer to the requested authorized target; `backlogTicks` includes **all** earned unprocessed time even when the caller requested a smaller target. A successful sequenced sync consumes its receipt normally. Retry of that same request replays its exact response; submit a new sync sequence to request another slice.

### Gameplay commands

The host still catches up before running a gameplay handler. If its budget is exhausted first, it commits only historical world/history work and returns `success: false`, error `WORLD_CATCHUP_PENDING`, and `payload: { retryable: true, commandExecuted: false, catchUp: { worldTick, targetWorldTick, remainingTicks, chunks, complete: false } }`. The HTTP envelope remains HTTP 200, consistent with existing command-domain failures.

The requested gameplay handler has **not** run. Its command sequence, command receipt and lease renewal are not consumed. The client retries with the same logical identity. That retry observes its current trusted server receipt, processes remaining earned history, then executes the command only when caught up. Deferral does not enqueue a persistent future command or reserve its initial receipt time; subsequent commands still follow normal serialized receipt rules. This introduces no gameplay cooldown or artificial time cap.

Completed slices and terminal workout-history upserts pass through the existing atomic Supabase world/history port and state_version CAS. A failed or ambiguous write reloads persisted truth through the prior cache correction. A stale writer cannot merge a losing slice. No RNG state or reward settlement is stored outside canonical state and existing ledgers.

## Implementation and tests

Source changes: `world/catchup.ts` (chunk limit/progress), `orchestration/handlers.ts` (trusted runtime option), `orchestration/orchestrator.ts` (pre-handler deferral), `orchestration/errors.ts` (public deferral code), `server/session.ts` (host limit/receipt protection), `server/production.ts` (trusted configuration forwarding).

`tests/boundedCatchup.ts` adds 17 awaited tests. The pre-change reproduction produced 1 pass/5 failures in the initial six tests. All 17 focused tests now pass:

- Default/custom budgets, retained earned backlog and fractions, reload and client-budget/clock forgery resistance.
- Deferred gameplay sequence preservation, exactly-once completion/replay, successful partial-sync receipt replay and stale-command rejection.
- Identical complete canonical state with single-chunk, two-chunk and uninterrupted processing, including active AI/operations/RNG with seeds 11 and 29 under offline and mixed online/offline presence, invasion expiry and construction.
- Failed saves, competing CAS writers, lost committed responses and terminal history/world atomicity using a controlled persistence-port fake.
- Real HTTP command deferral/progress and final execution.

No combat, AI policy, workout rewards, economy, world geography, Unity, schema or lease-duration changes. Existing production ratios and unconfigured content remain unchanged. Live Supabase is not exercised by the port fake.

## Validation and remaining work

Focused tests: **17 passed / 0 failed**. Source and test-inclusive typechecks and production build: **PASS**, no diagnostics. Full-suite validation is running; no full-suite pass is claimed until its result is recorded below.

An independent mixed-presence probe also ran both seeds with budgets 100, 1 and 2, earning 163 ticks from the same trusted receipt and two recorded online spans. All three budgets produced identical full-state SHA-256 values per seed: seed 11 `cc4ae990f519de46c546de5dc5d519162ecce1af14dfbb11e6a840e71ce1ed9a`, seed 29 `9ebc7a2910009889b0f143e6b835de6733d7a199da3991c62836b23f9c3ba78c`. Mixed-presence coverage was then added inside the existing seeded regressions and all 17 focused tests reran successfully. The temporary probe and logs reside under `/tmp/repwars-catchup`; permanent regressions preserve the scenario class.

Remaining independently assessable work includes world geometry validation and operational/load verification. Full island coverage needs a clear distinction between playable territory and decorative/unplayable land; this phase does not invent that content rule. Located Food banks/transport, production workout content/ratios, visibility/scouting and production identity remain their previously documented product/infrastructure gates.

### Completed validation

Implementation checkpoint: `efee7a3c94445b678dff717bee257d7e7fe582c2` (pushed on the isolated branch).

- Full backend suite: **2,220 passed, 0 failed, 3 skipped**, exit 0. This is the prior 2,203 plus 17 new regressions. The final mixed-presence extension inside the same two seeded tests was also rerun in the focused suite after the full runner had loaded its test modules: **17/0**.
- Production and test-inclusive TypeScript checks and production build: **PASS**, zero diagnostics.
- Whitespace check: **PASS**. Raw run evidence is outside the repository at `/tmp/repwars-catchup/`.
- The three skips remain live Supabase save/reload, atomic world/history commit and restart; external credentials and approved non-production execution are still required.
- Schema remains 30. Existing world/workout content, source branches and earlier worktrees are preserved. No merge, deployment or live database change occurred.

The next phase assesses stronger polygon overlap/containment checks against existing authored files before enabling them; content is never silently repaired.
