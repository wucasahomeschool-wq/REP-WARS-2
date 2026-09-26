import { Orchestrator } from '../orchestration';
import { GameState } from '../types/GameState';
import { CommandRequest } from '../orchestration/protocol';

/**
 * Developer-only starting conditions so the unchanged DecisionEngine
 * selects ATTACK and RESOLVE_COMMITMENT opens an invasion.
 * Stock Level 1 prefers BUILD. This does not plant a commitment or call
 * the tutorial invasion.
 *
 * Attack eligibility requires more than 100 soldiers. A completed defense
 * workout adds defense power at 1× physical output, so the player field
 * army is what makes a real workout win or lose.
 */
export type AiInvasionFixtureMode = 'success' | 'failure';

const SUCCESS_PLAYER_SOLDIERS = 140;
const SUCCESS_ATTACKER_SOLDIERS = 160;
const FAILURE_PLAYER_SOLDIERS = 1;
const FAILURE_ATTACKER_SOLDIERS = 2000;

export function aiInvasionFixtureMode(
  env: string | undefined = process.env.REP_WARS_AI_INVASION_SETUP,
): AiInvasionFixtureMode | null {
  if (env === 'success' || env === 'failure') return env;
  return null;
}

export function arrangeLevel1SoAiAttacks(state: GameState, mode: AiInvasionFixtureMode): void {
  if (state.level1Tutorial) {
    state.level1Tutorial.completed = true;
    state.level1Tutorial.active = false;
    state.level1Tutorial.beat = 'COMPLETE';
  }
  state.playerFitness.lastWorkoutCompletedAtTick = null;
  // The fight is close: defense power is 44 against an army that must exceed 100.
  // Seed 1 resolves as a defender win. Seed 0 resolves as an attacker win.
  state.worldSeed = mode === 'success' ? 1 : 0;
  const playerId = state.playerFactionId;
  for (const territory of state.territories.values()) {
    if (territory.owner === 'f_ai_01') {
      territory.fortification = 5;
      territory.garrison = 400;
    }
    if (playerId && territory.owner === playerId) territory.garrison = 0;
  }
  const ai = state.factions.get('f_ai_01');
  const player = playerId ? state.factions.get(playerId) : undefined;
  if (ai && playerId) {
    ai.resources.gold = 0;
    ai.resources.food = 0;
    ai.resources.stone = 0;
    const towardPlayer = ai.diplomacy.get(playerId);
    if (towardPlayer) towardPlayer.state = 'at_war';
  }
  if (player) {
    const towardAi = player.diplomacy.get('f_ai_01');
    if (towardAi) towardAi.state = 'at_war';
  }
  const playerSoldiers = mode === 'success' ? SUCCESS_PLAYER_SOLDIERS : FAILURE_PLAYER_SOLDIERS;
  const attackerSoldiers = mode === 'success' ? SUCCESS_ATTACKER_SOLDIERS : FAILURE_ATTACKER_SOLDIERS;
  for (const army of state.armies.values()) {
    army.knights = 0;
    army.siegeEngines = 0;
    army.movement = null;
    army.attackIntent = null;
    if (playerId && army.owner === playerId) army.soldiers = playerSoldiers;
    if (army.owner === 'f_ai_01') army.soldiers = attackerSoldiers;
  }
}

export interface OpenedAiInvasion {
  action: string;
  targetId: string | null;
  attackOutcome: string;
  invasionId: string;
  attackerSoldiers: number;
}

export function openAiInvasionFromDecision(orchestrator: Orchestrator, playerId: string): OpenedAiInvasion {
  const decided = orchestrator.execute(request(playerId, 'AI_DECIDE', 'ai-invasion-decide', { warlordId: 'f_ai_01' }));
  if (!decided.success) {
    throw new Error(decided.errors[0]?.message ?? 'AI_DECIDE failed');
  }
  const commitments = decided.payload.commitments;
  const row = Array.isArray(commitments)
    ? commitments.find((entry) => isRecord(entry) && entry.factionId === 'f_ai_01')
    : undefined;
  const commitment = row && isRecord(row.commitment) ? row.commitment : undefined;
  const action = typeof commitment?.action === 'string' ? commitment.action : '';
  const targetId = typeof commitment?.targetId === 'string' ? commitment.targetId : null;
  if (action !== 'ATTACK' || !targetId) {
    throw new Error(`DecisionEngine chose ${action || 'nothing'} ${targetId ?? ''}`.trim());
  }
  const resolved = orchestrator.execute(request(playerId, 'RESOLVE_COMMITMENT', 'ai-invasion-resolve', {
    factionId: 'f_ai_01',
  }));
  if (!resolved.success) {
    throw new Error(resolved.errors[0]?.message ?? 'RESOLVE_COMMITMENT failed');
  }
  const attackOutcome = typeof resolved.payload.attackOutcome === 'string' ? resolved.payload.attackOutcome : '';
  const invasionId = typeof resolved.payload.invasionId === 'string' ? resolved.payload.invasionId : '';
  if (attackOutcome !== 'invasion_created' || invasionId === '') {
    throw new Error(`Resolve produced ${attackOutcome || 'no attack outcome'}`);
  }
  const invasion = orchestrator.getState().activeInvasions.get(invasionId);
  const attackerSoldiers = invasion
    ? invasion.attackingArmyIds.reduce((sum, id) => {
      const army = orchestrator.getState().armies.get(id);
      return sum + (army ? army.soldiers + army.knights + army.siegeEngines : 0);
    }, 0)
    : 0;
  return { action, targetId, attackOutcome, invasionId, attackerSoldiers };
}

function request(
  playerId: string,
  commandId: string,
  requestId: string,
  parameters: Record<string, unknown>,
): CommandRequest {
  return { commandId, playerId, requestId, parameters };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
