import { BattleEngine } from '../battle/BattleEngine';
import { DecisionEngine } from '../engine/DecisionEngine';
import { WorldSimulator } from '../events/WorldSimulator';
import { MapEngine } from '../map/MapEngine';
import { OrchestrationError, ErrorCode } from './errors';

export type EngineId =
  | 'orchestrator'
  | 'aiWarlord'
  | 'battle'
  | 'imperialEvents'
  | 'map'
  | 'fitness'
  | 'state';

/**
 * Future player-only workout → game-delta conversion. Must NOT mutate
 * GameState; the Orchestrator would apply any returned result. Stub only.
 */
export interface FitnessEnginePort {
  convertWorkout?(input: {
    sessionId: string;
    exerciseId: string;
    sets: { reps: number }[];
  }): { resourceDeltas?: Record<string, number>; troopDeltas?: Record<string, number>; notes: string[] };
}

export interface RegisteredEngineInfo {
  id: EngineId;
  name: string;
  status: 'ready' | 'unavailable' | 'stub';
  description: string;
}

/**
 * Pluggable engines. Adding a new engine = register here + add command routes.
 * Do not put simulation math in this file.
 */
export class EngineRegistry {
  battle: BattleEngine | null = null;
  ai: DecisionEngine | null = null;
  events: WorldSimulator | null = null;
  map: MapEngine | null = null;
  fitness: FitnessEnginePort | null = null;

  registerBattle(engine: BattleEngine): void {
    this.battle = engine;
  }
  registerAi(engine: DecisionEngine): void {
    this.ai = engine;
  }
  registerEvents(engine: WorldSimulator): void {
    this.events = engine;
  }
  registerMap(engine: MapEngine): void {
    this.map = engine;
  }
  registerFitness(engine: FitnessEnginePort): void {
    this.fitness = engine;
  }

  requireBattle(): BattleEngine {
    if (!this.battle) {
      throw new OrchestrationError(ErrorCode.ENGINE_UNAVAILABLE, 'Battle simulator is not registered', {
        engine: 'battle',
      });
    }
    return this.battle;
  }

  requireAi(): DecisionEngine {
    if (!this.ai) {
      throw new OrchestrationError(ErrorCode.ENGINE_UNAVAILABLE, 'AI Warlord engine is not registered', {
        engine: 'aiWarlord',
      });
    }
    return this.ai;
  }

  requireEvents(): WorldSimulator {
    if (!this.events) {
      throw new OrchestrationError(ErrorCode.ENGINE_UNAVAILABLE, 'Imperial event engine is not registered', {
        engine: 'imperialEvents',
      });
    }
    return this.events;
  }

  requireMap(): MapEngine {
    if (!this.map) {
      throw new OrchestrationError(ErrorCode.ENGINE_UNAVAILABLE, 'Map engine is not registered', {
        engine: 'map',
      });
    }
    return this.map;
  }

  list(): RegisteredEngineInfo[] {
    return [
      {
        id: 'orchestrator',
        name: 'Game Interface & Orchestration',
        status: 'ready',
        description: 'Command validation, routing, transaction, engine dispatch, state apply',
      },
      {
        id: 'state',
        name: 'Authoritative Game State',
        status: 'ready',
        description: 'Single world state owned by the orchestrator',
      },
      {
        id: 'aiWarlord',
        name: 'AI Warlord Decision Engine',
        status: this.ai ? 'ready' : 'unavailable',
        description: 'Strategic decisions for AI empires',
      },
      {
        id: 'battle',
        name: 'Battle Simulator',
        status: this.battle ? 'ready' : 'unavailable',
        description: 'Battle resolution authority',
      },
      {
        id: 'imperialEvents',
        name: 'Imperial Event & World Simulation Engine',
        status: this.events ? 'ready' : 'unavailable',
        description: 'World/empire events',
      },
      {
        id: 'map',
        name: 'Map Expansion / Generation Engine',
        status: this.map ? 'ready' : 'unavailable',
        description: 'Procedural map and fog of war',
      },
      {
        id: 'fitness',
        name: 'Player Fitness Level Detection Engine',
        status: this.fitness ? 'ready' : 'stub',
        description: 'Relative workout difficulty (not implemented in this repo)',
      },
    ];
  }
}

export function createDefaultRegistry(): EngineRegistry {
  const reg = new EngineRegistry();
  reg.registerBattle(new BattleEngine());
  reg.registerAi(new DecisionEngine());
  reg.registerEvents(new WorldSimulator());
  reg.registerMap(new MapEngine());
  return reg;
}
