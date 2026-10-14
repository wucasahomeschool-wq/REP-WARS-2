const fs=require('node:fs'),path=require('node:path'),{performance}=require('node:perf_hooks');
const root=process.cwd(),stats={};
const specs={
 'src/army/strategicAccess':['strategicAccessOpportunity','ownedTravel'],
 'src/army/fieldRecovery':['fieldRecoveryOpportunity'],
 'src/engine/strategicPressure':['deriveSources','sourcePlanPredicates','observeSources'],
 'src/state/cloneGameState':['cloneGameState'],
 'src/persistence/snapshot':['snapshotGameState'],
 'src/persistence/hydrate':['hydratePersistedPayload'],
 'src/state/gameStateInvariants':['checkGameStateInvariants'],
 'src/server/gameplaySessionLifecycle':['commitGameplaySession'],
};
for(const [file,names]of Object.entries(specs)){
 const m=require(path.join(root,file));for(const name of names){const native=m[name];if(typeof native!=='function')continue;
 m[name]=function(...args){const t=performance.now();try{return native.apply(this,args);}finally{const r=stats[name]??={calls:0,milliseconds:0};r.calls++;r.milliseconds+=performance.now()-t;}};
}}
const {ContextPlanComparator}=require(path.join(root,'src/scoring/contextPlanComparison'));
for(const name of ['compare','evaluate']){const native=ContextPlanComparator.prototype[name];if(!native)continue;ContextPlanComparator.prototype[name]=function(...args){const t=performance.now();try{return native.apply(this,args);}finally{const r=stats['comparator.'+name]??={calls:0,milliseconds:0};r.calls++;r.milliseconds+=performance.now()-t;}};}
const {runSimulation}=require(path.join(root,'src/simulation/longrun/runner'));
const result=runSimulation({size:'medium',seed:11,ticks:1440,presence:'online',stepTicks:5,reloadEvery:60});
const out=process.env.REVIEW_OUTPUT;
fs.writeFileSync(out,JSON.stringify({stats,summary:result.summary},null,2)+'\n');
fs.writeFileSync(out.replace('.json','-state.json.gz'),require('node:zlib').gzipSync(JSON.stringify(result.final)));
fs.writeFileSync(out.replace('.json','-timeline.jsonl.gz'),require('node:zlib').gzipSync(result.rows.map(r=>JSON.stringify(r)).join('\n')));
console.log(JSON.stringify({out,elapsed:result.summary.elapsedSeconds,digest:result.summary.stateDigest,decisions:result.summary.decisions,battles:result.summary.battles,stats}));
