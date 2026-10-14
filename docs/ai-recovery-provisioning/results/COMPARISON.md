# Authoritative military recovery comparison

All sixteen original inputs and authored definitions match. Reference digests match the original archived corpus. Original and previous results are preserved paired evidence; current results are fresh runs. No scenario resources, troops, seeds or time/presence settings changed.

| Case | Decisions previous→current | WAIT | ATTACK | MOVE | REINFORCE | Formed armies | Recovered faction cases | Battles | Captures | Food failures | Frontier gaps | Seconds | Peak RSS MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| large-11-online-1440 | 2068→2142 | 1757→1655 | 188→306 | 2→4 | 0→49 | 26 | 5 | 55→89 | 176→263 | 0→0 | 1→1 | 164.77→200.09 | 927.6→873.8 |
| large-11-online-360 | 1238→1264 | 927→911 | 188→212 | 2→3 | 0→10 | 6 | 4 | 55→61 | 176→196 | 0→0 | 1→0 | 96.45→96.52 | 799.4→793.0 |
| large-29-offline-360 | 220→220 | 83→82 | 84→84 | 0→0 | 0→1 | 1 | 1 | 39→39 | 79→79 | 0→0 | 0→0 | 21.77→22.04 | 501.6→530.4 |
| large-29-online-360 | 1967→1951 | 1757→1740 | 99→101 | 2→2 | 2→1 | 1 | 1 | 44→45 | 94→96 | 0→0 | 0→0 | 161.38→163.61 | 780.0→785.6 |
| large-47-online-360 | 1454→1645 | 1213→1365 | 164→162 | 0→0 | 1→18 | 12 | 6 | 54→60 | 153→139 | 0→0 | 0→1 | 91.86→112.41 | 774.1→825.8 |
| medium-11-online-1440 | 904→3595 | 782→3176 | 68→269 | 0→4 | 0→73 | 28 | 4 | 33→81 | 65→220 | 0→0 | 0→0 | 55.15→154.27 | 689.7→912.3 |
| medium-11-online-360 | 904→1055 | 782→875 | 68→96 | 0→0 | 0→15 | 8 | 4 | 33→39 | 65→84 | 0→0 | 0→0 | 48.99→47.83 | 556.1→655.9 |
| medium-29-offline-360 | 148→150 | 75→74 | 36→35 | 0→0 | 3→6 | 2 | 2 | 23→24 | 33→33 | 0→0 | 0→0 | 7.61→8.19 | 408.8→429.0 |
| medium-29-online-360 | 892→926 | 783→750 | 49→85 | 0→1 | 0→8 | 4 | 3 | 27→33 | 45→77 | 0→0 | 1→0 | 37.30→35.82 | 628.2→706.8 |
| medium-47-online-360 | 1126→1041 | 1013→851 | 50→92 | 0→0 | 0→12 | 6 | 4 | 26→29 | 44→80 | 0→0 | 1→0 | 42.01→44.15 | 597.3→710.4 |
| small-11-online-10080 | 75→75 | 18→18 | 24→24 | 1→1 | 0→0 | 0 | 0 | 11→11 | 22→22 | 68→68 | 0→0 | 90.05→92.51 | 550.1→541.3 |
| small-11-online-1440 | 66→66 | 18→18 | 24→24 | 1→1 | 0→0 | 0 | 0 | 11→11 | 22→22 | 0→0 | 0→0 | 12.89→13.29 | 413.5→421.9 |
| small-11-online-360 | 66→66 | 18→18 | 24→24 | 1→1 | 0→0 | 0 | 0 | 11→11 | 22→22 | 0→0 | 0→0 | 11.74→6.83 | 552.0→511.9 |
| small-29-offline-360 | 41→42 | 5→6 | 22→22 | 0→0 | 0→0 | 0 | 0 | 11→11 | 21→21 | 0→0 | 0→0 | 1.62→1.74 | 355.0→366.6 |
| small-29-online-360 | 54→54 | 18→18 | 19→19 | 0→0 | 0→0 | 0 | 0 | 11→11 | 17→17 | 0→0 | 0→0 | 8.81→5.87 | 556.9→522.5 |
| small-47-online-360 | 31→31 | 6→6 | 17→17 | 0→0 | 0→0 | 0 | 0 | 10→10 | 14→14 | 0→0 | 0→0 | 7.82→4.85 | 509.5→513.3 |

## Nine equal-horizon six-hour online cases

```json
{
  "original": {
    "decisions": 7234,
    "actions": {
      "ATTACK": 689,
      "REINFORCE": 1,
      "BUILD": 524,
      "MOVE": 0,
      "OFFER_PEACE": 0,
      "TRADE": 50,
      "RETREAT": 0,
      "WAIT": 5970
    },
    "operations": 1296,
    "battles": 278,
    "captures": 638,
    "formations": 0,
    "recoveredFactionCases": 0,
    "frontierGaps": 4,
    "repeatDeclines": 38
  },
  "previous": {
    "decisions": 7732,
    "actions": {
      "ATTACK": 678,
      "REINFORCE": 3,
      "BUILD": 524,
      "MOVE": 5,
      "OFFER_PEACE": 0,
      "TRADE": 4,
      "RETREAT": 1,
      "WAIT": 6517
    },
    "operations": 1243,
    "battles": 271,
    "captures": 630,
    "formations": 0,
    "recoveredFactionCases": 0,
    "frontierGaps": 3,
    "repeatDeclines": 0
  },
  "current": {
    "decisions": 8033,
    "actions": {
      "ATTACK": 808,
      "REINFORCE": 64,
      "BUILD": 617,
      "MOVE": 7,
      "OFFER_PEACE": 0,
      "TRADE": 2,
      "RETREAT": 1,
      "WAIT": 6534
    },
    "operations": 1536,
    "battles": 299,
    "captures": 725,
    "formations": 37,
    "recoveredFactionCases": 22,
    "frontierGaps": 1,
    "repeatDeclines": 0
  }
}
```

Formations count completed native REINFORCE/new_army operations, not generated candidates. Final-after uses the final frozen production fingerprints; the preserved formation-only after matrix is excluded. Recovery counts are distinct faction IDs per case; labels repeat across independent worlds. Some formed armies are later destroyed. The inherited `militaryRecoveryBlocked` diagnostic means an army-less faction with a deployable pool at the final snapshot; it does not prove its current recovery plan is blocked. Proactive MOVE decisions and all physical MOVE operation counts are separate.

Strict nested-error-free cases: 15/16. Every nonempty error array is retained in COMPARISON.json; a completed, conserved world does not by itself classify those errors. See the investigation in the implementation report.

Food administration remains blocked for a separately reviewed located-bank and transport contract. Automatic internal collection/transport added here: zero. Current logs establish paid upkeep, shortages, recruitment Food costs and net resource conservation; gross production/ownership-forfeiture Food is not separately tallied, and is not inferred from net balances. Changes in holdings/shortages follow changed wars and infrastructure, not a Food-provisioning fix.

Runtime includes native cloning, persistence, hydration, TypeScript/bootstrap and retained private scoring logs. Some host validation workloads overlapped; RSS/timing are observations, not isolated engine-performance guarantees. No source or test assumptions were changed to favor survival. All original and earlier artifacts remain preserved.
