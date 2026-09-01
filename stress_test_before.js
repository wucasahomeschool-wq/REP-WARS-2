"use strict";
const { BattleEngine } = require("./dist/battle/BattleEngine");

function makeArmy(id, owner, location, soldiers, knights = 0, siegeEngines = 0, morale = 75, supply = 80) {
    return { id, owner, location, soldiers, knights, siegeEngines, morale, supply };
}

function makeTerritory(id, name, terrain, owner, fortification = 0, garrison = 0, isCapital = false) {
    return {
        id, name, owner, terrain, neighboring: [], population: 10000, baseValue: 30,
        resourceOutput: {}, fortification, garrison, isCapital,
        isKnown: true, scoutedTurnsAgo: 0,
    };
}

const engine = new BattleEngine();
const ratios = [
    ["1 vs 1", 1, 1],
    ["10 vs 1", 10, 1],
    ["100 vs 1", 100, 1],
    ["1000 vs 1", 1000, 1],
    ["10,000 vs 1", 10000, 1],
    ["1,000,000 vs 10", 1000000, 10],
    ["10,000,000 vs 10", 10000000, 10],
    ["100,000,000 vs 10", 100000000, 10],
    ["100 vs 100", 100, 100],
    ["1,000 vs 1,000", 1000, 1000],
    ["10,000 vs 10,000", 10000, 10000],
    ["1.5:1 (1500 vs 1000)", 1500, 1000],
    ["2:1 (2000 vs 1000)", 2000, 1000],
    ["3:1 (3000 vs 1000)", 3000, 1000],
    ["5:1 (5000 vs 1000)", 5000, 1000],
    ["10:1 (10000 vs 1000)", 10000, 1000],
];

console.log("=" .repeat(90));
console.log("REP WARS - CURRENT (BROKEN) BATTLE ENGINE - EXTREME RATIO STRESS TEST");
console.log("=" .repeat(90));
console.log("");
console.log(`Seed 42 - Open terrain (plains, no fortification)`);
console.log("");

for (const [label, atk, def] of ratios) {
    const input = {
        turn: 1, seed: 42,
        attackerFactionId: "A", attackerFactionName: "Faction A",
        defenderFactionId: "B", defenderFactionName: "Faction B",
        attackerArmies: [makeArmy("a", "A", "t", atk, 0, 0, 75, 80)],
        defenderArmies: [],
        defenderGarrison: def,
        territory: makeTerritory("t", "Test Plains", "plains", "B", 0, def),
    };
    const r = engine.resolve(input);
    const atkCas = r.attacker.casualties.casualtyRate;
    const defCas = r.defender.casualties.casualtyRate;
    console.log(`${label.padEnd(30)} | winner=${String(r.winner).padEnd(8)} ratio=${r.effectiveRatio.toFixed(3)} | atkCas%=${(atkCas*100).toFixed(1).padStart(6)} defCas%=${(defCas*100).toFixed(1).padStart(6)} | outcome=${r.outcomeType}`);
}

console.log("");
console.log("=" .repeat(90));
console.log("STATISTICAL SAMPLE (1000 runs each) - EXTREME RATIOS");
console.log("=" .repeat(90));
console.log("");

const extremeCases = [
    ["1000 vs 1 (should be ~99.9% attacker wins)", 1000, 1],
    ["10,000 vs 10 (should be ~99.9% attacker wins)", 10000, 10],
    ["1,000,000 vs 10 (should be near 100% attacker wins)", 1000000, 10],
    ["10,000,000 vs 10 (should be 100% attacker wins)", 10000000, 10],
    ["100 vs 100 (should be ~50/50)", 100, 100],
    ["2:1 ratio (should be ~66% attacker)", 2000, 1000],
    ["3:1 ratio (should be ~75% attacker)", 3000, 1000],
];

for (const [label, atk, def] of extremeCases) {
    let atkWins = 0, defWins = 0, draws = 0;
    let atkCasTotal = 0, defCasTotal = 0;
    let atkRemTotal = 0, defRemTotal = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) {
        const input = {
            turn: 1, seed: 100000 + i,
            attackerFactionId: "A", attackerFactionName: "Faction A",
            defenderFactionId: "B", defenderFactionName: "Faction B",
            attackerArmies: [makeArmy("a", "A", "t", atk, 0, 0, 75, 80)],
            defenderArmies: [],
            defenderGarrison: def,
            territory: makeTerritory("t", "Test Plains", "plains", "B", 0, def),
        };
        const r = engine.resolve(input);
        if (r.winner === "attacker") atkWins++;
        else if (r.winner === "defender") defWins++;
        else draws++;
        atkCasTotal += r.attacker.casualties.casualtyRate;
        defCasTotal += r.defender.casualties.casualtyRate;
        atkRemTotal += r.attacker.remainingTroops;
        defRemTotal += r.defender.remainingTroops;
    }
    console.log(`${label}:`);
    console.log(`  Atk wins: ${atkWins}/${N} (${((atkWins/N)*100).toFixed(1)}%)  Def wins: ${defWins}/${N} (${((defWins/N)*100).toFixed(1)}%)  Draws: ${draws}`);
    console.log(`  Avg Atk cas%: ${((atkCasTotal/N)*100).toFixed(1)}  Avg Def cas%: ${((defCasTotal/N)*100).toFixed(1)}`);
    console.log(`  Avg Atk remaining: ${Math.round(atkRemTotal/N)} / ${atk}  Avg Def remaining: ${Math.round(defRemTotal/N)} / ${def}`);
    console.log("");
}
