"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runBattleTestSuite = runBattleTestSuite;
exports.runSeededReproducibilityTest = runSeededReproducibilityTest;
exports.runStatisticalSample = runStatisticalSample;
exports.formatTestSuite = formatTestSuite;
const BattleEngine_1 = require("../battle/BattleEngine");
const balance_1 = require("../constants/balance");
function makeArmy(id, owner, location, soldiers, knights = 0, siegeEngines = 0, morale = 75, supply = 80) {
    return { id, owner, location, soldiers, knights, siegeEngines, morale, supply };
}
function makeTerritory(id, name, terrain, owner, fortification = 0, garrison = 0, isCapital = false) {
    return {
        id,
        name,
        owner,
        terrain,
        neighboring: [],
        population: 10000,
        baseValue: 30,
        resourceOutput: {},
        fortification,
        garrison,
        isCapital,
        isKnown: true,
        scoutedTurnsAgo: 0,
    };
}
const SCENARIOS = [
    {
        name: '1. Strong attacker vs weak defender',
        description: 'Large veteran assault force attacks a small outpost garrison on open plains.',
        expectedNotes: 'Expected: Attacker decisive victory with light casualties.',
        buildInput: (seed) => ({
            turn: 5,
            seed,
            attackerFactionId: 'ashen_horde',
            attackerFactionName: 'Ashen Horde',
            defenderFactionId: 'iron_kingdom',
            defenderFactionName: 'Iron Kingdom',
            attackerArmies: [makeArmy('a1', 'ashen_horde', 't1', 2500, 400, 20, 85, 90)],
            defenderGarrison: 250,
            territory: makeTerritory('t1', 'Border Plains', 'plains', 'iron_kingdom', 1, 250),
        }),
    },
    {
        name: '2. Weak attacker vs strong defender',
        description: 'Raid force attacks a fortified mountain fortress capital.',
        expectedNotes: 'Expected: Defender decisive victory; attackers shattered.',
        buildInput: (seed) => ({
            turn: 7,
            seed,
            attackerFactionId: 'merchant_republic',
            attackerFactionName: 'Merchant Republic',
            defenderFactionId: 'ashen_horde',
            defenderFactionName: 'Ashen Horde',
            attackerArmies: [makeArmy('a2', 'merchant_republic', 't2', 400, 50, 0, 60, 55)],
            defenderGarrison: 800,
            territory: makeTerritory('t2', 'Icehold Citadel', 'fortress', 'ashen_horde', 5, 800, false),
        }),
    },
    {
        name: '3a. Similar armies - Plains (open terrain favors attacker)',
        description: 'Two balanced armies clash on the plains.',
        expectedNotes: 'Plains negate defender terrain advantage.',
        buildInput: (seed) => ({
            turn: 10,
            seed,
            attackerFactionId: 'ashen_horde',
            attackerFactionName: 'Ashen Horde',
            defenderFactionId: 'iron_kingdom',
            defenderFactionName: 'Iron Kingdom',
            attackerArmies: [makeArmy('a3a', 'ashen_horde', 't3a', 1000, 150, 5, 75, 75)],
            defenderArmies: [makeArmy('d3a', 'iron_kingdom', 't3a', 1000, 150, 5, 75, 75)],
            defenderGarrison: 0,
            territory: makeTerritory('t3a', 'Central Plains', 'plains', 'iron_kingdom', 0, 0),
        }),
    },
    {
        name: '3b. Similar armies - Mountains (rough terrain favors defender)',
        description: 'Same force sizes, but defenders are in mountains.',
        expectedNotes: 'Mountains should give defenders a meaningful edge vs plains case.',
        buildInput: (seed) => ({
            turn: 10,
            seed,
            attackerFactionId: 'ashen_horde',
            attackerFactionName: 'Ashen Horde',
            defenderFactionId: 'iron_kingdom',
            defenderFactionName: 'Iron Kingdom',
            attackerArmies: [makeArmy('a3b', 'ashen_horde', 't3b', 1000, 150, 5, 75, 75)],
            defenderArmies: [makeArmy('d3b', 'iron_kingdom', 't3b', 1000, 150, 5, 75, 75)],
            defenderGarrison: 0,
            territory: makeTerritory('t3b', 'Highland Pass', 'mountain', 'iron_kingdom', 0, 0),
        }),
    },
    {
        name: '4. Fortress helps defender hold out',
        description: 'Attacker is numerically superior but defender has L5 Citadel + capital bonus.',
        expectedNotes: 'Expected: Fortress should tip a 2:1 attacker advantage into defender win or narrow attacker pyrrhic.',
        buildInput: (seed) => ({
            turn: 14,
            seed,
            attackerFactionId: 'ashen_horde',
            attackerFactionName: 'Ashen Horde',
            defenderFactionId: 'iron_kingdom',
            defenderFactionName: 'Iron Kingdom',
            attackerArmies: [makeArmy('a4', 'ashen_horde', 't4', 1800, 200, 2, 80, 70)],
            defenderArmies: [makeArmy('d4', 'iron_kingdom', 't4', 500, 80, 0, 85, 90)],
            defenderGarrison: 500,
            territory: makeTerritory('t4', 'Iron Spire Capital', 'fortress', 'iron_kingdom', 5, 500, true),
        }),
    },
    {
        name: '5. Narrow attacker victory',
        description: 'Balanced edge to attacker; fortification near L2 blunts them slightly.',
        expectedNotes: 'Expected: Close ratio → attacker_narrow_victory.',
        buildInput: (seed) => ({
            turn: 18,
            seed,
            attackerFactionId: 'iron_kingdom',
            attackerFactionName: 'Iron Kingdom',
            defenderFactionId: 'merchant_republic',
            defenderFactionName: 'Merchant Republic',
            attackerArmies: [makeArmy('a5', 'iron_kingdom', 't5', 1400, 180, 8, 78, 75)],
            defenderArmies: [makeArmy('d5', 'merchant_republic', 't5', 900, 120, 2, 72, 70)],
            defenderGarrison: 180,
            territory: makeTerritory('t5', 'Western Reach', 'plains', 'merchant_republic', 2, 180),
        }),
    },
    {
        name: '6. Narrow defender victory',
        description: 'Defenders slightly outnumbered but hold forest terrain + L1 palisade.',
        expectedNotes: 'Expected: Narrow defender win or mutual heavy losses.',
        buildInput: (seed) => ({
            turn: 20,
            seed,
            attackerFactionId: 'ashen_horde',
            attackerFactionName: 'Ashen Horde',
            defenderFactionId: 'celestial_theocracy',
            defenderFactionName: 'Celestial Theocracy',
            attackerArmies: [makeArmy('a6', 'ashen_horde', 't6', 1300, 170, 3, 72, 68)],
            defenderArmies: [makeArmy('d6', 'celestial_theocracy', 't6', 850, 100, 2, 80, 78)],
            defenderGarrison: 150,
            territory: makeTerritory('t6', 'Emerald Forest', 'forest', 'celestial_theocracy', 1, 150),
        }),
    },
    {
        name: '7. Pyrrhic victory',
        description: 'Extremely close, bloody battle on open terrain. Winner takes crippling losses.',
        expectedNotes: 'Expected: Narrow victory with winner cas rate ≥ 33% triggers pyrrhic flag.',
        buildInput: (seed) => ({
            turn: 23,
            seed,
            attackerFactionId: 'merchant_republic',
            attackerFactionName: 'Merchant Republic',
            defenderFactionId: 'ashen_horde',
            defenderFactionName: 'Ashen Horde',
            attackerArmies: [makeArmy('a7', 'merchant_republic', 't7', 1050, 150, 4, 62, 55)],
            defenderArmies: [makeArmy('d7', 'ashen_horde', 't7', 1000, 150, 4, 62, 55)],
            defenderGarrison: 120,
            territory: makeTerritory('t7', 'Bloodmoor Plains', 'plains', 'ashen_horde', 1, 120),
        }),
    },
    {
        name: '8. Failed attack — retreating survivors',
        description: 'Attackers lose decisively; engine computes retreat survival %.',
        expectedNotes: 'Expected: Attacker routed but retreatSurvivorsPct set so simulation can withdraw remnant.',
        buildInput: (seed) => ({
            turn: 27,
            seed,
            attackerFactionId: 'celestial_theocracy',
            attackerFactionName: 'Celestial Theocracy',
            defenderFactionId: 'iron_kingdom',
            defenderFactionName: 'Iron Kingdom',
            attackerArmies: [makeArmy('a8', 'celestial_theocracy', 't8', 700, 90, 0, 62, 58)],
            defenderArmies: [makeArmy('d8', 'iron_kingdom', 't8', 1500, 250, 10, 86, 82)],
            defenderGarrison: 300,
            territory: makeTerritory('t8', 'Eastern Ironhold', 'mountain', 'iron_kingdom', 3, 300),
        }),
    },
];
function runBattleTestSuite(opts) {
    const seed = opts?.seed ?? balance_1.BALANCE.simulate.defaultSeed;
    const verbose = opts?.verbose ?? false;
    const engine = new BattleEngine_1.BattleEngine();
    const reports = [];
    for (const scenario of SCENARIOS) {
        const input = scenario.buildInput(seed);
        const result = engine.resolve(input);
        reports.push({
            scenarioName: scenario.name,
            result,
            formatted: engine.formatResult(result, verbose),
        });
    }
    return reports;
}
function runSeededReproducibilityTest() {
    const engine = new BattleEngine_1.BattleEngine();
    const buildInput = (s) => ({
        turn: 1,
        seed: s,
        attackerFactionId: 'A',
        attackerFactionName: 'Faction A',
        defenderFactionId: 'B',
        defenderFactionName: 'Faction B',
        attackerArmies: [makeArmy('ax', 'A', 'tx', 1200, 180, 8, 80, 75)],
        defenderArmies: [makeArmy('dx', 'B', 'tx', 1000, 150, 5, 78, 72)],
        defenderGarrison: 220,
        territory: makeTerritory('tx', 'Test Valley', 'plains', 'B', 2, 220),
    });
    const r1 = engine.resolve(buildInput(42));
    const r2 = engine.resolve(buildInput(42));
    const rDiff = engine.resolve(buildInput(99));
    const same = r1.winner === r2.winner &&
        r1.outcomeType === r2.outcomeType &&
        r1.attacker.casualties.total === r2.attacker.casualties.total &&
        r1.defender.casualties.total === r2.defender.casualties.total &&
        r1.effectiveRatio === r2.effectiveRatio &&
        r1.territoryOutcome === r2.territoryOutcome;
    return { same, result1: r1, result2: r2, diffSeedResult: rDiff };
}
function runStatisticalSample(inputFactory, runs = 200) {
    const engine = new BattleEngine_1.BattleEngine();
    const outcomes = {};
    let a = 0, d = 0, dr = 0;
    let casA = 0, casD = 0;
    for (let i = 0; i < runs; i++) {
        const r = engine.resolve(inputFactory(100000 + i));
        outcomes[r.outcomeType] = (outcomes[r.outcomeType] ?? 0) + 1;
        if (r.winner === 'attacker')
            a++;
        else if (r.winner === 'defender')
            d++;
        else
            dr++;
        casA += r.attacker.casualties.casualtyRate;
        casD += r.defender.casualties.casualtyRate;
    }
    return {
        outcomes,
        attackerWins: a,
        defenderWins: d,
        draws: dr,
        avgAtkCas: casA / runs,
        avgDefCas: casD / runs,
        sampleCount: runs,
    };
}
function formatTestSuite(reports) {
    const out = [];
    out.push('╔══════════════════════════════════════════════════════════════╗');
    out.push('║           REP WARS  ·  BATTLE RESOLUTION ENGINE             ║');
    out.push('║            Second Milestone  ·  Battle Test Suite           ║');
    out.push('╚══════════════════════════════════════════════════════════════╝');
    out.push('');
    out.push(`Scenarios run: ${reports.length}`);
    out.push('');
    for (const report of reports) {
        const sc = SCENARIOS.find((s) => s.name === report.scenarioName);
        out.push('─'.repeat(62));
        out.push(`SCENARIO: ${sc?.name ?? report.scenarioName}`);
        out.push(`  ${sc?.description ?? ''}`);
        if (sc?.expectedNotes)
            out.push(`  Note: ${sc.expectedNotes}`);
        out.push('');
        out.push(report.formatted);
        out.push('');
    }
    const repro = runSeededReproducibilityTest();
    out.push('─'.repeat(62));
    out.push('9. SEEDED REPRODUCIBILITY TEST');
    out.push(`   Same seed (42) produces identical result: ${repro.same ? 'PASS ✓' : 'FAIL ✗'}`);
    out.push(`     r1 winner=${repro.result1.winner} casA=${repro.result1.attacker.casualties.total} casD=${repro.result1.defender.casualties.total}`);
    out.push(`     r2 winner=${repro.result2.winner} casA=${repro.result2.attacker.casualties.total} casD=${repro.result2.defender.casualties.total}`);
    out.push('');
    out.push('10. DIFFERENT SEEDS PRODUCE VARIED (but bounded) OUTCOMES');
    out.push(`   Seed=42:  outcome=${repro.result1.outcomeType}  ratio=${repro.result1.effectiveRatio}  margin=${repro.result1.marginOfVictory}`);
    out.push(`   Seed=99:  outcome=${repro.diffSeedResult.outcomeType}  ratio=${repro.diffSeedResult.effectiveRatio}  margin=${repro.diffSeedResult.marginOfVictory}`);
    const sampleInputFactory = (s) => ({
        turn: 1,
        seed: s,
        attackerFactionId: 'A',
        attackerFactionName: 'Faction A',
        defenderFactionId: 'B',
        defenderFactionName: 'Faction B',
        attackerArmies: [makeArmy('ax', 'A', 'tx', 1200, 180, 8, 80, 75)],
        defenderArmies: [makeArmy('dx', 'B', 'tx', 1000, 150, 5, 78, 72)],
        defenderGarrison: 220,
        territory: makeTerritory('tx', 'Test Valley', 'plains', 'B', 2, 220),
    });
    const dist = runStatisticalSample(sampleInputFactory, 200);
    out.push('');
    out.push(`   Statistical sample (n=${dist.sampleCount} runs, identical armies, varying seed):`);
    out.push(`     Attacker wins: ${dist.attackerWins} (${((dist.attackerWins / dist.sampleCount) * 100).toFixed(1)}%)`);
    out.push(`     Defender wins: ${dist.defenderWins} (${((dist.defenderWins / dist.sampleCount) * 100).toFixed(1)}%)`);
    out.push(`     Draws/stalemate: ${dist.draws}`);
    out.push('     Outcome distribution:');
    for (const [k, v] of Object.entries(dist.outcomes).sort((a, b) => b[1] - a[1])) {
        out.push(`       - ${k.padEnd(30, ' ')} ${v.toString().padStart(4, ' ')}  ${((v / dist.sampleCount) * 100).toFixed(1)}%`);
    }
    out.push(`     Avg attacker cas rate: ${(dist.avgAtkCas * 100).toFixed(1)}%`);
    out.push(`     Avg defender cas rate: ${(dist.avgDefCas * 100).toFixed(1)}%`);
    out.push('');
    out.push('─'.repeat(62));
    out.push('End of battle resolution tests.');
    return out.join('\n');
}
//# sourceMappingURL=battleTests.js.map