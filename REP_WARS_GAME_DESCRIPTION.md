# REP WARS — GAME DESCRIPTION & ARCHITECTURE REFERENCE
# Version: 1.1
# Canonical branch: REP-WARS-3
#
# PURPOSE
# Persistent product-level reference for AI coding agents working on Rep Wars.
# Read this before modifying or integrating Rep Wars systems.
#
# This document describes the intended product. Existing code may still contain
# prototype behavior that differs from this specification.

================================================================================
1. GAME OVERVIEW
================================================================================

Rep Wars is a mobile-first fitness strategy game where real-world workouts
enable military actions, conquest, and empire management.

Core loop:

    STRATEGIC DECISION
        ↓
    REQUIRED WORKOUT
        ↓
    ACTION COMPLETES
        ↓
    GAME CONSEQUENCE
        ↓
    NEXT DECISION

The game is a persistent, AI-driven world with territorial conquest, armies,
cities, resources, diplomacy, exploration, fog of war, and world events.

================================================================================
2. CORE RULES
================================================================================

## Physical effort

Physical effort is the primary game currency/limiter.

The preferred model is:

    STRATEGIC ACTION → REQUIRED WORKOUT → ACTION COMPLETES

Do NOT use a system where players build up a large bank of "army power" through
workouts and spend it later without exercising.

Think in terms of FULL WORKOUTS rather than individual repetitions as the main
player-facing resource interaction. Exercises may contribute to workout
difficulty/reward.

## Fitness

Permanent fitness history/progress is never lost because of in-game losses.

Virtual assets can be lost:

- armies
- territories
- cities
- resources
- military positions

Fitness systems must not encourage excessive or dangerous exercise.

Rest is legitimate and should not cause permanent fitness loss or unreasonable
pressure to exercise.

## Player responsiveness

Player actions should be immediate or use short presentation/animation.

Do not design core player actions around long real-world timers.

The scarce resource is the player's real-world effort, not waiting time.

================================================================================
3. PLAYER
================================================================================

The player creates a custom empire.

Empire creation/customization should have minimal onboarding friction. It may be
done immediately or postponed until the player has completed one or two
workouts.

If the player loses their entire empire, the intended model is an
EXILE/COMEBACK system rather than permanent game-over. Exact mechanics remain
open.

================================================================================
4. WORLD
================================================================================

The final game is a continuous 24/7 world, not a globally synchronized
turn-based game.

The world contains:

- player empire
- AI empires
- territories
- cities
- armies
- resources
- diplomacy
- world events
- fog of war
- exploration/scouting
- ongoing strategic actions

The world continues while the player is offline.

Online:
- events and interactions progress quickly
- player actions resolve quickly
- feedback should be immediate
- the experience should maximize engagement during active workout sessions

Offline:
- world activity progresses more slowly
- offline changes should be more forgiving than active-play changes
- offline catch-up should not make the player's empire unnecessarily
  vulnerable to instant destruction

Exact online/offline time scaling is not finalized.

The underlying implementation may use timestamps, durations, scheduled actions,
or simulation steps. These must not become long player-facing waits.

================================================================================
5. PLAYER ACTIONS VS AI ACTIONS
================================================================================

Player actions are workout-gated and highly responsive.

Example:

    PLAYER ORDERS RAID
        ↓
    REQUIRED WORKOUT
        ↓
    WORKOUT COMPLETED
        ↓
    RAID RESOLVES

AI actions can be asynchronous strategic commitments.

The intended AI lifecycle is:

    OBSERVE
       ↓
    DECIDE
       ↓
    COMMIT
       ↓
    EXECUTE
       ↓
    COMPLETE / INTERRUPT
       ↓
    REASSESS

AI should not make a fresh strategic decision every global tick.

AI commitments belong inside the AI Warlord Engine. The orchestrator coordinates
their consequences and shared state.

Players can generally respond to AI actions while they are underway.

================================================================================
6. MAP
================================================================================

The map should have a Risk-style layout.

Territories must:

- have irregular shapes
- vary substantially in size and shape
- have different strategic values
- have terrain/geographic characteristics
- form an adjacency graph
- extend beyond the visible screen
- support continual expansion

The current Map Engine already generates polygons, but the territories are too
similar in size and differ mainly in angles. This must eventually be improved.

The player should NOT see a uniform hex-grid appearance.

An internal grid/graph representation is acceptable if the rendered result is
an irregular Risk-style map.

## Map expansion

The world expands as the player conquers territory.

Generation combines:

1. Procedural/algorithmic generation
2. Curated world themes

Example themes:

- Iron Hills
- Christmas Tree Mountains
- Tuna Isles

Themes are intended to become state/data stored in Supabase.

## Fog of war

Visibility states should distinguish concepts such as:

- unknown
- discovered/visible
- scouted
- controlled

Scouts can reveal territory beyond normal visibility.

The map system should remain authoritative for map visibility/exploration.

================================================================================
7. TERRITORIES AND CITIES
================================================================================

Cities are core strategic infrastructure.

A territory includes more than an army. Cities provide protection.

When a territory is conquered:

    PREVIOUS OWNER'S CITY IS DESTROYED
        ↓
    NEW OWNER MUST BUILD A CITY

Cities have multiple security/strength levels and can be upgraded with
resources.

Offline defense:

    NO CITY + OFFLINE DEFENSE → HIGHLY VULNERABLE

    STRONG CITY + OFFLINE DEFENSE → SUBSTANTIALLY SAFER

An offline army alone should have a very difficult time holding a territory
without a city.

Exact city levels, costs, and defense formulas are not finalized.

================================================================================
8. ARMIES AND COMBAT
================================================================================

Armies are expendable virtual assets.

They can attack, defend, move, reinforce, and be destroyed.

There is NO normal retreat mechanic.

Battle rule:

    WINNER
       ↓
    LOSING ARMY IS FULLY ELIMINATED

The Battle Simulator is the authority for battle resolution.

The existing Battle Engine includes more detail than the simplest intended
model, including combat power, win probability, casualties, phases/events,
capture outcomes, and other resolution logic.

Keep the existing Battle Engine for now. Do not duplicate or independently
recreate its battle calculations in other systems.

The Battle Engine should be evaluated and simplified later if appropriate.

================================================================================
9. WORKOUT / FITNESS SYSTEM
================================================================================

A dedicated Player Fitness Level Detection / Workout system will evaluate
workout data and determine relative difficulty/effort.

Prefer:

    WORKOUT DATA
        ↓
    RELATIVE DIFFICULTY / EFFORT
        ↓
    GAME EFFECT

Do not assume universal values such as:

    1 repetition = 1 soldier

The same workout can have different difficulty for different players.

Exact formulas, workout types, and reward values are not finalized.

================================================================================
10. AI WARLORDS
================================================================================

AI-controlled empires are strategic factions, not simple scripted enemies.

The AI Warlord Engine includes concepts such as:

- personality
- goals
- memory
- relationships
- grievances
- military advantage
- territory value
- risk
- strategic positioning
- action scoring

Current personality archetypes include:

- Defensive
- Aggressive
- Expansionist
- Opportunistic
- Diplomatic
- Economic

## Ambition

AI warlords have longer-term ambitions that influence strategic priorities.

Ambition should prevent AI from behaving only reactively.

Examples:

- territorial dominance
- military dominance
- economic prosperity
- defensive security
- opportunistic expansion

Ambition belongs in the AI Warlord Engine.

Do not duplicate AI strategic reasoning in the orchestrator or frontend.

## Elimination

A faction with no territory and no meaningful military presence should become
eliminated/inactive and stop normal strategic behavior.

KNOWN PROTOTYPE BUG:

Celestial Theocracy currently starts with zero territories in a test world,
making it impossible to conquer.

The test/sample starting state must be corrected so every intended active AI
faction starts with a valid territory.

================================================================================
11. IMPERIAL EVENTS
================================================================================

Events include:

- famine
- drought
- rebellion
- political crises
- economic events
- natural events
- other world/imperial events

Events can affect:

- territories
- resources
- stability
- armies
- cities
- diplomacy
- relationships
- strategic conditions

Player-facing events should generally provide choices where appropriate.

Example:

    EVENT
      ↓
    PLAYER CHOICE
      ↓
    CONSEQUENCE

The current event engine is prototype/step-oriented and must eventually fit the
continuous-world model.

================================================================================
12. ECONOMY
================================================================================

The exact economy is not finalized.

Possible resource categories include:

- food
- gold
- materials
- population
- influence
- stability-related resources

These are examples, not locked requirements.

Resources are expected to support systems such as city construction, city
security upgrades, development, and imperial management.

Do not invent a final resource system without an explicit design decision.

================================================================================
13. DIPLOMACY
================================================================================

Diplomacy is between a major and supporting system.

It supports the conquest-focused core while providing tools for major world
events and crises.

Potential systems include:

- trade
- peace
- war
- treaties
- alliances
- military assistance
- crisis cooperation

The exact depth of diplomacy remains open.

Do not overbuild or permanently lock the diplomacy design without an explicit
decision.

================================================================================
14. AUTHORITATIVE GAME STATE
================================================================================

The final game requires ONE authoritative GameState containing the shared truth
for:

- player
- AI factions
- territories
- cities
- armies
- resources
- diplomacy
- events
- visibility
- world time
- AI commitments
- persistent game state

Engines should read relevant state, calculate decisions/results, and return
structured outputs.

The orchestration/state layer applies those outputs to the authoritative state.

Do not maintain conflicting copies of core world state across engines.

================================================================================
15. GAME INTERFACE & ORCHESTRATION
================================================================================

The Game Interface & Orchestration Engine bridges the eventual Replit
application and specialized engines.

Architecture:

    REPLIT APP
        ↓
    GAME INTERFACE / ORCHESTRATOR
        ↓
    ┌──────────┬──────────┬──────────┐
    AI       BATTLE     EVENTS      MAP
    ENGINE    ENGINE     ENGINE     ENGINE
        └──────────┴──────────┴──────────┘
                    ↓
           AUTHORITATIVE GAME STATE
                    ↓
                 SUPABASE

The orchestrator:

- receives commands
- validates commands
- routes commands
- calls engines
- coordinates engine results
- applies state changes
- emits events/notifications
- returns standardized responses
- provides presentation instructions
- supports observability/debugging

The orchestrator must NOT contain:

- AI strategic reasoning
- AI personality/scoring
- battle equations
- map generation algorithms
- fitness calculations
- event-generation logic

================================================================================
16. COMMAND SYSTEM
================================================================================

The application should communicate with the game through standardized commands.

Command categories include:

EMPIRE
- view empire
- rename empire
- view stats
- view resources
- view armies
- view territories
- view status

MAP
- view map
- select territory
- inspect territory
- explore
- scout
- reveal fog
- view neighbors

ARMY
- view army
- select army
- recruit
- train
- move
- split
- merge
- reinforce
- disband
- recall
- set defensive posture

COMBAT
- inspect enemy
- estimate battle
- prepare attack
- launch attack
- defend
- view battle
- view battle result

WORKOUT
- start workout
- select workout
- log workout/set progress
- complete workout
- cancel workout
- apply workout to required game action

TERRITORY
- conquer
- claim
- fortify
- develop
- upgrade
- inspect/manage

CITY
- build city
- inspect city
- upgrade city
- upgrade security
- manage city defenses

ECONOMY
- view resources
- resolve production
- purchase upgrade
- trade
- manage economy

DIPLOMACY
- view faction
- send request
- propose trade
- propose alliance
- accept/reject
- request assistance
- offer tribute
- declare war
- offer peace
- establish treaty
- break treaty

EVENTS
- view events
- inspect event
- respond
- choose option
- resolve
- ignore where permitted

EMPIRE MANAGEMENT
- set policies
- set priorities
- manage stability
- manage defenses
- manage relationships

CUSTOMIZATION
- customize empire
- customize banner
- customize avatar
- customize cosmetics

The exact command list will evolve.

================================================================================
17. COMPREHENSIVE COMMAND INDEX
================================================================================

The Game Interface & Orchestration Engine MUST maintain a comprehensive,
machine-readable and human-readable command index.

Each command must document:

- unique command ID
- category
- description
- required parameters
- optional parameters
- parameter types
- validation rules
- routed engine(s)
- state-changing vs read-only
- physical-effort/workout requirement
- immediate vs asynchronous behavior
- expected result
- possible errors
- example input
- example output

The command index is the primary integration reference for the future Replit
application.

Whenever a new game capability is added or an existing capability changes,
update the command index.

================================================================================
18. COMMAND / RESPONSE MODEL
================================================================================

Command concept:

    {
      commandId,
      playerId,
      timestamp,
      parameters,
      clientContext
    }

Response concept:

    {
      success,
      commandId,
      stateChanges,
      events,
      notifications,
      presentation,
      resourcesChanged,
      territoriesChanged,
      armiesChanged,
      newlyAvailableActions,
      errors
    }

Exact schemas may evolve.

Standard error concepts include:

- INVALID_COMMAND
- MISSING_PARAMETER
- INVALID_TARGET
- INSUFFICIENT_RESOURCES
- INSUFFICIENT_TROOPS
- INVALID_TERRITORY
- ACTION_NOT_ALLOWED
- ENGINE_UNAVAILABLE
- ENGINE_ERROR
- INVALID_GAME_STATE
- FEATURE_NOT_IMPLEMENTED

================================================================================
19. PRESENTATION
================================================================================

The game is mobile-first and should feel fast.

Engine/orchestrator responses may include presentation instructions such as:

- animation type
- duration
- affected entities
- battle presentation
- territory capture presentation
- event presentation

Presentation should communicate consequences without introducing unnecessary
waiting.

================================================================================
20. OBSERVABILITY
================================================================================

The system should expose enough information to debug engine integration.

AI:
- decision
- reasoning
- factor breakdown
- ambition
- goals
- personality
- commitment

Battle:
- attacker
- defender
- troop counts
- modifiers
- probability
- outcome
- casualties
- survivors

Events:
- trigger
- event type
- target
- effects
- player choice
- resulting changes

Commands:
- received
- validated
- routed
- engine called
- engine result
- state changes
- final response

================================================================================
21. PERSISTENCE
================================================================================

Supabase is intended to be the persistent database.

It may store:

- player data
- empire state
- world state
- map/theme data
- persistent game data
- other authoritative records

The final database schema is not yet finalized.

================================================================================
22. DEVELOPMENT PRINCIPLES
================================================================================

Rep Wars is being developed as specialized engines:

1. Player Fitness Level Detection / Workout Engine
2. Map Expansion / Generation Engine
3. AI Warlord Decision Engine
4. Battle Simulator
5. Imperial Event / World Simulation Engine
6. Game Interface & Orchestration Engine
7. Application/frontend layer

Prefer:

- clear interfaces
- typed inputs/outputs
- minimal coupling
- testability
- explainable behavior
- centralized configurable balance
- explicit state transitions
- reusable existing engines

Do not duplicate specialized engine logic.

Do not rebuild an existing engine unless explicitly instructed.

================================================================================
23. DEVELOPMENT / TESTING DISTINCTION
================================================================================

Development simulations may use:

- seeded RNG
- turns
- ticks
- sample maps
- CLI controls
- accelerated time

These are testing abstractions only.

The final game is continuous and persistent.

Prototype behavior must not automatically become product behavior.

================================================================================
24. KNOWN OPEN DESIGN AREAS
================================================================================

Do not silently finalize:

- fitness formulas
- workout types
- exercise/workout mappings
- workout reward values
- economy/resource list
- city levels/costs/formulas
- offline simulation formula
- diplomacy depth
- exile/comeback mechanics
- onboarding flow
- final battle complexity
- final event architecture
- database schema
- final map-generation algorithm
- final AI balance
- presentation/animation system

================================================================================
25. CURRENT DEVELOPMENT PRIORITY
================================================================================

Preferred high-level order:

PHASE 1 — FOUNDATION
- Game Interface & Orchestration Engine
- authoritative GameState
- command system
- engine registry
- comprehensive command index
- validation
- state transitions
- error handling
- observability

PHASE 2 — ENGINE INTEGRATION
- AI
- Battle
- Events
- Map

PHASE 3 — CONTINUOUS WORLD
- AI commitments
- world clock
- online/offline speed
- offline catch-up
- persistence

PHASE 4 — FITNESS LOOP
- workout engine
- relative difficulty
- workout-gated actions
- player fitness data

PHASE 5 — CORE GAME
- player empire
- territories
- cities
- armies
- conquest
- defense
- resources

PHASE 6 — DEPTH
- events
- diplomacy
- empire management
- ambition
- map expansion
- progression
- polish

PHASE 7 — APPLICATION
- mobile-first UI
- onboarding
- map interface
- workout interface
- strategic controls
- notifications
- offline report
- presentation/animation

================================================================================
26. AI AGENT RULES
================================================================================

Before modifying Rep Wars:

1. Read this file.
2. Inspect the relevant existing code.
3. Determine what is already implemented.
4. Reuse existing systems where possible.
5. Do not duplicate specialized engine logic.
6. Preserve authoritative shared state.
7. Preserve the continuous-world model.
8. Preserve workout-gated actions.
9. Preserve fast player responsiveness.
10. Update the Game Interface & Orchestration command index when adding or
    changing game capabilities.
11. If this document conflicts with prototype code, identify the discrepancy
    rather than silently assuming the prototype is correct.
12. Do not invent unfinished game rules without an explicit design decision.
