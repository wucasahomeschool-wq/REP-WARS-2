import { CommandCategory, CommandDefinition, ParameterSpec } from './protocol';
import { ErrorCode } from './errors';

const COMMON_ERRORS: ErrorCode[] = [
  ErrorCode.INVALID_COMMAND,
  ErrorCode.MISSING_PARAMETER,
  ErrorCode.INVALID_PARAMETER,
  ErrorCode.INVALID_GAME_STATE,
];

function p(name: string, type: ParameterSpec['type'], description: string): ParameterSpec {
  return { name, type, description };
}

interface CmdOpts {
  commandId: string;
  category: CommandCategory;
  description: string;
  required?: ParameterSpec[];
  optional?: ParameterSpec[];
  validation?: string[];
  routesTo: string[];
  changesState: boolean;
  requiresPhysicalEffort?: boolean;
  synchronous?: boolean;
  status: 'implemented' | 'unsupported';
  possibleErrors?: ErrorCode[];
}

function cmd(o: CmdOpts): CommandDefinition {
  return {
    commandId: o.commandId,
    category: o.category,
    description: o.description,
    requiredParameters: o.required ?? [],
    optionalParameters: o.optional ?? [],
    validationRules: o.validation ?? ['commandId must match catalog entry'],
    routesTo: o.routesTo,
    changesState: o.changesState,
    requiresPhysicalEffort: o.requiresPhysicalEffort ?? false,
    synchronous: o.synchronous ?? true,
    status: o.status,
    possibleErrors: [...COMMON_ERRORS, ...(o.possibleErrors ?? [])],
  };
}

/**
 * Phase 10 focused command catalog. Extensible — add entries here and a
 * matching handler in `router.ts`. Commands marked `unsupported` return
 * FEATURE_NOT_IMPLEMENTED without mutating state.
 */
export const COMMAND_INDEX: CommandDefinition[] = [
  cmd({
    commandId: 'GET_COMMAND_INDEX',
    category: 'SYSTEM',
    description: 'Return this machine-readable command catalog.',
    routesTo: ['orchestrator'],
    changesState: false,
    status: 'implemented',
  }),
  cmd({
    commandId: 'GET_GAME_STATE',
    category: 'READ',
    description: 'Read-only public snapshot of authoritative GameState (cloned, not mutable references).',
    optional: [p('factionId', 'string', 'Viewer faction for fog/knowledge filtering')],
    routesTo: ['state'],
    changesState: false,
    possibleErrors: [ErrorCode.INVALID_FACTION, ErrorCode.ACTION_NOT_ALLOWED],
    status: 'implemented',
  }),
  cmd({
    commandId: 'GET_VISIBLE_WORLD',
    category: 'READ',
    description: 'Fog-of-war filtered world view for a faction. Does not mutate state.',
    optional: [p('factionId', 'string', 'Viewer faction; defaults to playerFactionId')],
    routesTo: ['state'],
    changesState: false,
    possibleErrors: [ErrorCode.INVALID_FACTION, ErrorCode.ACTION_NOT_ALLOWED],
    status: 'implemented',
  }),

  cmd({
    commandId: 'ATTACK',
    category: 'COMBAT',
    description: 'Attack a foreign-owned territory via BattleEngine. Immediate if a legal staging army exists; otherwise starts a one-hop march to a legal staging tile and resolves after arrival.',
    required: [p('territoryId', 'string', 'Target territory to attack')],
    optional: [
      p('factionId', 'string', 'Attacking faction'),
      p('seed', 'number', 'Optional battle seed override'),
      p('commitAmount', 'number', 'Banked Troops to commit. Remaining banked Troops stay unused.'),
    ],
    validation: ['Target must be foreign-owned', 'Attacker needs an eligible force on a legal owned staging tile, or one adjacent hop to one'],
    routesTo: ['battle', 'state'],
    changesState: true,
    possibleErrors: [
      ErrorCode.INVALID_TERRITORY,
      ErrorCode.INVALID_FACTION,
      ErrorCode.INVALID_TARGET,
      ErrorCode.INSUFFICIENT_TROOPS,
      ErrorCode.ACTION_NOT_ALLOWED,
      ErrorCode.ENGINE_UNAVAILABLE,
      ErrorCode.ENGINE_ERROR,
    ],
    status: 'implemented',
  }),
  cmd({
    commandId: 'MOVE',
    category: 'ARMY',
    description: 'Begin moving an army to an adjacent territory. Immediate command; arrival happens over world ticks.',
    required: [p('armyId', 'string', 'Army to move'), p('destinationTerritoryId', 'string', 'Adjacent destination')],
    optional: [p('factionId', 'string', 'Owning faction')],
    routesTo: ['state'],
    changesState: true,
    possibleErrors: [ErrorCode.INVALID_ARMY, ErrorCode.INVALID_TERRITORY, ErrorCode.NOT_ADJACENT, ErrorCode.ACTION_NOT_ALLOWED],
    status: 'implemented',
  }),
  cmd({
    commandId: 'BUILD',
    category: 'TERRITORY',
    description: 'Raise fortification on an owned territory using BALANCE.territory.fortificationCostPerLevel.',
    required: [p('territoryId', 'string', 'Owned territory')],
    optional: [p('factionId', 'string', 'Building faction')],
    routesTo: ['state'],
    changesState: true,
    possibleErrors: [ErrorCode.INVALID_TERRITORY, ErrorCode.INSUFFICIENT_RESOURCES, ErrorCode.ACTION_NOT_ALLOWED],
    status: 'implemented',
  }),
  cmd({
    commandId: 'REINFORCE',
    category: 'ECONOMY',
    description: 'Spend gold/food to add garrison using BALANCE.economy.reinforcementCost.',
    required: [p('territoryId', 'string', 'Owned territory to reinforce')],
    optional: [p('factionId', 'string', 'Acting faction')],
    routesTo: ['state'],
    changesState: true,
    possibleErrors: [ErrorCode.INVALID_TERRITORY, ErrorCode.INSUFFICIENT_RESOURCES, ErrorCode.ACTION_NOT_ALLOWED],
    status: 'implemented',
  }),
  cmd({
    commandId: 'SCOUT',
    category: 'ARMY',
    description: 'Reveal territory knowledge. Uses MapEngine fog when mapWorld exists; otherwise updates faction knownTerritories.',
    required: [p('territoryId', 'string', 'Territory to scout/learn about')],
    optional: [p('factionId', 'string', 'Scouting faction'), p('fromTerritoryId', 'string', 'Origin for map fog reveal'), p('range', 'number', 'Reveal range when using MapEngine')],
    routesTo: ['map', 'state'],
    changesState: true,
    possibleErrors: [ErrorCode.INVALID_TERRITORY, ErrorCode.ACTION_NOT_ALLOWED, ErrorCode.FOG_OF_WAR],
    status: 'implemented',
  }),
  cmd({
    commandId: 'EXPAND',
    category: 'TERRITORY',
    description: 'Claim an unowned territory using ScoringHelpers.computeLocalUsableMilitaryPower (same rules for player and AI).',
    required: [p('territoryId', 'string', 'Unowned target territory')],
    optional: [p('factionId', 'string', 'Expanding faction')],
    validation: ['Target must be unowned', 'Local usable military power must exceed garrison threshold', 'Must afford expansionClaim.goldCost'],
    routesTo: ['state'],
    changesState: true,
    possibleErrors: [
      ErrorCode.INVALID_TERRITORY,
      ErrorCode.INVALID_TARGET,
      ErrorCode.INSUFFICIENT_TROOPS,
      ErrorCode.INSUFFICIENT_RESOURCES,
      ErrorCode.ACTION_NOT_ALLOWED,
    ],
    status: 'implemented',
  }),

  cmd({
    commandId: 'DECLARE_WAR',
    category: 'DIPLOMACY',
    description: 'Set bilateral relationship to at_war immediately (supported by current model).',
    required: [p('targetFactionId', 'string', 'Faction to declare war on')],
    optional: [p('factionId', 'string', 'Declaring faction')],
    routesTo: ['state'],
    changesState: true,
    possibleErrors: [ErrorCode.INVALID_FACTION, ErrorCode.INVALID_TARGET, ErrorCode.ACTION_NOT_ALLOWED],
    status: 'implemented',
  }),
  cmd({
    commandId: 'NEGOTIATE',
    category: 'DIPLOMACY',
    description: 'Small mutual opinion improvement (supported by current harness model).',
    required: [p('targetFactionId', 'string', 'Faction to negotiate with')],
    optional: [p('factionId', 'string', 'Negotiating faction')],
    routesTo: ['state'],
    changesState: true,
    possibleErrors: [ErrorCode.INVALID_FACTION, ErrorCode.INVALID_TARGET],
    status: 'implemented',
  }),
  cmd({
    commandId: 'OFFER_PEACE',
    category: 'DIPLOMACY',
    description: 'Not supported: current model records peace offers in memory but does not transition war state.',
    required: [p('targetFactionId', 'string', 'Target faction')],
    routesTo: ['state'],
    changesState: false,
    status: 'unsupported',
    possibleErrors: [ErrorCode.FEATURE_NOT_IMPLEMENTED],
  }),
  cmd({
    commandId: 'TRADE',
    category: 'DIPLOMACY',
    description: 'Not supported: current model adjusts opinion/memory but does not exchange resources.',
    required: [p('targetFactionId', 'string', 'Trade partner')],
    routesTo: ['state'],
    changesState: false,
    status: 'unsupported',
    possibleErrors: [ErrorCode.FEATURE_NOT_IMPLEMENTED],
  }),

  cmd({
    commandId: 'ADVANCE_WORLD',
    category: 'WORLD',
    description:
      'Advance canonical worldTick by elapsedTicks (default 1), run ContinuousWorldEngine (AI commitments + EventEngine adapter), commit atomically.',
    optional: [
      p('factionId', 'string', 'Player faction context (unused by simulation; player commands stay immediate)'),
      p('elapsedTicks', 'number', 'Simulation ticks to advance (integer >= 0). Default 1. Alias: ticks'),
      p('ticks', 'number', 'Alias for elapsedTicks'),
    ],
    routesTo: ['imperialEvents', 'aiWarlord', 'state'],
    changesState: true,
    possibleErrors: [
      ErrorCode.ENGINE_UNAVAILABLE,
      ErrorCode.ENGINE_ERROR,
      ErrorCode.INVALID_PARAMETER,
      ErrorCode.INVALID_GAME_STATE,
    ],
    status: 'implemented',
  }),
  cmd({
    commandId: 'RESOLVE_COMMITMENT',
    category: 'AI',
    description: 'Execute a faction active AI commitment once through shared domain operations.',
    optional: [p('factionId', 'string', 'Faction whose commitment to resolve')],
    routesTo: ['aiWarlord', 'battle', 'state'],
    changesState: true,
    possibleErrors: [ErrorCode.INVALID_FACTION, ErrorCode.ACTION_NOT_ALLOWED, ErrorCode.FEATURE_NOT_IMPLEMENTED],
    status: 'implemented',
  }),
  cmd({
    commandId: 'AI_DECIDE',
    category: 'AI',
    description: 'Run DecisionEngine.decide/decideAll for AI factions; updates commitments only, does not mutate world.',
    optional: [p('warlordId', 'string', 'Single warlord; defaults to all non-player factions')],
    routesTo: ['aiWarlord', 'state'],
    changesState: true,
    possibleErrors: [ErrorCode.ENGINE_UNAVAILABLE],
    status: 'implemented',
  }),
  cmd({
    commandId: 'START_CONSTRUCTION',
    category: 'TERRITORY',
    description: 'Start a timed construction project by spending normal resources. Does not require a workout.',
    required: [p('territoryId', 'string', 'Owned territory')],
    optional: [p('factionId', 'string', 'Building faction'), p('constructionId', 'string', 'Optional project id')],
    routesTo: ['state'],
    changesState: true,
    possibleErrors: [ErrorCode.INVALID_TERRITORY, ErrorCode.INSUFFICIENT_RESOURCES, ErrorCode.ACTION_NOT_ALLOWED],
    status: 'implemented',
  }),
  cmd({
    commandId: 'APPLY_CONSTRUCTION_ACCELERATION',
    category: 'TERRITORY',
    description: 'Consume one pending Extra Construction Workers effect on an in-progress project.',
    required: [p('constructionId', 'string', 'Construction project id')],
    optional: [p('factionId', 'string', 'Owner faction')],
    routesTo: ['state'],
    changesState: true,
    possibleErrors: [ErrorCode.INVALID_TARGET, ErrorCode.ACTION_NOT_ALLOWED],
    status: 'implemented',
  }),
  cmd({
    commandId: 'COLLECT_RESOURCES',
    category: 'ECONOMY',
    description: 'Collect uncollected territory yield. Optional useGoldenYield consumes one pending Golden Yield effect on this collection only.',
    required: [p('territoryId', 'string', 'Owned territory')],
    optional: [
      p('factionId', 'string', 'Collecting faction'),
      p('useGoldenYield', 'boolean', 'Consume one pending Golden Yield multiplier'),
    ],
    routesTo: ['state'],
    changesState: true,
    possibleErrors: [ErrorCode.INVALID_TERRITORY, ErrorCode.INVALID_TARGET, ErrorCode.ACTION_NOT_ALLOWED],
    status: 'implemented',
  }),
  cmd({
    commandId: 'SET_PLAYER_PAUSE',
    category: 'TERRITORY',
    description: 'Pause or unpause the local player empire. Other factions continue simulating.',
    required: [p('paused', 'boolean', 'true to pause, false to resume')],
    routesTo: ['state'],
    changesState: true,
    possibleErrors: [ErrorCode.MISSING_PARAMETER, ErrorCode.ACTION_NOT_ALLOWED],
    status: 'implemented',
  }),
  cmd({
    commandId: 'START_WORKOUT',
    category: 'FITNESS',
    description: 'Start an authoritative workout session. DEFENSE requires a matching active invasion and must start before the response deadline.',
    required: [p('purpose', 'string', 'WorkoutPurpose'), p('workoutId', 'string', 'Catalog workout id')],
    optional: [
      p('intendedDifficulty', 'string', 'Override difficulty'),
      p('sessionId', 'string', 'Optional session id'),
      p('invasionId', 'string', 'Required for DEFENSE'),
      p('constructionId', 'string', 'Live construction target'),
      p('collectionTerritoryId', 'string', 'Live Golden Yield territory'),
      p('now', 'number', 'Session clock timestamp (not worldTick)'),
    ],
    routesTo: ['state'],
    changesState: true,
    requiresPhysicalEffort: true,
    possibleErrors: [ErrorCode.INVALID_PARAMETER, ErrorCode.INVALID_TARGET, ErrorCode.ACTION_NOT_ALLOWED, ErrorCode.WORKOUT_SESSION_INVALID],
    status: 'implemented',
  }),
  cmd({
    commandId: 'RECORD_EXERCISE',
    category: 'FITNESS',
    description: 'Record the current exercise of the active workout session.',
    required: [p('order', 'number', 'Exercise order')],
    optional: [p('repetitions', 'number', 'Completed reps'), p('durationSeconds', 'number', 'Completed duration'), p('now', 'number', 'Session clock')],
    routesTo: ['state'],
    changesState: true,
    requiresPhysicalEffort: true,
    possibleErrors: [ErrorCode.WORKOUT_SESSION_INVALID, ErrorCode.MISSING_PARAMETER],
    status: 'implemented',
  }),
  cmd({
    commandId: 'SKIP_REST',
    category: 'FITNESS',
    description: 'Skip the current REST exercise.',
    required: [p('order', 'number', 'REST exercise order')],
    optional: [p('now', 'number', 'Session clock')],
    routesTo: ['state'],
    changesState: true,
    possibleErrors: [ErrorCode.WORKOUT_SESSION_INVALID],
    status: 'implemented',
  }),
  cmd({
    commandId: 'SUBMIT_WORKOUT_FEEDBACK',
    category: 'FITNESS',
    description: 'Submit required post-workout feedback.',
    required: [p('value', 'string', 'WorkoutFeedbackValue')],
    optional: [p('now', 'number', 'Session clock')],
    routesTo: ['state'],
    changesState: true,
    possibleErrors: [ErrorCode.WORKOUT_SESSION_INVALID, ErrorCode.INVALID_PARAMETER],
    status: 'implemented',
  }),
  cmd({
    commandId: 'FINALIZE_WORKOUT',
    category: 'FITNESS',
    description: 'Run the internal fitness → PhysicalResult → GameRewardResult → applyGameReward pipeline. Not a client-fabricated reward grant.',
    optional: [p('now', 'number', 'Session clock')],
    routesTo: ['state', 'battle'],
    changesState: true,
    possibleErrors: [ErrorCode.WORKOUT_SESSION_INVALID, ErrorCode.ACTION_NOT_ALLOWED],
    status: 'implemented',
  }),
  cmd({
    commandId: 'ABANDON_WORKOUT',
    category: 'FITNESS',
    description: 'Abandon the active workout session. A DEFENSE session resolves the linked invasion as a failed defense.',
    optional: [p('now', 'number', 'Session clock')],
    routesTo: ['state', 'battle'],
    changesState: true,
    possibleErrors: [ErrorCode.WORKOUT_SESSION_INVALID, ErrorCode.ACTION_NOT_ALLOWED, ErrorCode.INVALID_TARGET],
    status: 'implemented',
  }),
  cmd({
    commandId: 'RECORD_INTEGRITY_FLAG',
    category: 'FITNESS',
    description: 'Record an integrity flag on the active workout. A second flag abandons the session and resolves a linked defense invasion.',
    optional: [p('type', 'string', 'IntegrityFlagType'), p('now', 'number', 'Session clock')],
    routesTo: ['state', 'battle'],
    changesState: true,
    possibleErrors: [ErrorCode.WORKOUT_SESSION_INVALID, ErrorCode.INVALID_PARAMETER, ErrorCode.ACTION_NOT_ALLOWED, ErrorCode.INVALID_TARGET],
    status: 'implemented',
  }),
];

const INDEX_BY_ID = new Map(COMMAND_INDEX.map((c) => [c.commandId, c]));

export function getCommandDefinition(commandId: string): CommandDefinition | undefined {
  return INDEX_BY_ID.get(commandId);
}

export function commandIndexSummary(): {
  count: number;
  implemented: number;
  unsupported: number;
  byCategory: Record<string, number>;
} {
  const byCategory: Record<string, number> = {};
  let implemented = 0;
  let unsupported = 0;
  for (const c of COMMAND_INDEX) {
    byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;
    if (c.status === 'implemented') implemented++;
    else unsupported++;
  }
  return { count: COMMAND_INDEX.length, implemented, unsupported, byCategory };
}
