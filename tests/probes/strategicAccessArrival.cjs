const fs=require('node:fs'),z=require('node:zlib'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=process.cwd(),load=p=>require(root+'/src/'+p);
const {getDefaultWorldCatalog}=load('worldDefinition/catalog'),{hydratePersistedPayload}=load('persistence/hydrate'),{snapshotGameState}=load('persistence/snapshot');
const {observeSources,sourceConcretePlans}=load('engine/strategicPressure'),{Orchestrator}=load('orchestration/orchestrator'),{checkGameStateInvariants}=load('state'),{settleOperation}=load('engine/operations');
getDefaultWorldCatalog().register(JSON.parse(fs.readFileSync('tests/fixtures/strategic-access/idle-small-world.json','utf8')).definition);
const initial=()=>hydratePersistedPayload(JSON.parse(z.gunzipSync(fs.readFileSync('tests/fixtures/strategic-access/idle-small-state.json.gz'))));
const s=initial();observeSources(s,'f_ai_1');const source=[...s.aiPressure.values()].find(s=>s.factionId==='f_ai_1'&&s.kind==='STRATEGIC_ACCESS');assert(source);
const plan=sourceConcretePlans(s,source).find(p=>p.action==='MOVE');assert(plan);
const o=new Orchestrator(s);assert(o.execute({commandId:'START_AI_OPERATION',playerId:'probe',parameters:{plan}}).success);
const start=o.getState(),move=start.armies.get(plan.armyId).movement;assert(move);const opId=move.commitmentId;
const receipt=start.lastAccrualAtMs;assert(Number.isSafeInteger(receipt));
start.gameplaySessionLeases.push(load('world/presenceLeases').openGameplaySessionLease({sessionId:'probe-movement-earned-time',receiptMs:receipt,leaseDurationMs:move.durationTicks*60000}));
function run(incremental){let c=new Orchestrator(hydratePersistedPayload(snapshotGameState(start)));for(let i=0;i<(incremental?move.durationTicks:1);i++){
 const r=c.executeAtAuthoritativeReceipt({commandId:'SYNC_PLAYER_WORLD',playerId:'probe'},receipt+(incremental?i+1:move.durationTicks)*60000);assert(r.success,JSON.stringify(r.errors));
 if(incremental&&i<move.durationTicks-1)assert.equal(c.getState().armies.get(plan.armyId).location,plan.originTerritoryId);
 c=new Orchestrator(hydratePersistedPayload(snapshotGameState(c.getState())));
}return c.getState();}
const a=run(false),b=run(true);assert.deepEqual(snapshotGameState(a),snapshotGameState(b));
assert.deepEqual(checkGameStateInvariants(a),[]);assert.equal(a.armies.get(plan.armyId).location,plan.destinationTerritoryId);assert.equal(a.armies.get(plan.armyId).soldiers,start.armies.get(plan.armyId).soldiers);
const op=a.operations.get(opId);assert(op.terminal);assert.deepEqual(op.claimIds,[]);assert(!a.operationClaims.has('force:'+plan.armyId));const settled=snapshotGameState(a);assert.equal(settleOperation(a,opId,'completed','duplicate'),false);assert.deepEqual(snapshotGameState(a),settled);
console.log(JSON.stringify({armyId:plan.armyId,origin:plan.originTerritoryId,destination:plan.destinationTerritoryId,ticks:move.durationTicks,soldiersBefore:start.armies.get(plan.armyId).soldiers,soldiersAfter:a.armies.get(plan.armyId).soldiers,terminal:op.terminal,claimCount:op.claimIds.length,canonicalReplayEqual:true,sha256:crypto.createHash('sha256').update(JSON.stringify(settled)).digest('hex')},null,2));
