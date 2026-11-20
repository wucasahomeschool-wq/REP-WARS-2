const root=process.cwd(),fs=require('node:fs'),path=require('node:path'),ts=require(root+'/node_modules/typescript'),native=require.extensions['.ts'];
if(process.env.REVIEW_PRE_PERFORMANCE==='1')require.extensions['.ts']=(m,f)=>{const rel=path.relative(root,f).split(path.sep).join('/');const old='docs/ai-military-final-review/evidence/pre-performance-'+rel.replaceAll('/','_')+'.txt';if(fs.existsSync(old))m._compile(ts.transpileModule(fs.readFileSync(old,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);else native(m,f);};
const errors=require(root+'/src/orchestration/errors'),Original=errors.OrchestrationError;let count=0;errors.OrchestrationError=class extends Original{constructor(...args){super(...args);count++;}};
const {createScenario}=require(root+'/src/simulation/longrun/scenarios'),{tradeDemand}=require(root+'/src/gameplay/trade/candidates'),{observeSources}=require(root+'/src/engine/strategicPressure');
const s=createScenario({size:'medium',seed:11,ticks:0,presence:'online'}).state;
for(let i=0;i<5;i++)for(const f of s.factions.values())if(f.id!==s.playerFactionId){tradeDemand(s,f.id);observeSources(s,f.id);}
console.log(JSON.stringify({before:process.env.REVIEW_PRE_PERFORMANCE==='1',factionBoundaryPasses:25,errorStacks:count}));
