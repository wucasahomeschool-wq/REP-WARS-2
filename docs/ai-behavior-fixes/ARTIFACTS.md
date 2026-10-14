# Behavioral simulation artifacts — preservation and tracking recommendation

No files were deleted, staged or committed. Original `docs/ai-longrun/MANIFEST.json` and all 118 entries remain byte-identical. Original 119 untracked files are preserved, including the original reusable harness and tests. This follow-up uses `docs/ai-behavior-fixes/` so historical evidence is never rewritten.

## Appropriate eventual source-control scope, after review

- Six modified production files and two new production helpers listed in `docs/AI_LONGRUN_BEHAVIORAL_FIXES.md`.
- `tests/aiBehavioralFixes.ts`, original `tests/aiLongRunSimulation.ts`, and the two small compressed-world/definition fixtures plus their README under `tests/fixtures/ai-behavioral/`. These permit regressions without tracking the whole corpus.
- Original reusable `src/simulation/longrun/{runner,scenarios,cli,analyze}.ts`, follow-up `behavioralRun.ts` and `compareBehavior.ts`.
- `scripts/ai-behavioral-baseline.cjs` and `scripts/ai-behavioral-matrix.cjs`: pinned real-engine replay and reproducible configuration matrix, not a second AI implementation.
- Concise architecture/audit/validation reports, aggregate comparison, scenario configurations and provenance fingerprints. Selected compact regression evidence can be tracked if desired.

## Reproducible generated outputs

Full private scoring/event JSONL, readable long timelines, per-case final snapshots, full runner logs and large comparison JSON with nested summaries should normally remain generated outputs or be archived separately. They are development-only private cognition evidence, not public API payloads. Do not automatically commit all generated logs or expose them to players.

`results/before/` and `results/final-after/` are the final paired corpus. `results/after/` and `results/smoke/` are preserved preliminary evidence and **excluded** from final metrics. They document intermediate iterations; they must not be mistaken for the final frozen code or silently removed during this task.

`MANIFEST.json` in this directory inventories follow-up files (self excluded); `evidence/final-production-fingerprints.json` pins the eight production files used by the final matrix. The original manifest remains authoritative for the original corpus. Hash manifests identify bytes; they do not authorize committing generated data.

No `.gitignore`, cleanup, reset or original-worktree modification was needed. The eventual code/evidence selection is a separate review/checkpoint decision.
