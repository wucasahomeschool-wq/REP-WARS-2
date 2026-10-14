# Before/after authoritative simulation comparison

Before uses actual tracked code read from the pinned Git commit, not a reimplementation. Every reference state hash must match the original corpus. Inputs, seeds, presence histories, batching and reload cadence match. Final-after uses the frozen production fingerprints. Preliminary after/smoke directories are excluded.

| Scenario | Decisions before→after | WAIT | MOVE | ATTACK | Trade | Repeat declined terms | Frontier gaps | Battles | AI Food failures | Seconds | Peak RSS MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| large-11-online-1440 | 1139→2068 | 874→1757 | 0→2 | 148→188 | 3→2 | 0→0 | 1→1 | 55→55 | 0→0 | 141.29→164.77 | 771.3→927.6 |
| large-11-online-360 | 1139→1238 | 874→927 | 0→2 | 148→188 | 3→2 | 0→0 | 1→1 | 55→55 | 0→0 | 86.10→96.45 | 728.2→799.4 |
| large-29-offline-360 | 220→220 | 83→83 | 0→0 | 84→84 | 0→0 | 0→0 | 0→0 | 39→39 | 0→0 | 22.84→21.77 | 479.6→501.6 |
| large-29-online-360 | 1678→1967 | 1364→1757 | 0→2 | 153→99 | 47→2 | 38→0 | 0→0 | 52→44 | 0→0 | 121.37→161.38 | 741.2→780.0 |
| large-47-online-360 | 1454→1454 | 1213→1213 | 0→0 | 164→164 | 0→0 | 0→0 | 0→0 | 54→54 | 0→0 | 104.61→91.86 | 730.8→774.1 |
| medium-11-online-1440 | 904→904 | 782→782 | 0→0 | 68→68 | 0→0 | 0→0 | 0→0 | 33→33 | 0→0 | 58.34→55.15 | 679.5→689.7 |
| medium-11-online-360 | 904→904 | 782→782 | 0→0 | 68→68 | 0→0 | 0→0 | 0→0 | 33→33 | 0→0 | 36.28→48.99 | 646.8→556.1 |
| medium-29-offline-360 | 148→148 | 75→75 | 0→0 | 36→36 | 0→0 | 0→0 | 0→0 | 23→23 | 0→0 | 13.65→7.61 | 452.0→408.8 |
| medium-29-online-360 | 901→892 | 792→783 | 0→0 | 49→49 | 0→0 | 0→0 | 1→1 | 27→27 | 0→0 | 33.46→37.30 | 553.8→628.2 |
| medium-47-online-360 | 1017→1126 | 904→1013 | 0→0 | 50→50 | 0→0 | 0→0 | 1→1 | 26→26 | 0→0 | 38.12→42.01 | 554.8→597.3 |
| small-11-online-10080 | 62→75 | 17→18 | 0→1 | 21→24 | 0→0 | 0→0 | 1→0 | 10→11 | 18→68 | 78.36→90.05 | 513.1→550.1 |
| small-11-online-1440 | 56→66 | 17→18 | 0→1 | 21→24 | 0→0 | 0→0 | 1→0 | 10→11 | 0→0 | 12.86→12.89 | 403.3→413.5 |
| small-11-online-360 | 56→66 | 17→18 | 0→1 | 21→24 | 0→0 | 0→0 | 1→0 | 10→11 | 0→0 | 5.70→11.74 | 427.1→552.0 |
| small-29-offline-360 | 41→41 | 5→5 | 0→0 | 22→22 | 0→0 | 0→0 | 0→0 | 11→11 | 0→0 | 4.56→1.62 | 381.2→355.0 |
| small-29-online-360 | 54→54 | 18→18 | 0→0 | 19→19 | 0→0 | 0→0 | 0→0 | 11→11 | 0→0 | 5.44→8.81 | 451.2→556.9 |
| small-47-online-360 | 31→31 | 6→6 | 0→0 | 17→17 | 0→0 | 0→0 | 0→0 | 10→10 | 0→0 | 4.81→7.82 | 431.3→509.5 |

## Equal-horizon online aggregate

```json
{
  "decisions": {
    "before": 7234,
    "after": 7732
  },
  "actions": {
    "ATTACK": {
      "before": 689,
      "after": 678
    },
    "REINFORCE": {
      "before": 1,
      "after": 3
    },
    "BUILD": {
      "before": 524,
      "after": 524
    },
    "MOVE": {
      "before": 0,
      "after": 5
    },
    "OFFER_PEACE": {
      "before": 0,
      "after": 0
    },
    "TRADE": {
      "before": 50,
      "after": 4
    },
    "RETREAT": {
      "before": 0,
      "after": 1
    },
    "WAIT": {
      "before": 5970,
      "after": 6517
    }
  },
  "operations": {
    "before": 1296,
    "after": 1243
  },
  "battles": {
    "before": 278,
    "after": 271
  },
  "captures": {
    "before": 638,
    "after": 630
  },
  "repeatedDeclines": {
    "before": 38,
    "after": 0
  },
  "frontierGaps": {
    "before": 4,
    "after": 3
  }
}
```

Each case also preserves native operation-action counts, status/terminal details, shipments, Goals, recruitment, resources, troop losses and survivor records in COMPARISON.json and the per-case artifacts. Repeat-decline counts group complete exact terms/endpoints/source, not merely counterparty. A retry after relevant context change is allowed; a lower count is not proof every rejection should have been prevented.

Frontier gaps mean idle uncommitted forces with a credible reachable target beyond local staging, measured using the same read-only physical query in both versions. Some distant first hops remain below the current commitment margin. No deployed replacement-army rule or Food transfer was implemented: changed starvation/survival counts can result from changed wars and elimination, not a fix to those blocked mechanics.

Elapsed runtime includes full scoring logs, canonical cloning, hydration and CAS. Peak RSS includes TypeScript/reference-loader/compiler and retained diagnostics; host workloads overlapped. Memory figures are observations, not pure-engine allocation comparisons. This is not a production throughput or gameplay-time guarantee.
