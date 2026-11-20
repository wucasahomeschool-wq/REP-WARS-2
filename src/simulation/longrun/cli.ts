import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { runSimulation } from './runner';
import { ScenarioConfig, SIZES } from './scenarios';

const args = process.argv.slice(2);
const arg = (key: string, fallback: string) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const sizes = arg('--sizes', 'small,medium,large').split(',') as (keyof typeof SIZES)[];
const seeds = arg('--seeds', '11,29,47').split(',').map(Number);
const output = resolve(arg('--output', 'docs/ai-longrun/results'));
const summaries: unknown[] = [];
for (const size of sizes) for (const seed of seeds) {
  if (!(size in SIZES)) throw new Error(`Unknown size ${size}`);
  const config: ScenarioConfig = { size, seed, ticks: Number(arg('--ticks', '360')), presence: arg('--presence', 'online') as 'online' | 'offline', stepTicks: Number(arg('--step', '1')), reloadEvery: Number(arg('--reload', '60')) };
  const result = runSimulation(config), name = `${size}-${seed}-${config.presence}-${config.ticks}`, directory = join(output, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'scenario.json'), JSON.stringify({ config, definition: result.definition }, null, 2) + '\n');
  writeFileSync(join(directory, 'summary.json'), JSON.stringify(result.summary, null, 2) + '\n');
  writeFileSync(join(directory, 'timeline.jsonl.gz'), gzipSync(result.rows.map(row => JSON.stringify(row)).join('\n') + '\n'));
  writeFileSync(join(directory, 'final-state.json.gz'), gzipSync(JSON.stringify(result.final) + '\n'));
  writeFileSync(join(directory, 'timeline.md'), `# ${name}\n\n` + result.rows.map(row => `- tick ${row.tick}: ${row.kind} ${row.faction ?? ''} ${row.action ?? ''} ${row.status ?? ''} ${row.id ?? ''}${row.kind === 'decision' ? ` ${(row.decision as any).action} score=${(row.decision as any).score}` : ''}${row.kind === 'ownership' ? ` ${row.from} → ${row.to}` : ''}`.trimEnd()).join('\n') + '\n');
  summaries.push(result.summary);
  process.stdout.write(JSON.stringify({ name, completed: result.summary.completed, seconds: result.summary.elapsedSeconds, decisions: result.summary.decisionActions, operations: result.summary.operationActions, battles: result.summary.battles, error: result.summary.error, conservation: result.summary.conservation }) + '\n');
}
writeFileSync(join(output, 'matrix.json'), JSON.stringify(summaries, null, 2) + '\n');
if (summaries.some((s: any) => !s.completed || s.nestedErrors.length || s.conservation.troopResidual !== 0 || s.conservation.siegeResidual !== 0 || Object.values(s.conservation.resourceResidual).some(n => n !== 0))) process.exitCode = 1;
