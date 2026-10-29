# Approved gameplay contract implementation — completed 2026-10-29

Parent: c9473107bbd5281d011480dc3fe3ff1a207c9688. Isolated branch: feat/backend-gameplay-contracts. The user's new empire-bank contract supersedes historical physical-resource and local-recruitment assumptions in earlier reports.

## Fresh audit before production edits

| Contract | Finding | Actual implementation / dependencies |
|---|---|---|
| Empire resource banks | EXISTING BUT CONFLICTING | `WarlordSnapshot.resources` already is a faction bank. `economy/accrual.ts`, `collect.ts` retain local uncollected yield; `trade/trade.ts` creates bilateral cargo and timers. Keep bank and resource reservations; replace collection/transport semantics. |
| Food upkeep | PARTLY COMPATIBLE | `foodConsumption.ts`: 60-tick cycles, one Food per territory, two Stability lost per failed cycle, Level 1 tutorial exemption. No army Food upkeep. `EventDefinitions.ts` already increases unrest/rebellion weight at low Stability. Add authored territory upkeep and baseline support; do not change event coefficients. |
| Bank deployment | MISSING general command | `commitBankedTroops.ts` only creates an attack force; `reinforcement.ts` allocates reserved local pools to garrison/army/new army. Reuse deterministic `allocateArmyId`, command transactions and receipts. |
| AI recruitment | EXISTING BUT CONFLICTING | `recruitment.ts` accrues exact simulation work per owned territory, one troop/tick, completed City multiplier two, consumes local Food, credits local pool. Preserve clock/rates provisionally; credit faction bank and use existing REINFORCE planning with explicit bank source. |
| Visibility | EXISTING AND COMPATIBLE | `publicView.ts`, `authorization.ts` expose entire current world; authored initializer populates known territories. Private cognition remains private. No scouting gameplay should be added. |
| Defeat/restart/history | PARTIAL / CONFLICTING | `anchors.ts` checks remaining anchors rather than all owned land. `worldTransition.ts` protects unresolved workouts and carries fitness/applied rewards, but no restart command or durable completed-world trophy list exists. |
| Workout rewards | EXISTING AND COMPATIBLE | R1-C–F locked entitlement, 60/100/145, integer micros, feedback-independent exactly-once bank payment, atomic history/CAS. Production world ratios and rebuilt catalog authoring remain external content dependencies. |

## Final user decisions and implemented behavior

The user explicitly superseded the earlier located-resource-bank and physical-resource-transport proposal. All resources now use the existing faction resource balance. Deployed troops still move physically. New Trade exchanges agreed resource bundles atomically between banks; it creates no cargo, route or delivery timer. Existing undelivered cargo is credited to its agreed recipient once during migration. Historical delivered cargo is not paid again.

Normal production credits every resource to its owner's bank automatically at authoritative simulation boundaries. Manual collection remains available. Golden Yield pays only `floor(eligibleResource * existingMultiplier) - eligibleResource`, per resource, and consumes its existing effect on success. Both ordinary manual collection and Golden Yield clear the production eligibility basis. Zero eligibility cannot consume an effect. Overflow fails without consuming eligibility. The old `uncollected` save/API field now describes already-banked production eligible for the additional manual bonus, not another balance. Public projection adds `goldenYieldEligibleProduction` and `productionBanking: AUTOMATIC` to make this explicit. Ownership loss settles earned production to its prior owner and clears eligibility; it does not confiscate empire-bank resources.

### Food and provisional authoring values

`WorldDefinition.empireFoodBaselinePerCycle` and `TerritoryDefinition.foodUpkeep` accept nonnegative safe integers. The authoritative demand is baseline plus the sum of currently owned territory upkeep. Missing legacy values retain baseline zero and one Food per owned territory per 60-tick cycle. Level 1's existing tutorial exemption remains. These are compatibility values, not approval of final balance or content. Explicit zero is supported. Existing resource production/building rules and the failed-cycle Stability reduction of two remain; army size does not determine Food demand. Existing low-Stability event/rebellion coefficients are unchanged. No additional hunger meter, army destruction or blanket production penalty was added.

### Bank deployment and AI recruitment

`DEPLOY_TROOPS` accepts an owned `territoryId` and positive safe-integer `quantity`, resolves faction authority on the server, and atomically debits available banked troops and creates a deterministic C2 army identity at that territory. Its result includes `armyId`, `territoryId`, `quantity` and remaining `bankedTroops`. No transport cost or timer applies. Existing deployed forces are neither moved nor merged. The player's existing `playerRewards.bankedTroops` remains its only bank; NPCs use `WarlordSnapshot.bankedTroops`.

The existing exact simulation-work recruiter credits NPC banks per owned territory. Existing provisional values remain one troop per territory per simulation tick, doubled by a completed owned City. No Food recruitment charge or new modifier remains. No land means no recruitment. No player passive recruitment is added. Whole/sliced/reloaded processing preserves the same fractions and balances.

AI uses its existing REINFORCE action, plans, Attention, quantity claims and transaction path with an explicit `troop-bank:v1:` source. It can deploy to owned land, reinforce a local army or garrison, or form a local army; bank deployment settles immediately. There is no ninth proactive action or separate controller. Legacy local-plan handling remains compatibility code; migration terminally cancels active local allocations before transferring their unspent pools. A regression caught instant defensive deployment being recorded as context invalidation after it removed its own threat. Successful intervention is now recorded before post-effect observation. Other response ownership/timing rules remain unchanged.

### Current-world visibility and attempt lifecycle

Public current-world data includes all factions irrespective of stale discovery lists. No scouting or fog-of-war progression is introduced; private AI diagnostics remain private.

Defeat is loss of the last owned territory, not merely the last anchor. A defeated attempt stops gameplay simulation and disallows strategic mutations; its accrued clock can still be acknowledged. `RESTART_WORLD` reloads the exact same registered authored world and fingerprint. It rejects unresolved active/completed-unpaid workouts and pending reward obligations, including legacy obligations. Existing terminal abandonment rules remain. Restart resets expendable attempt state while preserving permanent fitness, external workout history, paid reward identities, session receipt/lease continuity, army sequence safety and `completedWorldIds`. Existing world completion records a trophy once. No completed world background economy is created.

### Workout rewards and unchanged infrastructure

The existing locked SHORT/STANDARD/LONG entitlement system, applied-reward ledger, bank payment, optional feedback boundary, atomic world/history persistence and receipt replay remain authoritative. Production catalog content and world soldier ratios are still required; no ratios or workout definitions were invented. C1 troop accounting, C2 identities, C3 RNG authority, CAS, minute ticks, fixed-point presence accrual, durable backlog and bounded catch-up are retained. No Unity files, combat coefficients, AI weights or authored world JSON were edited.

## Persistence compatibility: schema 31

This phase advances GameState 30 to 31 because troop banks, Food authoring values, completion records and legacy-yield semantics change. `src/persistence/empireBankMigration.ts` runs only for older schemas, inside hydration before adoption:

1. Validate old Trade custody; pay undelivered loading/transit/unloading/blocked manifests to the agreed recipient, mark delivered, clear transit state, and retain historical identities. Already-delivered manifests remain paid once.
2. Initialize NPC troop banks and full current-world knowledge. Cancel active legacy REINFORCE allocations, releasing their claims, then credit existing local reserves to the corresponding faction bank and clear local quantities. No historical recruits or exact plans are invented.
3. Credit truly unbanked legacy stored yield once, retain its manual bonus eligibility, and bank only additional production after durable accrual watermarks. No clock advance occurs.
4. Default missing baseline to zero and completion history to an empty list rather than inventing past victories. Authored configuration binds through existing definition identity validation.

Existing armies, workout terms, pending/applied rewards and command identities remain. Unsafe quantity/overflow/corrupt custody fails closed. Schema-31 reload does not repeat migration. Do not run schema-30 executables over schema-31 saves. Before any production rollout, back up saves and exercise this migration in the approved staging database; local tests do not certify external deployment/rollback operations.

## Validation and regression revisions

See `BACKEND_GAMEPLAY_CONTRACTS_VALIDATION.json` for executed commands and exact results. `tests/gameplayContracts.ts` adds 42 focused tests covering banking, bonus-only collection, ownership, overflows, deployment, reservations, persistence failures, stale writers, replay, authored upkeep, migration phase variants, defeat/restart and permanent record preservation.

Existing tests that asserted physical Trade delivery, local Food-funded recruitment or manual base-resource payment were revised to the newly approved contracts. They continue checking exact terms, reservation availability, rollback, Opinion, cleanup, deterministic replay and conservation. Tests depending on non-tutorial Food pressure explicitly select a non-tutorial level. Schema assertions advance to 31. No credential-gated coverage is relabeled as executed. A focused-run filter reports excluded tests separately; the unfiltered runner executes the full suite.

Final personally executed results: full runner **2,340 passed / 0 failed / 3 credential-gated skips**; focused contract runner **42 passed / 0 failed / 0 skipped**. Production typecheck, test-inclusive typecheck, build and diff whitespace check all passed. All eight larger-world whole/sliced canonical hashes matched. The largest 50-territory, 1,440-tick case took 36.35 seconds whole and 38.99 seconds sliced; suite-process RSS reached approximately 1.46 GiB. These are measured engineering limits, not a production capacity guarantee.

The full run began with 35 new tests. Seven supplemental migration/CAS tests were added while that run was executing and were executed in the separate 42-test focused run. Full and supplemental results are reported separately, not represented as one larger full-suite execution. Earlier failing intermediate runs exposed superseded contract assertions, fixture assumptions and the instant-intervention recording defect; those were corrected before final validation.

Eight existing larger-world fixtures compare full catch-up with bounded, reloaded processing at identical earned targets. Their identical canonical hashes prove the tested execution equivalence, not gameplay balance or production capacity. This is not a rerun of the archived 16-scenario military campaign. Long indivisible chunks and history growth remain capacity risks.

## Remaining decisions and external validation

- Author final empire Food baselines, per-territory upkeep and production distribution; review provisional recruitment rates and military attrition separately. This phase supplies configurable fields without inventing final balance.
- Supply rebuilt authoritative workout content and approved per-world soldier ratios. Existing locked reward infrastructure remains ready for that content.
- Validate live Supabase CAS/atomic RPC/RLS and backup/restore with authorized non-production credentials. Perform hosting/TLS/monitoring and Unity client integration separately.
- Roads/markets and any future military policy are separate contracts, not silently implemented here. Resource transport and fog-of-war are no longer blockers: the user explicitly removed those requirements.

No merge, deployment or production-readiness claim is made. Earlier checkpoints/worktrees and historical reports are preserved.
