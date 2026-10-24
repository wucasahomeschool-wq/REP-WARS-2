# Bounded authentication and readiness callbacks

Parent: `c1063043fae039c333c8676ab5e0fcc0b47e733b`. Branch: `feat/backend-dependency-bounds`. This is operational failure containment, not authentication-provider implementation, an account policy or a gameplay timer.

## Reproduction

A local HTTP probe held four authentication callbacks and four `/ready` probes open. All eight entered their adapters and zero responses completed until the probe explicitly released them. The earlier host request-admission limit cannot help here: authentication occurs before host admission, while readiness does not use the gameplay host. The baseline had no callback count/deadline options.

## Implemented boundary

`src/server/dependencyBudget.ts` centralizes the same operational rule for both adapters:

- Reject excess calls immediately, without invoking or queueing the adapter.
- Bound the response wait using a monotonic deadline and a timer.
- Check elapsed time when a result arrives as well: delayed event-loop timers cannot authorize an already elapsed result.
- Supply an optional `AbortSignal`; consume late fulfillment/rejection without changing the public outcome.
- **Retain a timed-out callback's capacity slot until its actual promise settles.** Ignoring cancellation cannot turn retries into an unlimited collection of unfinished calls.
- Do not inspect thrown values or log provider messages/credentials.

`createCommandHttpServer` owns one authentication budget shared by `/commands`, `/session/open`, `/session/heartbeat` and `/session/end`, and one independent readiness budget. Production composition forwards the same trusted options.

| Trusted deployment option | Default outstanding calls | Default response deadline |
|---|---:|---:|
| `authenticationLimits` | 64 | 5,000 ms |
| `readinessLimits` | 1 | 2,000 ms |

Each accepts optional `maxPending` and `timeoutMs`. Counts must be positive safe integers. Deadlines must be integer milliseconds from 1 through 2,147,483,647, avoiding Node's timer-overflow clamp. HTTP data cannot choose these settings.

Authentication failure/timeout/capacity retains the existing safe **503 AUTHENTICATION_UNAVAILABLE** response; invalid credentials remain 401 and a mismatching body identity remains 403. Readiness returns 503 with `ready:false` unless its bounded probe returns exactly `true`. `/health` does not invoke either adapter. A rejected authentication attempt loads no world, renews no lease and consumes no command receipt. The existing logical command can retry normally after the dependency recovers.

One-argument authentication and zero-argument readiness callbacks remain compatible. New adapters should honor the optional signal and enforce their own network I/O deadlines. No selected provider, token policy, account mapping or external credential is introduced.

## Limits

A JavaScript timer cannot preempt synchronous blocking code or make an uncooperative promise terminate. A late result is rejected, but the process must regain its event loop to send a response. If every adapter slot is permanently stuck, the boundary stays unavailable rather than launching more work; operator recovery is required. Adapters remain trusted, nonblocking server code and must not mutate gameplay state.

These limits do not bound incoming sockets, request bodies before authentication, IP request rates, synchronous database calls or gameplay processing. Existing host admission and historical chunk limits remain separate. TLS, ingress controls, real provider configuration, live database readiness and deployment load/restore tests remain infrastructure gates.

## Validation

- Focused regressions: **22 passed / 0 failed** (8 budget tests and 14 HTTP/composition tests).
- Actual routes cover all four protected endpoints, cross-route capacity, default 64-call saturation, cancellation, a late identity result, no world access on failure, retry/receipt exactness, provider error privacy, readiness timeout/saturation/recovery, strict boolean readiness and independent liveness.
- A synchronous-stall regression proves that elapsed results cannot beat a delayed timer.
- Production/test-inclusive TypeScript and production build: PASS, zero diagnostics.
- Full backend suite: running against the final implementation. An earlier partial run was stopped after adding the elapsed-deadline check; it is not counted as a successful run.
- `git diff --check`: PASS.

An initial syntax error in the new HTTP test was corrected before focused validation; it was a candidate test defect, not an inherited diagnostic. No skipped test is counted as passed. Logs are outside the repository under `/tmp/repwars-dependency-bounds/`; the committed tests reproduce the checks.
