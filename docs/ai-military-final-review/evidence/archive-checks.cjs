const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const root=process.cwd(),{hydratePersistedPayload}=require(root+'/src/persistence/hydrate'),{checkGameStateInvariants}=require(root+'/src/state/gameStateInvariants'),cases=JSON.parse(fs.readFileSync('docs/ai-military-final-review/evidence/formed-army-outcomes.json','utf8')).cases;let checked=0;
for(const c of cases){const dir='docs/ai-recovery-provisioning/results/final-after/'+c.case;require(root+'/src/worldDefinition/catalog').getDefaultWorldCatalog().register(JSON.parse(fs.readFileSync(dir+'/scenario.json','utf8')).definition);const state=hydratePersistedPayload(JSON.parse(zlib.gunzipSync(fs.readFileSync(dir+'/final-state.json.gz'))));assert.deepEqual(checkGameStateInvariants(state),[]);
 const formed=[...state.operations.values()].filter(o=>o.plan?.action==='REINFORCE'&&o.plan.destination.kind==='new_army'&&o.status==='completed').map(o=>o.links.armyId);
 const lost=formed.filter(id=>!state.armies.has(id)).sort(),battleLost=[...new Set(c.participations.filter(b=>!b.won).map(b=>b.armyId))].sort();assert.deepEqual(lost,battleLost);
 const summary=JSON.parse(fs.readFileSync(dir+'/summary.json','utf8'));assert.equal(summary.conservation.troopResidual,0);assert.equal(summary.conservation.siegeResidual,0);assert(Object.values(summary.conservation.resourceResidual).every(v=>v===0));checked++;
}
console.log(JSON.stringify({archivedCasesChecked:checked,invariantFailures:0,conservationResiduals:0,missingArmiesExactlyMatchDistinctBattleLosses:true}));
