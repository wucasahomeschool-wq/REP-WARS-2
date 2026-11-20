import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const root = resolve(process.argv[2] ?? 'docs/ai-longrun/results');
function summaries(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? summaries(join(directory, entry.name)) : entry.name === 'summary.json' ? [join(directory, entry.name)] : []);
}
const reports = summaries(root).sort().map(path => {
  const summary = JSON.parse(readFileSync(path, 'utf8')), dir = path.slice(0, -'summary.json'.length);
  const raw = existsSync(join(dir, 'timeline.jsonl.gz')) ? gunzipSync(readFileSync(join(dir, 'timeline.jsonl.gz'))).toString() : readFileSync(join(dir, 'timeline.jsonl'), 'utf8');
  const rows: any[] = raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const decisions = rows.filter(r => r.kind === 'decision'), waits = decisions.filter(r => r.decision.action === 'WAIT'), battles = rows.filter(r => r.kind === 'battle');
  const count = (keys: string[]) => keys.reduce((n: Record<string, number>, k) => { n[k] = (n[k] ?? 0) + 1; return n; }, {});
  const repeatedWaits = count(waits.map(r => `${r.faction}:${r.source.domain}:${r.source.materialSignature}`));
  const opRecords = rows.filter(r => r.kind === 'operation');
  const finals = new Map<string, any>(); for (const r of opRecords) finals.set(r.id, r);
  // Old first-stage results predate this summary field. Reconstruct the sampled
  // boundary maximum from their unmodified operation transition timeline.
  const live = new Set<string>(); let sampledPeak = 0;
  for (let i = 0; i < rows.length; i++) { const r = rows[i]; if (r.kind === 'operation') { if (r.terminal) live.delete(r.id); else live.add(r.id); }
    if (i === rows.length - 1 || rows[i + 1].tick !== r.tick) sampledPeak = Math.max(sampledPeak, live.size); }
  const analyses = decisions.flatMap(r => r.decision.planComparisonDiagnostics?.comparisons ?? []);
  const goalPreference = analyses.filter(p => p.contributions.some((c: any) => c.owner === 'GOAL_MODIFIER' && c.normalizedMagnitude > 0)).length;
  const finalPath = join(dir, 'final-state.json.gz');
  const final = JSON.parse(existsSync(finalPath) ? gunzipSync(readFileSync(finalPath)).toString() : readFileSync(join(dir, 'final-state.json'), 'utf8'));
  const lifecycle = final.operations.$map.map(([id, op]: [string, any]) => ({ id, faction: op.warlordId, action: op.action, plan: op.plan,
    createdAtTick: op.createdAtTick, startedAtTick: op.startedAtTick ?? null, terminal: op.terminal, status: op.status, phase: op.phase, responseContextId: op.responseContextId ?? null }));
  lifecycle.sort((a: any, b: any) => a.createdAtTick - b.createdAtTick || a.id.localeCompare(b.id));
  writeFileSync(join(dir, 'operation-lifecycle.json'), JSON.stringify(lifecycle, null, 2) + '\n');
  return { path, name: `${summary.config.size}/${summary.config.seed}/${summary.config.presence}/${summary.config.ticks}`, summary,
    waitFraction: decisions.length ? waits.length / decisions.length : 0,
    waitDomains: count(waits.map(r => r.source.domain)), maximumIdenticalWaitSource: Math.max(0, ...Object.values(repeatedWaits)),
    lastDecision: Math.max(-1, ...decisions.map(r => r.tick)), sampledPeakConcurrent: Math.max(sampledPeak, summary.peakConcurrentOperations),
    battleWinners: count(battles.map(r => r.result.winner)), minimumResolvedAttackWinProbability: battles.length ? Math.min(...battles.map(r => r.result.attackerWinProbability)) : null,
    constructionTypes: count([...finals.values()].filter(r => r.action === 'BUILD').map(r => r.plan.projectType)),
    terminalReasons: count([...finals.values()].filter(r => r.terminal).map(r => r.terminal.reason)),
    goalPreferenceComparisons: goalPreference,
    goalStates: count(summary.factions.flatMap((f: any) => f.goals.filter((g: any) => g.id.startsWith('sim-')).map((g: any) => g.lifecycle.status))),
    survivors: summary.factions.filter((f: any) => f.territories || f.armies).length,
    survivingWithoutArmies: summary.factions.filter((f: any) => f.territories && !f.armies).map((f: any) => f.id),
    eventBatches: rows.filter(r => r.kind === 'world_events').length,
    // The required zero-bank observer also has one owned tile and therefore
    // fails its native upkeep every cycle. Keep this fixture noise separate.
    failedAiUpkeepCycles: summary.failedUpkeepCycles - Math.floor(summary.processedTick / 60),
    failedObserverUpkeepCycles: Math.floor(summary.processedTick / 60),
    completedOperationCount: [...finals.values()].filter(r => r.terminal?.outcome === 'completed').length,
    decisionsOutsideProactiveVocabulary: decisions.filter(r => !['ATTACK','REINFORCE','BUILD','MOVE','OFFER_PEACE','TRADE','RETREAT','WAIT'].includes(r.decision.action)).length,
  };
});
writeFileSync(join(root, 'analysis.json'), JSON.stringify(reports, null, 2) + '\n');
let md = '# Actual seeded simulation results\n\nWorld tick = one simulation minute. Online receipts earn one tick/minute; offline receipts earn one tick/ten real minutes. Runtime includes diagnostic recording and in-memory CAS serialization; concurrent host workloads affect elapsed time.\n\n';
md += '| Scenario/seed/presence/ticks | Complete | Decisions (WAIT) | Operations | Battles/captures | Survivors | Seconds | Conservation residual |\n|---|---:|---:|---:|---:|---:|---:|---|\n';
for (const r of reports) { const s = r.summary, c = s.conservation;
  md += `| ${r.name} | ${s.completed} | ${s.decisions} (${s.decisionActions.WAIT ?? 0}) | ${s.operations} | ${s.battles}/${s.captures} | ${r.survivors} | ${s.elapsedSeconds.toFixed(3)} | troops ${c.troopResidual}; siege ${c.siegeResidual}; resources ${Object.values(c.resourceResidual).join('/')} |\n`; }
md += '\n## Behavioral evidence\n\n';
for (const r of reports) md += `- ${r.name}: last decision tick ${r.lastDecision}; WAIT ${(100*r.waitFraction).toFixed(1)}%; at most ${r.maximumIdenticalWaitSource} WAIT choices on one identical material source; sampled concurrent operations ${r.sampledPeakConcurrent}; no-army survivors ${r.survivingWithoutArmies.join(', ') || 'none'}; minimum resolved attacker win probability ${r.minimumResolvedAttackWinProbability}; Goal-favored comparisons ${r.goalPreferenceComparisons}; Goals ${JSON.stringify(r.goalStates)}; construction ${JSON.stringify(r.constructionTypes)}; AI failed upkeep cycles ${r.failedAiUpkeepCycles} (observer ${r.failedObserverUpkeepCycles}); Peace ${JSON.stringify(r.summary.peace)}; Trade ${JSON.stringify(r.summary.trade)}; shipments ${JSON.stringify(r.summary.shipments)}.\n`;
writeFileSync(join(root, 'RESULTS.md'), md);
console.log(`Analyzed ${reports.length} complete/partial run artifacts; see ${join(root, 'RESULTS.md')}`);
