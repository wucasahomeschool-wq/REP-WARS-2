# Performance evidence — fixture measurements, not gameplay guarantees

The reported implementation measurement is preserved unmodified in `evidence/reported-performance.jsonl`: quiet **10,000 ticks in 3,152 ms**, zero observer scans and zero deliberations. This freeze task packages that evidence rather than replacing the reported number with a differently loaded benchmark run.

## Exact command

Original command, from repository root:

```bash
TS_NODE_PROJECT=tsconfig.tests.json node -r ./node_modules/ts-node/register/transpile-only /tmp/l-driver.cjs aiResponses /tmp/l-diagnostics.ts
```

Portable bundled equivalent:

```bash
TS_NODE_PROJECT=tsconfig.tests.json node -r ./node_modules/ts-node/register/transpile-only docs/review/phase-l-frozen/scripts/l-driver.cjs aiResponses docs/review/phase-l-frozen/scripts/l-diagnostics.ts
```

This command runs the quiet fixture first and then all seven representative fixtures below. `scripts/l-driver.cjs` AST-extracts the existing test helper declarations and assembles a virtual module in memory. `scripts/l-diagnostics.ts` contains complete fixture authoring/instrumentation. Metrics patch functions in that diagnostic process only, with no production file writes.

## Quiet fixture configuration

Twelve active AI factions, one territory each in a deterministic ring; no player faction, field forces, Goals, Memory, useful missing construction, resource income or output. Existing completed Cities/developments and max fortifications eliminate artificial development need; garrisons are high. Recruitment has no Food. Default WAR alone is not a source. `QuietEvents` suppresses unrelated random event activity; this is explicitly a quiet fixture, not a representative contested production world.

Uses real `ADVANCE_WORLD` Orchestrator handlers, canonical state cloning, invariants and all current cognition/domain hooks. Advances in at-most-64-tick chunks through 10,000 ticks. No network, database or serialization latency is measured. Elapsed wall time comes from diagnostic `performance.now`, never gameplay timing authority.

Reported quiet workload: 40,000 cheap boundary queue checks; **0 observations**, **0 contexts**, **0 full non-proactive or proactive deliberations**, **0 evaluator/comparison suites**, **0 plans**, **0 starts/operations**, **0 history rows**. Empty queue checks at existing boundaries are not new polls/timer wakes.

## Preserved measurements

| Fixture | ms | Queue checks | Observations | Full thoughts | Plans | Interventions | Outcome |
|---|---:|---:|---:|---:|---:|---:|---|
| Quiet 12-faction / 10,000 ticks | 3,152 | 40,000 | 0 | 0 | 0 | 0 | No contexts/history |
| 100 required Trade contexts | 56 | 2 | 1 | 100 required | Existing recipient assessment | 0 | 100 responses settled; history 101 |
| 200 emergencies / unchanged repeat calls | 64 | 1,201 | 2 | 200 | 0 | 0 | 200 dormant no-intervention; history 0 |
| 200 blocked cargo recoveries | 22 | 1,000 | 2 | 0 | 0 | 0 | 200 dormant; custody conserved; history 301 |
| Critical + required + blocked movement | 21 | 8 | 6 | 2 (includes 1 required) | 4 | 0 | Inferior intervention rejected; history 2 |
| 25 reload / fine-coarse pairs | 185 | 951 | 1 | 50 | 100 | 0 | Exact canonical equality |
| Actionable local defensive REINFORCE | 6 | 8 | 3 | 1 | 5 | 1 | Exact allocation; no proactive deliberation |

Stress proposals begin with an actually published domain template and then author independently identified valid operations/claims/timers; they are not 100 independently completed proactive selections. Blocked cargo is produced from accepted bilateral domain settlement before authoring the blockage. These fixtures test bounded machinery/custody, not autonomous strategic quality. The positive reinforcement fixture prevents the quiet/no-intervention results being mistaken for globally disabled cognition.

## Comparison / environment

Preserved comparable Phase K quiet measurement: **2,930 ms**, `evidence/reported-phase-k-quiet.log`; Phase L 3,152 ms is about **7.6% higher in that run**. `scripts/l-quiet-comparison.cjs` is the original baseline driver and originally read `/tmp/l-diagnostics.ts`; its unmodified copy is retained for provenance. Reproduction requires the baseline checkout/export plus the documented diagnostic path; it is not a production runner.

Freeze environment captured in `evidence/environment.json`: Linux x86_64, Node v24.19.0, TypeScript 5.9.3, five reported logical CPUs and approximately 33.3 GiB host-reported memory. These are environment observations, not reserved hardware capacity. The earlier measurement log did not separately capture hardware/load; do not infer a stronger hardware equivalence guarantee.

Classification: the quiet measurement supports bounded extra bookkeeping with zero scans/full thought; it does **not** certify large retained-history performance, contested-world throughput, mobile performance or response correctness. See the confirmed scheduling finding in `SELF_AUDIT.md`. No tuning, compaction or implementation optimization was done in this freeze task.
