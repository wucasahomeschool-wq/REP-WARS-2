# Schema-30 Trade migration fixture

`schema30-live-trade.json` was serialized using the actual parent runtime at `c9473107bbd5281d011480dc3fe3ff1a207c9688`, before the empire-bank changes. It uses the registered Level 1 definition and canonical initializer. Fixture faction banks were set to 100 of each resource, the player offered 20 Wood for 10 Food through the native Orchestrator, then the authoritative `progressProactiveThrough` advanced 60,000 ms under default offline presence and `settleTradeProposal` accepted the offer. Both real manifests are in loading with their source resources already debited.

These balances and terms are test inputs, not production balance. The fixture has no credentials or real player data. Tests hydrate it through the actual migration and verify both recipient credits, already-delivered behavior, loading/transit/unloading/blocked variants and a schema-31 round trip. Additional variants are explicitly test mutations of the native fixture, not claims that separate live production saves were obtained.

The temporary generator used in this session is `/tmp/gameplay-contracts/make-legacy-trade.cjs`; the committed JSON is the durable regression input. No old source checkout was modified to generate it.
