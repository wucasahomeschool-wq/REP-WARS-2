# Exact declined-Trade context

Parent: `4203a7fd709ddaba1cb000f08d54fb54469a6a3d`. Isolated branch `fix/backend-declined-trade-context`. This ports the previously approved exact-decline fix from `ce63ad0bd1d74494c0a87f494d65d9efb8d88b25` after independently reproducing it on the current backend. No source branch is merged.

## Current reproduction

A validated 10-territory fixture, seed 11, produces a one-Gold-for-40-Stone candidate from `scale_ai_0` to `scale_ai_1`. The real START_AI_OPERATION and required-response pipeline decline it at the existing response boundary. Claims and Attention release correctly and no cargo is created, but the identical complete candidate immediately reappears before the fix. The same probe passes after the correction. This is a planner repetition defect, not missing physical reservations or a reason to force the recipient to accept.

## Implementation and authority

`gameplay/trade/declinedContext.ts` records a current relevance predicate in the existing canonical source/blocker record after native decline settlement releases the proposal's claims. It covers complete plan identity/terms/endpoints, relevant observable stock, incoming cargo, factual demand, route/timing, public relationship and the proposer's own relevant preferences. It never reads recipient-private Goals or directed Opinion.

`inspectSourceActionability` filters that exact proactive candidate only while the predicate is unchanged. `observeSources` incorporates retained decline context into the material signature and discards obsolete candidates/sources through its existing lifecycle. Explicit offers still use normal domain legality. Different terms, counterparties and meaningful context changes remain eligible. There is no new cooldown, global/pair proposal cap, acceptance policy, score, tuning constant, action, resource store or historical scan.

The existing required-response, operation, claim, Attention and CAS paths remain authoritative. Replayed terminal settlement returns false before recording another context or changing custody. Already-declined historical proposals do not receive fabricated context on hydration. This does not claim to eliminate every WAIT loop or improve strategic attrition.

## Additional reproduced reservation edge

The archived fix alone missed a current-code case: when an offer reserves all tradable surplus, observation removes its source while the offer is pending. On decline, the original helper finds no source and forgets the actual response; the identical offer reappears. A native end-to-end probe and regression failed with `exactCandidateRepeated:true` even after the initial port.

The final helper reuses the pure `deriveSources` query only when the original source is absent, after the terminal reducer releases claims. It records the new actual decline only if that exact semantic opportunity exists now. It does not run the observer, accrue Pressure, advance clocks, recreate old primary owners or scan terminal history. A rediscovered source starts with the existing fresh-source defaults. If current resources/ownership no longer support that source, nothing is recreated. Tests cover minimal-surplus reservation, conserved stock, released claims, reload retention and the unavailable-source negative case.

## Persistence and compatibility

The existing SourceBlocker contract admits the additive `CONTEXT` reason kind; no persistent field or schema-shape migration is introduced, and GameState remains schema 30. Existing sources without a context retain the original signature representation. Updated readers are required for saves containing the new enum value: older executables may reject it during invariant validation, so do not roll back binaries over newer saves without a compatible checkpoint/restore review. No live save is modified by this task.

A focused malformed-persistence test found that the previous blocker validator did not require reason text to be a string. That would allow malformed metadata through hydration before the new observer used it. The validator now rejects non-string text. The test failed before this narrow validation correction and passes afterward. Valid existing reason strings and old source data are preserved.

## Evidence

Nineteen focused tests pass, covering native decline, exact reservation/resource cleanup, explicit command legality, relevant versus unrelated rearming, recipient-private information isolation, alternate exchanges/counterparties, insertion-order independence, clone/reload, terminal retry, prospective-only history, accepted physical cargo and bounded retention across 100 repeated observations. One initial new-test type error around an optional resource-source union was fixed by explicitly constructing the actual faction-stock source; no production type was weakened.

An independent final public-state serialization probe has zero occurrences of the NPC plan identity, private source identity or retained context prefix (7,489-byte public DTO). This checks the actual public serializer output, not a claim that the temporary probe used an HTTP socket. Existing HTTP privacy tests remain in the full runner.

Production and test-inclusive TypeScript, build and diff check pass. The initial full suite completed with 2,291 passes and three skips, but predates the additional reservation-edge correction. **Final resumed validation: 2,293 passed / 0 failed / 3 credential-gated skips.** All 16 canonical hashes from eight larger-world cases match the parent, and whole/sliced reload processing agrees. These load fixtures contain no Trade operations; the native focused probes demonstrate the corrected behavior. See `BACKEND_DECLINED_TRADE_VALIDATION.json`. Three live-Supabase tests remain explicitly credential-gated. The environment restart discarded the earlier temporary logs, so validation was rerun. Current focused, independent parent/current native-path probes and full-suite logs are at `/tmp/repwars-trade-context/`; the concise validation JSON is the durable evidence. An initial sandboxed full-suite attempt stopped at loopback `listen EPERM`; the permitted rerun is reported separately, not counted as an application test failure or pass.

## Remaining independent work

The archived distant-army MOVE case also reproduces on the current schema-30 reader: an 836-soldier field force at `t_009` has no distant strategic-access source. The previously approved owned-route/adjacent-MOVE correction can be reviewed separately; this phase does not change movement scoring or replace the recovered local-army-formation policy. Food location/transport, production identity/database access, authored workout policy/content, visibility/scouting and Level 1 selection remain external/product gates.
