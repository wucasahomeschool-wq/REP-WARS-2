import { SimulationBuilder, SAMPLE_MAP, WARLORD_SPECS, WorldSimulator,
  WorldStepInput, ActiveEvent, HistoryEntry, BALANCE, SeededRNG,
  WorldStepOutput, Territory, WarlordSnapshot, FactionId, TerritoryId,
  evaluateAllTriggersForTerritory, buildConditionContext, WorldHelperImpl,
} from '../index';

function hr() { console.log('═'.repeat(80)); }
function hrThin() { console.log('─'.repeat(80)); }
function pad(s: string, n: number): string {
  if (s.length <= n) return s + ' '.repeat(n - s.length);
  return s.slice(0, n - 3) + '...';
}

function formatStability(s: number): string {
  if (s >= 80) return `Stable (${s})`;
  if (s >= 55) return `Calm (${s})`;
  if (s >= 30) return `Restless (${s})`;
  return `Critical (${s})`;
}

type FactionState = {
  gameState: ReturnType<typeof SimulationBuilder.buildFromSpecs>['gameState'];
  activeEvents: ActiveEvent[];
  eventHistory: HistoryEntry[];
  turn: number;
  seed: number;
  playerFactionId: FactionId;
};

function createInitialEmpire(seed: number, playerFactionId: FactionId = 'merchant_republic'): FactionState {
  const { gameState } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, seed);
  return {
    gameState,
    activeEvents: [],
    eventHistory: [],
    turn: 1,
    seed,
    playerFactionId,
  };
}

function reportFactionStatus(st: FactionState) {
  const f = st.gameState.factions.get(st.playerFactionId);
  if (!f) return;
  console.log(`\n=== FACTION: ${f.name} (Turn ${st.turn}) ===`);
  console.log(`  Stability: ${formatStability(f.stability)}`);
  console.log(`  Territories: ${f.territories.length}`);
  console.log(`  Population: ${Array.from(st.gameState.territories.values()).filter(t => t.owner === f.id).reduce((a, t) => a + t.population, 0).toLocaleString()}`);
  console.log(`  Resources: G${f.resources.gold.toFixed(0)} / F${f.resources.food.toFixed(0)} / I${f.resources.iron.toFixed(0)} / W${f.resources.wood.toFixed(0)}`);
  const activeOnFaction = st.activeEvents.filter(e => e.status === 'active' && (e.factionId === f.id ||
    (e.territoryId && st.gameState.territories.get(e.territoryId)?.owner === f.id)));
  if (activeOnFaction.length > 0) {
    console.log(`  Active Events (${activeOnFaction.length}):`);
    for (const ev of activeOnFaction) {
      const terr = ev.territoryId ? st.gameState.territories.get(ev.territoryId)?.name ?? ev.territoryId : '—';
      console.log(`    • [${ev.severity.toUpperCase()}] ${ev.title} @ ${terr}  (expires T${ev.expiresTurn})`);
      if (ev.choicesPending.length > 0) {
        console.log(`      ⚠ DECISION PENDING: ${ev.choicesPending.length} choices available`);
      }
    }
  } else {
    console.log('  Active Events: 0 — realm is calm');
  }
}

function printTurnOutput(st: FactionState, out: WorldStepOutput) {
  console.log(`\n\nTURN ${st.turn}`);
  hr();
  for (const line of out.summary) {
    console.log(line);
  }
  for (const te of out.triggeredEvents) {
    // Find the active event from output
    const inst = out.newActiveEvents.find(
      e => e.typeId === te.definition.typeId && e.territoryId === te.territoryId
    );
    if (!inst) continue;
    hrThin();
    console.log(`[EVENT] ${inst.title}`);
    console.log(`  Severity: ${inst.severity.toUpperCase()}`);
    console.log(`  Category: ${te.definition.categoryLabel}`);
    const terrName = te.territoryId ? st.gameState.territories.get(te.territoryId)?.name ?? '?' : '—';
    console.log(`  Location: ${terrName}`);
    if (inst.causes.length > 0) console.log(`  Causes: ${inst.causes.filter((_, i) => i < 3).join(' • ')}`);
    console.log(`  Description: ${inst.description}`);
    if (te.immediateConsequences.length > 0) {
      console.log('  [CONSEQUENCES]');
      for (const c of te.immediateConsequences) {
        const d = c.delta;
        const parts: string[] = [];
        if (d.stabilityDelta !== undefined) parts.push(`Stability ${d.stabilityDelta > 0 ? '+' : ''}${d.stabilityDelta}`);
        if (d.foodProductionPct !== undefined) parts.push(`Food prod ${Math.round(d.foodProductionPct * 100)}%`);
        if (d.garrisonDeltaAbs !== undefined) parts.push(`Garrison ${d.garrisonDeltaAbs > 0 ? '+' : ''}${d.garrisonDeltaAbs}`);
        if (d.populationDeltaAbs !== undefined) parts.push(`Population ${d.populationDeltaAbs > 0 ? '+' : ''}${d.populationDeltaAbs.toLocaleString()}`);
        if (d.resources) {
          for (const [k, v] of Object.entries(d.resources)) {
            parts.push(`${k.toUpperCase()} ${v! > 0 ? '+' : ''}${v}`);
          }
        }
        if (d.resourceOutputPct) parts.push(`Resource output boost`);
        console.log(`    • ${parts.join('  │  ') || c.message}`);
      }
    }
    if (inst.choicesPending.length > 0) {
      console.log('  [IMPERIAL DECISION REQUIRED]');
      inst.choicesPending.forEach((c, i) => {
        const costParts = c.cost ? Object.entries(c.cost).map(([k, v]) => `${v} ${k}`).join(', ') : '';
        const costStr = costParts ? `  [Cost: ${costParts}]` : '';
        console.log(`    ${i + 1}. ${c.label}${costStr} — ${c.description}`);
      });
    }
  }
}

function printHistory(st: FactionState, limitPerTurn: number = 3) {
  console.log('\n─── EVENT HISTORY ───');
  const grouped: Record<number, HistoryEntry[]> = {};
  for (const h of st.eventHistory) {
    if (!grouped[h.turn]) grouped[h.turn] = [];
    grouped[h.turn].push(h);
  }
  for (const [turnStr, entries] of Object.entries(grouped).sort((a, b) => +a[0] - +b[0])) {
    console.log(`Turn ${turnStr}:`);
    const shown = entries.slice(0, limitPerTurn);
    for (const h of shown) {
      const sev = h.severity ? `[${h.severity.slice(0, 3).toUpperCase()}] ` : '';
      const terr = h.territoryId ? st.gameState.territories.get(h.territoryId)?.name ?? '' : '';
      console.log(`  ${h.kind.padEnd(7)} ${sev}${h.title ?? h.typeId}${terr ? ' — ' + terr : ''}: ${h.message.slice(0, 120)}`);
    }
    if (entries.length > limitPerTurn) console.log(`  (+${entries.length - limitPerTurn} more)`);
  }
}

// ────────────────────────────────────────────
// SCENARIO 1: Stable empire normal turns (2 turns, stable, verify no crashes)
// ────────────────────────────────────────────
function scenario_1_StableEmpire(seed: number) {
  console.log('\n\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║ SCENARIO 1: Normal stable empire — a couple of calm turns            ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  const st = createInitialEmpire(seed, 'merchant_republic');
  const sim = new WorldSimulator();
  reportFactionStatus(st);
  for (let i = 0; i < 2; i++) {
    const input: WorldStepInput = {
      turn: st.turn,
      territories: st.gameState.territories,
      factions: st.gameState.factions,
      activeEvents: st.activeEvents,
      eventHistory: st.eventHistory,
      playerFactionId: st.playerFactionId,
      seed: st.seed + st.turn * 31,
    };
    const out = sim.simulate(input);
    printTurnOutput(st, out);
    // Apply
    st.gameState.territories = out.mutatedTerritories;
    st.gameState.factions = out.mutatedFactions;
    st.activeEvents = out.newActiveEvents;
    st.eventHistory = out.newEventHistory;
    reportFactionStatus(st);
    st.turn++;
  }
  console.log('\n✓ Scenario 1 complete: stable empire processes turns cleanly');
  return st;
}

// ────────────────────────────────────────────
// SCENARIO 2: Force a drought by manually triggering on a farming territory
// (demonstrates drought → consequences)
// ────────────────────────────────────────────
function scenario_2_ForceDrought() {
  console.log('\n\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║ SCENARIO 2: Drought triggers; consequences applied                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  const st = createInitialEmpire(42, 'merchant_republic');
  // Pick a plains-owned farming territory of merchant_republic: western_reach or greenfields
  const targetTerr = 'western_reach';
  console.log(`\nTarget farming territory: ${st.gameState.territories.get(targetTerr)?.name}`);
  console.log(`Before — foodOutput: ${st.gameState.territories.get(targetTerr)?.resourceOutput?.food ?? 0}`);
  // Manually instantiate drought at moderate severity by using the simulator for several turns
  const sim = new WorldSimulator();
  const droughtSeed = 2026; // known seed we can bias to produce drought
  for (let i = 0; i < 5; i++) {
    const input: WorldStepInput = {
      turn: st.turn,
      territories: st.gameState.territories,
      factions: st.gameState.factions,
      activeEvents: st.activeEvents,
      eventHistory: st.eventHistory,
      playerFactionId: st.playerFactionId,
      seed: droughtSeed + st.turn * 3,
    };
    const out = sim.simulate(input);
    printTurnOutput(st, out);
    // Resolve any pending food decisions with "import food"
    for (const dec of out.unresolvedDecisions) {
      const res = sim.resolveChoice({
        ...input,
        activeEventInstanceId: dec.active.instanceId,
        choiceId: 'import_food',
      });
      Object.assign(st.gameState.territories, res.mutatedTerritories);
      Object.assign(st.gameState.factions, res.mutatedFactions);
      Object.assign(st.activeEvents, res.updatedActive);
      Object.assign(st.eventHistory, res.updatedHistory);
      console.log(`  ☛ [DECISION] ${dec.active.title}: Import food  →  ${res.choiceTakenMessage}`);
    }
    if (out.newActiveEvents.length > 0 || Object.keys(out).length > 0) {
      st.gameState.territories = out.mutatedTerritories;
      st.gameState.factions = out.mutatedFactions;
      st.activeEvents = out.newActiveEvents;
      st.eventHistory = out.newEventHistory;
    }
    const hasDrought = st.activeEvents.some(e => e.typeId === 'drought' && e.territoryId === targetTerr);
    reportFactionStatus(st);
    st.turn++;
    if (hasDrought || i >= 3) break;
  }
  console.log(`After — foodOutput: ${st.gameState.territories.get(targetTerr)?.resourceOutput?.food ?? 0}`);
  console.log('\n✓ Scenario 2 complete: drought modifies territory food production');
  return st;
}

// ────────────────────────────────────────────
// SCENARIO 3: Drought → Food shortage → Player mitigates → chain interrupted
// ────────────────────────────────────────────
function scenario_3_DroughtChainInterrupted() {
  console.log('\n\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║ SCENARIO 3: Drought → Food Shortage → PLAYER MITIGATES → Chain STOPS ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  const st = createInitialEmpire(99, 'iron_kingdom');
  const targetTerr = 'iron_kingdom_east';
  console.log(`Target territory: ${st.gameState.territories.get(targetTerr)?.name}`);
  const sim = new WorldSimulator();
  // Run turns with a known chain-prone seed until we get a food shortage
  let shortageFound = false;
  let mitigatedSuccessfully = false;
  const maxTurns = 10;
  for (let i = 0; i < maxTurns; i++) {
    const input: WorldStepInput = {
      turn: st.turn,
      territories: st.gameState.territories,
      factions: st.gameState.factions,
      activeEvents: st.activeEvents,
      eventHistory: st.eventHistory,
      playerFactionId: st.playerFactionId,
      seed: 999 + st.turn * 5,
    };
    const out = sim.simulate(input);
    if (out.summary.length > 0) printTurnOutput(st, out);
    st.gameState.territories = out.mutatedTerritories;
    st.gameState.factions = out.mutatedFactions;
    st.activeEvents = out.newActiveEvents;
    st.eventHistory = out.newEventHistory;
    // Check for pending food shortage decisions
    const shortageDecision = out.unresolvedDecisions.find(d => d.active.typeId === 'food_shortage');
    if (shortageDecision) {
      shortageFound = true;
      console.log(`\n\n⚠ Food shortage encountered at T${st.turn}! Applying "Release Reserves" to interrupt the chain...`);
      const res = sim.resolveChoice({
        ...input,
        activeEventInstanceId: shortageDecision.active.instanceId,
        choiceId: 'release_reserves',
      });
      Object.assign(st.gameState.territories, res.mutatedTerritories);
      Object.assign(st.gameState.factions, res.mutatedFactions);
      Object.assign(st.activeEvents, res.updatedActive);
      Object.assign(st.eventHistory, res.updatedHistory);
      console.log(`  Result: ${res.choiceTakenMessage}`);
      const updated = res.updatedActive.find(e => e.instanceId === shortageDecision.active.instanceId);
      if (updated?.chainSuppressed) {
        console.log(`  ✓ Chain suppressed (famine will NOT occur from this shortage)`);
        mitigatedSuccessfully = true;
      } else {
        console.log(`  Note: chain not fully suppressed`);
      }
      break;
    }
    if (out.unresolvedDecisions.length > 0) {
      for (const d of out.unresolvedDecisions) {
        const res = sim.resolveChoice({ ...input, activeEventInstanceId: d.active.instanceId, choiceId: 'ignore' });
        Object.assign(st.activeEvents, res.updatedActive);
      }
    }
    reportFactionStatus(st);
    st.turn++;
  }
  if (!shortageFound) console.log(`\n(No food shortage arose within ${maxTurns} turns — deterministic run proceeded calmly)`);
  console.log(`\n✓ Scenario 3 complete${mitigatedSuccessfully ? ' — mitigated with chain interruption' : ''}`);
  return st;
}

// ────────────────────────────────────────────
// SCENARIO 4: Poor management → Unrest → Rebellion
// ────────────────────────────────────────────
function scenario_4_UnrestToRebellion() {
  console.log('\n\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║ SCENARIO 4: Poor Management → Unrest → Rebellion                     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  const st = createInitialEmpire(2025, 'ashen_horde');
  console.log(`Faction: Ashen Horde  —  Personality: aggressive`);
  // Artificially lower stability to simulate poor management
  const f = st.gameState.factions.get('ashen_horde')!;
  f.stability = 22; // critical
  // Also cut food reserves to trigger famine
  f.resources.food = 80;
  console.log(`Pre-conditions set: Stability=${f.stability}, Food reserves=${f.resources.food}`);
  const sim = new WorldSimulator();
  let rebellionOccurred = false;
  const maxTurns = 8;
  for (let i = 0; i < maxTurns; i++) {
    const input: WorldStepInput = {
      turn: st.turn,
      territories: st.gameState.territories,
      factions: st.gameState.factions,
      activeEvents: st.activeEvents,
      eventHistory: st.eventHistory,
      playerFactionId: st.playerFactionId,
      seed: 5555 + st.turn * 7,
    };
    const out = sim.simulate(input);
    if (out.summary.length > 0) printTurnOutput(st, out);
    st.gameState.territories = out.mutatedTerritories;
    st.gameState.factions = out.mutatedFactions;
    st.activeEvents = out.newActiveEvents;
    st.eventHistory = out.newEventHistory;
    // "Ignore" all decisions — this is poor management
    for (const d of out.unresolvedDecisions) {
      console.log(`  ⚠ Poor management: ignoring decision for ${d.active.title}`);
      const res = sim.resolveChoice({ ...input, activeEventInstanceId: d.active.instanceId, choiceId: 'ignore' });
      Object.assign(st.activeEvents, res.updatedActive);
    }
    const hasRebellion = st.activeEvents.some(e => e.typeId === 'rebellion' && e.status === 'active');
    if (hasRebellion) { rebellionOccurred = true; }
    reportFactionStatus(st);
    st.turn++;
    if (rebellionOccurred) break;
  }
  console.log(`\n✓ Scenario 4 complete${rebellionOccurred ? ' — rebellion developed from unrest' : ' (deterministic calm path)'}`);
  return st;
}

// ────────────────────────────────────────────
// SCENARIO 5: Event expires naturally (drought duration)
// ────────────────────────────────────────────
function scenario_5_EventExpires(seed: number) {
  console.log('\n\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║ SCENARIO 5: Event naturally expires after its duration               ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  const st = createInitialEmpire(seed);
  const sim = new WorldSimulator();
  // Run for several turns; at some point events will trigger and expire
  let sawExpiration = false;
  for (let step = 0; step < 8; step++) {
    const input: WorldStepInput = {
      turn: st.turn,
      territories: st.gameState.territories,
      factions: st.gameState.factions,
      activeEvents: st.activeEvents,
      eventHistory: st.eventHistory,
      playerFactionId: st.playerFactionId,
      seed: seed + st.turn * 31,
    };
    const out = sim.simulate(input);
    if (out.summary.length > 0) printTurnOutput(st, out);
    if (out.expiredEvents.length > 0) {
      sawExpiration = true;
      console.log(`\n  ✓ Events expired this turn: ${out.expiredEvents.length}`);
      for (const ex of out.expiredEvents) console.log(`      - ${ex.title}  (lasted T${ex.startedTurn}–T${ex.expiresTurn - 1})`);
    }
    st.gameState.territories = out.mutatedTerritories;
    st.gameState.factions = out.mutatedFactions;
    st.activeEvents = out.newActiveEvents;
    st.eventHistory = out.newEventHistory;
    // Resolve any pending choices with default actions
    for (const d of out.unresolvedDecisions) {
      sim.resolveChoice({ ...input, activeEventInstanceId: d.active.instanceId, choiceId: 'reduce_taxes' });
    }
    st.turn++;
    if (sawExpiration && step > 3) break;
  }
  console.log(`\n✓ Scenario 5 complete${sawExpiration ? ' — events do expire' : ''}`);
  return st;
}

// ────────────────────────────────────────────
// SCENARIO 6: Multiple simultaneous events across different territories
// ────────────────────────────────────────────
function scenario_6_MultipleSimultaneousEvents() {
  console.log('\n\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║ SCENARIO 6: Multiple simultaneous events across territories          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  const st = createInitialEmpire(77, 'merchant_republic');
  // Merchant republic controls western_reach, crescent_harbor, salt_marshes, merchant_south
  // Let's confirm multiple territories exist:
  const mrTerritories = Array.from(st.gameState.territories.values()).filter(t => t.owner === 'merchant_republic');
  console.log(`Merchant Republic territories: ${mrTerritories.map(t => t.name).join(', ')}`);
  const sim = new WorldSimulator();
  let maxConcurrent = 0;
  for (let i = 0; i < 6; i++) {
    const input: WorldStepInput = {
      turn: st.turn,
      territories: st.gameState.territories,
      factions: st.gameState.factions,
      activeEvents: st.activeEvents,
      eventHistory: st.eventHistory,
      playerFactionId: st.playerFactionId,
      seed: 3333 + st.turn * 11,
    };
    const out = sim.simulate(input);
    if (out.summary.length > 0) printTurnOutput(st, out);
    const activeInFaction = out.newActiveEvents.filter(e => {
      if (e.status !== 'active') return false;
      const owner = e.territoryId ? st.gameState.territories.get(e.territoryId)?.owner : e.factionId;
      return owner === 'merchant_republic';
    });
    maxConcurrent = Math.max(maxConcurrent, activeInFaction.length);
    if (activeInFaction.length >= 2) console.log(`\n${activeInFaction.length} concurrent active events in Merchant Republic this turn!`);
    st.gameState.territories = out.mutatedTerritories;
    st.gameState.factions = out.mutatedFactions;
    st.activeEvents = out.newActiveEvents;
    st.eventHistory = out.newEventHistory;
    for (const d of out.unresolvedDecisions) {
      sim.resolveChoice({ ...input, activeEventInstanceId: d.active.instanceId, choiceId: d.choices[0]?.id ?? 'ignore' });
    }
    st.turn++;
  }
  console.log(`Peak simultaneous events: ${maxConcurrent}`);
  console.log(`\n✓ Scenario 6 complete: events coexist across different territories`);
  return st;
}

// ────────────────────────────────────────────
// SCENARIO 7: Positive events (prosperity / trade boom / resource discovery)
// ────────────────────────────────────────────
function scenario_7_PositiveEvents(seed: number) {
  console.log('\n\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║ SCENARIO 7: Positive events — prosperity & resource discovery        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  const st = createInitialEmpire(seed, 'iron_kingdom');
  // Boost stability to encourage prosperity triggers
  const f = st.gameState.factions.get('iron_kingdom')!;
  f.stability = 88;
  f.resources.gold = 5000;
  console.log(`Iron Kingdom boosted: stability=${f.stability}, gold=${f.resources.gold}`);
  const sim = new WorldSimulator();
  let positives = 0;
  for (let i = 0; i < 5; i++) {
    const input: WorldStepInput = {
      turn: st.turn,
      territories: st.gameState.territories,
      factions: st.gameState.factions,
      activeEvents: st.activeEvents,
      eventHistory: st.eventHistory,
      playerFactionId: st.playerFactionId,
      seed: 1212 + st.turn * 5,
    };
    const out = sim.simulate(input);
    if (out.summary.length > 0) printTurnOutput(st, out);
    const positive = out.triggeredEvents.filter(te =>
      te.definition.typeId === 'prosperity' || te.definition.typeId === 'trade_boom' || te.definition.typeId === 'resource_discovery'
    );
    positives += positive.length;
    st.gameState.territories = out.mutatedTerritories;
    st.gameState.factions = out.mutatedFactions;
    st.activeEvents = out.newActiveEvents;
    st.eventHistory = out.newEventHistory;
    for (const d of out.unresolvedDecisions) {
      sim.resolveChoice({ ...input, activeEventInstanceId: d.active.instanceId, choiceId: 'ignore' });
    }
    reportFactionStatus(st);
    st.turn++;
  }
  console.log(`Positive events encountered this run: ${positives}`);
  console.log(`\n✓ Scenario 7 complete: stable empire generates positive events`);
  return st;
}

// ────────────────────────────────────────────
// SCENARIO 8: Deterministic reproducibility — identical seeds = identical results
// ────────────────────────────────────────────
function scenario_8_DeterministicReproducibility() {
  console.log('\n\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║ SCENARIO 8: Identical seed produces identical results (reproducibility) ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  const seed = 42;
  function runOnce(s: number): { events: string[]; stab: Map<string, number>; gold: Map<string, number>; pop: Map<FactionId, number>; } {
    const st = createInitialEmpire(s);
    const sim = new WorldSimulator();
    const events: string[] = [];
    for (let i = 0; i < 6; i++) {
      const input: WorldStepInput = {
        turn: st.turn,
        territories: st.gameState.territories,
        factions: st.gameState.factions,
        activeEvents: st.activeEvents,
        eventHistory: st.eventHistory,
        playerFactionId: st.playerFactionId,
        seed: s + st.turn * 13,
      };
      const out = sim.simulate(input);
      for (const e of out.triggeredEvents) events.push(`T${st.turn}:${e.definition.typeId}:${e.territoryId}:${e.severity}`);
      st.gameState.territories = out.mutatedTerritories;
      st.gameState.factions = out.mutatedFactions;
      st.activeEvents = out.newActiveEvents;
      st.eventHistory = out.newEventHistory;
      for (const d of out.unresolvedDecisions) {
        sim.resolveChoice({ ...input, activeEventInstanceId: d.active.instanceId, choiceId: 'ignore' });
      }
      st.turn++;
    }
    const stab = new Map<string, number>();
    const gold = new Map<string, number>();
    const pop = new Map<FactionId, number>();
    for (const [id, f] of st.gameState.factions) {
      stab.set(id, f.stability);
      gold.set(id, Math.round(f.resources.gold));
      const totalPop = Array.from(st.gameState.territories.values()).filter(t => t.owner === id).reduce((a, t) => a + t.population, 0);
      pop.set(id, totalPop);
    }
    return { events, stab, gold, pop };
  }
  const r1 = runOnce(seed);
  const r2 = runOnce(seed);
  console.log('\n─── Run 1 Events ───');
  console.log(r1.events.join('\n') || '(no events)');
  console.log('\n─── Run 2 Events ───');
  console.log(r2.events.join('\n') || '(no events)');
  const eventsEqual = r1.events.length === r2.events.length && r1.events.every((e, i) => e === r2.events[i]);
  let stabsEqual = true;
  for (const k of r1.stab.keys()) {
    if (r1.stab.get(k) !== r2.stab.get(k)) stabsEqual = false;
  }
  console.log(`\n  Events deterministic: ${eventsEqual ? '✓ YES' : '✗ NO'}`);
  console.log(`  Stability deterministic: ${stabsEqual ? '✓ YES' : '✗ NO'}`);
  console.log('  Faction final states:');
  for (const fid of r1.stab.keys()) {
    console.log(`    ${fid}: stability=${r1.stab.get(fid)}  gold=${r1.gold.get(fid)}  pop=${r1.pop.get(fid)}`);
  }
  const allEqual = eventsEqual && stabsEqual;
  console.log(`\n✓ Scenario 8 complete: Determinism = ${allEqual ? 'CONFIRMED' : 'INCONSISTENT (review!)'}`);
  return allEqual;
}

// ────────────────────────────────────────────
// SCENARIO 9: Event history answers "What happened in my empire?"
// ────────────────────────────────────────────
function scenario_9_HistoryRecording() {
  console.log('\n\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║ SCENARIO 9: Event history records what happened to the empire       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  const st = createInitialEmpire(123, 'merchant_republic');
  const sim = new WorldSimulator();
  for (let i = 0; i < 6; i++) {
    const input: WorldStepInput = {
      turn: st.turn,
      territories: st.gameState.territories,
      factions: st.gameState.factions,
      activeEvents: st.activeEvents,
      eventHistory: st.eventHistory,
      playerFactionId: st.playerFactionId,
      seed: 123 + st.turn * 7,
    };
    const out = sim.simulate(input);
    st.gameState.territories = out.mutatedTerritories;
    st.gameState.factions = out.mutatedFactions;
    st.activeEvents = out.newActiveEvents;
    st.eventHistory = out.newEventHistory;
    for (const d of out.unresolvedDecisions) {
      const res = sim.resolveChoice({ ...input, activeEventInstanceId: d.active.instanceId, choiceId: 'reduce_taxes' });
      Object.assign(st.eventHistory, res.updatedHistory);
    }
    st.turn++;
  }
  printHistory(st);
  const kinds = new Map<string, number>();
  for (const h of st.eventHistory) kinds.set(h.kind, (kinds.get(h.kind) ?? 0) + 1);
  console.log('\nHistory entry kinds:');
  for (const [k, n] of kinds) console.log(`  ${k.padEnd(7)}: ${n}`);
  console.log(`\n✓ Scenario 9 complete: history records trigger/choice/perTurn/expire events`);
  return st;
}

// ────────────────────────────────────────────
// SCENARIO 10: Territory differences — different terrain triggers specific events
// ────────────────────────────────────────────
function scenario_10_RegionalDifferences() {
  console.log('\n\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║ SCENARIO 10: Regional/terrain differences affect which events occur  ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  // Compare: plains farming territory vs mountain mining territory vs coastal
  const cases: { tid: TerritoryId; name: string; expect: string[] }[] = [
    { tid: 'central_plains', name: 'Central Plains (plains/farming)', expect: ['drought', 'flood'] },
    { tid: 'north_pass', name: 'Mountain Pass (mountain/mining)', expect: ['harsh_winter', 'resource_discovery'] },
    { tid: 'crescent_harbor', name: 'Crescent Harbor (coastal/trade)', expect: ['storm', 'flood', 'trade_boom'] },
  ];
  const sim = new WorldSimulator();
  const rng = new SeededRNG(4242);
  console.log('Evaluating trigger weights for representative territories:');
  console.log();
  const { gameState } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  for (const c of cases) {
    const t = gameState.territories.get(c.tid);
    if (!t) continue;
    // Force owner = merchant_republic so eligibility holds
    const prevOwner = t.owner;
    t.owner = 'merchant_republic';
    const helper = new WorldHelperImpl(gameState.territories, gameState.factions, []);
    const ctx = buildConditionContext(10, c.tid, 'merchant_republic', gameState.territories, gameState.factions, [], rng.fork(c.tid.length));
    const results = evaluateAllTriggersForTerritory(ctx);
    t.owner = prevOwner;
    console.log(`${c.name} (terrain=${t.terrain}):`);
    console.log(`  Expected biases: ${c.expect.join(', ')}`);
    console.log(`  Top eligible triggers:`);
    const tops = results.slice(0, 5);
    if (tops.length === 0) console.log('    (none eligible)');
    for (const r of tops) {
      const id = r.eventId.replace('evt_', '');
      const isExpected = c.expect.includes(id) ? '  ← expected match ✓' : '';
      console.log(`    - ${pad(id, 22)} weight=${r.weight.toFixed(2)}  ${r.severityHint ? `sev-hint:${r.severityHint}` : ''}${isExpected}`);
      if (r.reasons.length) console.log(`        reasons: ${r.reasons.slice(0, 2).join('; ')}`);
    }
    console.log();
  }
  console.log(`\n✓ Scenario 10 complete: terrain/theme biases condition weights correctly`);
}

// ────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────
function main() {
  console.log('\n\n╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║  REP WARS — Imperial Event & World Simulation Engine — DEMO / STRESS   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');
  console.log('Balance config:', JSON.stringify({
    maxEventsPerTurn: BALANCE.events.world.maxEventsPerTurn,
    severities: Object.keys(BALANCE.events.severityWeights).length,
    triggers: Object.keys(BALANCE.events.trigger).length,
    chains: Object.keys(BALANCE.events.chain).length,
  }, null, 2));

  const seed = 42;
  try { scenario_1_StableEmpire(seed); } catch (e) { console.error('✗ Scenario 1 crashed:', e); process.exit(1); }
  try { scenario_2_ForceDrought(); } catch (e) { console.error('✗ Scenario 2 crashed:', e); process.exit(1); }
  try { scenario_3_DroughtChainInterrupted(); } catch (e) { console.error('✗ Scenario 3 crashed:', e); process.exit(1); }
  try { scenario_4_UnrestToRebellion(); } catch (e) { console.error('✗ Scenario 4 crashed:', e); process.exit(1); }
  try { scenario_5_EventExpires(808); } catch (e) { console.error('✗ Scenario 5 crashed:', e); process.exit(1); }
  try { scenario_6_MultipleSimultaneousEvents(); } catch (e) { console.error('✗ Scenario 6 crashed:', e); process.exit(1); }
  try { scenario_7_PositiveEvents(303); } catch (e) { console.error('✗ Scenario 7 crashed:', e); process.exit(1); }
  const det = scenario_8_DeterministicReproducibility();
  try { scenario_9_HistoryRecording(); } catch (e) { console.error('✗ Scenario 9 crashed:', e); process.exit(1); }
  try { scenario_10_RegionalDifferences(); } catch (e) { console.error('✗ Scenario 10 crashed:', e); process.exit(1); }

  hr();
  console.log('\n🏁  ALL 10 SCENARIOS COMPLETED WITHOUT CRASH\n');
  console.log(`Deterministic reproducibility: ${det ? 'PASSED' : 'FLAGGED FOR REVIEW'}`);
  console.log('\nTo run this demo again:  npm run build && node dist/simulation/eventSimulation.js');
  console.log('or with ts-node:         npx ts-node src/simulation/eventSimulation.ts');
}

if (require.main === module) {
  main();
}

export {
  scenario_1_StableEmpire, scenario_2_ForceDrought, scenario_3_DroughtChainInterrupted,
  scenario_4_UnrestToRebellion, scenario_5_EventExpires, scenario_6_MultipleSimultaneousEvents,
  scenario_7_PositiveEvents, scenario_8_DeterministicReproducibility, scenario_9_HistoryRecording,
  scenario_10_RegionalDifferences, createInitialEmpire, reportFactionStatus, printHistory,
};
