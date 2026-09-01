"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorldSimulator = exports.ConsequenceApplier = void 0;
const balance_1 = require("../constants/balance");
const SeededRNG_1 = require("../utils/SeededRNG");
const EventModel_1 = require("./EventModel");
const EventTriggers_1 = require("./EventTriggers");
const EventDefinitions_1 = require("./EventDefinitions");
const BW = balance_1.BALANCE.events.world;
const BDEF = balance_1.BALANCE.events.defaultEventDuration;
const BN = balance_1.BALANCE.events.chain;
function cloneTerritory(t) {
    return {
        ...t,
        neighboring: [...t.neighboring],
        resourceOutput: { ...t.resourceOutput },
    };
}
function cloneWarlordSnapshot(f) {
    const diplomacy = new Map();
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
function cloneMap(m, cloneFn) {
    const out = new Map();
    for (const [k, v] of m.entries())
        out.set(k, cloneFn(v));
    return out;
}
class ConsequenceApplier {
    constructor(territories, factions) {
        this.territories = cloneMap(territories, cloneTerritory);
        this.factions = cloneMap(factions, cloneWarlordSnapshot);
        this.applied = [];
    }
    applyDelta(c) {
        const d = c.delta;
        // Territory deltas
        if (c.territoryId) {
            const t = this.territories.get(c.territoryId);
            if (t) {
                if (d.populationDeltaAbs)
                    t.population = Math.max(0, t.population + d.populationDeltaAbs);
                if (d.populationDeltaPct)
                    t.population = Math.max(0, Math.round(t.population * (1 + d.populationDeltaPct)));
                if (d.garrisonDeltaAbs)
                    t.garrison = Math.max(0, t.garrison + d.garrisonDeltaAbs);
                if (d.resourceOutputPct) {
                    const newOut = { ...t.resourceOutput };
                    for (const k of Object.keys(d.resourceOutputPct)) {
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
                if (d.stabilityDelta)
                    f.stability = Math.max(0, Math.min(100, f.stability + d.stabilityDelta));
                if (d.resources) {
                    for (const k of Object.keys(d.resources)) {
                        f.resources[k] = Math.max(0, (f.resources[k] ?? 0) + (d.resources[k] ?? 0));
                    }
                }
                if (d.resourceOutputPct) {
                    const newIncome = { ...f.resourceIncome };
                    for (const k of Object.keys(d.resourceOutputPct)) {
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
                    if (rel)
                        rel.opinion = Math.max(-100, Math.min(100, rel.opinion + d.relationshipDeltaOpinion.delta));
                }
            }
        }
        this.applied.push(c.message);
        return c.message;
    }
    applyMany(cs) {
        const out = [];
        for (const c of cs) {
            const r = this.applyDelta(c);
            if (r)
                out.push(r);
        }
        return out;
    }
    canAfford(cost, factionId) {
        if (!cost)
            return true;
        const f = this.factions.get(factionId);
        if (!f)
            return false;
        for (const k of Object.keys(cost)) {
            if ((f.resources[k] ?? 0) < (cost[k] ?? 0))
                return false;
        }
        return true;
    }
    payCost(cost, factionId) {
        if (!cost)
            return;
        const f = this.factions.get(factionId);
        if (!f)
            return;
        for (const k of Object.keys(cost)) {
            f.resources[k] = Math.max(0, (f.resources[k] ?? 0) - (cost[k] ?? 0));
        }
    }
}
exports.ConsequenceApplier = ConsequenceApplier;
function makeInstanceCounter() {
    let n = 0;
    return () => `inst_${Date.now().toString(36)}_${(n++).toString(36)}`;
}
class WorldSimulator {
    constructor() {
        this.applier = null;
    }
    simulate(input) {
        const turn = input.turn;
        const rng = new SeededRNG_1.SeededRNG(input.seed ^ BW.rngSalt);
        const newActiveEvents = [...input.activeEvents];
        const newEventHistory = [...input.eventHistory];
        const triggeredEvents = [];
        const perTurnConsequences = [];
        const expiredEvents = [];
        const summary = [];
        const unresolvedDecisions = [];
        const terr = cloneMap(input.territories, cloneTerritory);
        const facts = cloneMap(input.factions, cloneWarlordSnapshot);
        this.applier = new ConsequenceApplier(terr, facts);
        const nextInstanceId = makeInstanceCounter();
        // ────────────────────────────────────────────
        // PHASE 1: Apply per-turn effects of active events + decrement chains
        // ────────────────────────────────────────────
        for (const ev of newActiveEvents) {
            if (ev.status !== 'active')
                continue;
            const def = (0, EventDefinitions_1.getEventById)(ev.typeId === 'drought' ? 'evt_drought'
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
                                                            : '') || EventDefinitions_1.EVENT_LIST[0];
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
                for (const c of cs)
                    perTurnConsequences.push(c);
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
                if (cd.delayRemaining > 0)
                    cd.delayRemaining--;
            }
        }
        // ────────────────────────────────────────────
        // PHASE 2: Process chains (eligible chain candidates now delay=0)
        // ────────────────────────────────────────────
        const chainTriggered = [];
        for (const ev of newActiveEvents) {
            if (ev.status !== 'active')
                continue;
            if (ev.chainSuppressed)
                continue;
            for (const cd of ev.chainDelays) {
                if (cd.delayRemaining > 0)
                    continue;
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
            const def = EventDefinitions_1.EVENT_REGISTRY[ch.toEventId];
            if (!def)
                continue;
            const ctx = this._buildCtx(turn, ch.territoryId, ch.factionId, terr, facts, newActiveEvents, rng.fork(500 + turn * 5));
            const severity = ch.severity;
            const dur = def.isInstant ? 1 : rng.fork(600 + turn).nextInt(def.defaultDuration.min, def.defaultDuration.max);
            const triggerRes = def.onTrigger(ctx, severity);
            const choices = def.choices ? def.choices(ctx, severity) : [];
            const worldSnapshot = { territories: terr };
            const inst = {
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
        const candidates = (0, EventTriggers_1.candidateTerritoriesForEvents)(terr, newActiveEvents);
        const eventsThisTurnCap = BW.maxEventsPerTurn;
        const triggeredNow = [];
        // Shuffle candidates deterministically
        const shuffled = candidates.length > 0
            ? rng.fork(2000 + turn * 13).shuffle(candidates)
            : candidates;
        for (const tid of shuffled) {
            if (triggeredNow.length >= eventsThisTurnCap)
                break;
            const t = terr.get(tid);
            if (!t)
                continue;
            const factionId = t.owner;
            const ctx = this._buildCtx(turn, tid, factionId, terr, facts, newActiveEvents, rng.fork(2001 + turn * 17 + candidates.indexOf(tid)));
            const scored = (0, EventDefinitions_1.evaluateAllTriggersForTerritory)(ctx);
            if (scored.length === 0)
                continue;
            const items = scored.map(s => ({ value: s, weight: s.weight }));
            const chosen = ctx.rng.weightedPick(items);
            const def = EventDefinitions_1.EVENT_REGISTRY[chosen.eventId];
            if (!def)
                continue;
            const owned = !!factionId && facts.has(factionId);
            if (!owned && def.target === 'faction')
                continue;
            // Cooldown: don't repeatedly trigger the same typeId on same territory soon
            if (tid) {
                const historyRecent = newEventHistory.filter(h => h.territoryId === tid && h.typeId === def.typeId && (turn - h.turn) < BW.sameEventCooldownTurns);
                if (historyRecent.length > 0)
                    continue;
            }
            const severity = (0, EventModel_1.pickSeverityFromTable)(def.severityTable.length > 0 ? def.severityTable : (0, EventModel_1.buildDefaultSeverityTable)(), ctx.rng.fork(3000 + turn + chosen.eventId.length), chosen.severityHint);
            const dur = def.isInstant ? 1 : ctx.rng.nextInt(def.defaultDuration.min, def.defaultDuration.max);
            const triggerRes = def.onTrigger(ctx, severity);
            const choices = def.choices ? def.choices(ctx, severity) : [];
            const worldSnapshot = { territories: terr };
            const inst = {
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
            if (ev.status !== 'active')
                continue;
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
    _seedChainDelays(def, _parent, severity, rng) {
        if (!def.canChainFrom || def.canChainFrom.length === 0)
            return [];
        return def.canChainFrom
            .filter(cd => !cd.requireSeverityAtLeast || (0, EventModel_1.severityAtLeast)(severity, cd.requireSeverityAtLeast))
            .map(cd => ({
            toEventId: cd.toEventId,
            delayRemaining: cd.delayMinTurns + rng.nextInt(0, 2),
            probability: cd.baseProb,
            severity,
        }));
    }
    _buildCtx(turn, territoryId, factionId, territories, factions, activeEvents, rng) {
        return (0, EventTriggers_1.buildConditionContext)(turn, territoryId, factionId, territories, factions, activeEvents, rng);
    }
    resolveChoice(input) {
        const rng = new SeededRNG_1.SeededRNG(input.seed ^ BW.rngSalt ^ input.activeEventInstanceId.length);
        const terr = cloneMap(input.territories, cloneTerritory);
        const facts = cloneMap(input.factions, cloneWarlordSnapshot);
        const applier = new ConsequenceApplier(terr, facts);
        const activeEvents = [...input.activeEvents];
        const newHistory = [...input.eventHistory];
        const messages = [];
        const ev = activeEvents.find(e => e.instanceId === input.activeEventInstanceId);
        if (!ev)
            return {
                updatedActive: activeEvents,
                updatedHistory: newHistory,
                mutatedTerritories: terr,
                mutatedFactions: facts,
                messages: ['Event not found'],
                paidCost: undefined,
                choiceTakenMessage: '',
            };
        const def = (0, EventDefinitions_1.getEventById)(ev.typeId === 'drought' ? 'evt_drought'
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
        if (!def || !choice)
            return {
                updatedActive: activeEvents,
                updatedHistory: newHistory,
                mutatedTerritories: terr,
                mutatedFactions: facts,
                messages: ['Invalid choice or unknown definition'],
                paidCost: undefined,
                choiceTakenMessage: '',
            };
        const factionId = ev.factionId ?? (ev.territoryId ? terr.get(ev.territoryId)?.owner ?? null : null);
        let paidCost = undefined;
        let choiceTakenMessage = '';
        let consequences = [];
        let suppressChains = false;
        let shortenDurationBy = 0;
        if (factionId) {
            if (applier.canAfford(choice.cost, factionId)) {
                applier.payCost(choice.cost, factionId);
                paidCost = choice.cost;
            }
            else {
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
        }
        else {
            choiceTakenMessage = `Choice "${choice.label}" applied without specific resolution logic.`;
        }
        const applied = applier.applyMany(consequences);
        messages.push(choiceTakenMessage, ...applied);
        ev.choiceTaken = { id: input.choiceId, turn: input.turn, message: choiceTakenMessage, consequences };
        ev.choicesPending = [];
        if (suppressChains)
            ev.chainSuppressed = true;
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
exports.WorldSimulator = WorldSimulator;
//# sourceMappingURL=WorldSimulator.js.map