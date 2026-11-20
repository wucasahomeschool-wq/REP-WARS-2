# Personal-version master consolidation

This branch consolidates all local and fetched remote branch histories available
in the Codex workspace on 2026-11-20. It preserves the latest backend, Unity and
art assets without changing the GitHub default branch or deleting source branches.

Resolution policy, based on verified provenance:

- Recovered local completion tree is exactly the 51de61e recovery tree already
  incorporated by later backend checkpoints. Preserve its history and keep the
  newer backend implementation rather than replaying obsolete code over fixes.
- assets/3d-model-import contributes both additional 3D models and 2D artwork.
- dev/ai-longrun-simulation contributes its simulation tools, reports and evidence.
  Overlapping runtime and existing test files retain the current backend versions:
  durable army identities, empire banks, current deployment/recruitment and newer
  Trade context rules supersede the old branch's local-pool implementation.
- The old military-recovery test is archived byte-for-byte with a .reference
  suffix because its FIELD_FORCE_GAP contract is obsolete. See archive README.
  Other historical simulation utilities compile, but have not been revalidated
  against the changed gameplay contracts. Their old results remain historical.
- Original per-branch implementations remain accessible through merge parents;
  a single executable cannot simultaneously apply incompatible historical rules.

Validation: current backend source and registered regression runner are unchanged
from the verified Phase 5A checkpoint. Its full suite completed 2,477 passes,
0 failures and 3 credential-gated Supabase skips; 72 focused cases passed. Both
production and test-inclusive TypeScript checks and production build pass in the
consolidated tree. A focused post-merge run is recorded in the final handoff.
Unity and historical simulation execution are not verified here.

No default-branch update, branch deletion, force push or deployment is performed.
No simplification for the personal version has been implemented yet. Missing
approved workout content, ratios, public event choices, live Supabase testing and
expensive retained-event history remain limitations.

Raw cloud-only validation logs are under /workspace/phase5a-production-validation;
concise validation evidence is committed here. Existing external diagnostic logs,
node_modules and generated build outputs are not source commits. Local uncommitted
source work was preserved on recovery/local-completion-preservation-20261120 and
fix/backend-natural-event-eligibility before consolidation.
