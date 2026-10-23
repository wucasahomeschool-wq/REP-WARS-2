# Backend continuation: pending request admission

Parent: `b6e6b22455c31a919604b5cde2510e63c45c5070`.
Worktree: `/workspace/REP-WARS-2-ADMISSION`.
Branch: `feat/backend-request-admission`.

## Scope and evidence

The preceding cache limit retains at most the configured number of idle worlds but intentionally pins queued work. Before this phase, `createSessionHost` accepted an unbounded number of requests across players and for a single player. A host caller could therefore create arbitrarily many pinned worlds or queued closures. The pre-change focused run reported **3 passes and 7 failures**, demonstrating missing capacity rejection and deployment-option validation; existing failure recovery and accepted-work ordering already passed.

This is the next operational completion item after cache retention. It needs no gameplay policy decision. The separate catch-up audit confirms that `catchUpWorld` loops through all earned ticks and that mutating commands catch up before their handler. Bounding that work requires preserving accrued backlog, command ordering, history and partial-commit/receipt semantics. This phase does not change that behavior or claim to solve event-loop blocking.

## Implementation

- `src/server/session.ts`: trusted positive integer limits, 256 pending requests per host and 16 per player by default. Running and queued requests count together. The existing player chain and pending count remain the serialization mechanism. One process-local total counter is added; it is not persisted and is not gameplay authority.
- Capacity checks precede world loading, cache recency changes and command execution. A rejected attempt returns `RequestCapacityError`. Slots are released after settlement, including errors, and after failed initial loading.
- `src/server/production.ts`: forwards the two optional trusted deployment settings.
- `src/server/http.ts`: the existing non-trapping classifier recognizes the capacity error. `/commands`, `/session/open`, `/session/heartbeat` and `/session/end` return HTTP 503 with a constant `SERVER_BUSY` body and `retryable: true`. It does not read arbitrary exception fields or send capacity rejections to the internal diagnostic reporter.

No schema, CAS, persistent ledger, RNG, world tick, session lease, reward, fitness, combat, AI, economy, Unity or content rule changes. Defaults are operational bounds to load-test, not approved gameplay balance. No request field configures these bounds.

## Tests

`tests/requestAdmission.ts` adds 16 awaited regressions:

1. Total limit, no loading of the rejected player's world, recovery after completion.
2. Per-player limit while another player proceeds; accepted mutation order preserved.
3. Default 16 per-player slots.
4. Default 256 total slots across players.
5. Invalid, zero, fractional, non-finite and nonprimitive configuration rejected.
6. Initial loading failure releases capacity.
7. Thrown persistence and ordinary validation failures release capacity.
8. Rejected logical mutation leaves state/receipts untouched, then retries and replays safely.
9. Open, heartbeat and end share the limit without changing rejected leases or saves.
10. Concurrent accepted commands with zero idle cache retention match sequential canonical state.
11. CAS loser releases capacity and retains the persisted winner.
12–15. Each of the four actual HTTP routes returns safe 503 under pressure from the actual host, ignores attempted client capacity overrides and preserves canonical state.
16. Malformed capacity-error message/stack/details accessors, `toJSON`, custom inspection and coercion methods execute **zero times**; hidden literals are absent from final HTTP bodies and no internal diagnostic is emitted.

Wire tests occupy the real host immediately before the routed request, without sleeps or reading private counters. This deterministically exercises admission; it is not a network-load benchmark. An early post-change test counted the accepted other player's initial-world save as a rejected-request write; priming that fixture removed the erroneous expectation. No persistence behavior was changed to satisfy it.

## Limits and remaining work

Host admission is per process, not a distributed quota or rate limiter. It bounds accepted request count and pinned player entries, not bytes, individual world size, socket queues, HTTP parsing, authentication, history, or work inside one request. Synchronous catch-up and database calls still block the event loop. Upstream traffic limits, identity-provider deadlines, overall catch-up scheduling, load testing and live database verification remain required. Rejected attempts do not create a gameplay cooldown, renew a lease, consume command identities or discard earned time.

The recovered source worktrees and preceding cache checkpoint are preserved. Product decisions concerning located banks/Food logistics, world ratios/content and visibility remain unresolved and untouched.

## Validation

At the implementation preservation checkpoint:

- Focused admission regressions: **16 passed, zero failed**.
- `npm run typecheck`, `npm run typecheck:tests`, `npm run build`: **PASS**, zero TypeScript diagnostics.
- `git diff --check`: **PASS**.
- The full backend suite is still running; no final full-suite pass is claimed at this checkpoint. Its completion result will be recorded in a follow-up documentation commit.

The isolated remote destination was absent before publishing. The recovery branch remained at `51de61e0f9d01146a6e5d2179ddc86f0e33c987b` and cache branch at this phase's parent. Publishing a preservation checkpoint does not approve a production merge or deployment.

### Final validation

Implementation commit: `c60751701a6210645be216b85f3118ccf4158ae7`, pushed and verified on the isolated branch while the longer suite finished.

- Full `npm test`: **2,203 passed, zero failed, three skipped**, exit 0. The count is exactly the preceding 2,187 passes plus the 16 new tests. C1–C3, workout contracts/locking/settlement/API, AI, cache, privacy, persistence, accrued-time and session-lifecycle regressions all ran through the existing runner.
- The three skips are live Supabase save/reload, atomic two-table commit and server restart. They require explicit approved non-production credentials/opt-in; no live database validation is claimed.
- Source and test-inclusive typechecks and production build passed with zero diagnostics. The final documentation-only update requires no gameplay test rerun; its whitespace check passes.
- The original completion worktree's exact 78-file recovered candidate still matches the recovery commit, with its original HEAD and empty index. The original shared checkout, C1–C3, R1-C–F and preceding cache worktree retained their expected HEADs and clean status.
- Full output is retained at `/tmp/repwars-admission/full.log` in this execution environment; the portable results and test definitions are committed here. No raw player data, credentials or generated build output is added to Git.

This phase is locally validated and shared for review. Broader backend completion, production deployment and the outstanding engineering/product gates above remain incomplete.
