import { DecisionEngine, WarlordState } from '../engine/DecisionEngine';
import { SAMPLE_MAP, WARLORD_SPECS, SimulationBuilder } from './SampleMap';
import { BALANCE } from '../constants/balance';
import { SeededRNG } from '../utils/SeededRNG';
import { WarlordSnapshot, MemoryEventType, Army, BattleInput, BattleResult } from '../types';
import { PERSONALITY_NAMES, TERRAIN_NAMES, ACTION_NAMES } from '../constants/balance';
import { BattleEngine } from '../battle/BattleEngine';
import * as readline from 'readline';

function printBanner() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           REP WARS  ·  AI WARLORD DECISION ENGINE           ║');
  console.log('║            First Milestone  ·  Decision Simulator           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
}

function printMapLegend() {
  console.log('── MAP OVERVIEW ───────────────────────────────────────────────');
  const territories = [...SAMPLE_MAP].sort((a, b) => {
    const ownerOrder = [null, 'ashen_horde', 'iron_kingdom', 'merchant_republic', 'celestial_theocracy'];
    const ao = ownerOrder.indexOf(a.owner);
    const bo = ownerOrder.indexOf(b.owner);
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });
  const ownerNames: Record<string, string> = {
    ashen_horde: 'ASHEN HORDE',
    iron_kingdom: 'IRON KINGDOM',
    merchant_republic: 'MERCHANT REPUBLIC',
    celestial_theocracy: 'CELESTIAL THEOCRACY',
  };
  let lastOwner: string | null = '__start__';
  for (const t of territories) {
    if (t.owner !== lastOwner) {
      const label = t.owner ? ownerNames[t.owner] : 'UNCLAIMED';
      console.log(`  ▸ ${label}:`);
      lastOwner = t.owner;
    }
    const cap = t.isCapital ? ' ★' : '';
    const terr = TERRAIN_NAMES[t.terrain] ?? t.terrain;
    const resources = Object.entries(t.resourceOutput)
      .filter(([, v]) => v && v > 0)
      .map(([k, v]) => `${k}:${v}`)
      .join(' ');
    console.log(`    · ${t.name}${cap} (${terr}) fort:${t.fortification} gar:${t.garrison} — ${resources}`);
  }
  console.log('');
}

function printWarlordInfo(warlordStates: Map<string, WarlordState>) {
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
    const fmtInc = (n?: number) => (n ?? 0).toString().padStart(4, ' ');
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

interface SimOptions {
  turns: number;
  seed: number;
  verbose: boolean;
  interactive: boolean;
  selectedWarlords: string[] | null;
  showScores: boolean;
}

async function runSimulation(opts: SimOptions) {
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
    if (!rl) return resolve();
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

    for (const [id, ws] of warlordStates) {
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
        if (!ws) continue;
        const ctx = WarlordState.buildContext(ws.snapshot, gameState);
        console.log(`  SCORE BREAKDOWN for ${d.warlordName} (${d.action}${d.targetName ? '→' + d.targetName : ''}):`);
        const picked = d.topAlternatives[0] && false ? null : null;
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

    simulateDecisionOutcomes(decisions, warlordStates, gameState, turn);

    if (interactive && turn < turns) {
      await askContinue();
    }
  }

  if (rl) rl.close();
  console.log('─'.repeat(60));
  console.log(`Simulation complete. Re-run with different --seed=<n> to see alternative decisions.`);
  console.log('');
}

function recalcMilitary(snap: WarlordSnapshot, gameState: any): number {
  let total = 0;
  const { military: M } = BALANCE;
  for (const aid of snap.armies) {
    const a = gameState.armies.get(aid);
    if (a) total += a.soldiers * M.soldierValue + a.knights * M.knightValue + a.siegeEngines * M.siegeValue;
  }
  for (const tid of snap.territories) {
    const t = gameState.territories.get(tid);
    if (t) total += t.garrison * M.soldierValue;
  }
  return total;
}

function simulateDecisionOutcomes(
  decisions: any[],
  warlordStates: Map<string, WarlordState>,
  gameState: any,
  turn: number
) {
  for (const d of decisions) {
    const ws = warlordStates.get(d.warlordId);
    if (!ws) continue;
    ws.snapshot.lastActions.unshift({ turn, action: d.action, target: d.targetId });
    if (ws.snapshot.lastActions.length > 20) ws.snapshot.lastActions.pop();

    switch (d.action) {
      case 'ATTACK':
        if (d.targetId) {
          const t = gameState.territories.get(d.targetId);
          const victimId = t?.owner;
          if (victimId) {
            ws.memory.addEntry(turn, 'attack_made', victimId, d.targetId, 8, { target: d.targetName });
            const victim = warlordStates.get(victimId);
            if (victim) {
              victim.memory.addEntry(turn, 'attack_received', d.warlordId, d.targetId, 10, { attacker: d.warlordName });
              const rel = victim.snapshot.diplomacy.get(d.warlordId);
              if (rel) {
                rel.opinion = Math.max(-100, rel.opinion + BALANCE.diplomacy.opinionAttackImpact);
                rel.state = rel.state === 'allied' ? 'at_war' : rel.state === 'friendly' ? 'hostile' : rel.state === 'neutral' ? 'tense' : 'at_war';
              }
              const myRel = ws.snapshot.diplomacy.get(victimId);
              if (myRel) {
                myRel.opinion = Math.max(-100, myRel.opinion - 10);
                if (myRel.state !== 'at_war' && myRel.state !== 'hostile') myRel.state = 'tense';
              }
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
            if (rel) { rel.state = 'at_war'; rel.opinion = Math.max(-100, rel.opinion + BALANCE.diplomacy.warDeclarationOpinionHit); }
            const myRel = ws.snapshot.diplomacy.get(d.targetId);
            if (myRel) { myRel.state = 'at_war'; myRel.opinion = Math.max(-100, myRel.opinion - 25); }
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
            if (rel) rel.opinion = Math.min(100, rel.opinion + 8);
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
            if (rel) rel.opinion = Math.min(100, rel.opinion + BALANCE.diplomacy.opinionTradeImpact);
            const myRel = ws.snapshot.diplomacy.get(d.targetId);
            if (myRel) myRel.opinion = Math.min(100, myRel.opinion + BALANCE.diplomacy.opinionTradeImpact);
          }
        }
        break;
      case 'NEGOTIATE':
        if (d.targetId) {
          const rel = ws.snapshot.diplomacy.get(d.targetId);
          if (rel) rel.opinion = Math.min(100, rel.opinion + 3);
          const target = warlordStates.get(d.targetId);
          if (target) {
            const tr = target.snapshot.diplomacy.get(d.warlordId);
            if (tr) tr.opinion = Math.min(100, tr.opinion + 2);
          }
        }
        break;
      case 'BUILD':
        if (d.targetId) {
          const t = gameState.territories.get(d.targetId);
          if (t && t.owner === d.warlordId) {
            const cost = 100;
            if (ws.snapshot.resources.gold >= cost) {
              ws.snapshot.resources.gold -= cost;
              ws.snapshot.resources.stone = Math.max(0, ws.snapshot.resources.stone - 50);
              t.fortification = Math.min(5, t.fortification + 1);
            }
          }
        }
        break;
      case 'REINFORCE':
        if (d.targetId) {
          const t = gameState.territories.get(d.targetId);
          if (t && t.owner === d.warlordId) {
            const costG = 250, costF = 150;
            if (ws.snapshot.resources.gold >= costG && ws.snapshot.resources.food >= costF) {
              ws.snapshot.resources.gold -= costG;
              ws.snapshot.resources.food -= costF;
              t.garrison += 100;
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
              const myPower = ws.snapshot.totalMilitaryPower;
              const needed = (t.garrison + 100) * BALANCE.military.soldierValue;
              if (myPower > needed * 1.5) {
                t.owner = d.warlordId;
                ws.snapshot.territories.push(t.id);
                ws.snapshot.resources.gold = Math.max(0, ws.snapshot.resources.gold - 100);
                t.garrison = Math.max(50, t.garrison - 30);
                ws.memory.addEntry(turn, 'territory_gained', null, t.id, 8, { territory: t.name, via: 'expansion' });
                for (const otherId of gameState.allFactionIds) {
                  if (otherId === d.warlordId) continue;
                  const other = warlordStates.get(otherId);
                  if (!other) continue;
                  const hasNeighbor = t.neighboring.some((nid: string) => other.snapshot.territories.includes(nid));
                  if (hasNeighbor) {
                    const rel = other.snapshot.diplomacy.get(d.warlordId);
                    if (rel) rel.opinion = Math.max(-100, rel.opinion - 5);
                  }
                }
              }
            }
          }
        }
        break;
      case 'WAIT':
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

function parseArgs(argv: string[]): SimOptions {
  const opts: SimOptions = {
    turns: BALANCE.simulate.defaultTurns,
    seed: BALANCE.simulate.defaultSeed,
    verbose: false,
    interactive: false,
    selectedWarlords: null,
    showScores: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--turns=')) opts.turns = Math.max(1, parseInt(arg.split('=')[1]) || opts.turns);
    else if (arg.startsWith('--seed=')) opts.seed = parseInt(arg.split('=')[1]) || opts.seed;
    else if (arg === '--verbose' || arg === '-v') opts.verbose = true;
    else if (arg === '--interactive' || arg === '-i') opts.interactive = true;
    else if (arg === '--scores' || arg === '-s') opts.showScores = true;
    else if (arg.startsWith('--warlords=')) {
      opts.selectedWarlords = arg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean);
    }
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return opts;
}

function printHelp() {
  printBanner();
  console.log('USAGE:');
  console.log('  npm run simulate -- [options]');
  console.log('');
  console.log('OPTIONS:');
  console.log('  --turns=N         Number of turns to simulate (default: ' + BALANCE.simulate.defaultTurns + ')');
  console.log('  --seed=N          RNG seed for reproducible runs (default: ' + BALANCE.simulate.defaultSeed + ')');
  console.log('  --verbose, -v     Show score, confidence and top alternatives');
  console.log('  --scores, -s      Show detailed score breakdown per warlord');
  console.log('  --interactive, -i Step through turns one by one');
  console.log('  --warlords=a,b,c  Filter output to specific warlord ids');
  console.log('                    (ashen_horde, iron_kingdom, merchant_republic, celestial_theocracy)');
  console.log('  --help, -h        Show this help');
  console.log('');
  console.log('EXAMPLES:');
  console.log('  npm run simulate -- --turns=15 --seed=123');
  console.log('  npm run simulate -- --warlords=ashen_horde,iron_kingdom -v');
  console.log('  npm run simulate -- -i --scores');
  console.log('');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await runSimulation(opts);
}

main().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
