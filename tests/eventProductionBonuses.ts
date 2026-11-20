import assert from 'node:assert/strict';
import {initializePlayerWorld} from '../src/persistence/initializePlayerWorld';
import {runEventEngineTurn} from '../src/world/eventTick';
import {WorldSimulator} from '../src/events/WorldSimulator';

export async function runEventProductionBonusTests(report:(name:string,fn:()=>void|Promise<void>)=>Promise<void>) {
  await report('Phase 5A production: natural discovery leaves underlying production intact',()=>{
    const s=initializePlayerWorld({playerId:'bonus-test',worldId:'Level 2',seed:11}).state;
    const gold=s.territories.get('t_07')!.resourceOutput.gold;
    const r=runEventEngineTurn(s,new WorldSimulator());
    assert(r.events.some(e=>e.id==='resource_discovery'));
    assert.equal(s.territories.get('t_07')!.resourceOutput.gold,gold);
  });
  await additional(report);
}

import {GameState} from '../src/types/GameState';
import {ActiveEvent} from '../src/events/EventModel';
import {EVENT_LIST} from '../src/events/EventDefinitions';
import {buildConditionContext} from '../src/events/EventTriggers';
import {SeededRNG} from '../src/utils/SeededRNG';
import {effectiveResourceOutput,ensureTerritoryInfrastructure} from '../src/gameplay/economy/effectiveOutput';
import {persistAllTerritoryAccrual} from '../src/gameplay/economy/accrual';
import {snapshotGameState} from '../src/persistence/snapshot';
import {hydratePersistedPayload} from '../src/persistence/hydrate';
import {cloneGameState} from '../src/state/cloneGameState';
import {checkGameStateInvariants} from '../src/state/gameStateInvariants';
import {withoutNewNaturalEvents} from './naturalEventFixtures';
import {temporaryProductionOutput,productionBonusProduct} from '../src/events/productionBonuses';
import {toWorldStepInput} from '../src/state/gameStateAdapters';

const fresh=()=>initializePlayerWorld({playerId:'bonus-test',worldId:'Level 2',seed:11}).state;
const reload=(s:GameState)=>hydratePersistedPayload(JSON.parse(JSON.stringify(snapshotGameState(s))));
const output=(s:GameState,id='t_07')=>effectiveResourceOutput(s,s.territories.get(id)!);
/** Existing definition and coefficients; explicit lifecycle fixture isolates the
 * production contract without new event types, probabilities or production content. */
function bonus(s:GameState,typeId:string,instanceId=typeId,start=0,end=60):ActiveEvent {
 const def=EVENT_LIST.find(e=>e.typeId===typeId)!;
 const ctx=buildConditionContext(start,'t_07',s.territories.get('t_07')!.owner,s.territories,s.factions,[],new SeededRNG(11));
 return {instanceId,typeId,category:def.category,title:'Production fixture',description:'',causes:[],severity:'minor',
  status:def.isInstant?'resolved':'active',territoryId:'t_07',factionId:s.territories.get('t_07')!.owner,
  triggeredTurn:start,startedTurn:start,expiresTurn:end,durationTurns:end-start,
  productionBonusPolicy:def.isInstant?'instant-v1':'active-v1',
  consequences:def.onTrigger(ctx,'minor').consequences,chainDelays:[],choicesPending:[]};
}
function setTick(s:GameState,tick:number){s.worldTick=tick;s.accruedTargetWorldTick=tick;}
async function additional(report:(name:string,fn:()=>void|Promise<void>)=>Promise<void>) {
 const test=(name:string,fn:()=>void|Promise<void>)=>report('Phase 5A production: '+name,fn);
 await test('single Trade Boom uses base before during and after its existing window',()=>{
  const s=fresh(),t=s.territories.get('t_07')!;t.resourceOutput.gold=100;
  assert.equal(output(s).gold,100);s.activeEvents=[bonus(s,'trade_boom')];assert.equal(output(s).gold,115);
  s.turn=30;assert.equal(output(s).gold,115);s.turn=60;assert.equal(output(s).gold,100);assert.equal(t.resourceOutput.gold,100);
 });
 await test('separate repeated activations never increase underlying output',()=>{
  const s=fresh();s.territories.get('t_07')!.resourceOutput.gold=100;
  for(let n=0;n<5;n++){s.turn=n*10;s.activeEvents.push(bonus(s,'trade_boom','boom-'+n,s.turn,s.turn+3));
   assert.equal(output(s).gold,115);s.turn+=3;assert.equal(output(s).gold,100);}
  assert.equal(s.territories.get('t_07')!.resourceOutput.gold,100);
 });
 await test('distinct active bonuses add against one basis and duplicate type cannot stack',()=>{
  const s=fresh();s.territories.get('t_07')!.resourceOutput.gold=100;
  s.activeEvents=[bonus(s,'trade_boom'),bonus(s,'prosperity'),bonus(s,'trade_boom','duplicate')];
  assert.equal(output(s).gold,123);s.activeEvents.reverse();assert.equal(output(s).gold,123);
 });
 await test('partial expiration removes only its own multiplier',()=>{
  const s=fresh();s.territories.get('t_07')!.resourceOutput.gold=100;
  s.activeEvents=[bonus(s,'trade_boom','boom',0,5),bonus(s,'prosperity','prosperity',0,10)];
  assert.equal(output(s).gold,123);s.turn=5;assert.equal(output(s).gold,108);s.turn=10;assert.equal(output(s).gold,100);
 });
 await test('permanent rate changes and Farm multiplier survive bonus expiry',()=>{
  const s=fresh(),t=s.territories.get('t_07')!;t.resourceOutput.food=100;
  ensureTerritoryInfrastructure(s,t.id).farmCompletedAtTick=0;s.activeEvents=[bonus(s,'prosperity')];
  assert.equal(output(s).food,162);t.resourceOutput.food=200;assert.equal(output(s).food,324);
  s.turn=60;assert.equal(output(s).food,300);assert.equal(reload(s).territories.get(t.id)!.resourceOutput.food,200);
 });
 await test('earned resources and Golden Yield basis survive expiry and cannot be credited twice',()=>{
  const s=fresh(),id='t_07',owner=s.territories.get(id)!.owner!;
  for(const t of s.territories.values())t.resourceOutput={gold:t.id===id?100:0};
  s.activeEvents=[bonus(s,'trade_boom')];const bank=s.factions.get(owner)!.resources.gold;
  setTick(s,60);persistAllTerritoryAccrual(s);assert.equal(s.factions.get(owner)!.resources.gold,bank+115);
  s.turn=60;persistAllTerritoryAccrual(s);assert.equal(s.factions.get(owner)!.resources.gold,bank+115);
  assert.equal(s.territoryEconomy.get(id)!.uncollected.gold,115);
  setTick(s,120);persistAllTerritoryAccrual(s);assert.equal(s.factions.get(owner)!.resources.gold,bank+215);
 });
 for(const turn of [0,30,59,60,61])await test(`active and expired terms survive exact JSON round-trip at turn ${turn}`,()=>{
  const s=fresh();s.territories.get('t_07')!.resourceOutput.gold=100;s.activeEvents=[bonus(s,'trade_boom')];s.turn=turn;
  const b=reload(s);assert.deepEqual(snapshotGameState(b),snapshotGameState(s));assert.deepEqual(output(b),output(s));
  setTick(s,120);setTick(b,120);persistAllTerritoryAccrual(s);persistAllTerritoryAccrual(b);assert.deepEqual(snapshotGameState(b),snapshotGameState(s));
 });
 await test('legacy baked-in rates load unchanged without a second application',()=>{
  const s=fresh();s.territories.get('t_07')!.resourceOutput.gold=200;
  const e=bonus(s,'trade_boom');delete e.productionBonusPolicy;s.activeEvents=[e];
  const b=reload(s);assert.equal(output(b).gold,200);b.turn=100;assert.equal(output(b).gold,200);
 });
 await test('instant Discovery uses its recorded one-turn window without changing immediate lifecycle',()=>{
  const s=fresh();runEventEngineTurn(s,new WorldSimulator());const e=s.activeEvents.find(e=>e.typeId==='resource_discovery'&&e.territoryId==='t_07')!;
  assert(e);assert.equal(e.status,'resolved');assert.equal(e.expiresTurn-e.startedTurn,1);assert.equal(output(s).gold,2);
  s.turn=e.expiresTurn;assert.equal(output(s).gold,1);
 });
 await test('activation and expiry flush the preceding interval without repricing it',()=>withoutNewNaturalEvents(()=>{
  const s=fresh();for(const t of s.territories.values())t.resourceOutput={gold:t.id==='t_07'?100:0};
  const owner=s.territories.get('t_07')!.owner!,bank=s.factions.get(owner)!.resources.gold;
  s.activeEvents=[bonus(s,'trade_boom','boom',0,1)];setTick(s,60);
  runEventEngineTurn(s,new WorldSimulator());assert.equal(s.factions.get(owner)!.resources.gold,bank+115);
  assert.equal(output(s).gold,100);assert.equal(s.activeEvents[0]!.status,'expired');
  setTick(s,120);persistAllTerritoryAccrual(s);assert.equal(s.factions.get(owner)!.resources.gold,bank+215);
 }));
 await test('cloning cannot share bonus terms and malformed policies fail persistence',()=>{
  const s=fresh();s.activeEvents=[bonus(s,'trade_boom')];const c=cloneGameState(s);
  c.activeEvents[0].consequences[1].delta.resourceOutputPct!.gold=0.5;
  assert.notDeepEqual(c.activeEvents[0].consequences,s.activeEvents[0].consequences);
  (c.activeEvents[0] as any).productionBonusPolicy='forged';assert.throws(()=>snapshotGameState(c));
  const bad=cloneGameState(s);bad.activeEvents[0].consequences[1].delta.resourceOutputPct!.gold=Infinity;assert.throws(()=>snapshotGameState(bad));
 });
 await test('percentage summation and half-up rounding are exact and ordering independent',()=>{
  const s=fresh();const a=bonus(s,'trade_boom'),b=bonus(s,'prosperity');
  // Arithmetic-only coefficients; not new game content or authored balance.
  a.consequences=[{territoryId:'t_07',delta:{resourceOutputPct:{gold:0.1}},message:'arithmetic'}];
  b.consequences=[{territoryId:'t_07',delta:{resourceOutputPct:{gold:0.2}},message:'arithmetic'}];
  assert.equal(temporaryProductionOutput(5,'gold','t_07',0,[a,b]),7);
  assert.equal(temporaryProductionOutput(5,'gold','t_07',0,[b,a]),7);
  assert.throws(()=>temporaryProductionOutput(Number.MAX_SAFE_INTEGER,'gold','t_07',0,[a]),/safe integer/);
 });
 await test('authored severity percentages retain exact decimal products before half-up rounding',()=>{
  const s=fresh(),ctx=buildConditionContext(0,'t_07',s.territories.get('t_07')!.owner,s.territories,s.factions,[],new SeededRNG(11));
  for(const [severity,expected] of [['minor',0.08],['moderate',0.144],['severe',0.224],['critical',0.336]] as const){
   const c=EVENT_LIST.find(e=>e.typeId==='prosperity')!.onTrigger(ctx,severity).consequences;
   assert.equal(c.find(c=>c.delta.resourceOutputPct)?.delta.resourceOutputPct?.gold,expected);
  }
  // Arithmetic contrast only: 3 is not an authored severity scale.
  assert.equal(productionBonusProduct(0.30,3),0.9);
  const e=bonus(s,'trade_boom');e.consequences=[{territoryId:'t_07',delta:{resourceOutputPct:{gold:productionBonusProduct(0.3,3)}},message:'arithmetic'}];
  assert.equal(temporaryProductionOutput(5,'gold','t_07',0,[e]),10);
 });
 await test('a consumed chain cannot create another consequence after reload',()=>withoutNewNaturalEvents(()=>{
  const s=fresh(),e=bonus(s,'drought','parent',0,10);
  e.chainDelays=[{toEventId:'evt_food_shortage',delayRemaining:-999,probability:1,severity:'minor'}];s.activeEvents=[e];
  const b=reload(s),out=new WorldSimulator().simulate({...toWorldStepInput(b),turn:1});
  assert.equal(out.triggeredEvents.length,0);assert.equal(out.newActiveEvents[0].chainDelays[0].delayRemaining,-999);
 }));
 await test('a ready chain rolls once after success but remains retryable after a failed roll',()=>withoutNewNaturalEvents(()=>{
  const s=fresh(),e=bonus(s,'drought','parent',0,10);
  e.chainDelays=[{toEventId:'evt_food_shortage',delayRemaining:0,probability:0,severity:'minor'}];s.activeEvents=[e];
  runEventEngineTurn(s,new WorldSimulator());assert.equal(s.activeEvents[0].chainDelays[0].delayRemaining,0);
  s.activeEvents[0].chainDelays[0].probability=1; // Controlled probability outcomes, not production configuration.
  runEventEngineTurn(s,new WorldSimulator());assert.equal(s.activeEvents[0].chainDelays[0].delayRemaining,-999);
  const b=reload(s);runEventEngineTurn(b,new WorldSimulator());
  assert.equal(b.activeEvents.filter(e=>e.causes.includes('Chain from event in parent')).length,1);
 }));
 await test('registered Level 2 passes tick 2371 and 3000 with exact continuous versus reloaded earnings',()=>{
  const a=fresh();let b=reload(a);const simulator=new WorldSimulator();
  const initialGold=[...a.territories.values()].map(t=>[t.id,t.resourceOutput.gold] as const);
  for(let tick=1;tick<=3000;tick++){
   for(const s of [a,b]){setTick(s,tick);runEventEngineTurn(s,simulator);persistAllTerritoryAccrual(s);}
   if(tick%64===0)b=reload(b);
   if(tick===2371||tick===3000){assert.deepEqual(snapshotGameState(b),snapshotGameState(a));
    assert.deepEqual(checkGameStateInvariants(a),[]);assert.deepEqual([...a.territories.values()].map(t=>[t.id,t.resourceOutput.gold]),initialGold);}
  }
 });
}
