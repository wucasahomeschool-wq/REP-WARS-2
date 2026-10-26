import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadTinyWorldDefinition, getDefaultWorldCatalog } from '../src/worldDefinition/catalog';
import { WorldDefinition, WorldPolygon } from '../src/worldDefinition/types';
import { validateWorldDefinition } from '../src/worldDefinition/validate';
import { ringContainedBy, ringsOverlap, sharedEdgeLength, WORLD_GEOM_EPS } from '../src/worldDefinition/geometry';
import { settleOperation } from '../src/engine/operations';
import { cloneGameState } from '../src/state/cloneGameState';
import { createGameState, checkGameStateInvariants } from '../src/state';
import { InMemoryGameStateStore } from '../src/persistence/inMemoryGameStateStore';
import { createInMemoryPersistence } from '../src/server/persistencePort';
import { createSessionHost } from '../src/server/session';
import { snapshotGameState } from '../src/persistence/snapshot';
import { accrueWorldThroughReceipt } from '../src/world/worldAccrual';
import { openGameplaySessionLease } from '../src/world/presenceLeases';
import { WorldAdvanceResult } from '../src/world/ContinuousWorldEngine';
import { FoodConsumptionResult } from '../src/gameplay/economy/foodConsumption';
import { serializePublicGameState } from '../src/orchestration/publicView';

const rectangle = (x: number, y: number, w: number, h: number): WorldPolygon => ({ rings: [[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]] });

/** Engineering fixture, not authored production balance or the archived AI-SIM
 * campaign. Initial stocks/personalities/output come from the existing tiny
 * fixture. No post-start grants, cities, reward ratios or gameplay overrides. */
export function createScaleWorld(territories: number, aiFactions: number): WorldDefinition {
  assert.ok(territories >= 10 && territories % 5 === 0 && aiFactions >= 2 && aiFactions < territories);
  const loaded = loadTinyWorldDefinition(); assert.ok(loaded.ok);
  const base = loaded.definition, value = structuredClone(base), width = 5, height = territories / width;
  value.worldId = `validation_grid_${territories}_${aiFactions}`;
  value.name = 'Synthetic backend load fixture'; value.level = 2;
  value.island = rectangle(0,0,width,height); value.containedWorlds = []; delete value.workoutRewards;
  value.factions = [structuredClone(base.factions[0]), ...Array.from({length:aiFactions},(_,i) => {
    const faction = structuredClone(base.factions[1+i%2]); faction.id = `scale_ai_${i}`; faction.name = `Fixture AI ${i}`;
    assert.ok(faction.personality); faction.personality.id = `scale_personality_${i}`; return faction;
  })];
  value.regions = [{id:'scale_region',name:'Synthetic grid',worldId:value.worldId,territoryIds:[]}];
  const id = (i: number) => `scale_tile_${i}`;
  value.territories = Array.from({length:territories},(_,i) => {
    const x = i%width, y = Math.floor(i/width), owner = i===0?0:1+Math.floor((i-1)*aiFactions/(territories-1));
    const neighbors = [x>0?i-1:null,x<width-1?i+1:null,y>0?i-width:null,y<height-1?i+width:null]
      .filter((n): n is number => n!==null).map(id);
    return {...structuredClone(base.territories[i%base.territories.length]),id:id(i),regionId:'scale_region',
      startingOwnerFactionId:value.factions[owner].id,polygon:rectangle(x,y,1,1),neighborIds:neighbors};
  });
  value.regions[0].territoryIds = value.territories.map(t=>t.id);
  for (const faction of value.factions) {
    faction.homeTerritoryId = value.territories.find(t=>t.startingOwnerFactionId===faction.id)!.id;
    faction.startingArmy.locationTerritoryId = faction.homeTerritoryId;
  }
  value.startingDiplomacy = [];
  for (let i=0;i<value.factions.length;i++) for (let j=i+1;j<value.factions.length;j++) {
    value.startingDiplomacy.push({a:value.factions[i].id,b:value.factions[j].id,state:'at_war',opinion:0});
  }
  assert.deepEqual(validateWorldDefinition(value),[]);
  return value;
}

export async function runScaleWorld(definition: WorldDefinition, seed: number, maxCatchUpChunks: number, ticks = 360) {
  const start = performance.now(), store = new InMemoryGameStateStore(), state = createGameState({world:definition,seed});
  // Explicit six simulation hours of historical server-authorized online
  // presence for the default run; not a claim about a normal calendar schedule.
  accrueWorldThroughReceipt(state,1000);
  state.gameplaySessionLeases = [openGameplaySessionLease({sessionId:'load-history',receiptMs:1000,leaseDurationMs:ticks*60000})];
  const now = 1000+ticks*60000; accrueWorldThroughReceipt(state,now);
  assert.equal(state.accruedTargetWorldTick,ticks);
  assert.ok(store.save('scale-player',state,0).ok);
  const persistence = createInMemoryPersistence(store), reportedDecisions: Record<string,number> = {};
  let requests=0, resolvedAttacks=0, failedAttacks=0, foodFailures=0;
  let containedInvalidatedAttacks = 0;
  const timings: number[] = [];
  while (true) {
    const loaded = store.load('scale-player'); assert.ok(loaded.ok);
    if (loaded.state.worldTick === ticks) break;
    assert.ok(requests++ <= ticks); // Detect non-progress without assuming fixed chunk boundaries.
    const host = createSessionHost(persistence,{nowMs:()=>now,maxCatchUpChunks,maxCachedPlayers:0});
    const requestStart = performance.now();
    const result = await host.execute({commandId:'SYNC_PLAYER_WORLD',playerId:'scale-player'});
    timings.push(performance.now()-requestStart);assert.ok(result.success,JSON.stringify(result.errors));
    const advance = result.payload.worldAdvance as WorldAdvanceResult;

    for (const decision of advance.aiDecisions) reportedDecisions[decision.action] = (reportedDecisions[decision.action]??0)+1;
    for (const resolution of advance.commitmentResolutions) if (resolution.action==='ATTACK') {
      if (resolution.success) resolvedAttacks++; else failedAttacks++;
    }
    foodFailures += (result.payload.foodConsumption as FoodConsumptionResult).factions.reduce((sum,f)=>sum+f.failedCycles,0);
    const saved = store.load('scale-player'); assert.ok(saved.ok);assert.deepEqual(checkGameStateInvariants(saved.state),[]);
    assert.ok(saved.state.worldTick>loaded.state.worldTick);assert.equal(saved.state.accruedTargetWorldTick,ticks);
    // Arrival revalidates exact hostile identity. A conquered target can fail
    // safely; this is not ENGINE_ERROR and must have durable terminal cleanup.
    for (const error of advance.errors) {
      assert.equal(error.code,'INVALID_TARGET',JSON.stringify(error));
      const resolutions=advance.commitmentResolutions.filter(r=>r.action==='ATTACK' && !r.success
        && r.errors?.some(e=>e.code===error.code && e.message===error.message));
      assert.ok(resolutions.length>0,'An error without a failed ATTACK resolution is not a contained invalidation');
      for (const resolution of resolutions) {
        const op=saved.state.operations.get(resolution.commitmentId);assert.ok(op);
        assert.equal(op.terminal?.outcome,'failed');assert.equal(op.phase,'terminal');assert.deepEqual(op.claimIds,[]);
        assert.equal([...saved.state.operationClaims.values()].some(c=>c.operationId===op.id),false);
        if(op.attention.acquiredAtTick!==null)assert.equal(op.attention.releasedAtTick,op.terminal.atTick);
        assert.equal([...saved.state.armies.values()].some(a=>a.attackIntent?.commitmentId===op.id),false);
        const draft=cloneGameState(saved.state),before=snapshotGameState(draft);
        assert.equal(settleOperation(draft,op.id,'failed','duplicate terminal probe'),false);
        assert.deepEqual(snapshotGameState(draft),before);
      }
      containedInvalidatedAttacks++;
    }
  }
  const final = store.load('scale-player'); assert.ok(final.ok);
  const snapshot = snapshotGameState(final.state), canonical = JSON.stringify(snapshot);
  const publicStart = performance.now();let publicBytes=0;
  for (let i=0;i<100;i++) publicBytes=Buffer.byteLength(JSON.stringify(serializePublicGameState(final.state,final.state.playerFactionId)));
  const publicMs=performance.now()-publicStart;
  const operationsByAction: Record<string,number> = {};
  for (const operation of final.state.operations.values()) operationsByAction[operation.action] = (operationsByAction[operation.action]??0)+1;
  return { snapshot, metrics: {world:definition.worldId,seed,ticks,maxCatchUpChunks,requests,reportedDecisions,operationsByAction,resolvedAttacks,failedAttacks,containedInvalidatedAttacks,foodFailures,
    operations:final.state.operations.size,claims:final.state.operationClaims.size,
    changedTerritories:definition.territories.filter(t=>t.startingOwnerFactionId!==final.state.territories.get(t.id)!.owner).length,
    canonicalBytes:Buffer.byteLength(canonical),sha256:createHash('sha256').update(canonical).digest('hex'),
    elapsedMs:Math.round(performance.now()-start),maxRequestMs:Math.round(Math.max(...timings)),public100Ms:Math.round(publicMs),publicBytes,
    rssMiB:Math.round(process.memoryUsage().rss/1048576)} };
}

export function registerBackendScaleTests({test}:{test:(name:string,fn:()=>void|Promise<void>)=>void}) {
  test('geometry broad phase: rotated rectangle interiors retain analytic intersection and containment',()=>{
    let seed=20261026;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%21-10;};
    for (const scale of [1,1000]) for(let i=0;i<1000;i++) {
      const rect=()=>({x:rand(),y:rand(),w:Math.abs(rand())+1,h:Math.abs(rand())+1});
      const a=rect(),b=rect();const ring=(r:typeof a)=>rectangle(r.x,r.y,r.w,r.h).rings[0].map(p=>({x:(0.6*p.x-0.8*p.y+13)*scale,y:(0.8*p.x+0.6*p.y-7)*scale}));
      const ar=ring(a),br=ring(b);if(i%2)br.reverse();
      const expected=Math.min(a.x+a.w,b.x+b.w)>Math.max(a.x,b.x)&&Math.min(a.y+a.h,b.y+b.h)>Math.max(a.y,b.y);
      assert.equal(ringsOverlap(ar,br),expected,JSON.stringify({a,b,scale}));
      assert.equal(ringContainedBy(ar,br),a.x>=b.x&&a.y>=b.y&&a.x+a.w<=b.x+b.w&&a.y+a.h<=b.y+b.h);
    }
  });
  test('geometry broad phase: near-collinear borders retain the established tolerance',()=>{
    const left=rectangle(0,0,1,1);
    assert.equal(sharedEdgeLength(left,rectangle(1+WORLD_GEOM_EPS/2,0,1,1)),1);
    assert.equal(sharedEdgeLength(left,rectangle(1+WORLD_GEOM_EPS*2,0,1,1)),0);
  });
  for (const [territories,ais,ticks] of [[10,3,360],[30,5,360],[50,8,360],[50,8,1440]]) for (const seed of [11,29]) {
    test(`backend scale: ${territories} territories/${ais} AI, ${ticks}-tick reload and chunk equivalence seed ${seed}`,async()=>{
      const definition=createScaleWorld(territories,ais);getDefaultWorldCatalog().register(definition);
      const before=JSON.stringify(definition),whole=await runScaleWorld(definition,seed,100,ticks),sliced=await runScaleWorld(definition,seed,1,ticks);
      assert.deepEqual(sliced.snapshot,whole.snapshot);assert.equal(JSON.stringify(definition),before);
      console.log(JSON.stringify({scenario:'authored-grid-load',whole:whole.metrics,sliced:sliced.metrics}));
    });
  }
}
