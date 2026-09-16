# Player / AI interaction architecture (Phase 11)

> **Phase 17P:** Production initialization is WorldCatalog →
> `createGameStateFromWorld`. `MapEngine` is not a production engine.
>
> **Phase 17N.2:** Production worlds are authored `WorldDefinition` JSON
> (`docs/WORLD_DEFINITION.md`). `SCOUT` and `EXPAND` are not production
> commands. The current world is fully visible. `SAMPLE_MAP` is a legacy
> test fixture.

Phase 11 is an **architectural boundary pass**. Player and AI still share
domain engines. Phase 13 adds elapsed-time world simulation around that
boundary (`docs/CONTINUOUS_WORLD_ARCHITECTURE.md`) without persistence,
frontend, fitness, or TRADE/OFFER_PEACE.

**The most important rule:**

> The player and AI use the same underlying game rules.
> The AI decides what it wants to do.
> The player commands what they want to do.
> The Orchestrator coordinates both.
> Domain engines resolve the actual game rules.
> `GameState` remains the single source of truth.

**Level 1** is a scripted tutorial on those same engines. **Level 2+** is
where true autonomous AI is intended. Scripted tutorial attacks should use
`RESOLVE_COMMITMENT` / `executeAttack`, not a second combat path. A
tutorial/scenario controller is not implemented; `ADVANCE_WORLD` still
runs `AI_DECIDE`. That controller is a future vertical-slice task.

---

## Principle: participant-agnostic game systems

If something is a **game mechanic**, it must not fork into player-rules vs
AI-rules.

```
PLAYER                         AI
  ↓                              ↓
COMMAND                        DECISION ENGINE
  ↓                              ↓
                               COMMITMENT
  ↓                              ↓
           ORCHESTRATOR
                 ↓
        DOMAIN ENGINE (shared)
                 ↓
             GAMESTATE
```

Concrete shared examples:

| Mechanic | Player uses | AI uses | Shared engine / op |
| --- | --- | --- | --- |
| Battle | `ATTACK` command | `RESOLVE_COMMITMENT` → ATTACK | `BattleEngine` + `executeAttack` |
| Fortify | `BUILD` | commitment BUILD | same handler + `BALANCE.territory.fortificationCostPerLevel` |
| Reinforce | `REINFORCE` | commitment REINFORCE | same handler + `BALANCE.economy.reinforcementCost` |
| Declare war | `DECLARE_WAR` | commitment DECLARE_WAR | same handler |
| World events | `ADVANCE_WORLD` | same world step | `WorldSimulator` |

There is **no** PlayerBattleEngine, AIBattleEngine, PlayerEventEngine, or
AIEventEngine.

---

## Interaction flows

### 1. Player vs AI (and Player vs world)

```
PLAYER
  ↓
COMMAND  (ATTACK / BUILD / DECLARE_WAR / …)
  ↓
ORCHESTRATOR  (validate → route → transaction)
  ↓
BATTLE ENGINE / MAP / WorldSimulator / trivial state op
  ↓
GAMESTATE  (invariants, then commit)
  ↓
CommandResponse  (shared BattleResult / state-change fields)
```

The command envelope has a `playerId`. That value is the **durable game
identity** used by persistence (`docs/PLAYER_IDENTITY.md`). Gameplay faction
for player-originated commands is `GameState.playerFactionId`. A client-supplied
`parameters.factionId` cannot select another faction. AI factions act through
`AI_DECIDE` / `RESOLVE_COMMITMENT` / `ADVANCE_WORLD`. Engines never see
`playerId`.

### 2. AI vs player / AI vs AI

```
AI WARLORD
  ↓
DECISION ENGINE  (personality, ambition, goals, memory, scoring)
  ↓
COMMITMENT  ("I want to ATTACK territory X")
  ↓
ORCHESTRATOR  (RESOLVE_COMMITMENT)
  ↓
same executeAttack / handleBuild / … as the player
  ↓
BATTLE ENGINE (if combat)
  ↓
GAMESTATE
```

AI vs AI is the same path: two AI factions, `playerFactionId` is a third
faction (or null). `BattleEngine` only sees attacker/defender faction ids.

### 3. Player vs world / AI vs world

```
ORCHESTRATOR
  ↓
ADVANCE_WORLD
  ↓
ContinuousWorldEngine (worldTick + AI cadence + EventEngine adapter)
  ↓
WorldSimulator.simulate(toWorldStepInput(GameState)) when a tick completes an event turn
  ↓
mergeEventStepOntoGameState
  ↓
GAMESTATE
```

`WorldStepInput.playerFactionId` is **caller metadata**. `WorldSimulator`
does not branch event selection, severity, or consequences on whether a
faction is the player. Effects apply to the faction that owns the
affected territory.

---

## Responsibility matrix

| Operation | Game rule? | AI reasoning? | Player-specific? | Orchestration? | State mutation? | Belongs in |
| --- | --- | --- | --- | --- | --- | --- |
| ATTACK resolution math | yes | no | no | no | via result apply | **BattleEngine** |
| ATTACK eligibility / apply | thin glue | no | no | yes | yes | Orchestrator `executeAttack` |
| BUILD / REINFORCE costs | yes (BALANCE) | no | no | apply only | yes | handlers + `BALANCE` (no EconomyEngine) |
| MOVE (adjacent, immediate) | trivial | no | no | yes | yes | handler (no MovementEngine) |
| DECLARE_WAR / NEGOTIATE | trivial writes | no | no | yes | yes | handlers (no DiplomacyEngine yet) |
| OFFER_PEACE / TRADE | future | scoring exists | no | reject | no | `FEATURE_NOT_IMPLEMENTED` |
| Event step | yes | no | no | invoke/apply | yes | **WorldSimulator** |
| Personality / ambition / goals / memory / scoring / commitment pick | no | **yes** | no | no | commitments only | **DecisionEngine** + AI subsystems |
| AI_DECIDE | no | yes | no (excludes player) | route | commitments | Orchestrator → DecisionEngine |
| RESOLVE_COMMITMENT | no | lifecycle only | no | yes | via domain ops | Orchestrator delegates |
| Workout / fitness | future | no | **yes** | future | Orchestrator must apply | Fitness Engine (stub only) |
| GET_GAME_STATE / GET_VISIBLE_WORLD | no | no | viewer default | yes | **no** | read adapters |

---

## Participant-agnostic engines (current)

| Engine | Why it is shared |
| --- | --- |
| **BattleEngine** | `BattleInput` / `BattleResult` have attacker/defender faction ids only. No `playerFactionId`. PLAYER→AI, AI→PLAYER, AI→AI all call `battle.resolve()`. |
| **WorldSimulator** (Event Engine) | Territory/faction-owned effects. Does not read `playerFactionId` for rules. |
| **MapEngine** | **LEGACY / TEST ONLY.** Hex generation, fog, and scout/expand. Not registered in the production EngineRegistry. Authored WorldDefinition is geography authority. |

Shared apply helpers (not engines): `applyBattleResultToGameState`,
`mergeEventStepOntoGameState`. One `BattleResult` type; no player- or
AI-specific battle result.

---

## AI-specific systems

These decide **what** an AI warlord wants. They must not resolve battles,
apply event consequences, or own a second world.

- `DecisionEngine` / `WarlordState` — commitment lifecycle
- `PersonalitySystem`
- `GoalSystem`
- `MemorySystem`
- `ActionScorer` / `ScoringHelpers` — strategic scoring only
- `GameState.commitments` — canonical record of AI intent
- `AI_DECIDE` command — runs DecisionEngine for **non-player** factions
- `RESOLVE_COMMITMENT` — executes intent through **shared** domain handlers

Boundary:

```
AI DecisionEngine
    ↓
AI Commitment   ("attack X")
    ↓
Orchestrator
    ↓
BattleEngine.resolve()
    ↓
applyBattleResultToGameState
    ↓
GameState
```

`WarlordState` is AI runtime (live Memory/Goal engines). It is rebuilt from
`GameState` after commands. It is not a second authoritative world.

After `RESOLVE_COMMITMENT` completes, the stored commitment is terminal
(`completed` / `failed` / `interrupted`). GameState invariants validate
targets only for **in-flight** commitments, because a successful ATTACK
can capture the recorded target.

`AI_DECIDE` refuses to run DecisionEngine for `GameState.playerFactionId`.
The player issues commands; the AI does not auto-play the player faction.

---

## Player-specific systems

The player is **one faction** in `GameState.factions`, identified by
`playerFactionId` (`null` = all-AI / spectator sim). There is no separate
player world object.

Genuinely player-only (not implemented this phase):

```
Player physical input
    ↓
Future Fitness / Workout Engine   (converts workout → game-relevant deltas)
    ↓
result DTO
    ↓
Orchestrator
    ↓
GameState
```

The fitness port (`EngineRegistry.fitness`) is a **stub**. It must not
mutate `GameState`. Workout processing, difficulty interpretation, and
resource grants from exercise are later phases.

Player-facing conveniences that are **not** separate game rules:

- Command envelope `playerId`
- Default acting/viewer faction = `playerFactionId`
- Read-only `GET_*` snapshots

---

## Orchestrator responsibilities (after this pass)

The Orchestrator **coordinates**. It does not become a gameplay engine.

It does:

1. Validate command id / parameters / implemented-vs-unsupported
2. Route to a handler
3. For mutating commands: clone → handler → invariants → commit
4. Call engines and apply **engine results**
5. Package `CommandResponse`

It does not:

- Personality scoring, battle formulas, event generation, map generation,
  fitness conversion
- Maintain a second faction/territory/army collection

### Handler classification (`src/orchestration/handlers.ts`)

| Handler | Class | Why it stays here |
| --- | --- | --- |
| GET_COMMAND_INDEX, GET_GAME_STATE, GET_VISIBLE_WORLD | **A** routing / read | clones; no mutation |
| ATTACK (`executeAttack` → `startStrategicAttack`) | **A + B** | Shared immediate/delayed attack: staging selection, optional one-hop MOVE, then BattleEngine + `applyBattleResultToGameState`. Eligibility (`soldiers+knights > 100`) and diplomacy side-effects stay as glue — not a second combat engine. |
| MOVE | **B** trivial | adjacency + location write |
| BUILD / REINFORCE | **B** trivial | charge `BALANCE`, increment fort/garrison (BUILD requires a city) |
| DECLARE_WAR / NEGOTIATE | **B** trivial | relationship / opinion writes |
| ADVANCE_WORLD | **A** | ContinuousWorldEngine + EventEngine adapter + existing AI handlers |
| AI_DECIDE | **A** | DecisionEngine + commitment sync (not world mutation) |
| RESOLVE_COMMITMENT | **A** | delegates to the same handlers as player commands |
| OFFER_PEACE / TRADE | **E** future | `FEATURE_NOT_IMPLEMENTED` |

**C (extract to a new engine):** none this phase — see domain-engine rule.
**D (AI reasoning in handlers):** none; scoring stays in DecisionEngine.

---

## GameState responsibilities

`GameState` is the only authoritative world: territories, armies, factions
(including diplomacy, resources, memory, personality, ambition, goals),
commitments, events, map/visibility.

```
GameState
    ↓
read / derive engine input
    ↓
Engine calculation
    ↓
Engine result
    ↓
Orchestrator apply
    ↓
GameState update + invariants
```

Engines may keep **temporary** calculation state. AI may keep
`WarlordState` reasoning wrappers. Neither is a second world.

---

## Domain-engine creation criteria

Create a new engine only when **all** of the following hold:

1. The domain has meaningful rules/calculations
2. Multiple callers need the same rules
3. The logic would otherwise accumulate in Orchestrator handlers
4. There is a clear input → result boundary

Do **not** create an engine merely because a command exists, the player
uses it, the AI uses it, or a new file would look neat.

Prefer **fewer well-defined engines**.

---

## Diplomacy architecture (current)

**DiplomacyEngine is not justified yet.**

Supported operations are two trivial state writes:

- `DECLARE_WAR` — both directions `at_war` + opinion hit from `BALANCE.diplomacy`
- `NEGOTIATE` — small bilateral opinion bump

Player and AI already share those handlers via `RESOLVE_COMMITMENT`.

Unsupported (do not fake):

- `OFFER_PEACE` — memory-only in older harness thinking; **does not**
  transition war state
- `TRADE` — scoring exists; **does not** exchange resources

A future DiplomacyEngine would be warranted when peace/treaties/trade
have real calculations and multiple callers. It must be
participant-agnostic (`PLAYER↔AI` and `AI↔AI` same rules). Until then,
keep the writes in handlers.

ATTACK's opinion/relationship nudge stays next to battle apply as
incidental glue, not a diplomacy engine.

---

## Economy / trade

**EconomyEngine is not justified yet.**

BUILD and REINFORCE are single-cost applications of existing `BALANCE`
constants. There is no separate player-trade vs AI-trade rule set, and
TRADE is not implemented.

When trade is implemented, it must be one shared domain operation (whether
that lives in DiplomacyEngine, a later EconomyEngine, or a small service)
— never `PLAYER_TRADE` vs `AI_TRADE` rule forks.

---

## Map / visibility

The current authored world is **fully visible**. There is no `SCOUT`
command, no territory fog, and no `mapWorld` visibility maps on
production `GameState`. `knownTerritories` on a warlord snapshot lists
every current-world tile id (complete knowledge of this world, not fog).

---

## Event participant parity

One Event Engine. `ADVANCE_WORLD` merges `WorldStepOutput` onto the same
`GameState` factions map the player and AI already share. No
PlayerEventEngine / AIEventEngine.

---

## Command vs AI decision (convergence)

| | Player | AI |
| --- | --- | --- |
| Intent | Command (`ATTACK` target X) | DecisionEngine → commitment ATTACK X |
| Coordination | Orchestrator | Orchestrator (`RESOLVE_COMMITMENT`) |
| Rules | `executeAttack` → BattleEngine | **same** `executeAttack` → BattleEngine |
| Result | `BattleResult` + GameState | **same** `BattleResult` + GameState |

`CommandResponse.payload.interactionKind` (on ATTACK) is derived
presentation metadata from `playerFactionId` vs attacker/defender ids.
It does not change battle math.

Kinds: `player_vs_ai` | `ai_vs_player` | `ai_vs_ai`.

---

## Future fitness architecture (not implemented)

See player-specific systems above. No workout timers, no resource grants
from exercise, no direct world mutation from a fitness module.

---

## Intentionally not built this phase

- DiplomacyEngine / full peace / trade
- EconomyEngine
- Fitness Engine implementation
- Continuous 24/7 world, persistence, Supabase, frontend, WebSockets
- New battle / map / event mechanics, cities
- Rewiring `cli.ts` onto the Orchestrator (CLI remains a parallel harness
  that already calls the same BattleEngine)

---

## Tests

See `tests/run.ts` — "Player/AI interaction architecture". Coverage includes
participant-parity ATTACK (all three pairings through `BattleEngine.resolve`),
shared `BattleResult`, event-engine agnosticism, AI non-mutation, unsupported
diplomacy, and command/commitment convergence.
