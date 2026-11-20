import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { runSimulation, canonical } from './runner';
import { ScenarioConfig } from './scenarios';
import { hydratePersistedPayload } from '../../persistence/hydrate';
import { strategicAccessOpportunity } from '../../army/strategicAccess';
import { armyHasActiveStrategicOperation, MIN_ATTACKING_TROOPS } from '../../army/strategicAttack';
import { availableLocalTroops } from '../../gameplay/recruitment/reinforcement';

const args=process.argv.slice(2),arg=(name:string,fallback:string)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const config:ScenarioConfig={size:arg('--size','small') as ScenarioConfig['size'],seed:Number(arg('--seed','11')),ticks:Number(arg('--ticks','360')),
  presence:arg('--presence','online') as ScenarioConfig['presence'],stepTicks:Number(arg('--step','1')),reloadEvery:60};
const mode=process.env.AI_BEHAVIOR_ENGINE==='approved-baseline'?'before':'after';
const directory=resolve(arg('--output',`docs/ai-behavior-fixes/results/${mode}/${config.size}-${config.seed}-${config.presence}-${config.ticks}`));
const memoryBefore=process.memoryUsage(),result=runSimulation(config),memoryAfter=process.memoryUsage(),state=hydratePersistedPayload(result.final);
const counts:Record<string,number>={};
for(const p of state.tradeProposals.values())if(p.status==='declined') {
  const key=JSON.stringify(canonical([p.proposer,p.recipient,p.plan.offered,p.plan.requested,p.plan.delivery,p.plan.proposerSource]));counts[key]=(counts[key]??0)+1;
}
const summary={...result.summary,engine:mode==='before'?'approved-baseline':'behavioral-candidate',
  memory:{rssBefore:memoryBefore.rss,rssAfter:memoryAfter.rss,heapBefore:memoryBefore.heapUsed,heapAfter:memoryAfter.heapUsed,maxRssBytes:process.resourceUsage().maxRSS*1024,
    note:'Fresh process per case; includes TypeScript/bootstrap, retained diagnostics and serialization, not pure engine memory.'},
  uncommittedArmies:[...state.armies.values()].filter(a=>a.owner!==state.playerFactionId&&!armyHasActiveStrategicOperation(a)).length,
  unservedReachableFrontiers:[...state.armies.values()].filter(a=>strategicAccessOpportunity(state,a.owner,a.id)).map(a=>a.id),
  militaryRecoveryBlocked:[...state.factions.values()].filter(f=>f.id!==state.playerFactionId&&f.territories.length&&!f.armies.length&&f.territories.some(id=>availableLocalTroops(state,id)>MIN_ATTACKING_TROOPS)).map(f=>f.id),
  failedAiUpkeepCycles:result.summary.failedUpkeepCycles-Math.floor(state.worldTick/60),
  bankStarvedWithLocalFood:[...state.factions.values()].filter(f=>f.id!==state.playerFactionId&&f.territories.length&&f.resources.food===0&&f.territories.some(id=>(state.territoryEconomy.get(id)?.uncollected.food??0)>0)).map(f=>f.id),
  repeatedDeclinedExactOffers:Object.values(counts).reduce((n,count)=>n+Math.max(0,count-1),0),declinedTermGroups:Object.keys(counts).length,
  contextBlockedPlans:[...state.aiPressure.values()].reduce((n,s)=>n+s.blockers.filter(b=>b.reasons.some(r=>r.kind==='CONTEXT')).length,0),
  decisionDomains:result.rows.filter(r=>r.kind==='decision').reduce((n:Record<string,number>,r)=>{const domain=(r.source as any).domain;n[domain]=(n[domain]??0)+1;return n;},{}),
};
mkdirSync(directory,{recursive:true});
writeFileSync(join(directory,'scenario.json'),JSON.stringify({config,definition:result.definition},null,2)+'\n');
writeFileSync(join(directory,'summary.json'),JSON.stringify(summary,null,2)+'\n');
writeFileSync(join(directory,'timeline.jsonl.gz'),gzipSync(result.rows.map(r=>JSON.stringify(r)).join('\n')+'\n'));
writeFileSync(join(directory,'final-state.json.gz'),gzipSync(JSON.stringify(result.final)+'\n'));
writeFileSync(join(directory,'timeline.md'),`# ${mode}: ${config.size}/${config.seed}/${config.presence}/${config.ticks}\n\n`+result.rows.map(r=>`- tick ${r.tick}: ${r.kind} ${r.faction??''} ${r.action??''} ${r.status??''} ${r.id??''}${r.kind==='decision'?` ${(r.decision as any).action} score=${(r.decision as any).score}`:''}`.trimEnd()).join('\n')+'\n');
process.stdout.write(JSON.stringify({directory,completed:summary.completed,elapsedSeconds:summary.elapsedSeconds,actions:summary.decisionActions,
  repeatDeclines:summary.repeatedDeclinedExactOffers,frontierGaps:summary.unservedReachableFrontiers,blockedRecovery:summary.militaryRecoveryBlocked,
  aiUpkeepFailures:summary.failedAiUpkeepCycles,maxRssBytes:summary.memory.maxRssBytes,error:summary.error})+'\n');
if(!summary.completed||summary.nestedErrors.length||summary.conservation.troopResidual||summary.conservation.siegeResidual||Object.values(summary.conservation.resourceResidual).some(n=>n!==0))process.exitCode=1;
