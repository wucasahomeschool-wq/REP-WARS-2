# Distant-army strategic access

Parent: `a033904b120a4dc9b7c4af6eebf9df170fb8c369`, branch `fix/backend-strategic-access`, isolated worktree `/workspace/REP-WARS-2-STRATEGIC-ACCESS`.

## Reproduction and provenance

The immutable small seed-11 week fixture from approved AI-SIM checkpoint `ce63ad0bd1d74494c0a87f494d65d9efb8d88b25` hydrates through the current schema-30 reader with zero invariant violations. On the parent, faction `f_ai_1` has an idle 836-soldier `army_1` at `t_009`, but no distant strategic-access source. Immediate/one-staging-hop hostile planning excludes its owned route to a credible frontier.

The owned-route helper is byte-identical to the archived reviewed implementation (`src/army/strategicAccess.ts`, Git blob `534e08c35631edaf3ba0d61a115efa281e148505`). The two small synthetic fixture files are also byte-identical (world blob `51299668ab8cbc8ea06045e20f050acb12219ffd`, compressed state blob `343c4ccbdffd9e3f515c5c59ce7ec880c662f238`). This is a selective integration, not a merge of the old engine, military allocator or simulation branch.

## Narrow integration

- Disposable weighted search traverses owned land using native travel durations and stable ID tie-breaking. It does not enumerate every possible route or retain a second path/state authority.
- A `STRATEGIC_ACCESS` source uses the existing FORCE_POSITIONING domain and existing MOVE action. Only one adjacent step is proposed. The exact plan goes through ordinary feasibility, Attention, claims, operation initiation and native movement.
- The helper rejects claimed, engaged, undersized and foreign-sited forces, refuses to strip a threatened origin and respects Peace and existing player protection. Arbitrary idleness is not pressure.
- The existing FORCE_POSITION_VALUE evaluator can describe source-bound remaining travel to the selected frontier. Its offensive access term is replaced for this source, not augmented by a flat bonus. Existing scoring weights, commitment thresholds, Goals, personalities, combat equations and action vocabulary are unchanged. This changes which factual opportunity can be evaluated; it does not force every available MOVE to be chosen.
- Current local army formation, durable C2 army identities, C1 accounting, C3 battle seeds, reward settlement, physical logistics and world-time rules are untouched. In particular the archived `FIELD_FORCE_GAP` policy and formation allocator are not silently copied over the recovered implementation.

## Persistence and compatibility

Schema remains 30; no field or SQL migration is required. The existing source-kind enum and semantic binding validator accept STRATEGIC_ACCESS only for its own army's MOVE. Current readers preserve source and in-flight operation state through hydration. An older binary may reject the added enum; do not roll it back over newer saves without a compatible checkpoint/restore review. Old saves receive no invented history or completed operations.

## Validation

Twelve focused tests pass: actual archived candidate qualification; native timed dispatch and exact physical holdings; no arbitrary-idleness source; Peace/player protection; claim/movement guards; exposed-origin protection; weighted stable search; source hydration; read-only/RNG-free queries; Goal-neutral factual evaluation; 1,000-node structural cost; and deterministic in-flight dispatch/reload. The chain search visits 1,998 directed edges for 1,000 nodes and reconstructs 999 travel ticks, without input mutation. This is a structural test, not a production throughput guarantee.

Production/test TypeScript and build pass. **Full suite: 2,305 passed / 0 failed / 3 explicit live-Supabase skips.** This is the prior 2,293 plus 12 new registered regressions. Native arrival/reload and all eight whole/sliced larger-world cases pass. Results are recorded in `BACKEND_STRATEGIC_ACCESS_VALIDATION.json`. Temporary logs/probes live under `/tmp/repwars-strategic-access/`; concise results, fixture provenance and registered regressions are the durable artifacts. No Unity or live database is exercised.

## Limits and remaining decisions

Coverage of an available strategic route is not proof of intelligent overall conquest, sustainable formations or a better attacker victory rate. The old AI-SIM 16-run campaign is historical evidence, not a newly executed campaign on this branch. Current larger-world engineering runs use fixed synthetic definitions and explicit simulation-time assumptions. Current last-army recovery remains the recovered target-bound policy; the alternative archived formation policy is not implicitly approved as a replacement by this route port.

Food provisioning still requires the separately reviewed located-bank/physical-transport contract. Production identity/account mapping, non-production database access and restore verification, authored workout sizes/ratios/readiness, Level 1 content selection, scouting/visibility, general player bank deployment and deferred cargo/spatial policy remain unresolved external or product gates. No release or deployment readiness is claimed.

### Native arrival probe

`node -r ts-node/register tests/probes/strategicAccessArrival.cjs` exercises the saved army through START_AI_OPERATION, an explicitly server-authorized three-minute online lease, SYNC_PLAYER_WORLD, reload, native arrival and terminal replay. All 836 soldiers arrive at `t_008`; the force claim releases; a second terminal settlement returns false without mutation. Incremental receipt/reload processing and one coarse earned target produce identical complete canonical snapshots. The initial scratch probe had a syntax typo, then incorrectly used internal ADVANCE_WORLD without first earning time; the backend correctly rejected the latter with `world.accrued_target_behind`. Only the corrected authoritative-receipt probe is successful evidence. No production time rule was relaxed.

### Measured cost and behavior limits

All eight synthetic load cases preserve exact whole-versus-sliced/reloaded canonical equality. Their behavior need not match the parent because the missing opportunity is now visible. The 50-territory seed-29 six-hour case changes from 159 to 202 operations and 3 to 6 MOVEs; its day case changes from 159 to 206 operations. These are operation counts, not unique battles or victories. Compact catch-up responses omit decision details; empty reported-decision maps do not mean zero WAITs.

A separate instrumented day/seed-29 run matches the uninstrumented canonical hash. Of 19,967 ms total, 20,786 strategic-opportunity queries consume 1,011 ms and 1,916 separately invoked evaluator-route queries consume 225 ms (about 6.2% combined). Internal lexical route calls are already included in opportunity time. This rules out those query bodies being the dominant cost in that measured run; it does not prove all other overhead is necessary or attribute every changed millisecond to useful strategy. More operations, altered decision history and ordinary world work also change the workload. This run overlapped the full suite, so its elapsed time is not a controlled production benchmark. No new persistent cache or policy tuning is justified by this measurement alone.

Reproduce from the repository root with `node -r ts-node/register tests/probes/strategicAccessCost.cjs [expectedCanonicalSha256]`. The first scratch cost probe omitted catalog registration and failed on reload; the corrected probe registers the actual fixture definition before running. Reader validation was not weakened.
