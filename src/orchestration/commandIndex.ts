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
 * matching handler in `handlers.ts` (SYNC_PLAYER_WORLD is wired in
 * `orchestrator.ts`). Commands marked `unsupported` return
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
    description: 'Read-only public snapshot of authoritative GameState (cloned, not mutable references). Includes ownership, troops, invasions, workout session, anchors, and derived worldCompletion. Polygons are on GET_WORLD_DEFINITION.',
    optional: [p('factionId', 'string', 'Viewer faction; current world is fully visible')],
    routesTo: ['state'],
    changesState: false,
    possibleErrors: [ErrorCode.INVALID_FACTION, ErrorCode.ACTION_NOT_ALLOWED],
    status: 'implemented',
  }),
  cmd({
    commandId: 'GET_VISIBLE_WORLD',
    category: 'READ',
    description: 'Current-world view for a faction. The entire current world is visible; there is no territory fog. Polygons are not included — use GET_WORLD_DEFINITION.',
    optional: [p('factionId', 'string', 'Viewer faction; defaults to playerFactionId')],
    routesTo: ['state'],
    changesState: false,
    possibleErrors: [ErrorCode.INVALID_FACTION, ErrorCode.ACTION_NOT_ALLOWED],
    status: 'implemented',
  }),
  cmd({
    commandId: 'GET_WORLD_DEFINITION',
    category: 'READ',
    description: 'Authored WorldDefinition for the current instance, including island/territory polygons, regions, adjacency, starting owners, and completion. Geometry is not stored on GameState.',
    routesTo: ['state'],
    changesState: false,
    possibleErrors: [ErrorCode.INVALID_GAME_STATE],
    status: 'implemented',
  }),
  cmd({
    commandId: 'GET_FITNESS_CATALOG',
    category: 'READ',
    description: 'Workout and exercise catalog, including the authoritative purpose → selectedWorkoutId map. Use GET_WORKOUT_SELECTION for the current gameplay/tutorial prescription. Active session state is on GET_GAME_STATE playerGameplay.activeWorkout.',
    routesTo: ['fitness'],
    changesState: false,
    status: 'implemented',
  }),

  cmd({
    commandId: 'GET_WORKOUT_SELECTION',
    category: 'READ',
    description: 'Authoritative workout selection for a WorkoutPurpose. When an authored catalog is installed and tutorial gating is off, the backend selects from authored workouts. Does not start a session.',
    required: [p('purpose', 'string', 'WorkoutPurpose')],
    optional: [
      p('intendedDifficulty', 'string', 'Override desired difficulty for the prescribed snapshot'),
      p('size', 'string', 'SHORT, STANDARD, or LONG when an authored catalog is installed'),
    ],
    validation: ['purpose must be a WorkoutPurpose', 'selected workout must exist in the catalog'],
    routesTo: ['fitness', 'state'],
    changesState: false,
    possibleErrors: [ErrorCode.INVALID_PARAMETER, ErrorCode.INVALID_GAME_STATE],
    status: 'implemented',
  }),

  cmd({
    commandId: 'ATTACK',
    category: 'COMBAT',
    description: 'Attack a foreign-owned territory via BattleEngine. Immediate if a legal staging army exists; otherwise starts a one-hop march to a legal staging tile and resolves after arrival.',
    required: [p('territoryId', 'string', 'Target territory to attack')],
    optional: [
      p('factionId', 'string', 'Attacking faction'),
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
    description:
      'Legacy alias: starts the same timed FORTIFICATION construction project as START_CONSTRUCTION (see construction definitions). Prefer START_CONSTRUCTION for new clients.',
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
    description: 'Initiate an exact timed allocation from a territory-local undeployed troop pool (AI world growth only).',
    required: [p('plan', 'object', 'Exact REINFORCE concrete plan')],
    optional: [p('factionId', 'string', 'Acting faction')],
    routesTo: ['state'],
    changesState: true,
    possibleErrors: [ErrorCode.INVALID_TERRITORY, ErrorCode.INSUFFICIENT_RESOURCES, ErrorCode.ACTION_NOT_ALLOWED],
    status: 'implemented',
  }),

  cmd({
    commandId: 'DECLARE_WAR',
    category: 'DIPLOMACY',
    description: 'Historical command only; WAR is default and Peace ends through its authoritative lifecycle.',
    required: [p('targetFactionId', 'string', 'Faction to declare war on')],
    optional: [p('factionId', 'string', 'Declaring faction')],
    routesTo: ['state'],
    changesState: false,
    possibleErrors: [ErrorCode.INVALID_FACTION, ErrorCode.INVALID_TARGET, ErrorCode.ACTION_NOT_ALLOWED],
    status: 'unsupported',
  }),
  cmd({
    commandId: 'NEGOTIATE',
    category: 'DIPLOMACY',
    description: 'Historical command only; exact Trade counteroffers use RESPOND_TRADE.',
    required: [p('targetFactionId', 'string', 'Faction to negotiate with')],
    optional: [p('factionId', 'string', 'Negotiating faction')],
    routesTo: ['state'],
    changesState: false,
    possibleErrors: [ErrorCode.INVALID_FACTION, ErrorCode.INVALID_TARGET],
    status: 'unsupported',
  }),
  cmd({
    commandId: 'OFFER_PEACE',
    category: 'DIPLOMACY',
    description: 'Initiate an exact timed Peace proposal; a pending offer is not a ceasefire.',
    required: [p('plan', 'object', 'Exact OFFER_PEACE plan')],
    optional: [p('factionId', 'string', 'Proposer faction')],
    routesTo: ['state'], changesState: true, status: 'implemented',
    possibleErrors: [ErrorCode.INVALID_PARAMETER, ErrorCode.ACTION_NOT_ALLOWED, ErrorCode.INVALID_TARGET],
  }),
  cmd({
    commandId: 'RESPOND_PEACE', category: 'DIPLOMACY',
    description: 'Required recipient response: ACCEPT_PEACE or DECLINE_PEACE.',
    required: [p('proposalId','string','Exact pending proposal'),p('response','string','ACCEPT_PEACE or DECLINE_PEACE')],
    optional: [p('factionId','string','Recipient faction')], routesTo:['state'],changesState:true,status:'implemented',
    possibleErrors:[ErrorCode.ACTION_NOT_ALLOWED,ErrorCode.INVALID_PARAMETER],
  }),
  cmd({
    commandId:'WITHDRAW_PEACE',category:'DIPLOMACY',description:'Player withdraws their own pending Peace offer.',
    required:[p('proposalId','string','Exact player-originated proposal')],optional:[p('factionId','string','Player proposer')],
    routesTo:['state'],changesState:true,status:'implemented',possibleErrors:[ErrorCode.ACTION_NOT_ALLOWED],
  }),
  cmd({commandId:'TRADE',category:'DIPLOMACY',description:'Initiate exact timed Trade, legal during WAR; reserve offered bank sources.',required:[p('plan','object','Exact Trade plan')],optional:[p('factionId','string','Proposer')],routesTo:['state'],changesState:true,status:'implemented',possibleErrors:[ErrorCode.ACTION_NOT_ALLOWED,ErrorCode.INVALID_PARAMETER]}),
  cmd({commandId:'RESPOND_TRADE',category:'DIPLOMACY',description:'Required ACCEPT_TRADE/DECLINE_TRADE response.',required:[p('proposalId','string','Exact proposal'),p('response','string','Response')],optional:[p('factionId','string','Recipient')],routesTo:['state'],changesState:true,status:'implemented',possibleErrors:[ErrorCode.ACTION_NOT_ALLOWED]}),
  cmd({commandId:'WITHDRAW_TRADE',category:'DIPLOMACY',description:'Player withdraws own pending Trade.',required:[p('proposalId','string','Proposal')],optional:[p('factionId','string','Player')],routesTo:['state'],changesState:true,status:'implemented',possibleErrors:[ErrorCode.ACTION_NOT_ALLOWED]}),
  cmd({commandId:'COUNTEROFFER_TRADE',category:'DIPLOMACY',description:'Atomic exact response replacement, never proactive NEGOTIATE.',required:[p('proposalId','string','Old proposal'),p('plan','object','Exact reverse Trade plan')],optional:[p('factionId','string','Countering recipient')],routesTo:['state'],changesState:true,status:'implemented',possibleErrors:[ErrorCode.ACTION_NOT_ALLOWED]}),

  cmd({
    commandId: 'SYNC_PLAYER_WORLD',
    category: 'WORLD',
    description:
      'Catch the local player world up to an authorized targetWorldTick using chunked ADVANCE_WORLD semantics. The authoritative clock, not the client, decides the legal now.',
    optional: [
      p('targetWorldTick', 'number', 'Requested tick; rejected if beyond the registered time authority'),
    ],
    routesTo: ['imperialEvents', 'aiWarlord', 'state'],
    changesState: true,
    possibleErrors: [
      ErrorCode.ENGINE_UNAVAILABLE,
      ErrorCode.ENGINE_ERROR,
      ErrorCode.INVALID_PARAMETER,
      ErrorCode.INVALID_GAME_STATE,
      ErrorCode.TIME_UNAUTHORIZED,
    ],
    status: 'implemented',
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
    commandId: 'TRANSITION_TO_NEXT_WORLD',
    category: 'WORLD',
    description:
      'After the current authored world is complete, replace world state with a fresh GameState from the next registered production world. Player identity and player-scoped fitness history are preserved. The client cannot choose a target world.',
    routesTo: ['state'],
    changesState: true,
    possibleErrors: [
      ErrorCode.ACTION_NOT_ALLOWED,
      ErrorCode.INVALID_GAME_STATE,
      ErrorCode.ENGINE_ERROR,
    ],
    status: 'implemented',
  }),
  cmd({
    commandId: 'START_AI_OPERATION',
    category: 'AI',
    description: 'Atomically start an exact AI plan with physical claims. Does not run cognition.',
    required: [p('plan', 'object', 'Exact immutable concrete plan')],
    routesTo: ['aiWarlord', 'battle', 'state'], changesState: true,
    possibleErrors: [ErrorCode.ACTION_NOT_ALLOWED, ErrorCode.INVALID_TARGET], status: 'implemented',
  }),
  cmd({
    commandId: 'RESOLVE_COMMITMENT',
    category: 'AI',
    description: 'Start/poll an exact selected AI operation through shared physical domain systems.',
    optional: [p('factionId', 'string', 'Owning faction'), p('operationId', 'string', 'Exact operation; required when several are active')],
    routesTo: ['aiWarlord', 'battle', 'state'],
    changesState: true,
    possibleErrors: [ErrorCode.INVALID_FACTION, ErrorCode.ACTION_NOT_ALLOWED, ErrorCode.FEATURE_NOT_IMPLEMENTED],
    status: 'implemented',
  }),
  cmd({
    commandId: 'AI_DECIDE',
    category: 'AI',
    description: 'Run DecisionEngine.decide/decideAll for AI factions; registers exact selected operations without starting physical domain work.',
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
    optional: [p('factionId', 'string', 'Building faction'), p('constructionId', 'string', 'Optional project id'), p('projectType', 'string', 'CITY, FORTIFICATION, FARM, MINE, or LUMBER (default FORTIFICATION)')],
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
    description: 'Start an authoritative workout session. NORMAL_TROOPS requires an eligible authored workout, an authored world reward policy and a server-issued sequenced gameplay session; the server locks its completion entitlement. Specialized purposes retain their context-specific behavior. DEFENSE must start before the response deadline.',
    required: [p('purpose', 'string', 'WorkoutPurpose')],
    optional: [
      p('workoutId', 'string', 'Catalog workout id; omit to let the backend select. Level 1 tutorial requires the selected id when provided.'),
      p('intendedDifficulty', 'string', 'Override difficulty'),
      p('size', 'string', 'SHORT, STANDARD, or LONG for authored selection when workoutId is omitted'),
      p('sessionId', 'string', 'Legacy specialized-workout id only; ignored for NORMAL_TROOPS'),
      p('invasionId', 'string', 'Required for DEFENSE'),
      p('constructionId', 'string', 'Live construction target'),
      p('collectionTerritoryId', 'string', 'Live Golden Yield territory'),
      p('now', 'number', 'Session clock timestamp (not worldTick)'),
    ],
    validation: [
      'purpose must be a WorkoutPurpose',
      'omitted workoutId uses the authoritative selection',
      'provided workoutId must exist in the catalog',
      'Level 1 tutorial requires the selected workoutId',
    ],
    routesTo: ['state'],
    changesState: true,
    requiresPhysicalEffort: true,
    possibleErrors: [ErrorCode.INVALID_PARAMETER, ErrorCode.INVALID_TARGET, ErrorCode.ACTION_NOT_ALLOWED, ErrorCode.WORKOUT_SESSION_INVALID],
    status: 'implemented',
  }),
  cmd({
    commandId: 'PAUSE_WORKOUT',
    category: 'FITNESS',
    description: 'Pause the active workout session. Time spent paused is excluded from workout duration. Rejects paused, completed, and abandoned sessions.',
    optional: [p('now', 'number', 'Session clock')],
    routesTo: ['state'],
    changesState: true,
    possibleErrors: [ErrorCode.WORKOUT_SESSION_INVALID],
    status: 'implemented',
  }),
  cmd({
    commandId: 'RESUME_WORKOUT',
    category: 'FITNESS',
    description: 'Resume a paused workout session. Rejects active, completed, and abandoned sessions.',
    optional: [p('now', 'number', 'Session clock')],
    routesTo: ['state'],
    changesState: true,
    possibleErrors: [ErrorCode.WORKOUT_SESSION_INVALID],
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
    description: 'Submit fitness feedback. Locked completion soldiers do not require feedback.',
    required: [p('value', 'string', 'WorkoutFeedbackValue')],
    optional: [p('now', 'number', 'Session clock'), p('sessionId', 'string', 'Explicit active or paid historical locked workout')],
    routesTo: ['state'],
    changesState: true,
    possibleErrors: [ErrorCode.WORKOUT_SESSION_INVALID, ErrorCode.INVALID_PARAMETER],
    status: 'implemented',
  }),
  cmd({
    commandId: 'FINALIZE_WORKOUT',
    category: 'FITNESS',
    description: 'Settle a fully completed locked workout or run the legacy reward pipeline. Not a client-fabricated reward grant.',
    optional: [p('now', 'number', 'Session clock'), p('sessionId', 'string', 'Explicit active or paid historical locked workout')],
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
