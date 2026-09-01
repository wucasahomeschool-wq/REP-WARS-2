const { runFullStressSuite, formatStressCsvReport } = require('./dist/simulation/battleStressTests');
const {
  runBattleLabSingle,
  runBattleLabBatch,
  formatBatchStats,
  runSeededReproducibilityTest,
  runBattleTestSuite,
  formatTestSuite,
} = require('./dist/simulation/battleTests');

const RUNS = 1000;

console.log('\n===============================================================');
console.log(' REP WARS: BATTLE ENGINE VALIDATION (AFTER FIX)');
console.log('===============================================================\n');

console.log('── [1] SEEDED REPRODUCIBILITY TEST ──');
const repro = runSeededReproducibilityTest();
console.log(` Same seed (42) twice identical: ${repro.same ? 'PASS ✓' : 'FAIL ✗'}`);
console.log(` seed42: winner=${repro.result1.winner} outcome=${repro.result1.outcomeType} casA=${repro.result1.attacker.casualties.total} casD=${repro.result1.defender.casualties.total}`);
console.log(` seed99 (DIFFERENT): winner=${repro.diffSeedResult.winner} outcome=${repro.diffSeedResult.outcomeType} casA=${repro.diffSeedResult.attacker.casualties.total}`);
console.log('');

console.log('── [2] SINGLE BATTLE: 10,000,000 vs 10 (plains, seed=42) ──');
const big = runBattleLabSingle({
  attackerTroops: 10_000_000,
  attackerQuality: 1.0,
  attackerMorale: 75,
  defenderTroops: 0,
  defenderGarrison: 10,
  defenderQuality: 1.0,
  defenderMorale: 75,
  terrain: 'plains',
  fortification: 0,
}, 42);
console.log(big.formatted);
console.log('');

console.log('── [3] SINGLE BATTLE: 100 vs 100 (plains, seed=42) ──');
const eq = runBattleLabSingle({
  attackerTroops: 100, attackerQuality: 1.0, attackerMorale: 75,
  defenderTroops: 0, defenderGarrison: 100, defenderQuality: 1.0, defenderMorale: 75,
  terrain: 'plains', fortification: 0,
}, 42);
console.log(eq.formatted);
console.log('');

console.log('── [4] BATCH: 2:1 ratio (plains, n=' + RUNS + ') ──');
const ratio2 = runBattleLabBatch({
  attackerTroops: 2000, attackerQuality: 1.0, attackerMorale: 75,
  defenderTroops: 0, defenderGarrison: 1000, defenderQuality: 1.0, defenderMorale: 75,
  terrain: 'plains', fortification: 0,
}, RUNS, 300000);
console.log(formatBatchStats('2:1 plains', ratio2));
console.log('');

console.log('── [5] BATCH: 3:1 ratio (plains, n=' + RUNS + ') ──');
const ratio3 = runBattleLabBatch({
  attackerTroops: 3000, attackerQuality: 1.0, attackerMorale: 75,
  defenderTroops: 0, defenderGarrison: 1000, defenderQuality: 1.0, defenderMorale: 75,
  terrain: 'plains', fortification: 0,
}, RUNS, 320000);
console.log(formatBatchStats('3:1 plains', ratio3));
console.log('');

console.log('── [6] BATCH: 10:1 ratio (plains, n=' + RUNS + ') ──');
const ratio10 = runBattleLabBatch({
  attackerTroops: 10000, attackerQuality: 1.0, attackerMorale: 75,
  defenderTroops: 0, defenderGarrison: 1000, defenderQuality: 1.0, defenderMorale: 75,
  terrain: 'plains', fortification: 0,
}, RUNS, 340000);
console.log(formatBatchStats('10:1 plains', ratio10));
console.log('');

console.log('── [7] FULL STRESS SUITE (n=' + RUNS + '/scenario) ──');
const suite = runFullStressSuite(RUNS);
console.log(suite.summary);
console.log('');

console.log('── [8] SCENARIO SUITE (8 canonical + reproducibility) ──');
const reports = runBattleTestSuite({ seed: 42, verbose: false });
console.log(formatTestSuite(reports));
console.log('');
