const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require(process.cwd()+'/node_modules/typescript'),assert=require('node:assert/strict');
const file=path.join(process.cwd(),'src/gameplay/construction/definitions.ts'),m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(ts.transpileModule(fs.readFileSync('docs/ai-military-final-review/evidence/pre-performance-src_gameplay_construction_definitions.ts.txt','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,file);
const old=m.exports,current=require(file),{createScenario}=require(process.cwd()+'/src/simulation/longrun/scenarios'),{digest}=require(process.cwd()+'/src/simulation/longrun/runner');let checked=0;
for(const completed of [null,0,42])for(const city of [false,true])for(const fort of [0,1,2,3,4])for(const ownership of ['f_ai_0','f_ai_1']){
 const s=createScenario({size:'medium',seed:11,ticks:0,presence:'online'}).state,id=s.factions.get('f_ai_0').territories[0];s.territories.get(id).owner=ownership;s.territories.get(id).fortification=fort;
 for(const [key,c]of s.cities)if(c.territoryId===id)s.cities.delete(key);if(city)require(process.cwd()+'/src/gameplay/cities/city').ensureCity(s,id,ownership);
 s.territoryInfrastructure.set(id,{territoryId:id,farmCompletedAtTick:completed,mineCompletedAtTick:completed,lumberCompletedAtTick:completed});
 for(const tid of [id,'missing'])for(const type of old.listConstructionProjectTypes()){
  const ctx={state:s,factionId:'f_ai_0',territoryId:tid},before=digest(s);let expected=null;try{old.getConstructionProjectDefinition(type).assertCanStart(ctx);}catch(e){expected=e.toBody();}
  assert.deepEqual(JSON.parse(JSON.stringify(current.constructionStartProblem(type,ctx))),JSON.parse(JSON.stringify(expected)));let actual=null;try{current.getConstructionProjectDefinition(type).assertCanStart(ctx);}catch(e){actual=e.toBody();}
  assert.deepEqual(actual,expected);assert.equal(digest(s),before);checked++;
 }
}
console.log(JSON.stringify({checks:checked,mismatches:0,mutations:0,reference:'actual pre-performance production source'}));
