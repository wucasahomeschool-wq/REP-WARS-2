import assert from 'node:assert/strict';
import { createScaleWorld } from './backendScale';
import { createGameState, checkGameStateInvariants } from '../src/state';
import { getDefaultWorldCatalog } from '../src/worldDefinition/catalog';
import { cloneGameState } from '../src/state/cloneGameState';
import { snapshotGameState } from '../src/persistence/snapshot';
import { hydratePersistedPayload } from '../src/persistence/hydrate';
import { observeSources, sourceConcretePlans } from '../src/engine/strategicPressure';
import { tradeDemand } from '../src/gameplay/trade/candidates';
import { declinedTradeContext, unchangedTradeDecline, rememberDeclinedTrade } from '../src/gameplay/trade/declinedContext';
import { settleTradeProposal } from '../src/gameplay/trade/trade';
import { openGameplaySessionLease } from '../src/world/presenceLeases';
import { accrueWorldThroughReceipt } from '../src/world/worldAccrual';
import { Orchestrator } from '../src/orchestration/orchestrator';
import { makeConcretePlan, TradePlan } from '../src/types/AIConcretePlan';
import { assignGoal } from '../src/cognition/goals';
import { assessConcretePlanFeasibility } from '../src/engine/concretePlans';
import { toDecisionEngineSnapshot } from '../src/state/gameStateAdapters';

const proposer = 'scale_ai_0', recipient = 'scale_ai_1', origin = 1_700_000_000_000;
function fixture(decline = true, minimalSurplus = false) {
  const definition = createScaleWorld(10, 3); getDefaultWorldCatalog().register(definition);
  const state = createGameState({ world: definition, seed: 11 });
  Object.assign(state.factions.get(proposer)!.resources, { gold: minimalSurplus ? tradeDemand(state, proposer).gold + 1 : 1000, stone: 0, wood: 650 });
  Object.assign(state.factions.get(recipient)!.resources, { gold: decline ? tradeDemand(state, recipient).gold - 1 : 0, stone: 1000 });
  state.factions.get(recipient)!.diplomacy.get(proposer)!.opinion = decline ? -100 : 0;
  state.gameplaySessionLeases = [openGameplaySessionLease({ sessionId: 'trade-context-test', receiptMs: origin })];
  accrueWorldThroughReceipt(state, origin); observeSources(state, proposer);
  const source = [...state.aiPressure.values()].find(s => s.factionId === proposer && s.counterpartyId === recipient && s.kind === 'RESOURCE_EXCHANGE'); assert.ok(source);
  const plan = sourceConcretePlans(state, source).find((p): p is TradePlan => p.action === 'TRADE'); assert.ok(plan);
  const stocks = [...state.factions].map(([id, f]) => [id, { ...f.resources }]);
  const orchestrator = new Orchestrator(state);
  const start = orchestrator.executeAtAuthoritativeReceipt({ commandId: 'START_AI_OPERATION', playerId: 'internal', parameters: { plan } }, origin);
  assert.ok(start.success, JSON.stringify(start.errors));
  const finish = orchestrator.executeAtAuthoritativeReceipt({ commandId: 'SYNC_PLAYER_WORLD', playerId: 'internal' }, origin + 15_000);
  assert.ok(finish.success, JSON.stringify(finish.errors));
  const result = orchestrator.getState();
  const proposal = [...result.tradeProposals.values()].find(p => p.plan.id === plan.id); assert.ok(proposal);
  assert.equal(proposal.status, decline ? 'declined' : 'accepted');
  observeSources(result, proposer); assert.deepEqual(checkGameStateInvariants(result), []);
  return { state: result, plan, sourceId: source.id, proposalId: proposal.id, stocks };
}
const available = (f: ReturnType<typeof fixture>) => {
  observeSources(f.state, proposer);
  return sourceConcretePlans(f.state, f.state.aiPressure.get(f.sourceId)!).some(p => p.id === f.plan.id);
};

export function registerDeclinedTradeTests({ test }: { test: (name: string, fn: () => void) => void }) {
  test('declined Trade: native required response suppresses the unchanged exact proactive candidate', () => {
    const f = fixture(); assert.equal(available(f), false);
    assert.ok(f.state.aiPressure.get(f.sourceId)!.blockers.some(b => b.plan.id === f.plan.id && b.reasons.some(r => r.kind === 'CONTEXT')));
    assert.equal(f.state.tradeShipments.size, 0); assert.equal(f.state.operationClaims.size, 0);
    assert.deepEqual([...f.state.factions].map(([id, faction]) => [id, { ...faction.resources }]), f.stocks);
    const op = f.state.operations.get(f.state.tradeProposals.get(f.proposalId)!.operationId)!;
    assert.ok(op.terminal); assert.deepEqual(op.claimIds, []); assert.equal(op.attention.releasedAtTick, op.terminal.atTick);
  });
  test('declined Trade: explicit identical offers remain legal through the command path', () => {
    const f = fixture(); assert.ok(assessConcretePlanFeasibility(f.plan, toDecisionEngineSnapshot(f.state)).feasible);
    const o = new Orchestrator(f.state), result = o.executeAtAuthoritativeReceipt({ commandId: 'START_AI_OPERATION', playerId: 'internal', parameters: { plan: f.plan } }, origin + 16_000);
    assert.ok(result.success, JSON.stringify(result.errors));
    assert.equal(o.getState().tradeProposals.size, f.state.tradeProposals.size + 1);
  });
  test('declined Trade: clock, Pressure and unrelated local troops do not rearm it', () => {
    const f = fixture(); f.state.aiClock.nowMs += 1000; f.state.aiPressure.get(f.sourceId)!.pressure += 100;
    [...f.state.territoryRecruitment.values()][0].troops++;
    assert.equal(available(f), false);
  });
  test('declined Trade: recipient private Opinion and Goals cannot rearm the proposer', () => {
    const f = fixture(); f.state.factions.get(recipient)!.diplomacy.get(proposer)!.opinion = 100;
    assignGoal(f.state, recipient, 'private-food', { kind: 'RESOURCE_HOLDING', resource: 'food', quantity: 10000 });
    assert.equal(available(f), false);
  });
  test('declined Trade: unrelated own Goals do not rearm an exchange', () => {
    const f = fixture(); assignGoal(f.state, proposer, 'unrelated-farm', { kind: 'DEVELOPMENT', territoryId: 'scale_tile_1', projectType: 'FARM' });
    assert.equal(available(f), false);
  });
  test('declined Trade: relevant own resource Goal restores eligibility', () => {
    const f = fixture(); assignGoal(f.state, proposer, 'need-stone', { kind: 'RESOURCE_HOLDING', resource: 'stone', quantity: 10000 });
    assert.equal(available(f), true);
  });
  test('declined Trade: relevant observable stock and own Opinion changes restore eligibility', () => {
    for (const change of [(f: ReturnType<typeof fixture>) => f.state.factions.get(recipient)!.resources.stone++,
      (f: ReturnType<typeof fixture>) => f.state.factions.get(proposer)!.diplomacy.get(recipient)!.opinion++]) {
      const f = fixture(); change(f); assert.equal(available(f), true);
    }
  });
  test('declined Trade: different terms are not suppressed', () => {
    const f = fixture(), changed = makeConcretePlan({ ...f.plan, offered: { gold: (f.plan.offered.gold ?? 0) + 1 }, proposerSource: { kind: 'faction_stock', factionId: proposer, resources: { gold: (f.plan.offered.gold ?? 0) + 1 } } }) as TradePlan;
    assert.equal(unchangedTradeDecline(f.state, changed, f.state.aiPressure.get(f.sourceId)!.blockers), null);
  });
  test('declined Trade: alternative terms and counterparties remain available without a global cap', () => {
    const f = fixture(); f.state.factions.get(proposer)!.resources.wood = 0; f.state.factions.get(recipient)!.resources.wood = 1000;
    f.state.factions.get('scale_ai_2')!.resources.gold = 0; observeSources(f.state, proposer);
    const plans = sourceConcretePlans(f.state, f.state.aiPressure.get(f.sourceId)!);
    assert.ok(plans.some(p => p.action === 'TRADE' && (p.requested.wood ?? 0) > 0)); assert.ok(!plans.some(p => p.id === f.plan.id));
    const other = [...f.state.aiPressure.values()].find(s => s.factionId === proposer && s.counterpartyId === 'scale_ai_2' && s.kind === 'RESOURCE_EXCHANGE'); assert.ok(other);
    assert.ok(sourceConcretePlans(f.state, other).some(p => p.action === 'TRADE'));
  });
  test('declined Trade: insertion order does not change the predicate or suppression', () => {
    const f = fixture(), before = declinedTradeContext(f.state, f.plan);
    f.state.factions = new Map([...f.state.factions].reverse()); f.state.territories = new Map([...f.state.territories].reverse());
    assert.equal(declinedTradeContext(f.state, f.plan), before); assert.equal(available(f), false);
  });
  test('declined Trade: clone and persistence retain the original context', () => {
    const f = fixture(), before = snapshotGameState(f.state);
    for (const state of [cloneGameState(f.state), hydratePersistedPayload(before)]) {
      assert.deepEqual(snapshotGameState(state), before); assert.equal(available({ ...f, state }), false); assert.deepEqual(checkGameStateInvariants(state), []);
    }
  });
  test('declined Trade: repeated terminal settlement cannot duplicate effects or cleanup', () => {
    const f = fixture(), before = snapshotGameState(f.state);
    assert.equal(settleTradeProposal(f.state, f.proposalId, 'declined'), false); assert.deepEqual(snapshotGameState(f.state), before);
  });
  test('declined Trade: old historical declines do not acquire fabricated context on reload', () => {
    const f = fixture(); f.state.aiPressure.get(f.sourceId)!.blockers = [];
    const state = hydratePersistedPayload(snapshotGameState(f.state)); assert.equal(available({ ...f, state }), true);
  });
  test('declined Trade: accepted offers retain exact settled bank receipt', () => {
    const f = fixture(false); assert.equal(f.state.tradeShipments.size, 0);assert.equal(f.state.tradeProposals.get(f.proposalId)!.status,'accepted');assert.equal(typeof f.state.tradeProposals.get(f.proposalId)!.bankSettledAtMs,'number');
    assert.ok([...f.state.tradeShipments.values()].every(s => s.phase !== 'delivered'));
    assert.ok(!f.state.aiPressure.get(f.sourceId)?.blockers.some(b => b.reasons.some(r => r.kind === 'CONTEXT')));
  });
  test('declined Trade: obsolete sources release bounded context and do not retain terminal history', () => {
    const f = fixture(); Object.assign(f.state.factions.get(proposer)!.resources, { gold: 0, food: 0, wood: 0, iron: 0, stone: 0 });
    observeSources(f.state, proposer); assert.equal(f.state.aiPressure.has(f.sourceId), false);
    assert.ok(f.state.tradeProposals.has(f.proposalId));
  });
  test('declined Trade: malformed persisted blocker text is rejected during hydration', () => {
    const f = fixture();
    f.state.aiPressure.get(f.sourceId)!.blockers.find(b => b.plan.id === f.plan.id)!.reasons[0].reason = 7 as unknown as string;
    assert.throws(() => hydratePersistedPayload(snapshotGameState(f.state)));
  });

  test('declined Trade: repeated observations cannot reopen the exact offer or grow retained context', () => {
    const f = fixture();
    const before = JSON.stringify(f.state.aiPressure.get(f.sourceId)!.blockers);
    for (let i = 0; i < 100; i++) { f.state.aiClock.nowMs++; assert.equal(available(f), false); }
    assert.equal(JSON.stringify(f.state.aiPressure.get(f.sourceId)!.blockers), before);
    assert.deepEqual(checkGameStateInvariants(f.state), []);
  });

  test('declined Trade: reservation of all tradable surplus cannot erase the actual decline', () => {
    const f = fixture(true, true); assert.equal(available(f), false);
    assert.equal(f.state.operationClaims.size, 0);
    assert.deepEqual([...f.state.factions].map(([id, faction]) => [id, { ...faction.resources }]), f.stocks);
    assert.equal(available({ ...f, state: hydratePersistedPayload(snapshotGameState(f.state)) }), false);
  });

  test('declined Trade: rediscovery cannot revive a currently unavailable source', () => {
    const f = fixture(); f.state.aiPressure.delete(f.sourceId);
    Object.assign(f.state.factions.get(proposer)!.resources, { gold: 0, food: 0, wood: 0, iron: 0, stone: 0 });
    const before = snapshotGameState(f.state);
    rememberDeclinedTrade(f.state, f.state.tradeProposals.get(f.proposalId)!);
    assert.equal(f.state.aiPressure.has(f.sourceId), false);
    assert.deepEqual(snapshotGameState(f.state), before);
  });

}
