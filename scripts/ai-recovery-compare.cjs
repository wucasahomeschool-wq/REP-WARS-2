const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root='docs/ai-recovery-provisioning/results',current=path.join(root,'final-after');
const load=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const cases=fs.readdirSync(current).filter(n=>fs.existsSync(path.join(current,n,'summary.json'))).sort().map(name=>{
  const now=load(path.join(current,name,'summary.json'));
  const previous=load(path.join('docs/ai-behavior-fixes/results/final-after',name,'summary.json'));
  const reference=load(path.join('docs/ai-behavior-fixes/results/before',name,'summary.json'));
  const c=now.config,group=c.ticks===10080?'one-week':c.ticks===1440?'one-day':c.presence==='offline'?'offline-six-hours':c.size==='large'?'large-six-hours':'six-hours';
  const original=load(path.join('docs/ai-longrun/results',group,name,'summary.json'));
  assert.deepEqual(canonical(c),canonical(previous.config));assert.deepEqual(canonical(c),canonical(reference.config));assert.equal(reference.stateDigest,original.stateDigest);
  const definition=load(path.join(current,name,'scenario.json')).definition;
  assert.deepEqual(canonical(definition),canonical(load(path.join('docs/ai-longrun/results',group,name,'scenario.json')).definition));
  const metric=s=>({decisions:s.decisions,actions:s.decisionActions,operations:s.operations,operationActions:s.operationActions,battles:s.battles,captures:s.captures,
    formations:(s.formations??[]).filter(f=>f.status==='completed').length,recoveredFactions:s.recoveredFactions??[],
    frontierGaps:s.unservedReachableFrontiers.length,armylessWithPool:s.militaryRecoveryBlocked,
    foodFailures:s.failedAiUpkeepCycles,upkeepPaid:s.upkeepPaid,foodFinal:s.conservation.final.resources.food,
    recruited:s.conservation.recruited,trade:s.trade,shipments:s.shipments,repeatDeclines:s.repeatedDeclinedExactOffers,
    survivors:s.factions.filter(f=>f.territories||f.armies).length,seconds:s.elapsedSeconds,maxRssMiB:s.memory.maxRssBytes/1048576,
    canonicalDigest:s.stateDigest,conservation:s.conservation,peakConcurrentOperations:s.peakConcurrentOperations});
  const safe=s=>s.completed&&!s.error&&!s.conservation.troopResidual&&!s.conservation.siegeResidual&&Object.values(s.conservation.resourceResidual).every(n=>n===0);
  return {name,config:c,inputsMatch:true,originalReferenceDigestMatch:true,nestedErrors:now.nestedErrors,strictNestedErrorFree:!now.nestedErrors.length,completedAndConserved:safe(now)&&safe(previous)&&safe(reference),original:metric(reference),previous:metric(previous),current:metric(now)};
});
assert.equal(cases.length,16,'All sixteen original configurations are required');assert(cases.every(c=>c.completedAndConserved));
const main=cases.filter(c=>c.config.ticks===360&&c.config.presence==='online'),sum=(version,field)=>main.reduce((n,c)=>n+c[version][field],0);
const aggregate=Object.fromEntries(['original','previous','current'].map(version=>[version,{decisions:sum(version,'decisions'),actions:Object.fromEntries(['ATTACK','REINFORCE','BUILD','MOVE','OFFER_PEACE','TRADE','RETREAT','WAIT'].map(a=>[a,main.reduce((n,c)=>n+(c[version].actions[a]??0),0)])),operations:sum(version,'operations'),battles:sum(version,'battles'),captures:sum(version,'captures'),formations:sum(version,'formations'),recoveredFactionCases:main.reduce((n,c)=>n+c[version].recoveredFactions.length,0),frontierGaps:sum(version,'frontierGaps'),repeatDeclines:sum(version,'repeatDeclines')} ]));
fs.writeFileSync(path.join(root,'COMPARISON.json'),JSON.stringify({configurations:16,allCompletedAndConserved:true,casesWithNestedErrors:cases.filter(c=>!c.strictNestedErrorFree).map(c=>({name:c.name,errors:c.nestedErrors})),aggregate,cases},null,2)+'\n');
let md='# Authoritative military recovery comparison\n\nAll sixteen original inputs and authored definitions match. Reference digests match the original archived corpus. Original and previous results are preserved paired evidence; current results are fresh runs. No scenario resources, troops, seeds or time/presence settings changed.\n\n';
md+='| Case | Decisions previous→current | WAIT | ATTACK | MOVE | REINFORCE | Formed armies | Recovered faction cases | Battles | Captures | Food failures | Frontier gaps | Seconds | Peak RSS MiB |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n';
for(const c of cases){const b=c.previous,a=c.current,action=k=>`${b.actions[k]??0}→${a.actions[k]??0}`;md+=`| ${c.name} | ${b.decisions}→${a.decisions} | ${action('WAIT')} | ${action('ATTACK')} | ${action('MOVE')} | ${action('REINFORCE')} | ${a.formations} | ${a.recoveredFactions.length} | ${b.battles}→${a.battles} | ${b.captures}→${a.captures} | ${b.foodFailures}→${a.foodFailures} | ${b.frontierGaps}→${a.frontierGaps} | ${b.seconds.toFixed(2)}→${a.seconds.toFixed(2)} | ${b.maxRssMiB.toFixed(1)}→${a.maxRssMiB.toFixed(1)} |\n`;}
md+='\n## Nine equal-horizon six-hour online cases\n\n```json\n'+JSON.stringify(aggregate,null,2)+'\n```\n\n';
md+='Formations count completed native REINFORCE/new_army operations, not generated candidates. Final-after uses the final frozen production fingerprints; the preserved formation-only after matrix is excluded. Recovery counts are distinct faction IDs per case; labels repeat across independent worlds. Some formed armies are later destroyed. The inherited `militaryRecoveryBlocked` diagnostic means an army-less faction with a deployable pool at the final snapshot; it does not prove its current recovery plan is blocked. Proactive MOVE decisions and all physical MOVE operation counts are separate.\n\n';
md+='Strict nested-error-free cases: '+cases.filter(c=>c.strictNestedErrorFree).length+'/16. Every nonempty error array is retained in COMPARISON.json; a completed, conserved world does not by itself classify those errors. See the investigation in the implementation report.\n\n';
md+='Food administration remains blocked for a separately reviewed located-bank and transport contract. Automatic internal collection/transport added here: zero. Current logs establish paid upkeep, shortages, recruitment Food costs and net resource conservation; gross production/ownership-forfeiture Food is not separately tallied, and is not inferred from net balances. Changes in holdings/shortages follow changed wars and infrastructure, not a Food-provisioning fix.\n\n';
md+='Runtime includes native cloning, persistence, hydration, TypeScript/bootstrap and retained private scoring logs. Some host validation workloads overlapped; RSS/timing are observations, not isolated engine-performance guarantees. No source or test assumptions were changed to favor survival. All original and earlier artifacts remain preserved.\n';
fs.writeFileSync(path.join(root,'COMPARISON.md'),md);console.log(JSON.stringify({configurations:16,allCompletedAndConserved:true,casesWithNestedErrors:cases.filter(c=>!c.strictNestedErrorFree).map(c=>c.name),aggregate}));
