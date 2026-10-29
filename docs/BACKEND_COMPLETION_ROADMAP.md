# Rep Wars — Backend Completion Roadmap

Source: `e3f1781f8a53424462fabbd943cc01b0e2725154`; audited 2026-10-29. **Plan only: do not implement until reviewed and authorized.** No speculative time estimates or completion percentage.

## Architecture and checkpoint rules

Use isolated branches based on the latest reviewed backend descendant; verify actual heads and dirty worktrees before each phase. One independently reviewable phase per local/remote checkpoint. Never merge/deploy as a side effect of testing. Preserve GameState, transactions, CAS, existing ledger, fixed-point clocks, C1–C3 and R1 reward locks. Do not invent ratios, new actions, Food transport, scouting, population mechanics or fitness content.

Production tests should exercise public routes, not just direct reducers. Keep fixture-only inputs explicit. A checkpoint needs focused reproducer→fix tests, affected regressions, production and test-inclusive typechecks, full backend runner where behavior changes, whitespace checks, source review and verified remote hash. Three gated DB tests remain skips until an approved non-production environment is supplied.

## Phase 1 — Universal mutation identity (Astra first)

- **Objective/scope:** AUD-001. Make public retries reliable using existing gameplay-session/command receipt authority.
- **Exclude:** new payment/receipt service, gameplay policy, read-only API removal.
- **Dependencies:** none; current identity adapter can be injected in tests.
- **Required tests:** replay the same unsequenced deployment twice (reject before mutation); valid sequenced duplicate across lost response/reload; stale writer; failed precommit/ambiguous response; every exposed mutating command has the rule.
- **Acceptance:** one logical mutation has one durable effect; missing identity has a documented safe response; no clock/lease mutation on rejected retries; old paid reward identities remain valid.
- **Checkpoint:** isolated receipt-enforcement change + API compatibility note + tests.
- **Product decisions:** none. Client migration sequencing needs coordination, not new gameplay.
- **Parallel:** tutorial and event-hydration investigations can proceed on separate branches, but coordinate API test changes.

## Phase 2 — Tutorial and deployed-force compatibility

- **Objective/scope:** AUD-002. A player who deploys legitimate reward troops can still complete tutorial attacks.
- **Exclude:** new troop grants, bans on approved deployment, alternate combat formulas, wholesale tutorial removal.
- **Dependencies:** none for domain correction; use Phase1 identity for public acceptance.
- **Required tests:** bank→partial/all deployment→existing force ATTACK; correct first target and scripted invasion ordering; retry/reload; no new troops or duplicate conquest; fallback insufficient-troop messaging.
- **Acceptance:** the reproduced bank500 dead end is closed by legal existing-force use; no new authority or waiting gate.
- **Checkpoint:** tutorial compatibility fix plus full composed regression, not a weakened fixture.
- **Product decisions:** none for this contradiction. Final authored workout/troop balance is separate.
- **Parallel:** can run alongside Phase3 with independent files.

## Phase 3 — Durable event consequences

- **Objective/scope:** AUD-005. Preserve actual event output modifiers on hydrate while protecting immutable authored geography.
- **Exclude:** event probability/balance changes and new consequence types.
- **Dependencies:** inspect schema compatibility before choosing representation; event-eligible fixtures can test this without waiting for population policy.
- **Required tests:** natural Resource Discovery (seed11), adverse output effect, production before/after reload, event expiry/choice as supported, cache eviction/restart, old-schema compatibility, equal canonical continued outcomes.
- **Acceptance:** registered-base output1→event2 remains2 after reload, or an equivalent canonical modifier yields2; no fingerprint bypass or repeated effect application. If durable shape changes, explicit migration review is required.
- **Checkpoint:** minimal effect persistence change, migration if necessary, reproducer evidence.
- **Product decisions:** no decision needed to prevent data loss; do not settle broader event duration policy accidentally.
- **Parallel:** independent of catalog work.

## Phase 4 — Production workout-content activation contract

- **Objective/scope:** AUD-003. Explicit catalog loading, truthful selection/availability, authoritative tutorial binding and reward-policy checks.
- **Exclude:** authoring replacement content, setting ratios, changing readiness or payout formulas.
- **Dependencies:** compiler/registry already exist. Use labeled contract fixtures until AUD-017/018 supplies approved production manifests.
- **Required tests:** production composition with valid/absent/invalid catalog; START follows selected authored identity and size; tutorial selection works without hardcoded legacy-only ID; all sizes, feedback-independent settlement, mid-session revision immutability, restart/reconnect.
- **Acceptance:** loader either activates a validated content revision or reports configuration unavailable before advertising a playable normal workout; no placeholder policy presented as production-approved.
- **Checkpoint:** loader/selection wiring and documented deployment content contract; actual content is separately reviewed.
- **Product decisions:** approved catalog/world-policy files and IDs, not a new reward equation.
- **Parallel:** content authors can work independently; integrate manifests after schema validation.

## Phase 5 — Natural event eligibility and player choices (two checkpoints)

- **Objective/scope:** AUD-004/006. Make relevant events reachable and interactive using the existing event engine.
- **Exclude:** new population economy, garrison morale stat, invented secession mechanics or arbitrary event coefficients.
- **Dependencies:** bounded eligibility decision; Phase3 effect persistence; Phase1 receipts.
- **Checkpoint A:** resolve authored-population versus obsolete population gating, add registered-world eligibility tests and compatible migration if needed.
- **Checkpoint B:** public safe choice DTO + authorized receipted resolve command; truthful consequence support and default/expiry behavior.
- **Required tests:** Food shortage→Stability→eligible event; active choice save/reconnect; wrong player, invalid/expired choice, duplicate choice, reserved resources, valid outcome→reload; no-op/unimplemented consequence cannot be advertised as applied.
- **Acceptance:** real initialized world can trigger intended events, inspect them and resolve choices exactly once; no private AI data leaks.
- **Product decisions:** eligibility/population role and unsupported consequence replacement. Reuse existing choices/expiry policy wherever it already defines behavior.
- **Parallel:** DTO work can proceed after public shape is agreed; avoid parallel edits to one event reducer.

## Phase 6 — Neutral and foreign-territory military paths

- **Objective/scope:** AUD-007/008. Close neutral occupation and foreign MOVE ambiguity through existing physical movement/ownership systems.
- **Exclude:** ninth proactive action, teleporting deployed units, border currencies, new combat balance.
- **Dependencies:** explicit neutral resistance/occupation and WAR/PEACE passage rules; Phase1 receipt enforcement.
- **Required tests:** neutral start/arrival/reload/retry; state changes while in transit; ownership/claim invalidation; WAR/PEACE entry; no double occupation or duplicated armies; AI actions remain eight.
- **Acceptance:** every legal destination has deterministic, documented arrival behavior; 100% conquest can include neutral tiles.
- **Checkpoint:** neutral path and passage enforcement separately if necessary, each with approved contract cited.
- **Product decisions:** yes; this audit does not invent neutral troop costs or trespass consequences.
- **Parallel:** can proceed independently of fitness content once military policies are settled.

## Phase 7 — Explicit clock-domain and protection contract

- **Objective/scope:** AUD-009. Map every response/protection/recovery gate to simulation versus real-world time and enforce the approved table.
- **Exclude:** changing world tick baseline/rates, gameplay caps, new recovery rewards or compulsory checking.
- **Dependencies:** bounded gate/pause decision; migration review for existing active deadlines.
- **Required tests:** online, wholly offline and mixed presence; paused/resumed empire; completion just before/at/after deadline; delayed processing; restart/CAS; identical event identity never rerolls.
- **Acceptance:** real-world gates ignore simulation multipliers; simulation gates continue to use earned time; processing delay is not authority; no active legacy obligation is silently lost.
- **Checkpoint:** reviewed clock table followed by small gate-family implementation checkpoints.
- **Product decisions:** classify existing gates and pause/offensive-action interaction; preserve numerical values provisionally unless explicitly changed.
- **Parallel:** do not concurrently modify temporal ordering and operation completion without a shared integration review.

## Phase 8 — Player military and Unity API acceptance contracts

- **Objective/scope:** AUD-010/020. Describe and expose the approved player reinforcement/strategic retreat equivalents; publish current client request/response/retry/feedback/backlog contracts.
- **Exclude:** army merging, battlefield retreat, HUD/map replacement, touching an active dirty Unity worktree.
- **Dependencies:** approved player force-targeting semantics; Phases1/2/4; source-of-truth Windows Unity inspection in a separately safe environment.
- **Required tests:** owned bank allocation to defined destination, reservation conflict/retry; locked versus settled reward; no-feedback finalize and later real feedback; response loss with no second credit/animation signal; specialized results and bonus-only Golden Yield; content mismatch errors.
- **Acceptance:** no client reward math, guessed ownership, fabricated feedback or ambiguous receipt handling; server integration contract is versioned and demonstrable.
- **Checkpoint:** backend contract/documentation separately from any later Unity implementation.
- **Product decisions:** force-targeting interface only if not covered by existing domain contract; no economy redesign.
- **Parallel:** Unity teams can use already-verified read/build/move routes now, without waiting for all content.

## Phase 9 — All ten journeys and content acceptance

- **Objective/scope:** AUD-011/017/018/019. Prove feature completion using approved content, not fixture substitution.
- **Exclude:** declaring balance from green unit tests or inventing a human-skill agent.
- **Dependencies:** gameplay correctness phases; approved catalog, world ratios, world/visual revision and provisional-to-approved balance decisions.
- **Required tests:** the ten journeys listed in the audit through authenticated HTTP with restart/CAS; actual event eligibility/effects; full visibility; entire-world conquest; defeat/restart fitness preservation; migration fixture corpus; several fixed seeds and live/catch-up comparison.
- **Acceptance:** every P0/P1 item closed with evidence or explicitly removed from approved scope; production fresh start does not return fixture content or missing configuration; whole journey replay is deterministic.
- **Checkpoint:** content manifests and acceptance tests reviewed separately from balance changes; numerical tuning requires explicit approval and before/after evidence.
- **Product decisions:** approve real content/ratios and balance values, not new infrastructure architecture.
- **Parallel:** content preparation is independent; acceptance must run on the combined reviewed branch.

## Phase 10 — Production identity and live persistence proof

- **Objective/scope:** AUD-013/014/015. Real account identity, deployable composition, live atomic RPC/RLS/CAS and save rollout.
- **Exclude:** production deployment or destructive production-data tests without separate authorization.
- **Dependencies:** selected identity provider; approved disposable Supabase environment; anonymized save corpus; content-migration decision.
- **Required tests:** real token/account isolation; three gated tests actually executed; stale/concurrent writers; world+history failure rollback; restart; schema31 and future compatibility; backup/restore and safe rollback exercise.
- **Acceptance:** no developer identity fallback, no live skip reported as a pass, recoverable and reviewed save migration, documented provider/DB contract.
- **Checkpoint:** identity integration, live verification report, and migration/restore runbook independently reviewed.
- **Product decisions:** service/account mapping and operational access; old content revision transitions where needed.
- **Parallel:** substantial work can run alongside gameplay phases with stable adapter contracts.

## Phase 11 — Responsiveness and operational acceptance

- **Objective/scope:** AUD-016/021 and measured need for AUD-024. Prove capacity, health responsiveness, monitoring, CI and failure containment.
- **Exclude:** arbitrary time caps, deleting history to make benchmarks pass, unrelated optimizations, default-branch deployment.
- **Dependencies:** intended host/latency target and live non-production DB; representative reviewed state sizes.
- **Required tests:** concurrent players plus one deep backlog, blocked/slow DB and authentication, health/readiness response, queue rejection, restore/rollback, growing histories, authoritative deterministic outcomes across execution strategies.
- **Acceptance:** bounded operational behavior on documented capacity; no event-loop monopolization from sync I/O; observable failures; hosted CI proof; preserved backlog and identity. Set numeric SLOs from intended service needs, not guesses in this audit.
- **Checkpoint:** each measured bottleneck fixed independently with equivalence proof; operations report separate.
- **Product decisions:** hosting/SLO/retention approvals, not gameplay balance.
- **Parallel:** ops preparation is independent; final evidence must use the reviewed combined executable.

## Feature-complete versus launch-ready gates

**Feature-complete backend:** close AUD-001–011 and backend aspects of AUD-020; validate approved production-content activation; prove all ten journeys and exact client contract. A documented unavailable catalog is an honest development state, not a playable release. External authentication can be stubbed for local feature tests only.

**Public launch:** additionally approve AUD-017/018/019 content and balance; close AUD-013–016/021 with live evidence; complete Unity/device acceptance without inventing rewards; approve migration/restore and operational release. Optional roads, markets, Self-Learning AI and unnecessary compaction are not blanket prerequisites.

## Product decisions genuinely required

1. **Event eligibility:** Is population an authored initial value used by existing events, or should events be eligible from existing ownership/economy facts without a population gate? No new population economy is implied. If retained, approve its authored values/interface.
2. **Unsupported event effects:** For choices currently advertising unapplied garrison-morale/infrastructure deltas, which existing supported consequences should apply, or should those choices be removed from production content? Do not invent new meters.
3. **Neutral/foreign land:** What permits neutral occupation and what resistance/cost, if any, exists? Is ordinary foreign MOVE allowed under WAR/PEACE, or must hostile entry use ATTACK/invasion? Existing positive-owned ATTACK rules do not answer this.
4. **Gate time domains and pause:** Which existing response/protection/recovery/max-defense-workout gates are real-time versus simulation-time? What does empire pause freeze and may offensive actions occur while paused? Preserve current constants until their domain is settled.
5. **Player reinforcement targeting:** Should approved bank deployment also target an existing identified force via current reinforcement mechanics, or should the public interface explicitly expose only separate forces plus strategic movement? This does not authorize army merging.
6. **Production inputs:** Approve catalog versions/tutorial workout IDs/readiness mapping, world soldier ratios, coherent Level1 gameplay+visual content and Food/recruitment balance. These are content/balance deliverables, not requests to redesign 60/100/145 rewards or resource banks.
7. **Operational choices/access:** Select identity/account mapping and hosting targets; provide authorized non-production Supabase credentials and save samples for actual live verification. Approve any content/save transition and release later, separately.

No decision is requested about empire-wide banks, automatic base production, manual bonus-only Golden Yield, instant bank deployment, physical deployed movement, full-world visibility, last-territory defeat or permanent fitness preservation. Those rules are already locked.

## Stop condition

After this documentation checkpoint, stop for review. Astra should start Phase1 only after authorization. There is no authorization here to implement the rest of the roadmap, merge, deploy, rewrite histories or modify other worktrees.
