import assert from 'node:assert/strict';
import { createGameState } from '../src/state';
import { cloneGameState } from '../src/state/cloneGameState';
import { loadProductionLevel1Definition, loadProductionLevel2Definition, getDefaultWorldCatalog } from '../src/worldDefinition/catalog';
import { worldContentFingerprint, worldContentIdentity } from '../src/worldDefinition/contentIdentity';
import { loadWorldDefinition } from '../src/worldDefinition/parse';
import { validateWorldDefinition } from '../src/worldDefinition/validate';
import { pointOnSegment, ringIsSimple } from '../src/worldDefinition/geometry';
import { WorldDefinition } from '../src/worldDefinition/types';
import { snapshotGameState } from '../src/persistence/snapshot';
import { hydratePersistedPayload } from '../src/persistence/hydrate';
import { encodePersistable } from '../src/persistence/serialization';
import { Orchestrator } from '../src/orchestration';
import { GAME_STATE_SCHEMA_VERSION } from '../src/types/GameState';

function world(): WorldDefinition { const loaded = loadProductionLevel2Definition(); assert.ok(loaded.ok); return structuredClone(loaded.definition); }
export function registerWorldContentTests({ test }: { test: (name: string, fn: () => void) => void }) {
  test('content: stable across object keys and set ordering', () => {
    const a = world(), b = structuredClone(a); b.territories.reverse(); b.regions.reverse(); b.factions.reverse();
    for (const t of b.territories) { t.neighborIds.reverse(); t.resourceOutput = Object.fromEntries(Object.entries(t.resourceOutput).reverse()); }
    for (const r of b.regions) r.territoryIds.reverse();
    assert.deepEqual(worldContentIdentity(a),worldContentIdentity(b));
  });
  test('content: polygon start vertex closure and winding do not create revisions', () => {
    const a=world(), b=structuredClone(a);
    for (const p of [b.island,...b.territories.map(t=>t.polygon)]) {
      const r=p.rings[0]!; if(r[0]!.x===r[r.length-1]!.x && r[0]!.y===r[r.length-1]!.y) r.pop();
      r.push(r.shift()!);r.reverse();
    }
    assert.deepEqual(worldContentIdentity(a),worldContentIdentity(b));
  });
  test('content: same world and territory IDs cannot mask changed geometry', () => {
    const a=world(), b=structuredClone(a); b.territories[0]!.polygon.rings[0]![0]!.x+=0.001;
    assert.notEqual(worldContentFingerprint(a),worldContentFingerprint(b));
    assert.notEqual(worldContentIdentity(a).geometryFingerprint,worldContentIdentity(b).geometryFingerprint);
  });
  test('content: terrain output starting armies and personality are simulation content', () => {
    const a=world();
    for (const mutate of [(b:WorldDefinition)=>{b.territories[0]!.terrain='mountain';},(b:WorldDefinition)=>{b.territories[0]!.resourceOutput.food=912;},(b:WorldDefinition)=>{b.factions[0]!.startingArmy.soldiers+=1;},(b:WorldDefinition)=>{b.factions.find(f=>f.personality)!.personality!.ambition+=0.01;}]) {
      const b=structuredClone(a);mutate(b);assert.notEqual(worldContentFingerprint(a),worldContentFingerprint(b));
    }
  });
  test('content: cosmetic composition and separately locked pricing do not rewrite simulation map identity', () => {
    const a=world(),b=structuredClone(a);b.composition={instances:[]};b.workoutRewards={version:'workout-soldiers.v1',revision:'test-only',soldiersPerRewardUnitMicros:123};
    assert.equal(worldContentFingerprint(a),worldContentFingerprint(b));
  });
  test('content: new authored state pins definition and persists it exactly', () => {
    const state=createGameState({world:world()}); const copy=cloneGameState(state);
    assert.equal(copy.definitionContentFingerprint,worldContentFingerprint(world()));
    assert.deepEqual(snapshotGameState(hydratePersistedPayload(snapshotGameState(state))),snapshotGameState(state));
  });
  test('content: altered catalog under the same ID cannot silently rebind a pinned save', () => {
    const original=world(),catalog=getDefaultWorldCatalog(), saved=catalog.get(original.worldId)!;
    const state=createGameState({world:original}),payload=snapshotGameState(state);
    const changed=structuredClone(original);changed.territories[0]!.resourceOutput.food=999;
    catalog.register(changed);
    try {
      assert.throws(()=>hydratePersistedPayload(payload),/content differs/);
      const result=new Orchestrator(state).execute({commandId:'GET_WORLD_DEFINITION',playerId:'test'});assert.equal(result.success,false);
      assert.deepEqual(snapshotGameState(state),payload);
    } finally {catalog.register(saved);}
  });
  test('content: schema 29 migration records unknown provenance without inventing historical hash', () => {
    const state=createGameState({world:world()}), original=snapshotGameState(state) as Record<string,unknown>;
    const old:Record<string,unknown>={...original,schemaVersion:29};delete old.definitionContentFingerprint;
    const migrated=hydratePersistedPayload(old);
    assert.equal(migrated.schemaVersion,GAME_STATE_SCHEMA_VERSION);assert.equal(migrated.definitionContentFingerprint,null);
    assert.deepEqual(snapshotGameState(migrated),{...original,definitionContentFingerprint:null});
    assert.deepEqual(snapshotGameState(hydratePersistedPayload(snapshotGameState(migrated))),snapshotGameState(migrated));
  });
  for (const pin of [undefined,'bad','sha256:123',42]) test(`content: current schema rejects malformed fingerprint ${String(pin)}`,()=>{
    const state=createGameState({world:world()}), raw=encodePersistable(state) as Record<string,unknown>;
    raw.definitionContentFingerprint=pin;assert.throws(()=>hydratePersistedPayload(raw),/fingerprint/);
  });
  test('content: world API supplies computed map identity plus actual persisted provenance',()=>{
    const state=createGameState({world:world()}),result=new Orchestrator(state).execute({commandId:'GET_WORLD_DEFINITION',playerId:'test'});
    assert.ok(result.success);assert.deepEqual(result.payload.contentIdentity,worldContentIdentity(world()));assert.equal(result.payload.persistedContentFingerprint,state.definitionContentFingerprint);
  });
  test('geometry: zero-length edge contains only its endpoint',()=>{
    assert.equal(pointOnSegment({x:99,y:99},{x:0,y:0},{x:0,y:0}),false);
    assert.equal(pointOnSegment({x:0,y:0},{x:0,y:0},{x:0,y:0}),true);
  });
  test('geometry: nonzero-area self-crossing rings and duplicate edges are rejected',()=>{
    const a=world();a.island.rings=[[{x:0,y:0},{x:4,y:4},{x:0,y:4},{x:3,y:0}]];
    assert.ok(validateWorldDefinition(a).some(i=>i.code==='geometry.self_intersection'));
    assert.equal(ringIsSimple([{x:0,y:0},{x:1,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]),false);
  });
  test('geometry: malformed nested JSON returns validation errors without throwing or mutating input',()=>{
    for (const raw of [{...world(),island:null},{...world(),territories:[null]},{...world(),factions:[null]},{...world(),regions:[null]},{...world(),startingDiplomacy:null},{...world(),containedWorlds:42},{...world(),territories:[{...world().territories[0],neighborIds:[42]}]}]) {
      const before=structuredClone(raw);const loaded=loadWorldDefinition(raw);assert.equal(loaded.ok,false);assert.deepEqual(raw,before);
    }
  });
  test('content: negative fractional or unsafe initial troop quantities are rejected before instantiation',()=>{
    for(const qty of [-1,0.5,Number.MAX_SAFE_INTEGER+1]) {const a=world();a.factions[0]!.startingArmy.soldiers=qty;assert.ok(validateWorldDefinition(a).some(i=>i.code==='faction.invalid_troops'));}
    const a=world();a.factions[0]!.startingResources.food=-1;assert.ok(validateWorldDefinition(a).some(i=>i.code==='faction.invalid_resources'));
  });
  test('content: unchanged registered Level 1 and Level 2 remain valid',()=>{
    const l1=loadProductionLevel1Definition();assert.ok(l1.ok);assert.deepEqual(validateWorldDefinition(l1.definition),[]);assert.deepEqual(validateWorldDefinition(world()),[]);
  });
}
