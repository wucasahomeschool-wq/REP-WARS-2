# AI long-run simulation and military recovery checkpoint

This checkpoint preserves the reviewed development candidate on `dev/ai-longrun-simulation`, based on `6f38eec6516682e64937b08744a5607f54bbba91`. It contains the authoritative simulation harness, portable regressions, owned-route MOVE discovery, exact-context declined-Trade suppression, local troop-to-army recovery, and the measured non-throwing construction-prerequisite optimization. No production behavior was changed during checkpoint preparation. Schema remains 27.

## Scope and evidence

`AI_LONGRUN_CHECKPOINT_SCOPE.json` records every included and excluded path, with SHA-256 fingerprints. The scope document's own content hash is excluded to avoid self-reference. Existing manifests remain unchanged historical evidence; their old source fingerprints are not rewritten to pretend later corrections already existed.

The commit includes production/development code, all four standalone test suites, the portable small-world fixtures, four root implementation/review reports, aggregate comparisons, scenario configurations, per-case summaries, compact diagnostic JSON, provenance manifests and reusable probe scripts/source copies. Full timelines, full final snapshots, raw CPU profiles and console logs remain unchanged in the Codex worktree, excluded as reproducible generated outputs. Their exact paths and fingerprints remain recorded. This commit is a source/compact-evidence checkpoint, not an embedded complete historical execution archive. Some optional archive-analysis probes require those generated outputs to be present or regenerated; the portable regression suites do not.

## Checkpoint verification performed

- Correct worktree and branch; parent HEAD verified; index initially empty.
- Complete tracked diff and new-file inventory reviewed. No Unity, unrelated checkout, credential/configuration, combat-formula or balance-constant changes included.
- Original simulation manifest: 118/118 entries match. Final military review manifest: 67/67 entries match. Earlier behavioral/military source fingerprint differences are the documented subsequent recovery and performance corrections; no manifest entries are missing.
- Targeted tests rerun during this checkpoint: military review 5/0, military recovery 31/0, MOVE/Trade 31/0, simulation 19/0; total 86 passed, zero failed/skipped.
- Production TypeScript `--noEmit` rerun: PASS.
- Staged path/content fingerprints and `git diff --cached --check` verified before commit.

## Historical validation and performance

The following were checked against preserved evidence, not rerun during this Git task:

- A–L focused: 837 passed / 0 failed.
- Integration: 319 passed / 0 failed.
- Full backend runner: 1,916 reported passed / 0 failed, including three credential-gated live Supabase skips; 1,913 actually executed. No new live database validation is claimed.
- Test-inclusive compilation: the same 28 inherited diagnostic identities, no additions/removals.
- Paired Medium seed 11 day profiles: 161.6→107.6 seconds.
- Large seed 29 six-hour run: archived 163.6→fresh 67.7 seconds.
- Small seed 11 week run: archived 92.5→fresh 85.0 seconds.

The three affected final-review runs preserve exact canonical state and decision/event timeline content. Historical native invariant/conservation checks and the current portable regressions support troop/resource conservation, deterministic identity, reserved local allocation, mature exactly-once completion, retry/reload/CAS safety and ordinary movement. Two Medium-day attacks were correctly invalidated after defensive casualties reduced 101 troops to 76; terminal claims and Attention release correctly. The final review corrects the older artifact's observation-batch versus actual-terminal timestamp labels while preserving the original artifact.

## Limitations preserved

- Food provisioning remains deferred pending a separately reviewed authoritative bank-location and physical-logistics contract. No automatic bank credit, free Food, transport shortcut or upkeep-accounting change is included.
- Strategic attrition remains open. Across the archived, overlapping simulation cohort, 94 armies formed and 77 were subsequently destroyed. Of 110 attacks by formed armies, 43 had execution-time win probabilities below 50%. **These subset/cohort figures do not establish the actual overall attacker-versus-defender victory rate.** Execution-time probability is not necessarily information known at commitment.
- No battle-equation, AI scoring-weight, personality, commitment-threshold or action-set retuning was approved or performed in this phase. Existing factual support extensions are the reviewed implementation, not new checkpoint edits.
- Low MOVE frequency, WAIT churn, history growth, spatial/cargo recovery and other previously documented deferred policies remain limitations. This checkpoint does not resolve them.

This local branch is ready for separate review and an explicitly authorized controlled transfer. No remote publication, merge, Windows copy or deployment is performed by this checkpoint task. Generated evidence remains local and requires a separate authorized transfer if a reviewer needs the complete archive.
