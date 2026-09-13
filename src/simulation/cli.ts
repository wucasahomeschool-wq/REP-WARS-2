import { DecisionEngine, WarlordState } from '../engine/DecisionEngine';
import { SAMPLE_MAP, WARLORD_SPECS, SimulationBuilder } from './SampleMap';
import { BALANCE, TERRAIN_NAMES, PERSONALITY_NAMES } from '../constants/balance';
import { runSeededReproducibilityTest, runBattleTestSuite, formatTestSuite } from './battleTests';
import { runMapDemo, runMapValidationTests } from './mapDemo';
import { GameStateSnapshot, WarlordSnapshot, Decision, FactionId, RelationshipState, Army, Territory } from '../types';
import { BattleEngine, BattleInput, BattleResult } from '../battle/BattleEngine';
import { ScoringHelpers } from '../scoring/ActionScorer';
import { Orchestrator } from '../orchestration/orchestrator';
import { createGameState } from '../state/createGameState';
import { checkGameStateInvariants } from '../state/gameStateInvariants';
import { calculateMovementDuration } from '../army/movement';
import { PersonalitySystem } from '../personality/PersonalitySystem';
import { GAME_STATE_SCHEMA_VERSION, emptyWorldClock, emptyRewardApplicationState } from '../types/GameState';
import * as readline from 'readline';

/**
 * ENGINE EXECUTION CONSISTENCY PASS: single shared `BattleEngine` instance
 * used by the ATTACK execution path below. `BattleEngine` is pure/stateless
 * (see docs/BATTLE_ENGINE_CORRECTNESS.md) — reusing one instance across
 * calls is just avoiding needless allocation, not shared mutable state.
 */
const battleEngine = new BattleEngine();

interface CliOpts {
  turns: number;
  seed: number;
  verbose: boolean;
  interactive: boolean;
  selectedWarlords: string[] | null;
  showScores: boolean;
  battles: boolean;
  battleRepro: boolean;
  map: boolean;
  mapIterations: number;
  world: boolean;
  move: boolean;
  attackChain: boolean;
}

function printBanner(): void {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           REP WARS  ·  AI WARLORD DECISION ENGINE           ║');
  console.log('║            First Milestone  ·  Decision Simulator           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
}

function printMapLegend(): void {
  console.log('── MAP OVERVIEW ───────────────────────────────────────────────');
  const territories = [...SAMPLE_MAP].sort((a, b) => {
    const ownerOrder: (string | null)[] = [null, 'ashen_horde', 'iron_kingdom', 'merchant_republic', 'celestial_theocracy'];
    const ao = ownerOrder.indexOf(a.owner);
    const bo = ownerOrder.indexOf(b.owner);
    if (ao !== bo)
      return ao - bo;
    return a.name.localeCompare(b.name);
  });
  const ownerNames: Record<string, string> = {
    ashen_horde: 'ASHEN HORDE',
    iron_kingdom: 'IRON KINGDOM',
    merchant_republic: 'MERCHANT REPUBLIC',
    celestial_theocracy: 'CELESTIAL THEOCRACY',
  };
  let lastOwner: string | null | undefined = '__start__';
  for (const t of territories) {
    if (t.owner !== lastOwner) {
      const label = t.owner ? ownerNames[t.owner] : 'UNCLAIMED';
      console.log(`  ▸ ${label}:`);
      lastOwner = t.owner;
    }
    const cap = t.isCapital ? ' ★' : '';
    const terr = TERRAIN_NAMES[t.terrain] ?? t.terrain;
    const resources = Object.entries(t.resourceOutput)
      .filter((entry): entry is [string, number] => {
        const v = entry[1];
        return !!v && v > 0;
      })
      .map(([k, v]) => `${k}:${v}`)
      .join(' ');
    console.log(`    · ${t.name}${cap} (${terr}) fort:${t.fortification} gar:${t.garrison} — ${resources}`);
  }
  console.log('');
}

function printWarlordInfo(warlordStates: Map<string, WarlordState>): void {
  console.log('── WARLORDS ──────────────────────────────────────────────────');
  for (const [id, ws] of Array.from(warlordStates.entries()).sort()) {
    const s = ws.snapshot;
    const pType = PERSONALITY_NAMES[s.personality.type] ?? s.personality.type;
    const res = s.resources;
    const income = s.resourceIncome;
    const fmt = (n: number) => n.toString().padStart(5, ' ');
    console.log(`  ${s.name.toUpperCase()} (${pType}) — Rep:${s.reputation} Stab:${s.stability}`);
    console.log(`    Territories: ${s.territories.length}  Armies: ${s.armies.length}  Military Power: ${s.totalMilitaryPower}`);
    console.log(`    Resources: 💰${fmt(res.gold)}  🍞${fmt(res.food)}  ⚔${fmt(res.iron)}  🌲${fmt(res.wood)}  🪨${fmt(res.stone)}`);
    const fmtInc = (n: number | undefined) => (n ?? 0).toString().padStart(4, ' ');
    console.log(`    Income:    +${fmtInc(income.gold)} +${fmtInc(income.food)} +${fmtInc(income.iron)} +${fmtInc(income.wood)} +${fmtInc(income.stone)}`);
    const rels = Array.from(s.diplomacy.entries())
      .filter(([tid]) => tid !== id)
      .map(([tid, r]) => {
        const target = warlordStates.get(tid)?.snapshot.name ?? tid;
        return `${target}=${r.state}(${r.opinion >= 0 ? '+' : ''}${r.opinion})`;
      })
      .join('  ');
    console.log(`    Diplomatic: ${rels}`);
    const goals = ws.goals.getActiveGoals(0).slice(0, 3);
    if (goals.length > 0) {
      const goalStr = goals.map((g) => `${g.type.replace(/_/g, ' ')}(${g.priority})`).join(', ');
      console.log(`    Goals: ${goalStr}`);
    }
    console.log('');
  }
}

async function runSimulation(opts: CliOpts): Promise<void> {
  const { turns, seed, verbose, interactive, selectedWarlords, showScores } = opts;
  printBanner();
  console.log(`Simulation parameters:`);
  console.log(`  · Turns: ${turns}`);
  console.log(`  · Seed:  ${seed}`);
  console.log(`  · Mode:  ${interactive ? 'Interactive (step by step)' : 'Auto-run'}`);
  console.log(`  · Verbose: ${verbose ? 'On (shows score/alternatives)' : 'Off'}`);
  console.log('');
  const { gameState, warlordStates } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, seed);
  const engine = new DecisionEngine(seed);
  printMapLegend();
  printWarlordInfo(warlordStates);
  const factionOrder = gameState.allFactionIds;
  const rl = interactive
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : null;
  const askContinue = () => new Promise<void>((resolve) => {
    if (!rl)
      return resolve();
    rl.question('Press [Enter] for next turn, [q+Enter] to quit...', (ans) => {
      if (ans.trim().toLowerCase() === 'q') {
        rl.close();
        process.exit(0);
      }
      resolve();
    });
  });
  for (let turn = 1; turn <= turns; turn++) {
    gameState.turn = turn;
    for (const [, ws] of warlordStates) {
      ws.snapshot.totalMilitaryPower = recalcMilitary(ws.snapshot, gameState);
    }
    const decisions = engine.decideAll(warlordStates, gameState, turn, factionOrder);
    const filtered = selectedWarlords
      ? decisions.filter((d) => selectedWarlords.includes(d.warlordId))
      : decisions;
    console.log(engine.formatTurnReport(turn, filtered, verbose));
    if (showScores) {
      for (const d of decisions) {
        const ws = warlordStates.get(d.warlordId);
        if (!ws)
          continue;
        const ctx = WarlordState.buildContext(ws.snapshot, gameState);
        void ctx;
        console.log(`  SCORE BREAKDOWN for ${d.warlordName} (${d.action}${d.targetName ? '→' + d.targetName : ''}):`);
        const picked = d.topAlternatives[0] && false ? null : null;
        void picked;
        const displayAlt = [
          { action: d.action, targetName: d.targetName, score: d.score, isTop: true },
          ...d.topAlternatives.slice(0, 4).map((a) => ({ action: a.action, targetName: a.targetName, score: a.score, isTop: false })),
        ];
        for (const alt of displayAlt) {
          const tag = alt.isTop ? '►' : ' ';
          const tn = alt.targetName ? ` ${alt.targetName}` : '';
          console.log(`    ${tag} ${alt.action}${tn} — score: ${alt.score.toFixed(1)}`);
        }
        console.log('');
      }
    }
    simulateDecisionOutcomes(
      decisions.filter((d) => d.isNewCommitment !== false),
      warlordStates,
      gameState,
      turn,
      seed,
      verbose,
    );
    // Stub orchestrator: this harness executes immediately, then marks the
    // commitment complete so the next turn may reassess. Holding across
    // evaluations is the DecisionEngine's job; timing is not.
    for (const d of decisions) {
      if (d.isNewCommitment === false)
        continue;
      const ws = warlordStates.get(d.warlordId);
      if (ws)
        engine.completeCommitment(ws, 'simulation harness executed immediately');
    }
    if (interactive && turn < turns) {
      await askContinue();
    }
  }
  if (rl)
    rl.close();
  console.log('─'.repeat(60));
  console.log(`Simulation complete. Re-run with different --seed=<n> to see alternative decisions.`);
  console.log('');
}

function recalcMilitary(snap: WarlordSnapshot, gameState: GameStateSnapshot): number {
  let total = 0;
  const { military: M } = BALANCE;
  for (const aid of snap.armies) {
    const a = gameState.armies.get(aid);
    if (a)
      total += a.soldiers * M.soldierValue + a.knights * M.knightValue + a.siegeEngines * M.siegeValue;
  }
  for (const tid of snap.territories) {
    const t = gameState.territories.get(tid);
    if (t)
      total += t.garrison * M.soldierValue;
  }
  return total;
}

/**
 * ENGINE EXECUTION CONSISTENCY PASS — helpers shared by the ATTACK/EXPAND
 * execution paths below. See docs/ENGINE_EXECUTION_CONSISTENCY.md for the
 * full rationale; summarized inline at each call site.
 */

/** Faction's current field armies as live `Army` objects (not just ids). */
function factionArmies(ws: WarlordState, gameState: GameStateSnapshot): Army[] {
  const out: Army[] = [];
  for (const id of ws.snapshot.armies) {
    const a = gameState.armies.get(id);
    if (a) out.push(a);
  }
  return out;
}

/**
 * Deterministic per-battle seed derived from the simulation's own seed plus
 * the battle's identity (turn/attacker/defender/territory) — NOT reusing
 * `DecisionEngine`'s internal RNG (that governs decision-making, a
 * separate concern from battle resolution; see `battleTests.ts` for the
 * same "derive a seed, don't share an RNG instance" pattern). This is a
 * plain hash, not battle math — `BattleEngine` still owns all probability/
 * casualty calculation.
 */
function deriveBattleSeed(baseSeed: number, turn: number, attackerId: string, defenderId: string, territoryId: string): number {
  const s = `${turn}_${attackerId}_${defenderId}_${territoryId}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return (h ^ baseSeed) >>> 0;
}

/**
 * Distributes a `BattleResult` side's aggregate remaining troop/siege
 * counts back across the (possibly multiple) `Army` objects that
 * contributed to that side, proportional to each army's pre-battle share.
 * `BattleEngine` resolves combat as one aggregate per side (see
 * `BattleInput.attackerArmies`/`defenderArmies`); it has no concept of
 * "which surviving soldier belongs to which original army object", so this
 * is the harness-side adapter that maps the aggregate result back onto the
 * existing per-army fields. Exact remainders go to the last army so the
 * sum across all armies always matches `remaining` exactly. In the current
 * SAMPLE_MAP scenario each faction has exactly one starting army, so this
 * is normally a 1-army identity assignment.
 */
function applySurvivingArmies(
  armies: Army[],
  remaining: { soldiers: number; knights: number; siegeEngines: number },
  moraleChange: number,
): void {
  const totalPre = armies.reduce((s, a) => s + a.soldiers + a.knights + a.siegeEngines, 0);
  if (armies.length === 0 || totalPre <= 0) return;
  let remSoldiers = remaining.soldiers;
  let remKnights = remaining.knights;
  let remSiege = remaining.siegeEngines;
  armies.forEach((a, idx) => {
    const isLast = idx === armies.length - 1;
    if (isLast) {
      a.soldiers = Math.max(0, remSoldiers);
      a.knights = Math.max(0, remKnights);
      a.siegeEngines = Math.max(0, remSiege);
    } else {
      const share = (a.soldiers + a.knights + a.siegeEngines) / totalPre;
      const s = Math.min(remSoldiers, Math.round(remaining.soldiers * share));
      const k = Math.min(remKnights, Math.round(remaining.knights * share));
      const sg = Math.min(remSiege, Math.round(remaining.siegeEngines * share));
      a.soldiers = s;
      a.knights = k;
      a.siegeEngines = sg;
      remSoldiers -= s;
      remKnights -= k;
      remSiege -= sg;
    }
    a.morale = Math.max(0, Math.min(100, a.morale + moraleChange));
  });
}

/** Removes fully-eliminated (no-retreat-rule loser) armies from the simulation entirely. */
function eliminateArmies(armies: Army[], gameState: GameStateSnapshot, owner: WarlordSnapshot): void {
  for (const a of armies) {
    gameState.armies.delete(a.id);
    const idx = owner.armies.indexOf(a.id);
    if (idx >= 0) owner.armies.splice(idx, 1);
  }
}

/**
 * Applies an already-resolved `BattleResult` to the temporary simulation
 * state using ONLY existing `Territory`/`Army`/`WarlordSnapshot`/
 * `MemorySystem` structures — no new gameplay mechanics. `BattleEngine`
 * itself stays pure; this function is the harness-side "apply" step called
 * once per resolved battle. See docs/ENGINE_EXECUTION_CONSISTENCY.md,
 * "BattleResult application flow".
 */
function applyBattleResult(
  result: BattleResult,
  attackerWs: WarlordState,
  defenderWs: WarlordState,
  attackingArmies: Army[],
  defendingArmies: Army[],
  targetTerritory: Territory,
  gameState: GameStateSnapshot,
  turn: number,
): void {
  // Garrison casualties apply regardless of who wins — BattleEngine always
  // reports `defender.remaining.garrison` (see BattleSideBreakdown).
  targetTerritory.garrison = Math.max(0, result.defender.remaining.garrison ?? 0);

  if (result.winner === 'attacker') {
    // NO-RETREAT RULE (Phase 4): the losing side is eliminated outright,
    // not withdrawn. Mirrored here — never re-introduce retreat behavior.
    eliminateArmies(defendingArmies, gameState, defenderWs.snapshot);
    applySurvivingArmies(attackingArmies, result.attacker.remaining, result.attacker.moraleChange);
    if (result.territoryOutcome === 'captured') {
      const prevOwnerId = targetTerritory.owner;
      targetTerritory.owner = attackerWs.snapshot.id;
      if (prevOwnerId) {
        const idx = defenderWs.snapshot.territories.indexOf(targetTerritory.id);
        if (idx >= 0) defenderWs.snapshot.territories.splice(idx, 1);
      }
      if (!attackerWs.snapshot.territories.includes(targetTerritory.id)) {
        attackerWs.snapshot.territories.push(targetTerritory.id);
      }
      // The surviving attacking force advances into the territory it just
      // captured. This reuses the existing `Army.location` field for a
      // direct consequence of capture; it is not a troop-movement/
      // logistics system.
      for (const a of attackingArmies) a.location = targetTerritory.id;
      attackerWs.memory.addEntry(turn, 'territory_gained', defenderWs.snapshot.id, targetTerritory.id, 12, { territory: targetTerritory.name, via: 'conquest' });
      defenderWs.memory.addEntry(turn, 'territory_lost', attackerWs.snapshot.id, targetTerritory.id, 15, { territory: targetTerritory.name });
    }
    attackerWs.memory.addEntry(turn, 'battle_won', defenderWs.snapshot.id, targetTerritory.id, 10, { outcome: result.outcomeType });
    defenderWs.memory.addEntry(turn, 'battle_lost', attackerWs.snapshot.id, targetTerritory.id, 12, { outcome: result.outcomeType });
  } else if (result.winner === 'defender') {
    eliminateArmies(attackingArmies, gameState, attackerWs.snapshot);
    applySurvivingArmies(defendingArmies, result.defender.remaining, result.defender.moraleChange);
    attackerWs.memory.addEntry(turn, 'battle_lost', defenderWs.snapshot.id, targetTerritory.id, 10, { outcome: result.outcomeType });
    defenderWs.memory.addEntry(turn, 'battle_won', attackerWs.snapshot.id, targetTerritory.id, 8, { outcome: result.outcomeType });
  } else {
    // Stalemate ('draw'): both sides take graduated casualties but neither
    // is eliminated and the territory stays 'contested' (unchanged owner).
    applySurvivingArmies(attackingArmies, result.attacker.remaining, result.attacker.moraleChange);
    applySurvivingArmies(defendingArmies, result.defender.remaining, result.defender.moraleChange);
  }
}

function simulateDecisionOutcomes(
  decisions: Decision[],
  warlordStates: Map<FactionId, WarlordState>,
  gameState: GameStateSnapshot,
  turn: number,
  seed: number,
  verbose: boolean,
): void {
  for (const d of decisions) {
    const ws = warlordStates.get(d.warlordId);
    if (!ws)
      continue;
    ws.snapshot.lastActions.unshift({ turn, action: d.action, target: d.targetId });
    if (ws.snapshot.lastActions.length > 20)
      ws.snapshot.lastActions.pop();
    switch (d.action) {
      case 'ATTACK':
        if (d.targetId) {
          const t = gameState.territories.get(d.targetId);
          const victimId = t?.owner;
          const victim = victimId ? warlordStates.get(victimId) : undefined;
          // ENGINE EXECUTION CONSISTENCY PASS: re-derive the attacking
          // force at execution time using the exact same helper the AI
          // scorer used to decide this attack was viable
          // (`ScoringHelpers.armiesBorderingTerritory` + the same >100
          // soldiers+knights eligibility filter as `ActionScorer.scoreAttack`),
          // rather than trusting cached scoring-time state. This also
          // guards against another faction's earlier action this same
          // turn changing `t.owner` or depleting this army out from under
          // a stale decision.
          const attackingArmies = t && victim
            ? ScoringHelpers.armiesBorderingTerritory(factionArmies(ws, gameState), gameState.territories, t.id)
                .filter((a) => a.soldiers + a.knights > 100)
            : [];
          if (t && victimId && victim && attackingArmies.length > 0) {
            const defendingArmies = Array.from(gameState.armies.values()).filter((a) => a.location === t.id);
            const battleSeed = deriveBattleSeed(seed, turn, d.warlordId, victimId, t.id);
            const input: BattleInput = {
              turn,
              seed: battleSeed,
              attackerFactionId: d.warlordId,
              attackerFactionName: d.warlordName,
              defenderFactionId: victimId,
              defenderFactionName: victim.snapshot.name,
              attackerArmies: attackingArmies,
              defenderArmies: defendingArmies,
              defenderGarrison: t.garrison,
              territory: t,
            };
            const validation = battleEngine.validate(input);
            if (validation.valid) {
              // Diplomatic/memory consequences of the attack itself (not
              // the outcome — those are applied via `applyBattleResult`
              // below) — unchanged from the pre-Phase-6 behavior.
              ws.memory.addEntry(turn, 'attack_made', victimId, d.targetId, 8, { target: d.targetName });
              victim.memory.addEntry(turn, 'attack_received', d.warlordId, d.targetId, 10, { attacker: d.warlordName });
              const rel = victim.snapshot.diplomacy.get(d.warlordId);
              if (rel) {
                rel.opinion = Math.max(-100, rel.opinion + BALANCE.diplomacy.opinionAttackImpact);
                rel.state = (rel.state === 'allied' ? 'at_war' : rel.state === 'friendly' ? 'hostile' : rel.state === 'neutral' ? 'tense' : 'at_war') as RelationshipState;
              }
              const myRel = ws.snapshot.diplomacy.get(victimId);
              if (myRel) {
                myRel.opinion = Math.max(-100, myRel.opinion - 10);
                if (myRel.state !== 'at_war' && myRel.state !== 'hostile')
                  myRel.state = 'tense';
              }

              // THE authoritative battle resolution call. No battle math is
              // duplicated here — everything from win probability to
              // casualty accounting to the no-retreat rule lives in
              // BattleEngine (src/battle/BattleEngine.ts).
              const result = battleEngine.resolve(input);
              console.log(battleEngine.formatResult(result, verbose));
              applyBattleResult(result, ws, victim, attackingArmies, defendingArmies, t, gameState, turn);
            }
          }
        }
        break;
      case 'DECLARE_WAR':
        if (d.targetId) {
          ws.memory.addEntry(turn, 'war_declared', d.targetId, null, 10, { target: d.targetName });
          const victim = warlordStates.get(d.targetId);
          if (victim) {
            victim.memory.addEntry(turn, 'war_declared', d.warlordId, null, 12, { attacker: d.warlordName });
            const rel = victim.snapshot.diplomacy.get(d.warlordId);
            if (rel) {
              rel.state = 'at_war';
              rel.opinion = Math.max(-100, rel.opinion + BALANCE.diplomacy.warDeclarationOpinionHit);
            }
            const myRel = ws.snapshot.diplomacy.get(d.targetId);
            if (myRel) {
              myRel.state = 'at_war';
              myRel.opinion = Math.max(-100, myRel.opinion - 25);
            }
          }
        }
        break;
      case 'OFFER_PEACE':
        if (d.targetId) {
          ws.memory.addEntry(turn, 'peace_offered', d.targetId, null, 5, { target: d.targetName });
          const target = warlordStates.get(d.targetId);
          if (target) {
            target.memory.addEntry(turn, 'peace_offered', d.warlordId, null, 4, { from: d.warlordName });
            const rel = target.snapshot.diplomacy.get(d.warlordId);
            if (rel)
              rel.opinion = Math.min(100, rel.opinion + 8);
          }
        }
        break;
      case 'TRADE':
        if (d.targetId) {
          ws.memory.addEntry(turn, 'trade_completed', d.targetId, null, 3, { target: d.targetName });
          const target = warlordStates.get(d.targetId);
          if (target) {
            target.memory.addEntry(turn, 'trade_completed', d.warlordId, null, 3, { with: d.warlordName });
            const rel = target.snapshot.diplomacy.get(d.warlordId);
            if (rel)
              rel.opinion = Math.min(100, rel.opinion + BALANCE.diplomacy.opinionTradeImpact);
            const myRel = ws.snapshot.diplomacy.get(d.targetId);
            if (myRel)
              myRel.opinion = Math.min(100, myRel.opinion + BALANCE.diplomacy.opinionTradeImpact);
          }
        }
        break;
      case 'NEGOTIATE':
        if (d.targetId) {
          const rel = ws.snapshot.diplomacy.get(d.targetId);
          if (rel)
            rel.opinion = Math.min(100, rel.opinion + 3);
          const target = warlordStates.get(d.targetId);
          if (target) {
            const tr = target.snapshot.diplomacy.get(d.warlordId);
            if (tr)
              tr.opinion = Math.min(100, tr.opinion + 2);
          }
        }
        break;
      case 'BUILD':
        if (d.targetId) {
          const t = gameState.territories.get(d.targetId);
          if (t && t.owner === d.warlordId) {
            // ENGINE EXECUTION CONSISTENCY PASS: reads the same
            // BALANCE.territory.fortificationCostPerLevel
            // ActionScorer.scoreBuild() now checks affordability against,
            // instead of separate inline literals (100 gold / 50 stone)
            // that previously happened to match by coincidence, not
            // structure. See docs/ENGINE_EXECUTION_CONSISTENCY.md.
            const { gold: costG, stone: costS } = BALANCE.territory.fortificationCostPerLevel;
            if (ws.snapshot.resources.gold >= costG && ws.snapshot.resources.stone >= costS && t.fortification < 5) {
              ws.snapshot.resources.gold -= costG;
              ws.snapshot.resources.stone -= costS;
              t.fortification += 1;
            }
          }
        }
        break;
      case 'REINFORCE':
        if (d.targetId) {
          const t = gameState.territories.get(d.targetId);
          if (t && t.owner === d.warlordId) {
            // AI DECISION CORRECTNESS PASS: moved from inline literals to
            // BALANCE.economy.reinforcementCost, the same source
            // ActionScorer.scoreReinforce() now reads for its affordability
            // check, so scoring and execution can't disagree about cost.
            const { gold: costG, food: costF, garrisonGain } = BALANCE.economy.reinforcementCost;
            if (ws.snapshot.resources.gold >= costG && ws.snapshot.resources.food >= costF) {
              ws.snapshot.resources.gold -= costG;
              ws.snapshot.resources.food -= costF;
              t.garrison += garrisonGain;
            }
          }
        }
        break;
      case 'EXPAND':
      case 'SCOUT':
        if (d.targetId) {
          if (!ws.snapshot.knownTerritories.includes(d.targetId)) {
            ws.snapshot.knownTerritories.push(d.targetId);
            const t = gameState.territories.get(d.targetId);
            if (t?.owner && !ws.snapshot.knownFactions.includes(t.owner)) {
              ws.snapshot.knownFactions.push(t.owner);
            }
          }
          if (d.action === 'EXPAND') {
            const t = gameState.territories.get(d.targetId);
            if (t && t.owner === null) {
              // ENGINE EXECUTION CONSISTENCY PASS: this used to compare
              // `ws.snapshot.totalMilitaryPower` — the faction's ENTIRE
              // empire-wide military power, including armies/garrisons on
              // the other side of the map — against this one target's
              // garrison. That let a faction "expand" using strength it
              // had no way to actually bring to bear here. Execution now
              // uses `ScoringHelpers.computeLocalUsableMilitaryPower`, the
              // exact same local/usable-strength formula
              // `ActionScorer.scoreExpand` uses to decide EXPAND is worth
              // scoring in the first place (armies stationed adjacent to
              // the target + garrisons of my own bordering territories).
              // See docs/AI_DECISION_CORRECTNESS.md ("Expansion strength
              // evaluation") and docs/ENGINE_EXECUTION_CONSISTENCY.md.
              const myPower = ScoringHelpers.computeLocalUsableMilitaryPower(
                d.warlordId, factionArmies(ws, gameState), gameState.territories, t.id,
              );
              const E = BALANCE.territory.expansionClaim;
              const needed = (t.garrison + E.garrisonBuffer) * BALANCE.military.soldierValue;
              if (myPower > needed * E.successLocalPowerRatio) {
                t.owner = d.warlordId;
                ws.snapshot.territories.push(t.id);
                ws.snapshot.resources.gold = Math.max(0, ws.snapshot.resources.gold - E.goldCost);
                t.garrison = Math.max(E.minGarrisonAfter, t.garrison - E.garrisonReduction);
                ws.memory.addEntry(turn, 'territory_gained', null, t.id, 8, { territory: t.name, via: 'expansion' });
                for (const otherId of gameState.allFactionIds) {
                  if (otherId === d.warlordId)
                    continue;
                  const other = warlordStates.get(otherId);
                  if (!other)
                    continue;
                  const hasNeighbor = t.neighboring.some((nid) => other.snapshot.territories.includes(nid));
                  if (hasNeighbor) {
                    const rel = other.snapshot.diplomacy.get(d.warlordId);
                    if (rel)
                      rel.opinion = Math.max(-100, rel.opinion - E.neighborOpinionHit);
                  }
                }
              }
            }
          }
        }
        break;
      case 'WAIT': {
        const inc = ws.snapshot.resourceIncome;
        ws.snapshot.resources.gold += Math.floor((inc.gold ?? 0) * 0.5);
        ws.snapshot.resources.food += Math.floor((inc.food ?? 0) * 0.5);
        ws.snapshot.resources.iron += Math.floor((inc.iron ?? 0) * 0.5);
        ws.snapshot.resources.wood += Math.floor((inc.wood ?? 0) * 0.5);
        ws.snapshot.resources.stone += Math.floor((inc.stone ?? 0) * 0.5);
        break;
      }
    }
  }
}

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = {
    turns: BALANCE.simulate.defaultTurns,
    seed: BALANCE.simulate.defaultSeed,
    verbose: false,
    interactive: false,
    selectedWarlords: null,
    showScores: false,
    battles: false,
    battleRepro: false,
    map: false,
    mapIterations: 4,
    world: false,
    move: false,
    attackChain: false,
  };
  for (const arg of argv) {
    if (arg.startsWith('--turns='))
      opts.turns = Math.max(1, parseInt(arg.split('=')[1]!) || opts.turns);
    else if (arg.startsWith('--seed='))
      opts.seed = parseInt(arg.split('=')[1]!) || opts.seed;
    else if (arg === '--verbose' || arg === '-v')
      opts.verbose = true;
    else if (arg === '--interactive' || arg === '-i')
      opts.interactive = true;
    else if (arg === '--scores' || arg === '-s')
      opts.showScores = true;
    else if (arg === '--battles' || arg === '-b')
      opts.battles = true;
    else if (arg === '--battle-repro')
      opts.battleRepro = true;
    else if (arg === '--map' || arg === '-m')
      opts.map = true;
    else if (arg === '--world')
      opts.world = true;
    else if (arg === '--move')
      opts.move = true;
    else if (arg === '--attack-chain')
      opts.attackChain = true;
    else if (arg.startsWith('--map-iterations='))
      opts.mapIterations = Math.max(1, parseInt(arg.split('=')[1]!) || opts.mapIterations);
    else if (arg.startsWith('--warlords=')) {
      opts.selectedWarlords = arg.split('=')[1]!.split(',').map((s) => s.trim()).filter((s): s is string => Boolean(s));
    }
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return opts;
}

function printHelp(): void {
  printBanner();
  console.log('USAGE:');
  console.log('  npm run simulate -- [options]');
  console.log('  npm run battles  -- [options]');
  console.log('  npm run map      -- [options]');
  console.log('  npm run simulate -- --world --turns=8 --seed=42');
  console.log('');
  console.log('OPTIONS:');
  console.log('  Decision Engine:');
  console.log('    --turns=N         Number of turns to simulate (default: ' + BALANCE.simulate.defaultTurns + ')');
  console.log('    --seed=N          RNG seed for reproducible runs (default: ' + BALANCE.simulate.defaultSeed + ')');
  console.log('    --verbose, -v     Show score, confidence and top alternatives');
  console.log('    --scores, -s      Show detailed score breakdown per warlord');
  console.log('    --interactive, -i Step through turns one by one');
  console.log('    --warlords=a,b,c  Filter output to specific warlord ids');
  console.log('                      (ashen_horde, iron_kingdom, merchant_republic, celestial_theocracy)');
  console.log('');
  console.log('  Battle Resolution Engine:');
  console.log('    --battles, -b     Run full battle test suite (10 scenarios + statistical sample)');
  console.log('    --battle-repro    Run only seeded reproducibility + diff-seed tests');
  console.log('');
  console.log('  Map Generation & Expansion Engine:');
  console.log('    --map, -m         Run full map generation + expansion demo');
  console.log('    --map-iterations=N Number of frontier conquest rounds (default: 4)');
  console.log('');
  console.log('  Continuous World Engine (Orchestrator ADVANCE_WORLD demo):');
  console.log('    --world           Advance worldTick via Orchestrator (not a second authority)');
  console.log('                      Uses --turns as elapsedTicks and --seed as world seed');
  console.log('    --move            Deterministic adjacent MOVE + ADVANCE_WORLD arrival demo');
  console.log('    --attack-chain    Staging hop then ATTACK after arrival (Orchestrator only)');
  console.log('');
  console.log('  --help, -h        Show this help');
  console.log('');
  console.log('EXAMPLES:');
  console.log('  npm run simulate -- --turns=15 --seed=123');
  console.log('  npm run simulate -- --warlords=ashen_horde,iron_kingdom -v');
  console.log('  npm run simulate -- -i --scores');
  console.log('  npm run battles  -- --seed=99 -v');
  console.log('  npm run battles  -- --battle-repro');
  console.log('  npm run map      -- --seed=2026 -v --map-iterations=6');
  console.log('');
}

async function runBattleMode(opts: CliOpts): Promise<void> {
  printBanner();
  if (opts.battleRepro) {
    console.log('Seeded reproducibility test:');
    const repro = runSeededReproducibilityTest();
    console.log(`  Same seed (42) produces identical result: ${repro.same ? 'PASS ✓' : 'FAIL ✗'}`);
    console.log(`  Seed=42: outcome=${repro.result1.outcomeType}  winner=${repro.result1.winner}`);
    console.log(`  Seed=42: casA=${repro.result1.attacker.casualties.total}  casD=${repro.result1.defender.casualties.total}`);
    console.log(`  Seed=42: territoryOutcome=${repro.result1.territoryOutcome}  ratio=${repro.result1.effectiveRatio}`);
    console.log('');
    console.log(`  Seed=99: outcome=${repro.diffSeedResult.outcomeType}  winner=${repro.diffSeedResult.winner}`);
    console.log(`  Seed=99: casA=${repro.diffSeedResult.attacker.casualties.total}  casD=${repro.diffSeedResult.defender.casualties.total}`);
    console.log(`  Seed=99: territoryOutcome=${repro.diffSeedResult.territoryOutcome}  ratio=${repro.diffSeedResult.effectiveRatio}`);
    if (!repro.same) process.exit(1);
  }
  else {
    const reports = runBattleTestSuite({ seed: opts.seed, verbose: opts.verbose });
    console.log(formatTestSuite(reports));
    const repro = runSeededReproducibilityTest();
    if (!repro.same) process.exit(1);
  }
}

async function runMapMode(opts: CliOpts): Promise<void> {
  const output = runMapDemo({
    seed: opts.seed,
    verbose: opts.verbose,
    iterations: opts.mapIterations,
  });
  console.log(output);
  const tests = runMapValidationTests();
  if (tests.some((t) => !t.pass))
    process.exit(1);
}

async function runContinuousWorldDemo(opts: CliOpts): Promise<void> {
  printBanner();
  console.log('Continuous world demo (Orchestrator ADVANCE_WORLD)');
  console.log(`  · Seed:          ${opts.seed}`);
  console.log(`  · elapsedTicks:  ${opts.turns}`);
  console.log('  · Authority:     Orchestrator → ContinuousWorldEngine → existing handlers');
  console.log('');
  const orch = new Orchestrator(createGameState({ seed: opts.seed, playerFactionId: 'merchant_republic' }));
  const beforeTick = orch.getState().worldTick;
  const beforeTurn = orch.getState().turn;
  const res = orch.execute({
    commandId: 'ADVANCE_WORLD',
    playerId: 'cli',
    requestId: 'cli_world_demo',
    parameters: { elapsedTicks: opts.turns },
  });
  const wa = res.payload.worldAdvance as {
    aiDecisions: { factionId: string; action: string }[];
    commitmentResolutions: { factionId: string; action: string; outcome: string }[];
    eventResults: { turn: number; triggered: number }[];
    errors: { message: string }[];
  } | undefined;
  console.log(`  Command success: ${res.success}`);
  console.log(`  World tick:      ${beforeTick} → ${orch.getState().worldTick}`);
  console.log(`  Event turn:      ${beforeTurn} → ${orch.getState().turn}`);
  if (wa) {
    console.log(`  AI decisions:    ${wa.aiDecisions.length}`);
    for (const d of wa.aiDecisions) {
      console.log(`    · ${d.factionId}: ${d.action}`);
    }
    console.log(`  Resolutions:     ${wa.commitmentResolutions.length}`);
    for (const r of wa.commitmentResolutions) {
      console.log(`    · ${r.factionId}: ${r.action} → ${r.outcome}`);
    }
    const triggered = wa.eventResults.reduce((n, e) => n + e.triggered, 0);
    console.log(`  Event steps:     ${wa.eventResults.length} (${triggered} triggered)`);
    if (wa.errors.length) {
      console.log(`  Errors:          ${wa.errors.length}`);
      for (const e of wa.errors) console.log(`    · ${e.message}`);
    }
  } else if (!res.success) {
    console.log(`  Errors:          ${res.errors.map((e) => e.message).join('; ')}`);
  }
  const violations = checkGameStateInvariants(orch.getState());
  console.log(`  Invariants:      ${violations.length === 0 ? 'ok' : violations[0]!.message}`);
  console.log('');
  if (!res.success) process.exit(1);
}

async function runArmyMoveDemo(opts: CliOpts): Promise<void> {
  printBanner();
  console.log('Army movement demo (Orchestrator MOVE + ADVANCE_WORLD)');
  console.log(`  · Seed: ${opts.seed}`);
  console.log('  · Authority: Orchestrator beginArmyMovement — not a second implementation');
  console.log('');
  const orch = new Orchestrator(createGameState({ seed: opts.seed, playerFactionId: 'merchant_republic' }));
  const fid = 'merchant_republic';
  const armyId = orch.getState().factions.get(fid)!.armies[0]!;
  const army = orch.getState().armies.get(armyId)!;
  const origin = orch.getState().territories.get(army.location)!;
  const destId = origin.neighboring[0]!;
  const dest = orch.getState().territories.get(destId)!;
  const duration = calculateMovementDuration({ origin, destination: dest });
  const ownerBefore = origin.owner;
  const startTick = orch.getState().worldTick;
  const move = orch.execute({
    commandId: 'MOVE',
    playerId: 'cli',
    requestId: 'cli_move_demo',
    parameters: { armyId, destinationTerritoryId: destId, factionId: fid },
  });
  console.log(`  MOVE success:     ${move.success}`);
  console.log(`  Location after:   ${orch.getState().armies.get(armyId)!.location} (origin until arrival)`);
  console.log(`  Moving:           ${orch.getState().armies.get(armyId)!.movement?.status}`);
  console.log(`  Duration ticks:   ${duration}`);
  console.log(`  World tick:       ${startTick} (MOVE does not wait)`);
  const adv = orch.execute({
    commandId: 'ADVANCE_WORLD',
    playerId: 'cli',
    requestId: 'cli_move_advance',
    parameters: { elapsedTicks: duration },
  });
  const arrived = orch.getState().armies.get(armyId)!;
  console.log(`  ADVANCE success:  ${adv.success}`);
  console.log(`  Location after:   ${arrived.location}`);
  console.log(`  Movement:         ${arrived.movement === null || arrived.movement === undefined ? 'idle' : arrived.movement.status}`);
  console.log(`  Origin owner:     ${orch.getState().territories.get(origin.id)!.owner} (unchanged=${orch.getState().territories.get(origin.id)!.owner === ownerBefore})`);
  const violations = checkGameStateInvariants(orch.getState());
  console.log(`  Invariants:       ${violations.length === 0 ? 'ok' : violations[0]!.message}`);
  console.log('');
  if (!move.success || !adv.success) process.exit(1);
}

async function runAttackChainDemo(opts: CliOpts): Promise<void> {
  printBanner();
  console.log('Strategic attack demo (Orchestrator ATTACK staging hop + ADVANCE_WORLD)');
  console.log(`  · Seed: ${opts.seed}`);
  console.log('  · Path: rear → staging → BattleEngine on enemy (not a second implementation)');
  console.log('');
  const atk = 'atk_faction';
  const def = 'def_faction';
  const rear: Territory = {
    id: 'rear', name: 'Rear', owner: atk, terrain: 'plains', neighboring: ['staging'],
    population: 1000, baseValue: 10, resourceOutput: {}, fortification: 0, garrison: 20,
    isCapital: true, isKnown: true, scoutedTurnsAgo: 0,
  };
  const staging: Territory = {
    id: 'staging', name: 'Staging', owner: atk, terrain: 'plains', neighboring: ['rear', 'front'],
    population: 1000, baseValue: 10, resourceOutput: {}, fortification: 0, garrison: 20,
    isCapital: false, isKnown: true, scoutedTurnsAgo: 0,
  };
  const front: Territory = {
    id: 'front', name: 'Front', owner: def, terrain: 'plains', neighboring: ['staging'],
    population: 1000, baseValue: 10, resourceOutput: {}, fortification: 0, garrison: 10,
    isCapital: false, isKnown: true, scoutedTurnsAgo: 0,
  };
  const army: Army = {
    id: 'atk_army', owner: atk, location: 'rear',
    soldiers: 800, knights: 0, siegeEngines: 0, morale: 80, supply: 80, movement: null, attackIntent: null,
  };
  const personality = PersonalitySystem.createPreset('aggressive');
  const atkSnap: WarlordSnapshot = {
    id: atk, name: 'Attacker', personality, territories: ['rear', 'staging'], armies: ['atk_army'],
    totalMilitaryPower: 800, resources: { gold: 1000, food: 1000, iron: 1000, wood: 1000, stone: 1000 },
    resourceIncome: { gold: 10, food: 10, iron: 10, wood: 10, stone: 10 }, diplomacy: new Map(),
    memory: [], goals: [], currentThreats: [], knownFactions: [atk, def], knownTerritories: ['rear', 'staging', 'front'],
    lastActions: [], reputation: 50, stability: 70, ambition: 0.5,
  };
  const defSnap: WarlordSnapshot = { ...atkSnap, id: def, name: 'Defender', territories: ['front'], armies: [], totalMilitaryPower: 10 };
  const state = {
    schemaVersion: GAME_STATE_SCHEMA_VERSION,
    turn: 1,
    ...emptyWorldClock(),
    ...emptyRewardApplicationState(),
    worldSeed: opts.seed,
    factions: new Map([[atk, atkSnap], [def, defSnap]]),
    allFactionIds: [atk, def],
    playerFactionId: atk,
    territories: new Map([['rear', rear], ['staging', staging], ['front', front]]),
    mapWorld: null,
    visibility: new Map(),
    armies: new Map([[army.id, army]]),
    commitments: new Map([[atk, null], [def, null]]),
    activeEvents: [],
    eventHistory: [],
  };
  const orch = new Orchestrator(state);
  const attack = orch.execute({
    commandId: 'ATTACK',
    playerId: 'cli',
    requestId: 'cli_attack_chain',
    parameters: { territoryId: 'front', factionId: atk, seed: opts.seed },
  });
  console.log(`  ATTACK success:   ${attack.success}`);
  console.log(`  Outcome:          ${String(attack.payload.attackOutcome)}`);
  console.log(`  Location:         ${orch.getState().armies.get('atk_army')!.location}`);
  console.log(`  Staging:          ${orch.getState().armies.get('atk_army')!.attackIntent?.stagingTerritoryId}`);
  const duration = orch.getState().armies.get('atk_army')!.movement?.durationTicks ?? 0;
  const adv = orch.execute({
    commandId: 'ADVANCE_WORLD',
    playerId: 'cli',
    requestId: 'cli_attack_advance',
    parameters: { elapsedTicks: duration },
  });
  console.log(`  ADVANCE success:  ${adv.success}`);
  console.log(`  Front owner:      ${orch.getState().territories.get('front')!.owner}`);
  console.log(`  Attack intent:    ${orch.getState().armies.get('atk_army')?.attackIntent ?? 'cleared'}`);
  const violations = checkGameStateInvariants(orch.getState());
  console.log(`  Invariants:       ${violations.length === 0 ? 'ok' : violations[0]!.message}`);
  console.log('');
  if (!attack.success || !adv.success) process.exit(1);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.battles || opts.battleRepro) {
    await runBattleMode(opts);
  }
  else if (opts.map) {
    await runMapMode(opts);
  }
  else if (opts.world) {
    await runContinuousWorldDemo(opts);
  }
  else if (opts.move) {
    await runArmyMoveDemo(opts);
  }
  else if (opts.attackChain) {
    await runAttackChainDemo(opts);
  }
  else {
    await runSimulation(opts);
  }
}

// Only auto-run when this file is executed directly (`npm run simulate`
// etc.), not when imported as a module (e.g. by tests/run.ts, which needs
// `simulateDecisionOutcomes`/`applyBattleResult` without triggering a full
// CLI run as a side effect of importing them).
if (require.main === module) {
  main().catch((err) => {
    console.error('Simulation failed:', err);
    process.exit(1);
  });
}

// ENGINE EXECUTION CONSISTENCY PASS: exported for focused integration
// testing (see tests/run.ts). `cli.ts` itself remains a temporary
// simulation harness, not a public API — these exports exist for test
// reachability, not as a stable interface for future callers.
export { simulateDecisionOutcomes, applyBattleResult, factionArmies, deriveBattleSeed, battleEngine };
