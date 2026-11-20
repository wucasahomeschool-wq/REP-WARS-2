import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { digest } from './runner';

const root=resolve(process.argv[2]??'docs/ai-behavior-fixes/results');
const load=(dir:string)=>new Map(readdirSync(dir,{withFileTypes:true}).filter(e=>e.isDirectory()&&existsSync(join(dir,e.name,'summary.json'))).map(e=>[e.name,JSON.parse(readFileSync(join(dir,e.name,'summary.json'),'utf8'))]));
const before=load(join(root,'before')),after=load(join(root,'final-after'));
const reports=[...before].sort(([a],[b])=>a<b?-1:a>b?1:0).flatMap(([name,b])=>{
  const a=after.get(name);if(!a)return [];
  if(digest(b.config)!==digest(a.config))throw new Error(`Different canonical inputs for ${name}`);
  const c=b.config,group=c.ticks===10080?'one-week':c.ticks===1440?'one-day':c.presence==='offline'?'offline-six-hours':c.size==='large'?'large-six-hours':'six-hours';
  const original=JSON.parse(readFileSync(join('docs/ai-longrun/results',group,name,'summary.json'),'utf8'));
  if(original.stateDigest!==b.stateDigest)throw new Error(`Reference replay differs from archived approved engine: ${name}`);
  const actions=Object.fromEntries(['ATTACK','REINFORCE','BUILD','MOVE','OFFER_PEACE','TRADE','RETREAT','WAIT'].map(action=>[action,{before:b.decisionActions[action]??0,after:a.decisionActions[action]??0}]));
  const residual=(s:any)=>s.conservation.troopResidual||s.conservation.siegeResidual||Object.values(s.conservation.resourceResidual).some(n=>n!==0);
  return [{name,config:c,originalBaselineHashVerified:true,before:b,after:a,actions,
    safe:b.completed&&a.completed&&!b.nestedErrors.length&&!a.nestedErrors.length&&!residual(b)&&!residual(a),
    runtimeRatio:a.elapsedSeconds/b.elapsedSeconds,
    survivors:{before:b.factions.filter((f:any)=>f.territories||f.armies).length,after:a.factions.filter((f:any)=>f.territories||f.armies).length},
    fieldTroops:{before:b.conservation.final.troops,after:a.conservation.final.troops},
  }];
});
const main=reports.filter(r=>r.config.presence==='online'&&r.config.ticks===360);
const sum=(which:'before'|'after',field:string)=>main.reduce((n,r)=>n+r[which][field],0);
const aggregate={matched:reports.length,expected:16,allSafe:reports.every(r=>r.safe),onlineSixHours:{
  decisions:{before:sum('before','decisions'),after:sum('after','decisions')},
  actions:Object.fromEntries(['ATTACK','REINFORCE','BUILD','MOVE','OFFER_PEACE','TRADE','RETREAT','WAIT'].map(action=>[action,{before:main.reduce((n,r)=>n+(r.before.decisionActions[action]??0),0),after:main.reduce((n,r)=>n+(r.after.decisionActions[action]??0),0)}])),
  operations:{before:sum('before','operations'),after:sum('after','operations')},battles:{before:sum('before','battles'),after:sum('after','battles')},captures:{before:sum('before','captures'),after:sum('after','captures')},
  repeatedDeclines:{before:sum('before','repeatedDeclinedExactOffers'),after:sum('after','repeatedDeclinedExactOffers')},
  frontierGaps:{before:main.reduce((n,r)=>n+r.before.unservedReachableFrontiers.length,0),after:main.reduce((n,r)=>n+r.after.unservedReachableFrontiers.length,0)},
}};
writeFileSync(join(root,'COMPARISON.json'),JSON.stringify({aggregate,cases:reports},null,2)+'\n');
let md='# Before/after authoritative simulation comparison\n\n';
md+='Before uses actual tracked code read from the pinned Git commit, not a reimplementation. Every reference state hash must match the original corpus. Inputs, seeds, presence histories, batching and reload cadence match. Final-after uses the frozen production fingerprints. Preliminary after/smoke directories are excluded.\n\n';
md+='| Scenario | Decisions before→after | WAIT | MOVE | ATTACK | Trade | Repeat declined terms | Frontier gaps | Battles | AI Food failures | Seconds | Peak RSS MiB |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n';
for(const r of reports){const b=r.before,a=r.after,action=(key:string)=>`${b.decisionActions[key]??0}→${a.decisionActions[key]??0}`;
  md+=`| ${r.name} | ${b.decisions}→${a.decisions} | ${action('WAIT')} | ${action('MOVE')} | ${action('ATTACK')} | ${action('TRADE')} | ${b.repeatedDeclinedExactOffers}→${a.repeatedDeclinedExactOffers} | ${b.unservedReachableFrontiers.length}→${a.unservedReachableFrontiers.length} | ${b.battles}→${a.battles} | ${b.failedAiUpkeepCycles}→${a.failedAiUpkeepCycles} | ${b.elapsedSeconds.toFixed(2)}→${a.elapsedSeconds.toFixed(2)} | ${(b.memory.maxRssBytes/1048576).toFixed(1)}→${(a.memory.maxRssBytes/1048576).toFixed(1)} |\n`;
}
md+='\n## Equal-horizon online aggregate\n\n```json\n'+JSON.stringify(aggregate.onlineSixHours,null,2)+'\n```\n\n';
md+='Each case also preserves native operation-action counts, status/terminal details, shipments, Goals, recruitment, resources, troop losses and survivor records in COMPARISON.json and the per-case artifacts. Repeat-decline counts group complete exact terms/endpoints/source, not merely counterparty. A retry after relevant context change is allowed; a lower count is not proof every rejection should have been prevented.\n\n';
md+='Frontier gaps mean idle uncommitted forces with a credible reachable target beyond local staging, measured using the same read-only physical query in both versions. Some distant first hops remain below the current commitment margin. No deployed replacement-army rule or Food transfer was implemented: changed starvation/survival counts can result from changed wars and elimination, not a fix to those blocked mechanics.\n\n';
md+='Elapsed runtime includes full scoring logs, canonical cloning, hydration and CAS. Peak RSS includes TypeScript/reference-loader/compiler and retained diagnostics; host workloads overlapped. Memory figures are observations, not pure-engine allocation comparisons. This is not a production throughput or gameplay-time guarantee.\n';
writeFileSync(join(root,'COMPARISON.md'),md);console.log(JSON.stringify(aggregate));
if(reports.length!==16||!aggregate.allSafe)process.exitCode=1;
