import { BattleEngine, BattleInput } from '../battle/BattleEngine';
import { LabParams, buildLabInput, runBattleLabBatch, formatBatchStats, BatchStats } from './battleTests';

export interface RatioScenario {
  label: string;
  params: LabParams;
  expected?: {
    minAttackerWinRate?: number;
    maxAttackerWinRate?: number;
    maxAttackerCasRate?: number;
    minDefenderCasRate?: number;
  };
}

export interface PropertyCheckResult {
  name: string;
  passed: boolean;
  detail: string;
  violationValues?: { step: number; before: number; after: number }[];
}

function plainTroops(
  atk: number,
  def: number,
  terrain: string = 'plains',
  atkMorale: number = 75,
  defMorale: number = 75,
  atkQuality: number = 1.0,
  defQuality: number = 1.0,
  fortification: number = 0,
): LabParams {
  return {
    attackerTroops: atk,
    attackerQuality: atkQuality,
    attackerMorale: atkMorale,
    defenderTroops: 0,
    defenderGarrison: def,
    defenderQuality: defQuality,
    defenderMorale: defMorale,
    terrain,
    fortification,
    isCapital: false,
  };
}

export const EXTREME_RATIO_SCENARIOS: RatioScenario[] = [
  { label: '1 vs 1 (plains)', params: plainTroops(1, 1) },
  { label: '10 vs 1 (plains)', params: plainTroops(10, 1), expected: { minAttackerWinRate: 0.85 } },
  { label: '100 vs 1 (plains)', params: plainTroops(100, 1), expected: { minAttackerWinRate: 0.985 } },
  { label: '1,000 vs 1 (plains)', params: plainTroops(1000, 1), expected: { minAttackerWinRate: 0.998, maxAttackerCasRate: 0.05 } },
  { label: '10,000 vs 1 (plains)', params: plainTroops(10000, 1), expected: { minAttackerWinRate: 0.999, maxAttackerCasRate: 0.03 } },
  { label: '1,000,000 vs 10 (plains)', params: plainTroops(1_000_000, 10), expected: { minAttackerWinRate: 0.999, maxAttackerCasRate: 0.02, minDefenderCasRate: 0.9 } },
  { label: '10,000,000 vs 10 (plains)', params: plainTroops(10_000_000, 10), expected: { minAttackerWinRate: 0.999, maxAttackerCasRate: 0.015, minDefenderCasRate: 0.92 } },
  { label: '100,000,000 vs 10 (plains)', params: plainTroops(100_000_000, 10), expected: { minAttackerWinRate: 0.999, maxAttackerCasRate: 0.012, minDefenderCasRate: 0.95 } },
];

export const EQUAL_FORCE_SCENARIOS: RatioScenario[] = [
  { label: '100 vs 100 (plains)', params: plainTroops(100, 100), expected: { maxAttackerWinRate: 0.58, minAttackerWinRate: 0.42 } },
  { label: '1,000 vs 1,000 (plains)', params: plainTroops(1000, 1000), expected: { maxAttackerWinRate: 0.58, minAttackerWinRate: 0.42 } },
  { label: '10,000 vs 10,000 (plains)', params: plainTroops(10000, 10000), expected: { maxAttackerWinRate: 0.58, minAttackerWinRate: 0.42 } },
];

export const RATIO_SCENARIOS: RatioScenario[] = [
  { label: '1.5:1 (plains, 1500 vs 1000)', params: plainTroops(1500, 1000), expected: { minAttackerWinRate: 0.55, maxAttackerWinRate: 0.68 } },
  { label: '2:1 (plains, 2000 vs 1000)', params: plainTroops(2000, 1000), expected: { minAttackerWinRate: 0.62, maxAttackerWinRate: 0.72 } },
  { label: '3:1 (plains, 3000 vs 1000)', params: plainTroops(3000, 1000), expected: { minAttackerWinRate: 0.70, maxAttackerWinRate: 0.82 } },
  { label: '5:1 (plains, 5000 vs 1000)', params: plainTroops(5000, 1000), expected: { minAttackerWinRate: 0.80, maxAttackerWinRate: 0.90 } },
  { label: '10:1 (plains, 10000 vs 1000)', params: plainTroops(10000, 1000), expected: { minAttackerWinRate: 0.88, maxAttackerWinRate: 0.96 } },
];

export interface StressReport {
  label: string;
  runs: number;
  stats: BatchStats;
  checksPassed: boolean;
  checks: { name: string; passed: boolean; actual: number; threshold: number; direction: 'gte' | 'lte' }[];
}

export function runStressScenario(scenario: RatioScenario, runs: number = 1000, seedBase: number = 500000): StressReport {
  const stats = runBattleLabBatch(scenario.params, runs, seedBase);
  const checks: StressReport['checks'] = [];
  if (scenario.expected?.minAttackerWinRate !== undefined) {
    checks.push({
      name: 'min attacker win rate',
      passed: stats.attackerWinRate >= scenario.expected.minAttackerWinRate,
      actual: stats.attackerWinRate,
      threshold: scenario.expected.minAttackerWinRate,
      direction: 'gte',
    });
  }
  if (scenario.expected?.maxAttackerWinRate !== undefined) {
    checks.push({
      name: 'max attacker win rate',
      passed: stats.attackerWinRate <= scenario.expected.maxAttackerWinRate,
      actual: stats.attackerWinRate,
      threshold: scenario.expected.maxAttackerWinRate,
      direction: 'lte',
    });
  }
  if (scenario.expected?.maxAttackerCasRate !== undefined) {
    checks.push({
      name: 'max attacker cas rate',
      passed: stats.avgAttackerCasRate <= scenario.expected.maxAttackerCasRate,
      actual: stats.avgAttackerCasRate,
      threshold: scenario.expected.maxAttackerCasRate,
      direction: 'lte',
    });
  }
  if (scenario.expected?.minDefenderCasRate !== undefined) {
    checks.push({
      name: 'min defender cas rate',
      passed: stats.avgDefenderCasRate >= scenario.expected.minDefenderCasRate,
      actual: stats.avgDefenderCasRate,
      threshold: scenario.expected.minDefenderCasRate,
      direction: 'gte',
    });
  }
  const checksPassed = checks.length === 0 ? true : checks.every((c) => c.passed);
  return { label: scenario.label, runs, stats, checksPassed, checks };
}

const PROPERTY_TOLERANCE = 0.025;

export function assertAttackerTroopMonotonicity(runsPerStep: number = 2000, seedBase: number = 700000): PropertyCheckResult {
  const steps = [10, 50, 200, 1000, 5000, 25000, 100000];
  const engine = new BattleEngine();
  let previousWinRate = -1;
  const violations: { step: number; before: number; after: number }[] = [];
  for (let idx = 0; idx < steps.length; idx++) {
    const atk = steps[idx];
    let wins = 0;
    for (let i = 0; i < runsPerStep; i++) {
      const input: BattleInput = buildLabInput(plainTroops(atk, 100), seedBase + idx * 10000 + i);
      const r = engine.resolve(input);
      if (r.winner === 'attacker') wins++;
    }
    const winRate = wins / runsPerStep;
    if (idx > 0 && winRate + PROPERTY_TOLERANCE < previousWinRate) {
      violations.push({ step: idx, before: previousWinRate, after: winRate });
    }
    previousWinRate = winRate;
  }
  return {
    name: 'Attacker troop monotonicity (more troops → never lower win rate)',
    passed: violations.length === 0,
    detail: violations.length === 0
      ? 'All steps show non-decreasing win rate as attacker troops grow.'
      : violations.map((v) => `step${v.step}: rate fell from ${v.before.toFixed(3)} → ${v.after.toFixed(3)}`).join('; '),
    violationValues: violations.length > 0 ? violations : undefined,
  };
}

export function assertAttackerMoraleMonotonicity(runsPerStep: number = 2000, seedBase: number = 720000): PropertyCheckResult {
  const moraleSteps = [20, 40, 60, 75, 85, 95];
  const engine = new BattleEngine();
  let previousWinRate = -1;
  const violations: { step: number; before: number; after: number }[] = [];
  for (let idx = 0; idx < moraleSteps.length; idx++) {
    const mor = moraleSteps[idx];
    let wins = 0;
    for (let i = 0; i < runsPerStep; i++) {
      const input: BattleInput = buildLabInput({
        ...plainTroops(900, 1000),
        attackerMorale: mor,
      }, seedBase + idx * 10000 + i);
      const r = engine.resolve(input);
      if (r.winner === 'attacker') wins++;
    }
    const winRate = wins / runsPerStep;
    if (idx > 0 && winRate + PROPERTY_TOLERANCE < previousWinRate) {
      violations.push({ step: idx, before: previousWinRate, after: winRate });
    }
    previousWinRate = winRate;
  }
  return {
    name: 'Attacker morale monotonicity (higher morale → never lower win rate)',
    passed: violations.length === 0,
    detail: violations.length === 0
      ? 'All morale steps show non-decreasing win rate.'
      : violations.map((v) => `step${v.step}: rate fell ${v.before.toFixed(3)} → ${v.after.toFixed(3)}`).join('; '),
    violationValues: violations.length > 0 ? violations : undefined,
  };
}

export function assertDefenseBonusMonotonicity(runsPerStep: number = 2000, seedBase: number = 740000): PropertyCheckResult {
  const terrains: { t: string; fort: number; expectedIncreasing: boolean }[] = [
    { t: 'plains', fort: 0, expectedIncreasing: true },
    { t: 'hills', fort: 0, expectedIncreasing: true },
    { t: 'forest', fort: 1, expectedIncreasing: true },
    { t: 'mountain', fort: 2, expectedIncreasing: true },
    { t: 'fortress', fort: 5, expectedIncreasing: true },
  ];
  const engine = new BattleEngine();
  let previousDefenderWinRate = -1;
  const violations: { step: number; before: number; after: number }[] = [];
  for (let idx = 0; idx < terrains.length; idx++) {
    const { t, fort } = terrains[idx];
    let defWins = 0;
    for (let i = 0; i < runsPerStep; i++) {
      const input: BattleInput = buildLabInput({
        ...plainTroops(1400, 1000),
        terrain: t,
        fortification: fort,
      }, seedBase + idx * 10000 + i);
      const r = engine.resolve(input);
      if (r.winner === 'defender') defWins++;
    }
    const defWinRate = defWins / runsPerStep;
    if (idx > 0 && defWinRate + PROPERTY_TOLERANCE < previousDefenderWinRate) {
      violations.push({ step: idx, before: previousDefenderWinRate, after: defWinRate });
    }
    previousDefenderWinRate = defWinRate;
  }
  return {
    name: 'Defense bonus monotonicity (better defense → never lower defender win rate)',
    passed: violations.length === 0,
    detail: violations.length === 0
      ? 'All terrain/fort steps show non-decreasing defender win rate.'
      : violations.map((v) => `step${v.step}: defender rate fell ${v.before.toFixed(3)} → ${v.after.toFixed(3)}`).join('; '),
    violationValues: violations.length > 0 ? violations : undefined,
  };
}

export function runFullStressSuite(runsPerScenario: number = 1000): {
  extremeReports: StressReport[];
  equalReports: StressReport[];
  ratioReports: StressReport[];
  properties: PropertyCheckResult[];
  overallPass: boolean;
  summary: string;
} {
  const extremeReports = EXTREME_RATIO_SCENARIOS.map((s, i) => runStressScenario(s, runsPerScenario, 500000 + i * 20000));
  const equalReports = EQUAL_FORCE_SCENARIOS.map((s, i) => runStressScenario(s, runsPerScenario, 600000 + i * 20000));
  const ratioReports = RATIO_SCENARIOS.map((s, i) => runStressScenario(s, runsPerScenario, 650000 + i * 20000));
  const properties = [
    assertAttackerTroopMonotonicity(2000, 700000),
    assertAttackerMoraleMonotonicity(2000, 720000),
    assertDefenseBonusMonotonicity(2000, 740000),
  ];
  const scenarioAllPass = [...extremeReports, ...equalReports, ...ratioReports].every((r) => r.checksPassed);
  const propAllPass = properties.every((p) => p.passed);
  const overallPass = scenarioAllPass && propAllPass;

  const lines: string[] = [];
  lines.push('╔══════════════════════════════════════════════════════════════╗');
  lines.push('║       REP WARS  ·  BATTLE ENGINE STRESS TEST SUITE          ║');
  lines.push('╚══════════════════════════════════════════════════════════════╝');
  lines.push('');
  lines.push(`Runs per scenario: ${runsPerScenario}`);
  lines.push(`Overall: ${overallPass ? 'PASS ✓' : 'FAIL ✗'}`);
  lines.push('');
  lines.push('── EXTREME FORCE RATIOS ──');
  for (const r of extremeReports) {
    const mark = r.checksPassed ? '✓' : '✗';
    lines.push(` ${mark} ${r.label}`);
    lines.push(`     ATK win: ${(r.stats.attackerWinRate * 100).toFixed(2)}%   casATK: ${(r.stats.avgAttackerCasRate * 100).toFixed(2)}%   casDEF: ${(r.stats.avgDefenderCasRate * 100).toFixed(2)}%`);
    for (const c of r.checks) {
      const cm = c.passed ? '  ok' : 'FAIL';
      lines.push(`     ${cm} ${c.name}: actual=${(c.actual * 100).toFixed(2)}%  ${c.direction === 'gte' ? '≥' : '≤'} ${(c.threshold * 100).toFixed(2)}%`);
    }
  }
  lines.push('');
  lines.push('── EQUAL FORCES ──');
  for (const r of equalReports) {
    const mark = r.checksPassed ? '✓' : '✗';
    lines.push(` ${mark} ${r.label}`);
    lines.push(`     ATK win: ${(r.stats.attackerWinRate * 100).toFixed(2)}%   DEF win: ${(r.stats.defenderWinRate * 100).toFixed(2)}%   draws: ${(r.stats.drawRate * 100).toFixed(2)}%`);
    for (const c of r.checks) {
      const cm = c.passed ? '  ok' : 'FAIL';
      lines.push(`     ${cm} ${c.name}: actual=${(c.actual * 100).toFixed(2)}%  ${c.direction === 'gte' ? '≥' : '≤'} ${(c.threshold * 100).toFixed(2)}%`);
    }
  }
  lines.push('');
  lines.push('── REPRESENTATIVE RATIOS ──');
  for (const r of ratioReports) {
    const mark = r.checksPassed ? '✓' : '✗';
    lines.push(` ${mark} ${r.label}`);
    lines.push(`     ATK win: ${(r.stats.attackerWinRate * 100).toFixed(2)}%   casATK: ${(r.stats.avgAttackerCasRate * 100).toFixed(2)}%   casDEF: ${(r.stats.avgDefenderCasRate * 100).toFixed(2)}%`);
    for (const c of r.checks) {
      const cm = c.passed ? '  ok' : 'FAIL';
      lines.push(`     ${cm} ${c.name}: actual=${(c.actual * 100).toFixed(2)}%  ${c.direction === 'gte' ? '≥' : '≤'} ${(c.threshold * 100).toFixed(2)}%`);
    }
  }
  lines.push('');
  lines.push('── PROPERTY INVARIANTS ──');
  for (const p of properties) {
    const mark = p.passed ? '✓ PASS' : '✗ FAIL';
    lines.push(` ${mark}  ${p.name}`);
    lines.push(`     ${p.detail}`);
  }
  lines.push('');
  lines.push('─'.repeat(62));
  return {
    extremeReports,
    equalReports,
    ratioReports,
    properties,
    overallPass,
    summary: lines.join('\n'),
  };
}

export function formatStressCsvReport(suite: ReturnType<typeof runFullStressSuite>): string {
  const rows: string[][] = [];
  rows.push(['Category', 'Label', 'ATK_win%', 'DEF_win%', 'Draw%', 'ATK_avg_cas%', 'DEF_avg_cas%', 'ATK_remaining', 'DEF_remaining']);
  for (const r of suite.extremeReports) {
    rows.push(['Extreme', r.label, (r.stats.attackerWinRate * 100).toFixed(2), (r.stats.defenderWinRate * 100).toFixed(2), (r.stats.drawRate * 100).toFixed(2),
      (r.stats.avgAttackerCasRate * 100).toFixed(2), (r.stats.avgDefenderCasRate * 100).toFixed(2),
      Math.round(r.stats.avgRemainingAttacker).toString(), Math.round(r.stats.avgRemainingDefender).toString()]);
  }
  for (const r of suite.equalReports) {
    rows.push(['Equal', r.label, (r.stats.attackerWinRate * 100).toFixed(2), (r.stats.defenderWinRate * 100).toFixed(2), (r.stats.drawRate * 100).toFixed(2),
      (r.stats.avgAttackerCasRate * 100).toFixed(2), (r.stats.avgDefenderCasRate * 100).toFixed(2),
      Math.round(r.stats.avgRemainingAttacker).toString(), Math.round(r.stats.avgRemainingDefender).toString()]);
  }
  for (const r of suite.ratioReports) {
    rows.push(['Ratio', r.label, (r.stats.attackerWinRate * 100).toFixed(2), (r.stats.defenderWinRate * 100).toFixed(2), (r.stats.drawRate * 100).toFixed(2),
      (r.stats.avgAttackerCasRate * 100).toFixed(2), (r.stats.avgDefenderCasRate * 100).toFixed(2),
      Math.round(r.stats.avgRemainingAttacker).toString(), Math.round(r.stats.avgRemainingDefender).toString()]);
  }
  return rows.map((r) => r.join(',')).join('\n');
}

export { formatBatchStats };
