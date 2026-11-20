import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { GameState } from '../../types/GameState';
import { GameStateSnapshot } from '../../types';
import { DecisionEngine, WarlordState } from '../../engine/DecisionEngine';
import { AISourceContext } from '../../types/AIPressure';
import { AIConcretePlan } from '../../types/AIConcretePlan';
import { BattleEngine, BattleInput } from '../../battle/BattleEngine';
import { WorldSimulator } from '../../events/WorldSimulator';
import { WorldStepInput } from '../../events/EventModel';
import { Orchestrator } from '../../orchestration/orchestrator';
import { createDefaultRegistry } from '../../orchestration/engineRegistry';
import { InMemoryGameStateStore } from '../../persistence/inMemoryGameStateStore';
import { snapshotGameState } from '../../persistence/snapshot';
import { createInMemoryPersistence } from '../../server/persistencePort';
import { applyGameplaySessionOpen, applyGameplaySessionHeartbeat, commitGameplaySession } from '../../server/gameplaySessionLifecycle';
import { checkGameStateInvariants } from '../../state/gameStateInvariants';
import { createScenario, ScenarioConfig, RESOURCES, zeros } from './scenarios';

export function canonical(value: unknown): any {
  if (value instanceof Map) return [...value.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([k, v]) => [k, canonical(v)]);
  if (value instanceof Set) return [...value].sort().map(canonical);
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export interface RecordRow { kind: string; tick: number; [field: string]: unknown }
export function holdings(s: GameState) {
  const resources = zeros(); let troops = 0, siege = 0;
  for (const f of s.factions.values()) for (const r of RESOURCES) resources[r] += f.resources[r];
  for (const e of s.territoryEconomy.values()) for (const r of RESOURCES) resources[r] += e.uncollected[r];
  for (const c of s.tradeShipments.values()) if (c.phase !== 'delivered') for (const r of RESOURCES) resources[r] += c.cargo[r] ?? 0;
  for (const a of s.armies.values()) { troops += a.soldiers + a.knights; siege += a.siegeEngines; }
  for (const t of s.territories.values()) troops += t.garrison;
  for (const p of s.territoryRecruitment.values()) troops += p.troops;
  return { resources, troops, siege };
}

/** Observers call each native entry exactly once and return its unmodified result.
 * Ledger deltas are diagnostics, not inputs or a second world authority. Hooks
 * are process-local, sequential, restored in finally, and counted only on CAS success. */
function observeReducers(ledger: any, attempts: RecordRow[]) {
  const restorations: (() => void)[] = [];
  const wrap = (path: string, name: string, observe: (args: any[], invoke: () => any) => any) => {
    const module = require(path), original = module[name];
    module[name] = (...args: any[]) => observe(args, () => original(...args));
    restorations.push(() => { module[name] = original; });
  };
  wrap('../../orchestration/transaction', 'runStateTransaction', (_, invoke) => {
    const before = JSON.stringify(ledger), length = attempts.length;
    try { return invoke(); } catch (error) { Object.assign(ledger, JSON.parse(before)); attempts.length = length; throw error; }
  });
  for (const name of ['progressRecruitment', 'progressRecruitmentThroughReceipt', 'settleRecruitmentWorldBoundary']) {
    wrap('../../gameplay/recruitment/recruitment', name, (_, invoke) => { const result = invoke(); if (result) { ledger.recruited += result.troopsGenerated; ledger.resources.food -= result.foodConsumed; } return result; });
  }
  let accruing = false;
  for (const name of ['persistAllTerritoryAccrual', 'persistTerritoryAccrual', 'persistTerritoryFoodAccrual']) {
    wrap('../../gameplay/economy/accrual', name, ([s], invoke) => {
      if (accruing) return invoke();
      const before = holdings(s).resources; accruing = true;
      try { const result = invoke(); const after = holdings(s).resources; for (const r of RESOURCES) ledger.resources[r] += after[r] - before[r]; return result; } finally { accruing = false; }
    });
  }
  wrap('../../gameplay/economy/foodConsumption', 'consumeEmpireFood', (_, invoke) => { const result = invoke(); for (const f of result.factions) { ledger.resources.food -= f.paid; ledger.upkeepPaid += f.paid; ledger.shortages += f.failedCycles; } return result; });
  wrap('../../gameplay/construction/consume', 'startConstruction', ([s], invoke) => { const before = holdings(s).resources; const result = invoke(); const after = holdings(s).resources; for (const r of RESOURCES) ledger.resources[r] += after[r] - before[r]; return result; });
  // Ownership settlement owns loss of local stock/pools, not bank/cargo.
  wrap('../../gameplay/economy/ownership', 'settleTerritoryOwnershipChange', ([s], invoke) => { const before = holdings(s); const result = invoke(); const after = holdings(s); ledger.troops += after.troops - before.troops; for (const r of RESOURCES) ledger.resources[r] -= result.resourcesLost[r]; return result; });
  return () => restorations.reverse().forEach(fn => fn());
}
let running = false;
export function runSimulation(config: ScenarioConfig) {
  if (running) throw new Error('Run simulations sequentially: reducer observations are process-local');
  const started = performance.now(), { definition, state } = createScenario(config);
  const initial = holdings(state), rows: RecordRow[] = [], attempts: RecordRow[] = [];
  const ledger = { resources: zeros(), recruited: 0, troops: 0, upkeepPaid: 0, shortages: 0 };
  let peakConcurrentOperations = 0;
  const restore = observeReducers(ledger, attempts); running = true;
  let tick = 0;
  class ObservedAI extends DecisionEngine {
    decideForSource(w: WarlordState, view: GameStateSnapshot, source: AISourceContext, plans: readonly AIConcretePlan[], opportunityId: string) {
      const result = super.decideForSource(w, view, source, plans, opportunityId);
      attempts.push({ kind: 'decision', tick: view.canonicalState!.worldTick, faction: w.snapshot.id, source: canonical(source), opportunityId,
        goals: canonical(view.canonicalState!.factions.get(w.snapshot.id)!.goals), decision: canonical(result) });
      return result;
    }
  }
  class ObservedBattle extends BattleEngine {
    resolve(input: BattleInput) { const result = super.resolve(input); attempts.push({ kind: 'battle', tick, input: canonical(input), result: canonical(result) }); return result; }
  }
  class ObservedEvents extends WorldSimulator {
    simulate(input: WorldStepInput) {
      const result = super.simulate(input);
      let troopDelta = 0;
      for (const [id, t] of result.mutatedTerritories) troopDelta += t.garrison - (input.territories.get(id)?.garrison ?? 0);
      for (const [id, a] of result.mutatedArmies ?? []) { const before = input.armies?.get(id); troopDelta += a.soldiers + a.knights - (before ? before.soldiers + before.knights : 0); }
      ledger.troops += troopDelta;
      for (const [id, f] of result.mutatedFactions) for (const r of RESOURCES) ledger.resources[r] += f.resources[r] - (input.factions.get(id)?.resources[r] ?? 0);
      if (result.triggeredEvents.length || troopDelta) attempts.push({ kind: 'world_events', tick, triggered: canonical(result.triggeredEvents), troopDelta, consequences: canonical(result.perTurnConsequences), summary: result.summary });
      return result;
    }
  }
  const registry = createDefaultRegistry(); registry.registerAi(new ObservedAI(config.seed)); registry.registerBattle(new ObservedBattle()); registry.registerEvents(new ObservedEvents());
  const store = new InMemoryGameStateStore(), persistence = createInMemoryPersistence(store);
  const playerId = `sim:${config.size}:${config.seed}`, sessionId = `sim-session:${config.size}:${config.seed}`, origin = 1_700_000_000_000;
  let orchestrator = new Orchestrator(state, registry), error: unknown = null;
  const failures: unknown[] = [], checkpointDigests: { tick: number; digest: string }[] = [];
  const step = config.stepTicks ?? 1;
  if (!Number.isSafeInteger(step) || step < 1) { restore(); running = false; throw new Error('Invalid processing step'); }
  const transition = (before: GameState, after: GameState) => {
    for (const [id, op] of after.operations) {
      const old = before.operations.get(id);
      if (!old || old.status !== op.status || old.phase !== op.phase || JSON.stringify(old.terminal) !== JSON.stringify(op.terminal))
        rows.push({ kind: 'operation', tick: after.worldTick, id, faction: op.warlordId, action: op.action, status: op.status, phase: op.phase, terminal: op.terminal, plan: canonical(op.plan), attention: canonical(op.attention) });
    }
    for (const [id, t] of after.territories) if (before.territories.get(id)?.owner !== t.owner) rows.push({ kind: 'ownership', tick: after.worldTick, id, from: before.territories.get(id)?.owner, to: t.owner });
    for (const [kind, oldMap, newMap] of [['peace', before.peaceProposals, after.peaceProposals], ['trade', before.tradeProposals, after.tradeProposals], ['shipment', before.tradeShipments, after.tradeShipments], ['construction', before.constructions, after.constructions], ['response', before.aiResponses, after.aiResponses]] as const)
      for (const [id, record] of newMap as Map<string, any>) { const old = (oldMap as Map<string, any>).get(id); if (!old || old.status !== record.status || old.phase !== record.phase) rows.push({ kind, tick: after.worldTick, id, record: canonical(record) }); }
  };
  const execute = (receipt: number, n: number) => {
    const loaded = persistence.ensure(playerId); const before = loaded.state; orchestrator.replaceState(before);
    const savedLedger = JSON.stringify(ledger); attempts.length = 0;
    tick = n;
    const result = orchestrator.executeAtAuthoritativeReceipt({ commandId: 'SYNC_PLAYER_WORLD', playerId, requestId: `sim-sync:${n}` }, receipt);
    if (!result.success) { Object.assign(ledger, JSON.parse(savedLedger)); error = canonical(result); throw new Error('Authoritative command rejected'); }
    const after = orchestrator.getState();
    const violations = checkGameStateInvariants(after); if (violations.length) throw new Error(JSON.stringify(violations));
    const saved = persistence.save(playerId, after, loaded.record.stateVersion); if (!saved.ok) throw new Error(JSON.stringify(saved));
    rows.push(...attempts); transition(before, after);
    peakConcurrentOperations = Math.max(peakConcurrentOperations, [...after.operations.values()].filter(op => !op.terminal).length);
    const findErrors = (value: any): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value.errors) && value.errors.length) failures.push(...canonical(value.errors));
      for (const child of Object.values(value)) if (child && typeof child === 'object') findErrors(child);
    };
    findErrors(result.payload);
  };
  try {
    const boot = persistence.save(playerId, state, 0); if (!boot.ok) throw new Error(JSON.stringify(boot));
    if (config.presence === 'online') {
      const opened = commitGameplaySession(persistence, playerId, s => applyGameplaySessionOpen(s, { sessionId, requestId: 'sim-open', receiptMs: origin })); if (!opened.ok) throw new Error(JSON.stringify(opened));
    }
    execute(origin, 0);
    // Presence is renewed at each real minute independently of the processing batch.
    let renewal = 0;
    for (let n = 1; n <= config.ticks; n++) {
      const receipt = origin + n * (config.presence === 'online' ? 60_000 : 600_000);
      if (config.presence === 'online') {
        const renewed = commitGameplaySession(persistence, playerId, s => applyGameplaySessionHeartbeat(s, { sessionId, requestId: `sim-heartbeat:${n}`, receiptMs: receipt, renewalSequence: ++renewal }));
        if (!renewed.ok) throw new Error(JSON.stringify(renewed));
      }
      if (n % step === 0 || n === config.ticks) {
        execute(receipt, n);
        if (config.reloadEvery && n % config.reloadEvery === 0) { const loaded = persistence.ensure(playerId); orchestrator = new Orchestrator(loaded.state, registry); checkpointDigests.push({ tick: n, digest: digest(snapshotGameState(loaded.state)) }); }
      }
    }
  } catch (err) { error ??= { message: err instanceof Error ? err.message : String(err), lastAttemptTick: tick }; }
  finally { restore(); running = false; }
  const final = persistence.ensure(playerId).state, finalHoldings = holdings(final);
  const losses = { troops: 0, siege: 0 };
  for (const pair of final.conflictLedger.values()) for (const e of pair.episodes.values()) for (const side of e.totals) { losses.troops += side.troopsLost; losses.siege += side.siegeLost; }
  const expectedTroops = initial.troops + ledger.recruited + ledger.troops - losses.troops;
  const conservation = { initial, final: finalHoldings, recruited: ledger.recruited, eventAndOwnershipTroopDelta: ledger.troops, conflictLosses: losses,
    troopResidual: finalHoldings.troops - expectedTroops, siegeResidual: finalHoldings.siege - (initial.siege - losses.siege),
    resourceResidual: Object.fromEntries(RESOURCES.map(r => [r, finalHoldings.resources[r] - initial.resources[r] - ledger.resources[r]])), observedNetResourceChanges: ledger.resources };
  const count = (items: any[], field: string) => items.reduce((out: Record<string, number>, item) => { const key = String(item[field]); out[key] = (out[key] ?? 0) + 1; return out; }, {});
  const decisions = rows.filter(row => row.kind === 'decision'), operations = [...final.operations.values()];
  const summary = { config, completed: !error && final.worldTick === config.ticks, processedTick: final.worldTick, earnedTick: final.accruedTargetWorldTick,
    elapsedSeconds: (performance.now() - started) / 1000, error, nestedErrors: failures, stateDigest: digest(snapshotGameState(final)),
    decisions: decisions.length, decisionActions: count(decisions.map(row => row.decision), 'action'), operations: operations.length,
    operationActions: count(operations, 'action'), operationStatuses: count(operations, 'status'), battles: rows.filter(r => r.kind === 'battle').length,
    captures: rows.filter(r => r.kind === 'ownership').length, peakConcurrentOperations,
    upkeepPaid: ledger.upkeepPaid, failedUpkeepCycles: ledger.shortages, conservation,
    factions: [...final.factions.values()].filter(f => f.id !== final.playerFactionId).map(f => ({ id: f.id, personality: f.personality.type, territories: f.territories.length,
      armies: [...final.armies.values()].filter(a => a.owner === f.id).length, resources: f.resources, stability: f.stability,
      localTroops: [...final.territoryRecruitment.values()].filter(p => p.factionId === f.id).reduce((n, p) => n + p.troops, 0), goals: f.goals,
      lastDecisionTick: Math.max(-1, ...decisions.filter(d => d.faction === f.id).map(d => d.tick)) })),
    peace: count([...final.peaceProposals.values()], 'status'), trade: count([...final.tradeProposals.values()], 'status'), shipments: count([...final.tradeShipments.values()], 'phase'),
    responseContexts: final.aiResponses.size, activeClaims: final.operationClaims.size, historyRows: final.eventHistory.length,
    checkpointDigests };
  return { definition, summary, rows, final: snapshotGameState(final) };
}
