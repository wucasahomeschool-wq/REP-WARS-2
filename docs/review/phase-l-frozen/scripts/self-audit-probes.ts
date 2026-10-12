// Review-only probes. These mutate in-memory fixtures, never repository code.
// Run with the bundled AST fixture driver (see TEST_EVIDENCE.md).
{
  const s=threat(world(),3);
  const base=s.armies.get('raider')!;
  s.armies.set('second',{...base,id:'second',location:'target',movement:null,
    attackIntent:{...base.attackIntent!,status:'ready',onlyArmyId:'second'}});
  s.factions.get('enemy')!.armies.push('second');
  observe(s); online(s); processNonProactiveBoundary(s);
  const previous=s.aiResponseScheduler.primaryByFaction.get('me');
  const before=responseStateProblems(s);
  s.worldTick=2;
  observe(s);
  const afterObservation=responseStateProblems(s);
  processNonProactiveBoundary(s);
  const afterProcessing=responseStateProblems(s);
  console.log(JSON.stringify({probe:'urgency escalation with another active primary',
    previousPrimary:previous,before,afterObservation,afterProcessing,
    thinking:[...s.aiResponses.values()].filter(c=>c.status==='thinking').map(c=>c.id),
    primary:s.aiResponseScheduler.primaryByFaction.get('me')??null}));
}
{
  const s=world();
  s.activeInvasions.set('review-invasion',{id:'review-invasion',defenderFactionId:'me',
    attackerFactionId:'enemy',territoryId:'stage',startedAtTick:0,notifiedAtTick:0,
    responseDeadlineTick:30,status:'pending_response',defenseMobilization:null,
    defenseWorkoutStartedAtTick:null,defenseCompletionDeadlineTick:null,
    defenseSessionId:null,attackingArmyIds:[],battleSeed:7,commitmentId:null});
  observe(s);
  const c=[...s.aiResponses.values()].find(c=>c.subject.kind==='invasion')!;
  c.status='blocked';c.outcome='NO_ADDITIONAL_INTERVENTION';c.timer=null;
  s.aiResponses.set(c.id,c);
  const before={revision:c.revision,signature:c.materialSignature,status:c.status};
  s.territories.get('stage')!.garrison+=1000;
  s.territoryRecruitment.get('stage')!.troops+=2000;
  observe(s);
  console.log(JSON.stringify({probe:'invasion materiality signature (synthetic support fixture)',
    before,after:{revision:c.revision,signature:c.materialSignature,status:c.status},
    scope:'unit-level observer probe; current production invasion entry point targets player'}));
}
