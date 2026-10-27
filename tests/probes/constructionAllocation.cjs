// Read-only current-code allocation probe; run with node -r ts-node/register.
const root=process.cwd(),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {createGameState}=require(root+'/src/state'),{loadTinyWorldDefinition}=require(root+'/src/worldDefinition/catalog');
const {ensureCity}=require(root+'/src/gameplay/cities/city'),{ensureTerritoryInfrastructure}=require(root+'/src/gameplay/economy/effectiveOutput');
const {GAMEPLAY_CONFIG}=require(root+'/src/gameplay/config');
const errors=require(root+'/src/orchestration/errors'),{tradeDemand}=require(root+'/src/gameplay/trade/candidates');
const {snapshotGameState}=require(root+'/src/persistence/snapshot');
const loaded=loadTinyWorldDefinition();assert.ok(loaded.ok);const state=createGameState({world:loaded.definition,seed:11});
for(const t of state.territories.values()) {
 ensureCity(state,t.id,t.owner);t.fortification=GAMEPLAY_CONFIG.maxFortificationLevel;
 const infra=ensureTerritoryInfrastructure(state,t.id);for(const key of ['farmCompletedAtTick','mineCompletedAtTick','lumberCompletedAtTick'])infra[key]=0;
}
const before=JSON.stringify(snapshotGameState(state)),Original=errors.OrchestrationError;let allocations=0;
errors.OrchestrationError=class extends Original{constructor(...args){super(...args);allocations++}};
const outputs=[];const start=performance.now();
try {for(let i=0;i<1000;i++) for(const id of state.factions.keys())outputs.push(tradeDemand(state,id));}
finally {errors.OrchestrationError=Original;}
assert.equal(JSON.stringify(snapshotGameState(state)),before);
console.log(JSON.stringify({node:process.version,passes:1000,factions:state.factions.size,territories:state.territories.size,allocations,elapsedMs:performance.now()-start,outputSha256:createHash('sha256').update(JSON.stringify(outputs)).digest('hex'),inputUnchanged:true}));
