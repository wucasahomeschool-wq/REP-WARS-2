// Read-only probe. Run from the candidate root with ts-node/register; optional
// first argument is another existing worktree to compare. No Git/file mutations.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const roots = { current: process.cwd() };
if (process.argv[2]) roots.reference = path.resolve(process.argv[2]);
const validators = Object.fromEntries(Object.entries(roots).map(([key, root]) => [key, require(root + '/src/worldDefinition/validate').validateWorldDefinition]));
const heads = Object.fromEntries(Object.entries(roots).map(([key, root]) => [key, execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {encoding:'utf8'}).trim()]));
const sources = Object.fromEntries(Object.entries(roots).map(([key, root]) => [key, {
  geometrySha256: createHash('sha256').update(readFileSync(root + '/src/worldDefinition/geometry.ts')).digest('hex'),
  trackedStatus: execFileSync('git', ['-C', root, 'status', '--short', '--untracked-files=no'], {encoding:'utf8'}).trim(),
}]));
const results = [];
for (const file of ['level-1.json', 'level-2.json']) {
  const definition = require(process.cwd() + '/worlds/' + file), samples = Object.fromEntries(Object.keys(roots).map(key => [key, []]));
  for (let i = 0; i < 6; i++) {
    const order = Object.keys(roots); if (i % 2) order.reverse();
    for (const key of order) {
      const start = performance.now(), issues = validators[key](definition), ms = performance.now() - start;
      assert.deepEqual(issues, []); if (i) samples[key].push(Math.round(ms));
    }
  }
  results.push({file, samples, medianMs:Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, [...values].sort((a,b)=>a-b)[2]]))});
}
console.log(JSON.stringify({node:process.version,heads,sources,results},null,2));
