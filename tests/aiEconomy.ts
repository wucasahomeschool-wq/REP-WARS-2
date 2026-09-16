import assert from 'assert';
import {
  ECONOMY_CONFIG,
  EXECUTABLE_COMMITMENT_ACTIONS,
  Orchestrator,
  UNSUPPORTED_COMMITMENT_ACTIONS,
  createLegacySampleMapGameState,
  peekCollectibleResources,
  progressWorldEconomy,
} from '../src';
import type { ActionType, AICommitment, CommandRequest, GameState } from '../src';
import { plantOwnedCities } from './worldTestHelpers';

export interface AiEconomyTestApi {
  test: (name: string, fn: () => void) => void;
}

function cmdReq(commandId: string, parameters: Record<string, unknown> = {}): CommandRequest {
  return { commandId, playerId: 'ai', requestId: `${commandId}_ai_econ`, parameters };
}

function makeCmt(factionId: string, action: ActionType, targetId: string): AICommitment {
  return {
    id: `cmt_${factionId}_${action}`,
    warlordId: factionId,
    action,
    targetId,
    targetName: targetId,
    status: 'committed',
    createdTurn: 1,
    originatingGoalId: null,
    reason: ['phase-7'],
    priority: 50,
    score: 50,
    confidence: 1,
    personalityBias: 0,
    ambitionInfluence: 0,
    factorBreakdown: [],
    statusReason: null,
  };
}

export function registerAiEconomyTests({ test }: AiEconomyTestApi): void {
  test('AI commitments have no collect action and TRADE stays unsupported', () => {
    const executable = [...EXECUTABLE_COMMITMENT_ACTIONS];
    assert.ok(executable.includes('BUILD'));
    assert.ok(executable.includes('REINFORCE'));
    assert.ok(executable.includes('WAIT'));
    assert.ok(!executable.some((action) => /collect/i.test(action)));
    assert.ok(UNSUPPORTED_COMMITMENT_ACTIONS.has('TRADE'));
  });

  test('AI BUILD commitment still starts FORTIFICATION, not a development', () => {
    const state = createLegacySampleMapGameState({ seed: 7, playerFactionId: 'ashen_horde' });
    plantOwnedCities(state);
    const fid = 'merchant_republic';
    const owned = state.factions.get(fid)!.territories[0]!;
    state.commitments.set(fid, makeCmt(fid, 'BUILD', owned));
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('RESOLVE_COMMITMENT', { factionId: fid }));
    assert.strictEqual(res.success, true, res.errors?.[0]?.message);
    const project = [...orch.getState().constructions.values()].find((p) => p.territoryId === owned && p.status === 'in_progress');
    assert.ok(project);
    assert.strictEqual(project.projectType, 'FORTIFICATION');
    assert.strictEqual(orch.getState().territoryInfrastructure.get(owned)!.farmCompletedAtTick, null);
  });

  test('world progress does not auto-collect AI uncollected yield', () => {
    const state: GameState = createLegacySampleMapGameState({ seed: 8, playerFactionId: 'iron_kingdom' });
    state.worldLevel = 2;
    const fid = 'ashen_horde';
    const owned = state.factions.get(fid)!.territories[0]!;
    const goldBefore = state.factions.get(fid)!.resources.gold;
    state.worldTick = ECONOMY_CONFIG.ticksPerProductionCycle;
    progressWorldEconomy(state);
    const uncollected = peekCollectibleResources(state, owned);
    assert.ok(uncollected.gold > 0 || uncollected.food > 0 || uncollected.wood > 0 || uncollected.iron > 0 || uncollected.stone > 0);
    assert.strictEqual(state.factions.get(fid)!.resources.gold, goldBefore);
  });
}
