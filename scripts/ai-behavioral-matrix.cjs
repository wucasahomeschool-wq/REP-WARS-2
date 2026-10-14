const { spawnSync } = require('node:child_process');
const mode = process.argv[2] || 'after';
const outputArg=process.argv.indexOf('--output-root');
const outputRoot=outputArg>=0?process.argv[outputArg+1]:'docs/ai-behavior-fixes/results/'+mode;
if (!['before', 'after'].includes(mode)) throw new Error('Use before or after');
const cases = [];
for (const size of ['small', 'medium', 'large']) for (const seed of [11, 29, 47]) cases.push({ size, seed, ticks: 360, presence: 'online', step: 1 });
for (const size of ['small', 'medium', 'large']) cases.push({ size, seed: 29, ticks: 360, presence: 'offline', step: 5 });
for (const size of ['small', 'medium', 'large']) cases.push({ size, seed: 11, ticks: 1440, presence: 'online', step: 5 });
cases.push({ size: 'small', seed: 11, ticks: 10080, presence: 'online', step: 5 });
let failed = 0;
for (const c of cases) {
  const entry = mode === 'before' ? ['scripts/ai-behavioral-baseline.cjs', 'src/simulation/longrun/behavioralRun.ts'] : ['node_modules/ts-node/dist/bin.js', '--transpile-only', 'src/simulation/longrun/behavioralRun.ts'];
  const flags = Object.entries(c).flatMap(([key, value]) => ['--' + key, String(value)]).concat(['--output',outputRoot+'/'+c.size+'-'+c.seed+'-'+c.presence+'-'+c.ticks]);
  const result = spawnSync(process.execPath, [...entry, ...flags], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, AI_BEHAVIOR_ENGINE: mode === 'before' ? 'approved-baseline' : 'candidate' } });
  if (result.status !== 0) { failed++; process.stderr.write(JSON.stringify({ case: c, status: result.status }) + '\n'); }
}
process.stdout.write(JSON.stringify({ mode, cases: cases.length, failed }) + '\n');
if (failed) process.exitCode = 1;
