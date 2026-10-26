const assert=require('node:assert/strict');
const root=process.cwd();
const attacks=require(root+'/src/army/strategicAttack');
const ops=require(root+'/src/engine/operations');
const attention=require(root+'/src/engine/strategicAttention');
const {BattleEngine}=require(root+'/src/battle/BattleEngine');
const originalAttack=attacks.executeReadyStrategicAttack,originalSettle=ops.settleOperation,originalBattle=BattleEngine.prototype.resolve;
let battles=0;const pending=new Map(),records=[];
const physical=s=>JSON.stringify({armies:[...s.armies.values()].map(a=>({id:a.id,owner:a.owner,location:a.location,soldiers:a.soldiers,knights:a.knights,siege:a.siegeEngines,morale:a.morale,supply:a.supply})),
 territories:[...s.territories.values()].map(t=>({id:t.id,owner:t.owner,garrison:t.garrison})),resources:[...s.factions].map(([id,f])=>({id,resources:f.resources})),
 pools:[...s.territoryRecruitment],economy:[...s.territoryEconomy],banked:s.playerRewards.bankedTroops,nextArmySequence:s.nextArmySequence,seed:s.worldSeed});
BattleEngine.prototype.resolve=function(...args){battles++;return originalBattle.apply(this,args)};
attacks.executeReadyStrategicAttack=function(s,host,id){
 const a=s.armies.get(id),intent=a?.attackIntent?{...a.attackIntent}:null;
 const before=physical(s),calls=battles;
 const result=originalAttack(s,host,id);
 if(result.errors?.some(e=>e.code==='INVALID_TARGET')) {
  assert.ok(intent);const target=s.territories.get(intent.targetTerritoryId);
  assert.notEqual(target.owner,intent.targetFactionId);assert.notEqual(target.owner,a.owner);
  assert.equal(physical(s),before);assert.equal(battles,calls);
  pending.set(intent.commitmentId,{operation:intent.commitmentId,tick:s.worldTick,army:id,expectedOwner:intent.targetFactionId,actualOwner:target.owner,
   preservedPhysicalState:true,battlesInvoked:0});
 }
 return result;
};
ops.settleOperation=function(s,id,...args){
 const record=pending.get(id),before=record?physical(s):null,occupied=record?attention.occupiedAttention(s,s.operations.get(id).warlordId):null;
 const result=originalSettle(s,id,...args);
 if(record) {
  const op=s.operations.get(id);assert.equal(result,true);assert.equal(op.terminal.outcome,'failed');assert.deepEqual(op.claimIds,[]);
  assert.equal([...s.operationClaims.values()].some(c=>c.operationId===id),false);assert.equal(physical(s),before);
  assert.equal(op.attention.releasedAtTick,s.worldTick);
  const remaining=attention.occupiedAttention(s,op.warlordId);assert.equal(remaining,occupied-op.attention.cost);
  records.push({...record,claimsReleased:true,attentionBefore:occupied,attentionAfter:remaining,settlementPreservedPhysicalState:true});pending.delete(id);
 }
 return result;
};
(async()=>{
 const helper=require(root+'/tests/backendScale'),def=helper.createScaleWorld(50,8);
 require(root+'/src/worldDefinition/catalog').getDefaultWorldCatalog().register(def);
 const result=await helper.runScaleWorld(def,29,1);
 assert.equal(records.length,1);assert.equal(pending.size,0);
 console.log(JSON.stringify({records,metrics:result.metrics},null,2));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{attacks.executeReadyStrategicAttack=originalAttack;ops.settleOperation=originalSettle;BattleEngine.prototype.resolve=originalBattle;});
