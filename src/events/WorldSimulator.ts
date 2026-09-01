import { FactionId, TerritoryId, Resources, Territory, WarlordSnapshot } from '../types';
import { BALANCE } from '../constants/balance';
import { SeededRNG } from '../utils/SeededRNG';
import {
  ActiveEvent, ConsequenceDelta, ConditionContext, EventDefinition, EventSeverity,
  HistoryEntry, ImperialChoice, SEVERITY_ORDER, TriggeredEvent, WorldHelper,
  WorldStepInput, WorldStepOutput, buildDefaultSeverityTable, pickSeverityFromTable,
  severityAtLeast,
} from './EventModel';
import { buildConditionContext, candidateTerritoriesForEvents, WorldHelperImpl } from './EventTriggers';
import { EVENT_REGISTRY, EVENT_LIST, getEventById, evaluateAllTriggersForTerritory } from './EventDefinitions';

const BW = BALANCE.events.world;
const BDEF = BALANCE.events.defaultEventDuration;
const BN = BALANCE.events.chain;

function cloneTerritory(t: Territory): Territory {
  return {
    ...t,
    neighboring: [...t.neighboring],
    resourceOutput: { ...t.resourceOutput },
  };
}

function cloneWarlordSnapshot(f: WarlordSnapshot): WarlordSnapshot {
  const diplomacy = new Map<FactionId, any>();
  for (const [k, v] of f.diplomacy.entries()) {
    diplomacy.set(k, {
      ...v,
      treaties: v.treaties.map(x => ({ ...x })),
    });
  }
  return {
    ...f,
    territories: [...f.territories],
    armies: [...f.armies],
    resources: { ...f.resources },
    resourceIncome: { ...f.resourceIncome },
    diplomacy,
    memory: [...f.memory],
    goals: [...f.goals],
    currentThreats: [...f.currentThreats],
    knownFactions: [...f.knownFactions],
    knownTerritories: [...f.knownTerritories],
    lastActions: [...f.lastActions],
  };
}

function cloneMap<K, V extends any>(m: Map<K, V>, cloneFn: (v: V) => V): Map<K, V> {
  const out = new Map<K, V>();
  for (const [k, v] of m.entries()) out.set(k, cloneFn(v));
  return out;
}

export class ConsequenceApplier {
  territories: Map<TerritoryId, Territory>;
  factions: Map<FactionId, WarlordSnapshot>;
  applied: string[];

  constructor(
    territories: Map<TerritoryId, Territory>,
    factions: Map<FactionId, WarlordSnapshot>,
  ) {
    this.territories = cloneMap(territories, cloneTerritory);
    this.factions = cloneMap(factions, cloneWarlordSnapshot);
    this.applied = [];
  }

  applyDelta(c: ConsequenceDelta): string | null {
    const d = c.delta;
    // Territory deltas
    if (c.territoryId) {
      const t = this.territories.get(c.territoryId);
      if (t) {
        if (d.populationDeltaAbs) t.population = Math.max(0, t.population + d.populationDeltaAbs);
        if (d.populationDeltaPct) t.population = Math.max(0, Math.round(t.population * (1 + d.populationDeltaPct)));
        if (d.garrisonDeltaAbs) t.garrison = Math.max(0, t.garrison + d.garrisonDeltaAbs);
        if (d.resourceOutputPct) {
          const newOut: Partial<Resources> = { ...t.resourceOutput };
          for (const k of Object.keys(d.resourceOutputPct) as (keyof Resources)[]) {
            const oldVal = t.resourceOutput?.[k] ?? 0;
            const multiplier = 1 + (d.resourceOutputPct[k] ?? 0);
            newOut[k] = Math.max(0, Math.round(oldVal * multiplier));
          }
          t.resourceOutput = newOut;
        }
        if (d.foodProductionPct) {
          const multiplier = 1 + d.foodProductionPct;
          const currentFood = t.resourceOutput?.food ?? 0;
          t.resourceOutput = { ...t.resourceOutput, food: Math.max(0, Math.round(currentFood * multiplier)) };
        }
      }
    }
    // Faction deltas
    const factionId = c.factionId ?? (c.territoryId ? this.territories.get(c.territoryId)?.owner ?? null : null);
    if (factionId) {
      const f = this.factions.get(factionId);
      if (f) {
        if (d.stabilityDelta) f.stability = Math.max(0, Math.min(100, f.stability + d.stabilityDelta));
        if (d.resources) {
          for (const k of Object.keys(d.resources) as (keyof Resources)[]) {
            f.resources[k] = Math.max(0, (f.resources[k] ?? 0) + (d.resources[k] ?? 0));
          }
        }
        if (d.resourceOutputPct) {
          const newIncome: Partial<Resources> = { ...f.resourceIncome };
          for (const k of Object.keys(d.resourceOutputPct) as (keyof Resources)[]) {
            const oldVal = f.resourceIncome?.[k] ?? 0;
            const multiplier = 1 + (d.resourceOutputPct[k] ?? 0);
            newIncome[k] = Math.max(0, Math.round(oldVal * multiplier));
          }
          f.resourceIncome = newIncome;
        }
        if (d.moraleDeltaArmy) {
          // We don't have army iteration here; apply to snapshot stability as proxy for now.
          // Real army morale would need to be handled by the orchestrator.
        }
        if (d.relationshipDeltaOpinion) {
          const rel = f.diplomacy.get(d.relationshipDeltaOpinion.target);
          if (rel) rel.opinion = Math.max(-100, Math.min(100, rel.opinion + d.relationshipDeltaOpinion.delta));
        }
      }
    }
    this.applied.push(c.message);
    return c.message;
  }

  applyMany(cs: ConsequenceDelta[]): string[] {
    const out: string[] = [];
    for (const c of cs) {
      const r = this.applyDelta(c);
      if (r) out.push(r);
    }
    return out;
  }

  canAfford(cost: Partial<Resources> | undefined, factionId: FactionId): boolean {
    if (!cost) return true;
    const f = this.factions.get(factionId);
    if (!f) return false;
    for (const k of Object.keys(cost) as (keyof Resources)[]) {
      if ((f.resources[k] ?? 0) < (cost[k] ?? 0)) return false;
    }
    return true;
  }

  payCost(cost: Partial<Resources> | undefined, factionId: FactionId): void {
    if (!cost) return;
    const f = this.factions.get(factionId);
    if (!f) return;
    for (const k of Object.keys(cost) as (keyof Resources)[]) {
      f.resources[k] = Math.max(0, (f.resources[k] ?? 0) - (cost[k] ?? 0));
    }
  }
}

function makeInstanceCounter(): () => string {
  let n = 0;
  return () => `inst_${Date.now().toString(36)}_${(n++).toString(36)}`;
}

export class WorldSimulator {
  private applier: ConsequenceApplier | null = null;

  simulate(input: WorldStepInput): WorldStepOutput {
    const turn = input.turn;
    const rng = new SeededRNG(input.seed ^ BW.rngSalt);
    const newActiveEvents: ActiveEvent[] = [...input.activeEvents];
    const newEventHistory: HistoryEntry[] = [...input.eventHistory];
    const triggeredEvents: TriggeredEvent[] = [];
    const perTurnConsequences: ConsequenceDelta[] = [];
    const expiredEvents: ActiveEvent[] = [];
    const summary: string[] = [];
    const unresolvedDecisions: WorldStepOutput['unresolvedDecisions'] = [];

    const terr = cloneMap(input.territories, cloneTerritory);
    const facts = cloneMap(input.factions, cloneWarlordSnapshot);

    this.applier = new ConsequenceApplier(terr, facts);

    const nextInstanceId = makeInstanceCounter();

    // ────────────────────────────────────────────
    // PHASE 1: Apply per-turn effects of active events + decrement chains
    // ────────────────────────────────────────────
    for (const ev of newActiveEvents) {
      if (ev.status !== 'active') continue;
      const def = getEventById(ev.typeId === 'drought' ? 'evt_drought'
        : ev.typeId === 'flood' ? 'evt_flood'
        : ev.typeId === 'storm' ? 'evt_storm'
        : ev.typeId === 'harsh_winter' ? 'evt_harsh_winter'
        : ev.typeId === 'resource_discovery' ? 'evt_resource_discovery'
        : ev.typeId === 'food_shortage' ? 'evt_food_shortage'
        : ev.typeId === 'famine' ? 'evt_famine'
        : ev.typeId === 'prosperity' ? 'evt_prosperity'
        : ev.typeId === 'trade_boom' ? 'evt_trade_boom'
        : ev.typeId === 'unrest' ? 'evt_unrest'
        : ev.typeId === 'rebellion' ? 'evt_rebellion'
        : ev.typeId === 'border_tension' ? 'evt_border_tension'
        : '') || EVENT_LIST[0];

      // Pending choices remain unresolved (player must resolve before turn end in real game)
      if (ev.choicesPending.length > 0) {
        unresolvedDecisions.push({
          active: ev,
          choices: ev.choicesPending,
          territoryId: ev.territoryId,
          factionId: ev.factionId,
        });
      }

      // Per-turn consequences
      if (def.perTurn) {
        const ctx = this._buildCtx(turn, ev.territoryId, ev.factionId, terr, facts, newActiveEvents, rng.fork(1000 + turn * 31));
        const cs = def.perTurn(ctx, ev.severity, ev);
        for (const c of cs) perTurnConsequences.push(c);
        const applied = this.applier.applyMany(cs);
        for (const a of applied) {
          newEventHistory.push({
            id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            turn,
            typeId: ev.typeId,
            kind: 'perTurn',
            severity: ev.severity,
            territoryId: ev.territoryId,
            factionId: ev.factionId,
            title: ev.title,
            message: a,
          });
        }
      }

      // Decrement chain delays
      for (const cd of ev.chainDelays) {
        if (cd.delayRemaining > 0) cd.delayRemaining--;
      }
    }

    // ────────────────────────────────────────────
    // PHASE 2: Process chains (eligible chain candidates now delay=0)
    // ────────────────────────────────────────────
    const chainTriggered: Array<{ fromId: string; toEventId: string; territoryId: TerritoryId | null; factionId: FactionId | null; severity: EventSeverity; probability: number }> = [];
    for (const ev of newActiveEvents) {
      if (ev.status !== 'active') continue;
      if (ev.chainSuppressed) continue;
      for (const cd of ev.chainDelays) {
        if (cd.delayRemaining > 0) continue;
        const rolls = rng.fork(100 + turn * 7 + cd.toEventId.length);
        if (rolls.chance(cd.probability)) {
          chainTriggered.push({
            fromId: ev.instanceId,
            toEventId: cd.toEventId,
            territoryId: ev.territoryId,
            factionId: ev.factionId,
            severity: cd.severity,
            probability: cd.probability,
          });
          cd.delayRemaining = -999; // consumed
          break; // only one chain per event per turn
        }
      }
    }

    for (const ch of chainTriggered) {
      const def = EVENT_REGISTRY[ch.toEventId];
      if (!def) continue;
      const ctx = this._buildCtx(turn, ch.territoryId, ch.factionId, terr, facts, newActiveEvents, rng.fork(500 + turn * 5));
      const severity = ch.severity;
      const dur = def.isInstant ? 1 : rng.fork(600 + turn).nextInt(def.defaultDuration.min, def.defaultDuration.max);
      const triggerRes = def.onTrigger(ctx, severity);
      const choices: ImperialChoice[] = def.choices ? def.choices(ctx, severity) : [];
      const worldSnapshot = { territories: terr };
      const inst: ActiveEvent = {
        instanceId: nextInstanceId(),
        typeId: def.typeId,
        category: def.category,
        title: def.titleTemplate(severity, ch.territoryId, worldSnapshot),
        description: def.descriptionTemplate(severity, ctx),
        causes: [...def.causes, `Chain from event in ${ch.fromId}`],
        severity,
        status: def.isInstant ? 'resolved' : 'active',
        territoryId: ch.territoryId,
        factionId: ch.factionId,
        triggeredTurn: turn,
        durationTurns: dur,
        startedTurn: turn,
        expiresTurn: turn + dur,
        consequences: triggerRes.consequences,
        chainSuppressed: false,
        chainDelays: this._seedChainDelays(def, null, severity, rng.fork(700 + turn)),
        choicesPending: choices,
      };
      const applied = this.applier.applyMany(triggerRes.consequences);
      newActiveEvents.push(inst);
      triggeredEvents.push({
        definition: def,
        severity,
        territoryId: ch.territoryId,
        factionId: ch.factionId,
        reasons: triggerRes.reasons,
        immediateConsequences: triggerRes.consequences,
        choices,
        durationTurns: dur,
      });
      summary.push(`[CHAIN] ${inst.title}`);
      newEventHistory.push({
        id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        turn,
        typeId: def.typeId,
        kind: 'chain',
        severity,
        territoryId: ch.territoryId,
        factionId: ch.factionId,
        title: inst.title,
        message: `Triggered by event chain: ${applied.join('; ')}`,
      });
      if (choices.length > 0 && inst.status === 'active') {
        unresolvedDecisions.push({
          active: inst,
          choices,
          territoryId: ch.territoryId,
          factionId: ch.factionId,
        });
      }
    }

    // ────────────────────────────────────────────
    // PHASE 3: World conditions → candidate territories → triggers
    // ────────────────────────────────────────────
    const candidates = candidateTerritoriesForEvents(terr, newActiveEvents);
    const eventsThisTurnCap = BW.maxEventsPerTurn;
    const triggeredNow: TriggeredEvent[] = [];

    // Shuffle candidates deterministically
    const shuffled = candidates.length > 0
      ? rng.fork(2000 + turn * 13).shuffle(candidates)
      : candidates;

    for (const tid of shuffled) {
      if (triggeredNow.length >= eventsThisTurnCap) break;
      const t = terr.get(tid);
      if (!t) continue;
      const factionId = t.owner;
      const ctx = this._buildCtx(turn, tid, factionId, terr, facts, newActiveEvents, rng.fork(2001 + turn * 17 + candidates.indexOf(tid)));
      const scored = evaluateAllTriggersForTerritory(ctx);
      if (scored.length === 0) continue;
      const items = scored.map(s => ({ value: s, weight: s.weight }));
      const chosen = ctx.rng.weightedPick(items);
      const def = EVENT_REGISTRY[chosen.eventId];
      if (!def) continue;
      const owned = !!factionId && facts.has(factionId);
      if (!owned && def.target === 'faction') continue;

      // Cooldown: don't repeatedly trigger the same typeId on same territory soon
      if (tid) {
        const historyRecent = newEventHistory.filter(h => h.territoryId === tid && h.typeId === def.typeId && (turn - h.turn) < BW.sameEventCooldownTurns);
        if (historyRecent.length > 0) continue;
      }

      const severity = pickSeverityFromTable(def.severityTable.length > 0 ? def.severityTable : buildDefaultSeverityTable(),
        ctx.rng.fork(3000 + turn + chosen.eventId.length), chosen.severityHint);
      const dur = def.isInstant ? 1 : ctx.rng.nextInt(def.defaultDuration.min, def.defaultDuration.max);
      const triggerRes = def.onTrigger(ctx, severity);
      const choices: ImperialChoice[] = def.choices ? def.choices(ctx, severity) : [];
      const worldSnapshot = { territories: terr };
      const inst: ActiveEvent = {
        instanceId: nextInstanceId(),
        typeId: def.typeId,
        category: def.category,
        title: def.titleTemplate(severity, tid, worldSnapshot),
        description: def.descriptionTemplate(severity, ctx),
        causes: [...def.causes, ...triggerRes.reasons, ...chosen.reasons],
        severity,
        status: def.isInstant ? 'resolved' : 'active',
        territoryId: tid,
        factionId,
        triggeredTurn: turn,
        durationTurns: dur,
        startedTurn: turn,
        expiresTurn: turn + dur,
        consequences: triggerRes.consequences,
        chainSuppressed: false,
        chainDelays: this._seedChainDelays(def, null, severity, ctx.rng.fork(4000 + turn * 3)),
        choicesPending: choices,
      };
      triggeredNow.push({
        definition: def,
        severity,
        territoryId: tid,
        factionId,
        reasons: triggerRes.reasons,
        immediateConsequences: triggerRes.consequences,
        choices,
        durationTurns: dur,
      });
      const applied = this.applier.applyMany(triggerRes.consequences);
      newActiveEvents.push(inst);
      triggeredEvents.push(triggeredNow[triggeredNow.length - 1]);
      summary.push(`[EVENT] ${inst.title}`);
      newEventHistory.push({
        id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        turn,
        typeId: def.typeId,
        kind: 'trigger',
        severity,
        territoryId: tid,
        factionId,
        title: inst.title,
        message: `${triggerRes.reasons.join('; ')} → ${applied.join('; ')}`,
        detail: { causes: inst.causes },
      });
      if (choices.length > 0 && inst.status === 'active') {
        unresolvedDecisions.push({
          active: inst,
          choices,
          territoryId: tid,
          factionId,
        });
      }
    }

    // ────────────────────────────────────────────
    // PHASE 4: Expire/resolve old events
    // ────────────────────────────────────────────
    for (const ev of newActiveEvents) {
      if (ev.status !== 'active') continue;
      if (turn >= ev.expiresTurn) {
        ev.status = 'expired';
        expiredEvents.push(ev);
        summary.push(`[EXPIRED] ${ev.title}`);
        newEventHistory.push({
          id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          turn,
          typeId: ev.typeId,
          kind: 'expire',
          severity: ev.severity,
          territoryId: ev.territoryId,
          factionId: ev.factionId,
          title: ev.title,
          message: `Event expired after ${ev.durationTurns} turns`,
        });
      }
    }

    return {
      newActiveEvents,
      newEventHistory,
      triggeredEvents,
      perTurnConsequences,
      expiredEvents,
      unresolvedDecisions,
      summary,
      mutatedTerritories: this.applier.territories,
      mutatedFactions: this.applier.factions,
    };
  }

  private _seedChainDelays(
    def: EventDefinition,
    _parent: ActiveEvent | null,
    severity: EventSeverity,
    rng: SeededRNG,
  ): ActiveEvent['chainDelays'] {
    if (!def.canChainFrom || def.canChainFrom.length === 0) return [];
    return def.canChainFrom
      .filter(cd => !cd.requireSeverityAtLeast || severityAtLeast(severity, cd.requireSeverityAtLeast!))
      .map(cd => ({
        toEventId: cd.toEventId,
        delayRemaining: cd.delayMinTurns + rng.nextInt(0, 2),
        probability: cd.baseProb,
        severity,
      }));
  }

  private _buildCtx(
    turn: number,
    territoryId: TerritoryId | null,
    factionId: FactionId | null,
    territories: Map<TerritoryId, Territory>,
    factions: Map<FactionId, WarlordSnapshot>,
    activeEvents: ActiveEvent[],
    rng: SeededRNG,
  ): ConditionContext {
    return buildConditionContext(turn, territoryId, factionId, territories, factions, activeEvents, rng);
  }

  resolveChoice(
    input: WorldStepInput & { activeEventInstanceId: string; choiceId: string },
  ): {
    updatedActive: ActiveEvent[];
    updatedHistory: HistoryEntry[];
    mutatedTerritories: Map<TerritoryId, Territory>;
    mutatedFactions: Map<FactionId, WarlordSnapshot>;
    messages: string[];
    paidCost: Partial<Resources> | undefined;
    choiceTakenMessage: string;
  } {
    const rng = new SeededRNG(input.seed ^ BW.rngSalt ^ input.activeEventInstanceId.length);
    const terr = cloneMap(input.territories, cloneTerritory);
    const facts = cloneMap(input.factions, cloneWarlordSnapshot);
    const applier = new ConsequenceApplier(terr, facts);
    const activeEvents = [...input.activeEvents];
    const newHistory = [...input.eventHistory];
    const messages: string[] = [];

    const ev = activeEvents.find(e => e.instanceId === input.activeEventInstanceId);
    if (!ev) return {
      updatedActive: activeEvents,
      updatedHistory: newHistory,
      mutatedTerritories: terr,
      mutatedFactions: facts,
      messages: ['Event not found'],
      paidCost: undefined,
      choiceTakenMessage: '',
    };

    const def = getEventById(ev.typeId === 'drought' ? 'evt_drought'
      : ev.typeId === 'flood' ? 'evt_flood'
      : ev.typeId === 'storm' ? 'evt_storm'
      : ev.typeId === 'harsh_winter' ? 'evt_harsh_winter'
      : ev.typeId === 'resource_discovery' ? 'evt_resource_discovery'
      : ev.typeId === 'food_shortage' ? 'evt_food_shortage'
      : ev.typeId === 'famine' ? 'evt_famine'
      : ev.typeId === 'prosperity' ? 'evt_prosperity'
      : ev.typeId === 'trade_boom' ? 'evt_trade_boom'
      : ev.typeId === 'unrest' ? 'evt_unrest'
      : ev.typeId === 'rebellion' ? 'evt_rebellion'
      : ev.typeId === 'border_tension' ? 'evt_border_tension'
      : '');
    const choice = ev.choicesPending.find(c => c.id === input.choiceId);
    if (!def || !choice) return {
      updatedActive: activeEvents,
      updatedHistory: newHistory,
      mutatedTerritories: terr,
      mutatedFactions: facts,
      messages: ['Invalid choice or unknown definition'],
      paidCost: undefined,
      choiceTakenMessage: '',
    };

    const factionId = ev.factionId ?? (ev.territoryId ? terr.get(ev.territoryId)?.owner ?? null : null);
    let paidCost: Partial<Resources> | undefined = undefined;
    let choiceTakenMessage = '';
    let consequences: ConsequenceDelta[] = [];
    let suppressChains = false;
    let shortenDurationBy = 0;

    if (factionId) {
      if (applier.canAfford(choice.cost, factionId)) {
        applier.payCost(choice.cost, factionId);
        paidCost = choice.cost;
      } else {
        messages.push(`Cannot afford cost: ${JSON.stringify(choice.cost)}`);
      }
    }

    if (def.resolveChoice) {
      const ctx = this._buildCtx(input.turn, ev.territoryId, ev.factionId, terr, facts, activeEvents, rng);
      const res = def.resolveChoice(input.choiceId, ctx, ev.severity, ev);
      choiceTakenMessage = res.choiceTakenMessage;
      consequences = res.consequences;
      suppressChains = !!res.suppressChains;
      shortenDurationBy = res.shortenDurationBy ?? 0;
    } else {
      choiceTakenMessage = `Choice "${choice.label}" applied without specific resolution logic.`;
    }

    const applied = applier.applyMany(consequences);
    messages.push(choiceTakenMessage, ...applied);
    ev.choiceTaken = { id: input.choiceId, turn: input.turn, message: choiceTakenMessage, consequences };
    ev.choicesPending = [];
    if (suppressChains) ev.chainSuppressed = true;
    if (shortenDurationBy > 0) {
      ev.expiresTurn = Math.max(ev.startedTurn + 1, ev.expiresTurn - shortenDurationBy);
      ev.durationTurns = ev.expiresTurn - ev.startedTurn;
    }

    newHistory.push({
      id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      turn: input.turn,
      typeId: ev.typeId,
      kind: 'choice',
      severity: ev.severity,
      territoryId: ev.territoryId,
      factionId,
      title: ev.title,
      message: `${choice.label}: ${choiceTakenMessage} → ${applied.join('; ')}`,
      detail: { choiceId: input.choiceId, paidCost },
    });

    return {
      updatedActive: activeEvents,
      updatedHistory: newHistory,
      mutatedTerritories: applier.territories,
      mutatedFactions: applier.factions,
      messages,
      paidCost,
      choiceTakenMessage,
    };
  }
}
