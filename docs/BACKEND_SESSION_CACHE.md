# Backend continuation: bounded player-world cache

Parent: `51de61e0f9d01146a6e5d2179ddc86f0e33c987b` (`recovery/backend-completion-20261023`).
Worktree: `/workspace/REP-WARS-2-COMPLETION-NEXT`.
Branch: `feat/backend-session-cache-bounds`.

## Recovery and task selection

The environment is accessible. GitHub's recovered branch was fetched from the intended repository and matched the supplied checkpoint. All 2,677 tracked blobs matched the original completion worktree; no extra untracked files were found. The original dirty worktree was not reset, switched, committed again or overwritten. This phase starts from the existing recovery commit in a separate clean worktree.

The three recovered completion/validation/operations documents identify bounded cache retention as unfinished engineering. It requires no gameplay or balance decision. Existing rewards, military formation, identity/privacy boundary, content pins and schema 30 are already implemented in the parent. Food logistics, world ratios/content, fog/scouting and production identity remain blocked by their documented decisions/infrastructure.

## Root causes and implementation

`src/server/session.ts` previously retained every `PlayerSession` in a process-wide-per-host Map indefinitely. A second lookup never reloaded an idle player's world regardless of how many others had been visited. There was also no invalidation when an exception escaped a command: a persistence transport failure could leave a changed, uncommitted Orchestrator draft visible to the next queued read. A regression reproduced `empirePaused: true` in that read while persisted state remained false.

The host now supports `maxCachedPlayers` (default 128; zero means no idle retention). The bound is an explicit deployment/memory setting. A request marks its entry pending before queueing and refreshes its LRU position. Trimming removes only idle entries. Completion releases the pin and trims again. This preserves a single local serialization chain per player under pressure; different pending players may temporarily exceed the bound.

A thrown request marks the entry as requiring reload. Subsequent queued work loads persisted state before executing, and an invalid idle entry is removed. This is necessary for both failed writes and committed writes whose responses were lost: the cache cannot determine which happened. Durable command receipts, the applied-reward ledger and state_version CAS retain that authority. No automatic retry of the failed mutation is added.

`src/server/production.ts` forwards the optional trusted configuration. No public DTO, schema, RNG, world-time policy, troop/resource rule, reward formula, lease timing or AI policy changes. Eviction does not advance time, issue saves, end leases or allocate game identities.

## Regression coverage

`tests/sessionCache.ts` adds 13 tests to the existing awaited runner:

1. Capacity eviction reloads canonical state without an eviction write.
2. LRU retains a recently requested player.
3. Zero retention reloads after each idle boundary.
4. The default retains at most 128 worlds after work settles.
5. Invalid integer/fractional/nonprimitive configuration fails before persistence is accessed.
6. Interleaved players and queued commands retain one chain even at capacity zero.
7. Lost-response receipts and stale-command rejection survive eviction.
8. Open/heartbeat/end receipts survive eviction without extending them again.
9. Thrown save failure cannot expose an uncommitted draft to an already queued read.
10. Another host's CAS winner remains authoritative after conflict and eviction.
11. A failed reload cannot publish a dirty draft; later healthy loading recovers.
12. Retention zero versus four produces identical complete canonical state after one earned offline simulation tick.
13. A committed workout reward with a lost response reloads and replays exactly once, preserving entitlement, history and banked troops.

The payout test uses the existing synthetic STANDARD fixture (125 soldiers); it is not a production ratio. Its atomic persistence port is a controlled fake, not a live Supabase test. In pre-fix reproduction, eviction expectations failed and the dirty-draft read was observed. One early reward test lacked the required gameplay-session request fields; that fixture was corrected before final validation. No production validation was weakened.

## Limits and next work

- This bounds retained idle player-world entries, not total process RSS, incoming concurrency, queued request count or persisted history. Pending worlds are pinned rather than dropped/rejected.
- Production capacity should be selected from measured world sizes and load. The default is an operational setting, not a balance constant.
- Cache invalidation relies on the existing persistence contract. It does not convert a custom non-atomic world/history adapter into an atomic store.
- Existing cached reads are not a distributed invalidation protocol; other-host writes are still serialized at CAS. This phase does not introduce a second locking authority.
- Whole-request catch-up budgeting, rate/admission limits, live database verification, identity integration and the remaining product contracts still require subsequent work.

## Executed validation

- Full backend runner (`npm test`): **2,187 passed, zero failed, three credential-gated skips**. This is the recovered 2,174 executed passes plus 13 cache regressions. The skipped live Supabase checks remain unverified.
- Final focused cache run: **13 passed, zero failed**. Final review strengthened the default-limit test to instantiate a host without an explicit capacity and verify that a second older world remains cached; this final test version was rerun successfully after the full runner.
- `npm run typecheck`, `npm run typecheck:tests` and `npm run build`: **PASS**, with no TypeScript diagnostics.
- `git diff --check`: **PASS**.
- The original completion worktree was compared again with all 2,677 recovered checkpoint blobs: **zero mismatches and no extra untracked files**. The original checkout and C1, C2, C3, R1-C, R1-D, R1-E and R1-F worktrees retained their recorded HEADs and clean status.

This phase is checkpointed on the isolated branch above, directly after the recovered commit. The recovery branch remains unchanged. Commit and remote verification are reported in the completion response; no merge or deployment is performed.
