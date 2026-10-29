import {beginWorkoutSession,completeExercise,getCurrentExercise,abandonWorkoutSession} from '../src/fitness/session';
import {loadProductionLevel1Definition,parseWorldJson,serializeWorldDefinitionForClient} from '../src/worldDefinition';
import {createSessionHost} from '../src/server/session';
import type {PlayerWorldPersistence} from '../src/server/persistencePort';
import {InMemoryGameStateStore} from '../src/persistence/inMemoryGameStateStore';
import {InMemoryWorkoutHistoryStore} from '../src/fitness/history/inMemoryStore';
import {ensurePlayerWorld} from '../src/persistence/initializePlayerWorld';
import {applyPlayerTerritoryLoss} from '../src/gameplay/anchors';
import {applyWorldCompletionCheck} from '../src/gameplay/completion';
import {restartDefeatedWorld} from '../src/gameplay/worldRestart';
import {emptyResources} from '../src/gameplay/economy/config';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {collectTerritoryYield} from '../src/gameplay/economy/collect';
import assert from 'node:assert/strict';
import {createGameState,createLegacySampleMapGameState} from '../src/state/createGameState';
import {Orchestrator} from '../src/orchestration/orchestrator';
import {bankedTroops,creditTroopBank,troopBankId} from '../src/gameplay/military/troopBank';
import {makeConcretePlan} from '../src/types/AIConcretePlan';
import {progressRecruitment,RECRUITMENT_WORK_PER_TICK} from '../src/gameplay/recruitment/recruitment';
import {progressWorldEconomy} from '../src/gameplay/economy/worldProgress';
import {consumeEmpireFood} from '../src/gameplay/economy/foodConsumption';
import {persistAllTerritoryAccrual} from '../src/gameplay/economy/accrual';
import {snapshotGameState} from '../src/persistence/snapshot';
import {hydratePersistedPayload} from '../src/persistence/hydrate';
import {checkGameStateInvariants} from '../src/state/gameStateInvariants';
import {settleOperation} from '../src/engine/operations';
import {cloneGameState} from '../src/state/cloneGameState';
import {migrateEmpireBanks} from '../src/persistence/empireBankMigration';

export function registerGameplayContractTests({test}:{test:(name:string,fn:()=>void|Promise<void>)=>void}) {
  const fixture=()=>{const s=createGameState();s.playerRewards.bankedTroops=100;return s;};
  test('empire contract: instant deployment conserves bank plus world soldiers',()=>{
    const s=fixture(),fid=s.playerFactionId!,t=[...s.territories.values()].find(t=>t.owner===fid)!;
    const before=[...s.armies.values()].reduce((n,a)=>n+a.soldiers,0),o=new Orchestrator(s);
    const r=o.execute({commandId:'DEPLOY_TROOPS',playerId:'p',parameters:{territoryId:t.id,quantity:40}});
    assert(r.success,JSON.stringify(r));const after=o.getState(),a=after.armies.get(r.payload.armyId as string)!;
    assert.equal(a.location,t.id);assert.equal(a.movement,null);assert.equal(a.soldiers,40);assert.equal(after.worldTick,s.worldTick);
    assert.equal(after.playerRewards.bankedTroops,60);assert.equal([...after.armies.values()].reduce((n,a)=>n+a.soldiers,0),before+40);
    assert.deepEqual(checkGameStateInvariants(after),[]);
  });
  for(const quantity of [0,-1,1.5,101,Number.MAX_SAFE_INTEGER+1])test(`empire contract: invalid deployment ${quantity} leaves state unchanged`,()=>{
    const s=fixture(),o=new Orchestrator(s),before=snapshotGameState(o.getState());
    const r=o.execute({commandId:'DEPLOY_TROOPS',playerId:'p',parameters:{territoryId:s.levelAnchorTerritoryIds[0],quantity}});
    assert.equal(r.success,false);assert.deepEqual(snapshotGameState(o.getState()),before);
  });
  test('empire contract: wrong-owner deployment rejected',()=>{
    const s=fixture(),o=new Orchestrator(s),t=[...s.territories.values()].find(t=>t.owner!==s.playerFactionId)!;
    assert.equal(o.execute({commandId:'DEPLOY_TROOPS',playerId:'p',parameters:{territoryId:t.id,quantity:10}}).success,false);
    assert.equal(o.getState().playerRewards.bankedTroops,100);
  });
  test('empire contract: deployment replay has deterministic durable identity',()=>{
    const s=fixture(),run=(o:Orchestrator)=>o.execute({commandId:'DEPLOY_TROOPS',playerId:'p',parameters:{territoryId:s.levelAnchorTerritoryIds[0],quantity:10}});
    const a=new Orchestrator(s),b=new Orchestrator(hydratePersistedPayload(snapshotGameState(s)));
    assert.equal(run(a).payload.armyId,run(b).payload.armyId);assert.deepEqual(snapshotGameState(a.getState()),snapshotGameState(b.getState()));
  });
  test('empire contract: NPC REINFORCE bank allocation settles immediately and once',()=>{
    const s=createGameState(),fid=s.allFactionIds.find(id=>id!==s.playerFactionId)!,t=s.factions.get(fid)!.territories[0]!;
    creditTroopBank(s,fid,100);
    const plan=makeConcretePlan({action:'REINFORCE',factionId:fid,territoryId:t,sourcePoolId:troopBankId(fid),quantity:40,destination:{kind:'new_army',territoryId:t}});
    const o=new Orchestrator(s),r=o.execute({commandId:'START_AI_OPERATION',playerId:'system',parameters:{plan}});
    assert(r.success,JSON.stringify(r));const after=o.getState(),id=r.payload.operationId as string;
    assert.equal(after.operations.get(id)!.terminal?.outcome,'completed');assert.equal(bankedTroops(after,fid),60);
    assert.equal(after.operationClaims.size,0);const snapshot=snapshotGameState(after);assert.equal(settleOperation(after,id,'completed','retry'),false);assert.deepEqual(snapshotGameState(after),snapshot);
  });
  test('empire contract: production banks all resource types once',()=>{
    const s=createGameState(),t=s.territories.get(s.levelAnchorTerritoryIds[0]!)!,f=s.factions.get(t.owner!)!;
    for(const x of s.territories.values())x.resourceOutput={};t.resourceOutput={food:10,gold:20,wood:30,iron:40,stone:50};
    const before={...f.resources};s.worldTick=60;persistAllTerritoryAccrual(s);
    for(const k of ['food','gold','wood','iron','stone'] as const)assert.equal(f.resources[k]-before[k],t.resourceOutput[k]);
    const once={...f.resources};persistAllTerritoryAccrual(s);assert.deepEqual(f.resources,once);assert.equal(s.territoryEconomy.get(t.id)!.uncollected.food,10);
  });
  test('empire contract: authored Food baseline and tile sums ignore army size',()=>{
    const s=createGameState();s.worldLevel=2;s.empireFoodBaselinePerCycle=3;
    const fid=s.playerFactionId!,f=s.factions.get(fid)!;f.resources.food=100;
    for(const t of s.territories.values())if(t.owner===fid)t.foodUpkeep=7;
    for(const a of s.armies.values())a.soldiers=1000000;
    s.worldTick=60;const result=consumeEmpireFood(s).factions.find(f=>f.factionId===fid)!;
    assert.equal(result.demandPerCycle,3+7*f.territories.length);assert.equal(f.resources.food,100-result.demand);assert.equal(result.failedCycles,0);
  });
  test('empire contract: Food failure lowers Stability without deleting soldiers',()=>{
    const s=createGameState();s.worldLevel=2;const f=s.factions.get(s.playerFactionId!)!;f.resources.food=0;f.stability=50;
    const armies=JSON.stringify([...s.armies]);s.worldTick=60;consumeEmpireFood(s);assert.equal(f.stability,48);assert.equal(JSON.stringify([...s.armies]),armies);
  });
  test('empire contract: AI recruitment credits bank without Food charge or local deployment',()=>{
    const s=createGameState(),fid=s.allFactionIds.find(id=>id!==s.playerFactionId)!,f=s.factions.get(fid)!;
    for(const t of s.territories.values())t.resourceOutput={};f.resources.food=0;progressRecruitment(s);
    s.worldTick=10;const r=progressRecruitment(s);assert(r.troopsGenerated>0);assert.equal(bankedTroops(s,fid),10*f.territories.length);
    assert.equal(r.foodConsumed,0);assert.equal(f.resources.food,0);for(const p of s.territoryRecruitment.values())assert.equal(p.troops,0);
    const before=bankedTroops(s,fid);progressRecruitment(s);assert.equal(bankedTroops(s,fid),before);
  });
  test('empire contract: fractional recruitment equivalent across split processing',()=>{
    const a=createGameState(),b=cloneGameState(a);progressRecruitment(a);progressRecruitment(b);
    const whole=RECRUITMENT_WORK_PER_TICK*3n;progressRecruitment(a,whole);
    for(let i=1n;i<=6n;i++)progressRecruitment(b,whole*i/6n);
    assert.deepEqual([...a.factions].map(([id,f])=>[id,f.bankedTroops]),[...b.factions].map(([id,f])=>[id,f.bankedTroops]));
    assert.deepEqual(a.territoryRecruitment,b.territoryRecruitment);
  });
  test('empire contract: schema migration transfers existing troops and yield without minting',()=>{
    const s=createLegacySampleMapGameState();progressRecruitment(s);let total=0;
    for(const pool of s.territoryRecruitment.values()){pool.troops=17;total+=17;}
    const banks=[...s.factions.values()].reduce((n,f)=>n+f.resources.food,0);
    for(const rec of s.territoryEconomy.values())rec.uncollected.food=5;
    migrateEmpireBanks(s);assert.equal([...s.factions.values()].reduce((n,f)=>n+(f.bankedTroops??0),0),total);
    assert.equal([...s.factions.values()].reduce((n,f)=>n+f.resources.food,0),banks+[...s.territories.values()].filter(t=>t.owner).length*5);
    assert.equal(s.worldTick,0);assert.deepEqual(s.completedWorldIds,[]);
  });
  test('empire contract: current-world visibility ignores stale discovery arrays',()=>{
    const s=fixture();for(const f of s.factions.values())f.knownTerritories=[];
    const o=new Orchestrator(s),r=o.execute({commandId:'GET_VISIBLE_WORLD',playerId:'p'});
    assert(r.success);assert.equal(Object.keys((r.payload as any).visibleWorld.territories).length,s.territories.size);
  });
  const goldenFixture=()=>{
    const s=createLegacySampleMapGameState({playerFactionId:'iron_kingdom'}),fid=s.playerFactionId!,t=s.levelAnchorTerritoryIds[0]!;
    for(const tile of s.territories.values())tile.resourceOutput={};
    s.territories.get(t)!.resourceOutput={food:13,gold:7};
    const effect=(id:string)=>({applicationId:id,sessionId:id,workoutId:'fixture',playerId:'p',multiplier:1.5,
      effect:'ONE_TIME_COLLECTION' as const,permanence:'EPHEMERAL' as const,consumed:false as const,appliedAtTick:0,sourcePhysicalOutput:10});
    s.playerRewards.pendingGoldenYieldEffects.push(effect('golden-one'),effect('golden-two'));
    return {s,fid,t,params:{factionId:fid,territoryId:t,playerId:'p',consumeGoldenYield:true}};
  };
  test('empire contract: Golden Yield credits only stored multiplier bonus and cannot reuse production',()=>{
    const {s,fid,t,params}=goldenFixture(),before={...s.factions.get(fid)!.resources};
    s.worldTick=60;persistAllTerritoryAccrual(s);
    assert.equal(s.factions.get(fid)!.resources.food,before.food+13);
    const result=collectTerritoryYield(s,params);
    assert.equal(result.transferredResources.food,Math.floor(13*1.5)-13);
    assert.equal(result.transferredResources.gold,Math.floor(7*1.5)-7);
    assert.equal(s.factions.get(fid)!.resources.food,before.food+Math.floor(13*1.5));
    assert.equal(s.territoryEconomy.get(t)!.uncollected.food,0);
    const once=snapshotGameState(s);assert.throws(()=>collectTerritoryYield(s,params),/No collectible/);
    assert.deepEqual(snapshotGameState(s),once);assert.equal(s.playerRewards.pendingGoldenYieldEffects.length,1);
  });
  test('empire contract: normal manual collection acknowledges eligibility without another base credit',()=>{
    const {s,fid,t,params}=goldenFixture(),before=s.factions.get(fid)!.resources.food;
    s.worldTick=60;persistAllTerritoryAccrual(s);
    const r=collectTerritoryYield(s,{...params,consumeGoldenYield:false});
    assert.equal(r.collectedTotal,0);assert.equal(r.baseResources.food,13);
    assert.equal(s.factions.get(fid)!.resources.food,before+13);assert.equal(s.playerRewards.pendingGoldenYieldEffects.length,2);
    s.worldTick=120;persistAllTerritoryAccrual(s);const bonus=collectTerritoryYield(s,params);
    assert.equal(bonus.baseResources.food,13);assert.equal(s.factions.get(fid)!.resources.food,before+26+6);
    assert.equal(s.territoryEconomy.get(t)!.lastAccrualTick,120);
  });
  test('empire contract: Golden Yield lazy banking equals incremental banking and reload',()=>{
    const {s,params}=goldenFixture(),a=cloneGameState(s),b=cloneGameState(s);
    a.worldTick=120;a.accruedTargetWorldTick=120;persistAllTerritoryAccrual(a);collectTerritoryYield(a,params);
    for(let tick=1;tick<=120;tick++){b.worldTick=tick;persistAllTerritoryAccrual(b);}
    const loaded=hydratePersistedPayload(snapshotGameState(b));collectTerritoryYield(loaded,params);
    assert.deepEqual(snapshotGameState(a),snapshotGameState(loaded));
  });
  test('empire contract: Golden Yield overflow preserves bank eligibility and pending effect',()=>{
    const {s,fid,params}=goldenFixture();s.worldTick=60;persistAllTerritoryAccrual(s);
    s.factions.get(fid)!.resources.food=Number.MAX_SAFE_INTEGER;
    const before=snapshotGameState(s);assert.throws(()=>collectTerritoryYield(s,params),/overflow/);
    assert.deepEqual(snapshotGameState(s),before);
  });
  test('empire contract: Food upkeep consumes automatic production without manual collection',()=>{
    const {s,fid,t}=goldenFixture();s.worldLevel=2;s.factions.get(fid)!.resources.food=0;
    s.territories.get(t)!.foodUpkeep=5;s.worldTick=60;
    const r=progressWorldEconomy(s).factions.find(f=>f.factionId===fid)!;
    assert.equal(r.failedCycles,0);assert.equal(s.factions.get(fid)!.resources.food,13-r.demand);
    assert.equal(s.territoryEconomy.get(t)!.uncollected.food,13,'consumption cannot alter production eligibility');
  });
  test('empire contract: real schema30 cargo credits recipients once and keeps history on reload',()=>{
    const raw=JSON.parse(readFileSync(join(__dirname,'fixtures/gameplay-contracts/schema30-live-trade.json'),'utf8'));
    const s=hydratePersistedPayload(raw);
    assert.equal(s.schemaVersion,31);assert.equal(s.tradeShipments.size,2);
    assert.equal(s.factions.get('f_player')!.resources.food,110);
    assert.equal(s.factions.get('f_player')!.resources.wood,80);
    assert.equal(s.factions.get('f_ai_01')!.resources.food,90);
    assert.equal(s.factions.get('f_ai_01')!.resources.wood,120);
    for(const sh of s.tradeShipments.values()){assert.equal(sh.phase,'delivered');assert.equal(sh.timer,null);}
    const once=snapshotGameState(s);assert.deepEqual(snapshotGameState(hydratePersistedPayload(once)),once);
    assert.deepEqual(checkGameStateInvariants(s),[]);
  });

  const defeat=(s:ReturnType<typeof fixture>)=>{
    const fid=s.playerFactionId!,enemy=s.allFactionIds.find(id=>id!==fid)!;
    const owned=[...s.territories.values()].filter(t=>t.owner===fid);
    for(const t of owned){t.owner=enemy;s.factions.get(enemy)!.territories.push(t.id);}
    s.factions.get(fid)!.territories=[];applyPlayerTerritoryLoss(s,owned[0]!.id);
    assert.equal(s.levelDefeat.status,'defeated');
  };
  test('empire contract: losing an anchor is not defeat while any owned land remains',()=>{
    const s=fixture(),fid=s.playerFactionId!,other=[...s.territories.values()].find(t=>t.owner!==fid)!;
    if(other.owner)s.factions.get(other.owner)!.territories=s.factions.get(other.owner)!.territories.filter(id=>id!==other.id);
    other.owner=fid;s.factions.get(fid)!.territories.push(other.id);
    const anchor=s.territories.get(s.levelAnchorTerritoryIds[0]!)!;anchor.owner=null;
    s.factions.get(fid)!.territories=s.factions.get(fid)!.territories.filter(id=>id!==anchor.id);
    applyPlayerTerritoryLoss(s,anchor.id);assert.equal(s.levelDefeat.status,'active');
    other.owner=null;s.factions.get(fid)!.territories=[];applyPlayerTerritoryLoss(s,other.id);
    assert.equal(s.levelDefeat.status,'defeated');
  });
  test('empire contract: restart resets same attempt and retains fitness trophies and paid identities',()=>{
    const s=fixture();defeat(s);s.nextArmySequence=100;s.completedWorldIds=['previous-world'];
    s.playerRewards.appliedRewards.push({applicationId:'already-paid',sessionId:'physical-workout',kind:'TROOPS',appliedAtTick:0,result:{soldiers:60}});
    s.playerFitness.progression.recentWorkoutIds=['past-workout'];
    const fitness=structuredClone(s.playerFitness.progression),paid=structuredClone(s.playerRewards.appliedRewards),world=s.definitionWorldId;
    restartDefeatedWorld(s);assert.equal(s.definitionWorldId,world);assert.equal(s.levelDefeat.status,'active');
    assert.deepEqual(s.playerFitness.progression,fitness);assert.deepEqual(s.playerRewards.appliedRewards,paid);
    assert.deepEqual(s.completedWorldIds,['previous-world']);assert.equal(s.nextArmySequence,100);
    assert.equal(s.playerRewards.bankedTroops,0);assert.deepEqual(checkGameStateInvariants(s),[]);
    assert.deepEqual(snapshotGameState(hydratePersistedPayload(snapshotGameState(s))),snapshotGameState(s));
  });
  test('empire contract: defeat stops economy recruitment and physical simulation before restart',()=>{
    const s=fixture();defeat(s);const before=snapshotGameState(s),o=new Orchestrator(s);
    const r=o.execute({commandId:'ADVANCE_WORLD',playerId:'system',parameters:{elapsedTicks:60}});
    assert(r.success,JSON.stringify(r.errors));const after=o.getState();assert.equal(after.worldTick,60);
    assert.deepEqual((snapshotGameState(after) as Record<string,unknown>).armies,(before as Record<string,unknown>).armies);
    assert.deepEqual([...after.factions].map(([id,f])=>[id,f.resources,bankedTroops(after,id)]),[...s.factions].map(([id,f])=>[id,f.resources,bankedTroops(s,id)]));
    assert.equal(after.operations.size,s.operations.size);assert.equal(after.tradeProposals.size,s.tradeProposals.size);
  });
  test('empire contract: victory trophy is recorded once without simulating prior worlds',()=>{
    const s=fixture(),fid=s.playerFactionId!;
    for(const f of s.factions.values())f.territories=[];
    for(const t of s.territories.values()){t.owner=fid;s.factions.get(fid)!.territories.push(t.id);}
    assert.equal(applyWorldCompletionCheck(s).length,1);assert.equal(applyWorldCompletionCheck(s).length,0);
    assert.deepEqual(s.completedWorldIds,[s.definitionWorldId]);
  });
  test('empire contract: legacy yield is banked once and still eligible for one Golden bonus',()=>{
    const {s,fid,t,params}=goldenFixture();s.schemaVersion=30;s.territoryEconomy.get(t)!.uncollected.food=13;
    const before=s.factions.get(fid)!.resources.food,loaded=hydratePersistedPayload(snapshotGameState(s));
    assert.equal(loaded.factions.get(fid)!.resources.food,before+13);
    const paid=collectTerritoryYield(loaded,params);assert.equal(paid.transferredResources.food,6);
    const after=hydratePersistedPayload(snapshotGameState(loaded));assert.equal(after.factions.get(fid)!.resources.food,before+19);
    assert.throws(()=>collectTerritoryYield(after,params),/No collectible/);
  });
  const hostFixture=(s=fixture())=>{
    const store=new InMemoryGameStateStore();assert(store.save('p',s,0).ok);
    const persistence:PlayerWorldPersistence={name:'memory',history:new InMemoryWorkoutHistoryStore(),
      ensure:playerId=>ensurePlayerWorld({playerId,store}),save:(id,state,version)=>store.save(id,state,version)};
    const host=createSessionHost(persistence,{nowMs:()=>5000});
    const load=()=>{const r=store.load('p');assert(r.ok);return r.state;};
    return {store,persistence,host,load};
  };
  test('empire contract: deployment receipt survives lost response reconnect and stale replay',async()=>{
    const {host,load,persistence}=hostFixture(),lease=await host.openGameplaySession('p','open');
    const command={commandId:'DEPLOY_TROOPS',playerId:'p',requestId:'deploy-one',gameplaySessionId:lease.sessionId,commandSequence:1,renewalSequence:1,parameters:{territoryId:'t_02',quantity:40}};
    const first=await host.execute(command);assert(first.success,JSON.stringify(first.errors));const after=snapshotGameState(load());
    const restarted=createSessionHost(persistence,{nowMs:()=>5000});const replay=await restarted.execute({...command,parameters:{territoryId:'t_02',quantity:99}});
    assert.equal(replay.idempotentReplay,true);assert.equal(replay.payload.armyId,first.payload.armyId);assert.deepEqual(snapshotGameState(load()),after);
    assert((await restarted.execute({...command,requestId:'deploy-two',commandSequence:2,renewalSequence:2,parameters:{territoryId:'t_02',quantity:10}})).success);
    const late=await restarted.execute(command);assert.equal(late.success,false);assert.equal(load().playerRewards.bankedTroops,50);
  });
  for(const writeBeforeFailure of [false,true])test(`empire contract: deployment save failure retry preserves exactly once ${writeBeforeFailure}`,async()=>{
    const {persistence,host,load}=hostFixture(),lease=await host.openGameplaySession('p','open');let armed=true;
    const failing:PlayerWorldPersistence={...persistence,save:(id,state,version)=>{
      if(!armed)return persistence.save(id,state,version);armed=false;
      if(writeBeforeFailure)assert(persistence.save(id,state,version).ok);
      return {ok:false,persisted:false,code:'persistence.conflict',message:'injected conflict'};
    }};
    const runner=createSessionHost(failing,{nowMs:()=>5000}),command={commandId:'DEPLOY_TROOPS',playerId:'p',requestId:'deploy',gameplaySessionId:lease.sessionId,commandSequence:1,renewalSequence:1,parameters:{territoryId:'t_02',quantity:40}};
    try{await runner.execute(command);}catch{} // Persisted result below, rather than transport exception shape, is authoritative.
    const retry=await runner.execute(command);assert(retry.success,JSON.stringify(retry.errors));assert.equal(load().playerRewards.bankedTroops,60);
    assert.equal([...load().armies.values()].filter(a=>a.id===retry.payload.armyId).length,1);
  });
  test('empire contract: Golden Yield receipt survives reconnect without another bonus or effect use',async()=>{
    // Registered production identity is retained for the persisted server fixture.
    const s=fixture(),t=s.levelAnchorTerritoryIds[0]!;s.worldTick=60;s.accruedTargetWorldTick=60;persistAllTerritoryAccrual(s);
    s.playerRewards.pendingGoldenYieldEffects.push({applicationId:'gy',sessionId:'gy',workoutId:'fixture',playerId:'p',multiplier:2,effect:'ONE_TIME_COLLECTION',permanence:'EPHEMERAL',consumed:false,appliedAtTick:0,sourcePhysicalOutput:10});
    const {host,persistence,load}=hostFixture(s),lease=await host.openGameplaySession('p','open');
    const command={commandId:'COLLECT_RESOURCES',playerId:'p',requestId:'collect',gameplaySessionId:lease.sessionId,commandSequence:1,renewalSequence:1,parameters:{territoryId:t,useGoldenYield:true}};
    const first=await host.execute(command);assert(first.success,JSON.stringify(first.errors));const once=snapshotGameState(load());
    const retry=await createSessionHost(persistence,{nowMs:()=>5000}).execute(command);assert.equal(retry.idempotentReplay,true);
    assert.deepEqual(retry.payload,first.payload);assert.deepEqual(snapshotGameState(load()),once);
  });
  test('empire contract: restart retains its receipt so retry cannot erase subsequent deployment',async()=>{
    const s=fixture();defeat(s);const {host,load}=hostFixture(s),lease=await host.openGameplaySession('p','open');
    const command={commandId:'RESTART_WORLD',playerId:'p',requestId:'restart',gameplaySessionId:lease.sessionId,commandSequence:1,renewalSequence:1,parameters:{}};
    const first=await host.execute(command);assert(first.success,JSON.stringify(first.errors));const once=snapshotGameState(load());
    const retry=await host.execute(command);assert.equal(retry.idempotentReplay,true);assert.deepEqual(snapshotGameState(load()),once);
    const next=await host.execute({...command,requestId:'another-restart',commandSequence:2,renewalSequence:2});assert.equal(next.success,false);
  });

  const workout=()=>{const r=beginWorkoutSession({playerId:'p',sessionId:'outstanding',now:1000,workoutId:'wk_very_easy_mobility',intendedDifficulty:'VERY_EASY',purpose:'NORMAL_TROOPS'});assert(r.ok);return r.value;};
  test('empire contract: restart rejects active and unpaid completed workout without mutation',()=>{
    const s=fixture();defeat(s);s.playerFitness.activeSession=workout();
    const before=snapshotGameState(s);assert.throws(()=>restartDefeatedWorld(s),/active workout/);assert.deepEqual(snapshotGameState(s),before);
    let session=s.playerFitness.activeSession,now=1000;
    while(session.state==='ACTIVE'){const step=getCurrentExercise(session)!;const r=completeExercise(session,step.prescription.kind==='repetitions'?{order:step.order,repetitions:step.prescription.repetitions}:{order:step.order,durationSeconds:step.prescription.durationSeconds},now+=1000);assert(r.ok);session=r.value;}
    s.playerFitness.activeSession=session;const completed=snapshotGameState(s);
    assert.throws(()=>restartDefeatedWorld(s),/completed workout must be settled/);assert.deepEqual(snapshotGameState(s),completed);
  });
  test('empire contract: abandoned workout does not permanently block restart',()=>{
    const s=fixture();defeat(s);const abandoned=abandonWorkoutSession(workout(),2000);assert(abandoned.ok);s.playerFitness.activeSession=abandoned.value;
    restartDefeatedWorld(s);assert.equal(s.levelDefeat.status,'active');assert.equal(s.playerFitness.activeSession,null);
  });
  test('empire contract: authored Food values validate and survive client export without invented defaults',()=>{
    const loaded=loadProductionLevel1Definition();assert(loaded.ok);const def=structuredClone(loaded.definition);
    assert.equal(def.empireFoodBaselinePerCycle,undefined);assert(def.territories.every(t=>t.foodUpkeep===undefined));
    def.empireFoodBaselinePerCycle=7;def.territories[0]!.foodUpkeep=0;def.territories[1]!.foodUpkeep=12;
    const parsed=parseWorldJson(JSON.stringify(serializeWorldDefinitionForClient(def)));assert(parsed.ok);assert.deepEqual(parsed.definition,def);
    const state=createGameState({world:def});assert.equal(state.empireFoodBaselinePerCycle,7);assert.equal(state.territories.get(def.territories[0]!.id)!.foodUpkeep,0);
    for(const bad of [-1,1.5,Number.MAX_SAFE_INTEGER+1,NaN]){
      const copy=structuredClone(def);copy.empireFoodBaselinePerCycle=bad;assert.equal(parseWorldJson(JSON.stringify(copy)).ok,false);
      const tile=structuredClone(def);tile.territories[0]!.foodUpkeep=bad;assert.equal(parseWorldJson(JSON.stringify(tile)).ok,false);
    }
  });

  for(const phase of ['loading','transit','unloading','blocked','delivered'])test(`empire contract: legacy cargo phase ${phase} migrates exactly once`,()=>{
    const raw=JSON.parse(readFileSync(join(__dirname,'fixtures/gameplay-contracts/schema30-live-trade.json'),'utf8'));
    const sh=raw.tradeShipments.$map[0][1];sh.phase=phase;
    if(phase==='transit'){sh.timer=null;sh.legStartedAtTick=0;sh.legDurationTicks=10;}
    if(phase==='unloading'){sh.legIndex=sh.route.length-1;sh.timer.onlineDurationMs=5000;sh.timer.offlineDurationMs=30000;}
    if(phase==='blocked'){sh.blockedReason='legacy route interruption';sh.blockedAtTick=0;}
    if(phase==='delivered'){
      sh.legIndex=sh.route.length-1;sh.timer=null;sh.deliveredAtMs=raw.aiClock.nowMs;
      const recipient=raw.factions.$map.find(([id]:[string,unknown])=>id===sh.recipient)[1];
      for(const [r,n] of Object.entries(sh.cargo))recipient.resources[r]+=n as number;
    }
    const loaded=hydratePersistedPayload(raw);
    assert.equal(loaded.factions.get('f_ai_01')!.resources.wood,120);assert.equal(loaded.factions.get('f_player')!.resources.food,110);
    const once=snapshotGameState(loaded);assert.deepEqual(snapshotGameState(hydratePersistedPayload(once)),once);
  });
  test('empire contract: migrating a reserved local allocation releases it before banking troops',()=>{
    const s=createGameState(),fid=s.allFactionIds.find(id=>id!==s.playerFactionId)!,t=s.factions.get(fid)!.territories[0]!;
    progressRecruitment(s);s.territoryRecruitment.get(t)!.troops=100;
    const plan=makeConcretePlan({action:'REINFORCE',factionId:fid,territoryId:t,sourcePoolId:`local-pool:v1:${JSON.stringify(t)}`,quantity:50,destination:{kind:'new_army',territoryId:t}});
    const o=new Orchestrator(s),r=o.execute({commandId:'START_AI_OPERATION',playerId:'system',parameters:{plan}});assert(r.success,JSON.stringify(r.errors));
    const old=o.getState();assert(old.operationClaims.size>0);const armyCount=old.armies.size;old.schemaVersion=30;
    const loaded=hydratePersistedPayload(snapshotGameState(old));assert.equal(loaded.operationClaims.size,0);
    assert.equal(loaded.operations.get(r.payload.operationId as string)!.terminal?.outcome,'failed');assert.equal(bankedTroops(loaded,fid),100);
    assert.equal(loaded.armies.size,armyCount);assert.equal(loaded.territoryRecruitment.get(t)!.troops,0);
    const once=snapshotGameState(loaded);assert.deepEqual(snapshotGameState(hydratePersistedPayload(once)),once);
  });
  test('empire contract: stale deployment writer cannot spend the same troop bank twice',()=>{
    const {store,load}=hostFixture(),a=store.load('p'),b=store.load('p');assert(a.ok&&b.ok);
    const run=(state:typeof a.state,quantity:number)=>{const o=new Orchestrator(state);const r=o.execute({commandId:'DEPLOY_TROOPS',playerId:'p',parameters:{territoryId:'t_02',quantity}});assert(r.success);return o.getState();};
    const first=run(a.state,70),stale=run(b.state,80);assert(store.save('p',first,a.record.stateVersion).ok);
    const failed=store.save('p',stale,b.record.stateVersion);assert.equal(failed.ok,false);assert.equal(load().playerRewards.bankedTroops,30);
    assert.equal(load().armies.size,first.armies.size);assert.deepEqual(snapshotGameState(load()),snapshotGameState(first));
  });

}
