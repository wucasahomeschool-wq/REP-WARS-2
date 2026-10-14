// Read-only reference loader: actual tracked TypeScript at the approved commit,
// current untracked development harness. No checkout/reset/worktree mutation.
const fs = require('node:fs');
const path = require('node:path');
const child = require('node:child_process');
const root = process.cwd();
const baseline = '6f38eec6516682e64937b08744a5607f54bbba91';
const target = process.argv[2];
if (!target) throw new Error('Supply a development TypeScript entry point');
require(root + '/node_modules/ts-node/register/transpile-only');
const ts = require(root + '/node_modules/typescript');
const native = require.extensions['.ts'];
const tracked = new Set(child.execFileSync('git', ['ls-tree', '-r', '--name-only', baseline, 'src'], { cwd: root, encoding: 'utf8' }).trim().split('\n'));
let pinnedModules = 0;
require.extensions['.ts'] = (module, filename) => {
  const relative = path.relative(root, filename).split(path.sep).join('/');
  if (!relative.startsWith('src/') || !tracked.has(relative)) return native(module, filename);
  const source = child.execFileSync('git', ['show', baseline + ':' + relative], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } });
  pinnedModules++;
  module._compile(compiled.outputText, filename);
};
process.argv = [process.argv[0], path.resolve(target), ...process.argv.slice(3)];
process.env.AI_BEHAVIOR_ENGINE = 'approved-baseline';
process.on('exit', () => process.stderr.write(JSON.stringify({ baseline, pinnedModules, referenceLoader: 'read-only Git blobs' }) + '\n'));
require(path.resolve(target));
