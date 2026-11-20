import assert from 'node:assert/strict';
import { createScenario } from '../src/simulation/longrun/scenarios';
import { constructionStartProblem, getConstructionProjectDefinition, listConstructionProjectTypes } from '../src/gameplay/construction/definitions';
import { ensureCity } from '../src/gameplay/cities/city';
import { GAMEPLAY_CONFIG } from '../src/gameplay/config';
import { tradeDemand } from '../src/gameplay/trade/candidates';
import { observeSources } from '../src/engine/strategicPressure';
import { digest } from '../src/simulation/longrun/runner';
import { ErrorCode } from '../src/orchestration/errors';
const tests: [string,()=>void][]=[];
const test=(name:string,fn:()=>void)=>tests.push([name,fn]);
const world=()=>createScenario({size:'medium',seed:11,ticks:0,presence:'online'}).state;
test('pure prerequisites retain missing-territory and wrong-owner command errors',()=>{
 const s=world();
 for(const type of listConstructionProjectTypes())for(const ctx of [{state:s,factionId:'f_ai_0',territoryId:'missing'},{state:s,factionId:'f_ai_1',territoryId:s.factions.get('f_ai_0')!.territories[0]}]){
  const expected=constructionStartProblem(type,ctx);assert(expected);assert.equal(expected.code,ctx.territoryId==='missing'?ErrorCode.INVALID_TERRITORY:ErrorCode.ACTION_NOT_ALLOWED);
  assert.throws(()=>getConstructionProjectDefinition(type).assertCanStart(ctx),(e:any)=>e.code===expected.code&&e.message===expected.message&&JSON.stringify(e.details)===JSON.stringify(expected.details));
 }
});
test('existing developments remain unavailable and absent developments stay eligible',()=>{
 const s=world(),id=s.factions.get('f_ai_0')!.territories[0],ctx={state:s,factionId:'f_ai_0',territoryId:id};
 s.territoryInfrastructure.delete(id);
 for(const type of ['FARM','MINE','LUMBER'] as const)assert.equal(constructionStartProblem(type,ctx),null);
 s.territoryInfrastructure.set(id,{territoryId:id,farmCompletedAtTick:0,mineCompletedAtTick:0,lumberCompletedAtTick:0});
 for(const type of ['FARM','MINE','LUMBER'] as const){assert(constructionStartProblem(type,ctx));assert.throws(()=>getConstructionProjectDefinition(type).assertCanStart(ctx));}
});
test('city and fortification eligibility use the same authoritative native city and maximum level',()=>{
 const s=world(),id=s.factions.get('f_ai_0')!.territories[0],ctx={state:s,factionId:'f_ai_0',territoryId:id};
 for(const [key,c]of s.cities)if(c.territoryId===id)s.cities.delete(key);
 assert.equal(constructionStartProblem('CITY',ctx),null);assert(constructionStartProblem('FORTIFICATION',ctx));
 ensureCity(s,id,'f_ai_0');s.territories.get(id)!.fortification=0;
 assert(constructionStartProblem('CITY',ctx));assert.equal(constructionStartProblem('FORTIFICATION',ctx),null);
 s.territories.get(id)!.fortification=GAMEPLAY_CONFIG.maxFortificationLevel;assert(constructionStartProblem('FORTIFICATION',ctx));
});
test('Trade demand remains factual read-only and reflects native prerequisite changes',()=>{
 const s=world(),f=s.factions.get('f_ai_0')!;
 for(const id of f.territories){for(const [k,c]of s.cities)if(c.territoryId===id)s.cities.delete(k);s.territoryInfrastructure.set(id,{territoryId:id,farmCompletedAtTick:0,mineCompletedAtTick:0,lumberCompletedAtTick:0});}
 const before=digest(s),d=tradeDemand(s,f.id),cost=getConstructionProjectDefinition('CITY').cost;
 assert.equal(d.gold,cost.gold);assert.equal(d.stone,cost.stone);assert.equal(d.iron,cost.iron);assert.equal(d.wood,0);assert.equal(digest(s),before);
 for(const id of f.territories){ensureCity(s,id,f.id);s.territories.get(id)!.fortification=GAMEPLAY_CONFIG.maxFortificationLevel;}
 const none=tradeDemand(s,f.id);assert.equal(none.gold,0);assert.equal(none.stone,0);assert.equal(none.iron,0);
});
test('ordinary unavailable Trade and pressure candidates allocate no OrchestrationError stacks',()=>{
 const s=world(),errors=require('../src/orchestration/errors'),Original=errors.OrchestrationError;let count=0;
 errors.OrchestrationError=class extends Original{constructor(...args:any[]){super(...args);count++;}};
 try{for(let i=0;i<5;i++)for(const f of s.factions.values())if(f.id!==s.playerFactionId){tradeDemand(s,f.id);observeSources(s,f.id);}assert.equal(count,0);}finally{errors.OrchestrationError=Original;}
});
let passed=0,failed=0;for(const [name,fn]of tests){try{fn();passed++;console.log('PASS',name);}catch(e){failed++;console.error('FAIL',name,e);}}
console.log(JSON.stringify({passed,failed,skipped:0}));if(failed)process.exitCode=1;
