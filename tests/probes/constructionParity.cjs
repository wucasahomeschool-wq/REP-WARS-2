// Read-only prerequisite comparison against a pinned Git revision. Run using
// node -r ts-node/register tests/probes/constructionParity.cjs <parent-commit>.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
const root=process.cwd(),ts=require(root+'/node_modules/typescript');
const revision=execFileSync('git',['rev-parse','--verify',(process.argv[2]||'HEAD')+'^{commit}'],{encoding:'utf8'}).trim();
const file='src/gameplay/construction/definitions.ts',filename=root+'/'+file;
const source=execFileSync('git',['show',revision+':'+file],{encoding:'utf8'});
const reference=new Module(filename,module);reference.filename=filename;reference.paths=Module._nodeModulePaths(path.dirname(filename));
reference._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const current=require(filename),{createGameState}=require(root+'/src/state'),{loadTinyWorldDefinition}=require(root+'/src/worldDefinition/catalog');
const {cloneGameState}=require(root+'/src/state/cloneGameState'),{snapshotGameState}=require(root+'/src/persistence/snapshot');
const {ensureCity,cityIdFor}=require(root+'/src/gameplay/cities/city'),{ensureTerritoryInfrastructure}=require(root+'/src/gameplay/economy/effectiveOutput');
const {GAMEPLAY_CONFIG}=require(root+'/src/gameplay/config');
const loaded=loadTinyWorldDefinition();assert.ok(loaded.ok);const initial=createGameState({world:loaded.definition,seed:11});let cases=0;
function result(def,ctx){try{def.assertCanStart(ctx);return null;}catch(error){return JSON.parse(JSON.stringify(error.toBody()));}}
for(let n=0;n<120;n++){
 const state=cloneGameState(initial),territory=[...state.territories.values()][n%state.territories.size];
 state.cities.delete(cityIdFor(territory.id));if(n&1)ensureCity(state,territory.id,territory.owner);
 territory.fortification=n%3===0?GAMEPLAY_CONFIG.maxFortificationLevel:0;
 const infra=ensureTerritoryInfrastructure(state,territory.id);
 for(const [i,key]of ['farmCompletedAtTick','mineCompletedAtTick','lumberCompletedAtTick'].entries())infra[key]=(n&(2<<i))?0:null;
 const ctx={state,territoryId:n%10===0?'missing':territory.id,factionId:n%11===0?'foreign':territory.owner};
 const before=JSON.stringify(snapshotGameState(state));
 for(const type of current.listConstructionProjectTypes()){
  const old=result(reference.exports.getConstructionProjectDefinition(type),ctx);
  const next=result(current.getConstructionProjectDefinition(type),ctx);
  assert.deepEqual(next,old);assert.deepEqual(JSON.parse(JSON.stringify(current.constructionStartProblem(type,ctx))),old);
  assert.equal(JSON.stringify(snapshotGameState(state)),before);cases++;
 }
}
console.log(JSON.stringify({reference:revision,cases,mismatches:0,inputMutations:0,referenceSha256:createHash('sha256').update(source).digest('hex'),currentSha256:createHash('sha256').update(fs.readFileSync(filename)).digest('hex')}));
