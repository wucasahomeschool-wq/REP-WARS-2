import assert from 'assert';
import {makeOperationTestWorld,setFixturePeace} from './aiOperationFixtures';
import {recordConflictFact,conflictSummary,conflictPairId,conflictEventId,hostileFactIdentity} from '../src/conflict/ledger';
import {CONFLICT_TUNING as C} from '../src/constants/conflict';
import type {ConflictFact} from '../src/types/ConflictLedger';
import type {GameState} from '../src/types/GameState';
import {cloneGameState} from '../src/state/cloneGameState';
import {encodePersistable} from '../src/persistence/serialization';
import {hydratePersistedPayload} from '../src/persistence/hydrate';
import {runStateTransaction} from '../src/orchestration/transaction';
import {InMemoryGameStateStore} from '../src/persistence/inMemoryGameStateStore';
import {checkGameStateInvariants} from '../src/state/gameStateInvariants';
import {conflictStateProblems} from '../src/state/conflictInvariants';
import {StrategicEvaluators} from '../src/scoring/strategicEvaluators';
import {FactualSupport} from '../src/scoring/factualSupport';
import {ContextPlanComparator} from '../src/scoring/contextPlanComparison';
import {assessRequiredPeaceResponse} from '../src/scoring/peaceAssessment';
import {assignGoal} from '../src/cognition/goals';
import {applyOpinionEvent} from '../src/cognition/opinion';
import {SeededRNG} from '../src/utils/SeededRNG';
import {computeAttackerPower,computeDefenderPower} from '../src/battle/CombatPower';
import {BattleEngine,BattleInput} from '../src/battle/BattleEngine';
import {applyBattleResultToGameState,applyUnopposedOccupationToGameState} from '../src/orchestration/applyBattle';
import {Orchestrator,createDefaultRegistry} from '../src/orchestration';
import {executeAttack} from '../src/orchestration/handlers';
import {WorldSimulator} from '../src/events/WorldSimulator';
import {startStrategicAttack} from '../src/army/strategicAttack';
import {makeConcretePlan,PROACTIVE_AI_ACTIONS} from '../src/types/AIConcretePlan';
import {STRATEGIC_EVALUATORS} from '../src/types/StrategicEvaluation';
import {PRESSURE_DOMAINS} from '../src/types/AIPressure';
import {deriveSources,observeSources,sourceConcretePlans} from '../src/engine/strategicPressure';
import {beginInvasionAgainstPlayer} from '../src/gameplay/invasion/create';
import {resolveInvasionBattle} from '../src/gameplay/invasion/resolve';
import {processTradeBoundary,settleTradeProposal,liveTradeProposals} from '../src/gameplay/trade/trade';
import {processPeaceBoundary,settlePeaceProposal,livePeaceProposals} from '../src/gameplay/diplomacy/peace';
import {accrueProactiveClocks} from '../src/engine/proactiveCognition';
import {relationshipBetween} from '../src/gameplay/diplomacy/relationships';
import {settleOperation} from '../src/engine/operations';
type Api=Pick<Parameters<typeof import('./aiTrade').registerAiTradeTests>[0],'test'|'makeSelf'|'makeTerritory'|'cmdReq'>;
export function registerAiConflictTests({test,makeSelf,makeTerritory,cmdReq}:Api):void {
  class QuietEvents extends WorldSimulator {
    simulate(input:any):any {return {perTurnConsequences:[],expiredEvents:[],unresolvedDecisions:[],mutatedTerritories:input.territories,mutatedFactions:input.factions,mutatedArmies:input.armies,newActiveEvents:input.activeEvents,newEventHistory:input.eventHistory,triggeredEvents:[],summary:[]};}
  }
  const registry=()=>{const r=createDefaultRegistry();r.events=new QuietEvents();return r;};
  const advance=(s:GameState,ticks:number)=>{const o=new Orchestrator(s,registry());const r=o.execute(cmdReq('ADVANCE_WORLD','ai',{elapsedTicks:ticks}));assert.ok(r.success,JSON.stringify(r.errors));return cloneGameState(o.getState());};
  const world=()=>makeOperationTestWorld(makeSelf,makeTerritory);
  const reload=(s:GameState)=>hydratePersistedPayload(encodePersistable(s));
  const ledger=(s:GameState)=>encodePersistable({pairs:s.conflictLedger,receipts:s.conflictEventReceipts});
  const war=(s:GameState,other='enemy')=>new StrategicEvaluators(new FactualSupport(s)).warValue('me',other);
  const loss=(s:GameState,id:string,own=10,enemy=20,other='enemy')=>recordConflictFact(s,id,{kind:'BATTLE',actor:'me',target:other,troopLosses:[own,enemy],siegeLosses:[0,0],outcome:own>enemy?'defender':'attacker'});
  const transfer=(s:GameState,id:string,actor='me',target='enemy')=>recordConflictFact(s,id,{kind:'TERRITORY_TRANSFER',actor,target,territoryId:'target'});
  const attack=(armyId='a',stage=false)=>makeConcretePlan({action:'ATTACK',factionId:'me',armyId,originTerritoryId:stage?'stage':'home',stagingTerritoryId:'stage',targetTerritoryId:'target',route:stage?['stage','target']:['home','stage','target']});
  const immediate=(s=world())=>{s.armies.get('a')!.location='stage';return s;};
  const peace=(s:GameState)=>{
    const o=new Orchestrator(s);assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:makeConcretePlan({action:'OFFER_PEACE',factionId:'me',counterpartyId:'spectator'})})).success);
    const d=cloneGameState(o.getState());accrueProactiveClocks(d,d.aiClock.nowMs+30000,'OFFLINE');processPeaceBoundary(d);
    assert.ok(settlePeaceProposal(d,livePeaceProposals(d)[0]!.id,'accepted'));processPeaceBoundary(d);
    accrueProactiveClocks(d,d.aiClock.nowMs+10000,'OFFLINE');processPeaceBoundary(d);assert.strictEqual(relationshipBetween(d,'me','spectator'),'PEACE');return d;
  };
  const resolvedBattle=(s:GameState,own=600,enemy=20,seed=7)=>{
    const a=s.armies.get('a')!;a.soldiers=own;a.knights=0;s.territories.get('target')!.garrison=enemy;
    const input:BattleInput={turn:s.turn,seed,battleId:'exact-test-battle:'+seed,attackerFactionId:'me',attackerFactionName:'me',defenderFactionId:'enemy',defenderFactionName:'enemy',
      attackerArmies:[a],defenderArmies:[],defenderGarrison:enemy,territory:s.territories.get('target')!};
    const result=new BattleEngine().resolve(input);return {a,result};
  };
  test('Phase K: clean canonical ledger does not fabricate default WAR history',()=>{const s=world();assert.strictEqual(relationshipBetween(s,'me','enemy'),'WAR');assert.strictEqual(s.conflictLedger.size,0);assert.strictEqual(s.conflictEventReceipts.size,0);assert.strictEqual(war(s).facts.conflict,null);});
  test('Phase K: exact eight actions seven evaluators five domains remain',()=>{assert.strictEqual(PROACTIVE_AI_ACTIONS.length,8);assert.strictEqual(STRATEGIC_EVALUATORS.length,7);assert.strictEqual(PRESSURE_DOMAINS.length,5);assert.ok(!STRATEGIC_EVALUATORS.some(n=>String(n).includes('CONFLICT')));});
  test('Phase K: pair identity preserves full exact IDs and unordered pair semantics',()=>{assert.strictEqual(conflictPairId('a:b','c'),conflictPairId('c','a:b'));assert.notStrictEqual(conflictPairId('a:b','c'),conflictPairId('a','b:c'));});
  test('Phase K: faction-relative casualty and territorial facts are directional',()=>{const s=world();loss(s,'battle',3,40);transfer(s,'capture');const a=conflictSummary(s,'me','enemy')!,b=conflictSummary(s,'enemy','me')!;assert.strictEqual(a.own.troopsLost,b.opponent.troopsLost);assert.strictEqual(a.own.territoriesGained,b.opponent.territoriesGained);assert.strictEqual(b.own.territoriesLost,1);});
  for(const kind of ['ATTACK_COMMITTED','HOSTILE_ARRIVAL','BATTLE','TERRITORY_TRANSFER','ATTACK_TERMINAL','RETREAT','PEACE_ACTIVATED','WAR_RETURN'] as const)
    test(`Phase K: ${kind} receipts replay and reload exactly once`,()=>{
      const s=world(),f:ConflictFact={kind,actor:'me',target:'enemy',...(kind==='BATTLE'?{troopLosses:[2,3] as const,siegeLosses:[0,1] as const,outcome:'draw' as const}:{}),...(kind==='TERRITORY_TRANSFER'?{territoryId:'target'}:{}),...(kind==='ATTACK_TERMINAL'?{outcome:'failed' as const}:{})};
      assert.ok(recordConflictFact(s,'domain',f));const before=ledger(s);assert.strictEqual(recordConflictFact(s,'domain',f),false);assert.deepStrictEqual(ledger(s),before);
      const d=reload(s);assert.strictEqual(recordConflictFact(d,'domain',f),false);assert.deepStrictEqual(ledger(d),before);
    });
  test('Phase K: conflicting event-ID reuse fails explicitly',()=>{const s=world();loss(s,'domain',2,3);assert.throws(()=>loss(s,'domain',3,3));});
  test('Phase K: malformed quantities and missing exact battle consequence are rejected atomically',()=>{const s=world(),before=ledger(s);assert.throws(()=>loss(s,'bad',NaN,3));assert.throws(()=>recordConflictFact(s,'bad',{kind:'BATTLE',actor:'me',target:'enemy'}));assert.throws(()=>recordConflictFact(s,'bad',{kind:'ATTACK_COMMITTED',actor:'me',target:'me'}));assert.deepStrictEqual(ledger(s),before);});
  test('Phase K: clone and returned summary cannot alias canonical facts',()=>{const s=world();loss(s,'battle');const before=ledger(s),d=cloneGameState(s);d.conflictLedger.values().next().value!.episodes.get(0)!.totals[0].troopsLost=999;const view=conflictSummary(s,'me','enemy')!;view.own.troopsLost=88;assert.deepStrictEqual(ledger(s),before);});
  test('Phase K: failed transaction rolls back consequence and ledger together',()=>{const s=world(),before=encodePersistable(s);assert.throws(()=>runStateTransaction(s,d=>{d.territories.get('target')!.owner='me';transfer(d,'capture');throw new Error('abort');}));assert.deepStrictEqual(encodePersistable(s),before);});
  test('Phase K: actual persisted CAS conflict and retry settle a factual event once',async()=>{
    const s=world(),store=new InMemoryGameStateStore();assert.ok(store.save('player',s,0).ok);
    const a=store.load('player'),b=store.load('player');assert.ok(a.ok&&b.ok);if(!a.ok||!b.ok)throw new Error('load failed');
    const draft=runStateTransaction(a.state,d=>loss(d,'cas',7,9)).state;
    assert.ok(store.save('player',b.state,b.record.stateVersion).ok);
    const stale=store.save('player',draft,a.record.stateVersion);assert.ok(!stale.ok);if(!stale.ok)assert.strictEqual(stale.code,'persistence.conflict');
    const fresh=store.load('player');assert.ok(fresh.ok);if(!fresh.ok)throw new Error('reload failed');assert.strictEqual(fresh.state.conflictLedger.size,0);
    const retry=runStateTransaction(fresh.state,d=>loss(d,'cas',7,9)).state;assert.ok(store.save('player',retry,fresh.record.stateVersion).ok);
    const final=store.load('player');assert.ok(final.ok);if(!final.ok)throw new Error('reload failed');assert.strictEqual(conflictSummary(final.state,'me','enemy')!.own.troopsLost,7);assert.strictEqual(loss(final.state,'cas',7,9),false);
  });
  test('Phase K: actual attack start records commitment but no travel victory or casualties',()=>{const s=world(),o=new Orchestrator(s);assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:attack()})).success);const d=o.getState(),v=conflictSummary(d,'me','enemy')!;assert.strictEqual(v.own.commitments,1);assert.strictEqual(v.own.battles,0);assert.strictEqual(v.own.territoriesGained,0);assert.strictEqual(v.own.troopsLost,0);assert.ok(d.armies.get('a')!.movement);assert.deepStrictEqual(ledger(reload(d)),ledger(d));});
  test('Phase K: concurrent exact attacks record independently for one pair',()=>{const s=world();s.territories.set('target2',makeTerritory({id:'target2',owner:'enemy',neighboring:['stage'],garrison:20}));s.territories.get('stage')!.neighboring.push('target2');s.factions.get('enemy')!.territories.push('target2');Object.assign(s,require('./worldTestHelpers').authoredWorldFields(s.territories));const o=new Orchestrator(s);assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:attack('a')})).success);const second=makeConcretePlan({action:'ATTACK',factionId:'me',armyId:'b',originTerritoryId:'home',stagingTerritoryId:'stage',targetTerritoryId:'target2',route:['home','stage','target2']});const r=o.execute(cmdReq('START_AI_OPERATION','ai',{plan:second}));assert.ok(r.success,JSON.stringify(r.errors));assert.strictEqual(conflictSummary(o.getState(),'me','enemy')!.own.commitments,2);});
  test('Phase K: immediate successful attack records one causal chain',()=>{const s=immediate(),o=new Orchestrator(s);assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:attack('a',true)})).success);const v=conflictSummary(o.getState(),'me','enemy')!;assert.strictEqual(v.own.commitments,1);assert.strictEqual(v.own.arrivals,1);assert.strictEqual(v.own.battles,1);assert.strictEqual(v.own.territoriesGained,1);assert.strictEqual(v.opponent.territoriesLost,1);});
  for(const [own,enemy,label]of [[600,20,'victory'],[10,100000,'defeat']] as const)
    test(`Phase K: authoritative ${label} casualties and siege are exact without replay`,()=>{const s=world(),{a,result}=resolvedBattle(s,own,enemy);applyBattleResultToGameState(s,result,[a],[],s.turn,'exact');const v=conflictSummary(s,'me','enemy')!;assert.strictEqual(v.own.troopsLost,result.attacker.casualties.total);assert.strictEqual(v.opponent.troopsLost,result.defender.casualties.total);assert.strictEqual(v.own.territoriesGained,result.territoryOutcome==='captured'?1:0);const before=encodePersistable(s);applyBattleResultToGameState(s,result,[a],[],s.turn,'exact');assert.deepStrictEqual(encodePersistable(s),before);});
  test('Phase K: retained defensive territory is not recorded as a gain',()=>{const s=world(),{a,result}=resolvedBattle(s,10,100000);assert.strictEqual(result.winner,'defender');applyBattleResultToGameState(s,result,[a],[],s.turn);const v=conflictSummary(s,'enemy','me')!;assert.strictEqual(v.own.territoriesGained,0);assert.strictEqual(v.own.victories,1);});
  test('Phase K: invasion publication and actual capture preserve ledger causality',()=>{const s=immediate();s.playerFactionId='enemy';s.levelAnchorTerritoryIds=[];s.territories.get('target')!.garrison=0;const r=beginInvasionAgainstPlayer(s,{attackerId:'me',territoryId:'target',armies:[s.armies.get('a')!],bypassPlayerDefenseGates:true});const id=String(r.payload.invasionId);assert.strictEqual(conflictSummary(s,'me','enemy')!.own.commitments,1);const d=reload(s);resolveInvasionBattle(d,new BattleEngine(),id,'undefended');const v=conflictSummary(d,'me','enemy')!;assert.strictEqual(v.own.battles,0);assert.strictEqual(v.own.territoriesGained,1);assert.throws(()=>resolveInvasionBattle(d,new BattleEngine(),id));});
  test('Phase K: virtual defense power is not a physical troop loss',()=>{const s=world(),a=s.armies.get('a')!;a.soldiers=100000;a.knights=0;const input:BattleInput={turn:s.turn,seed:7,attackerFactionId:'me',attackerFactionName:'me',defenderFactionId:'enemy',defenderFactionName:'enemy',attackerArmies:[a],defenderArmies:[{soldiers:100,knights:0,siegeEngines:0,morale:80,supply:80}],defenderGarrison:20,territory:s.territories.get('target')!};const result=new BattleEngine().resolve(input);applyBattleResultToGameState(s,result,[a],[],s.turn);assert.strictEqual(conflictSummary(s,'me','enemy')!.opponent.troopsLost,20);});
  test('Phase K: unopposed capture records no invented battle or casualties',()=>{const s=world();s.territories.get('target')!.garrison=0;applyUnopposedOccupationToGameState(s,s.territories.get('target')!,'me',[s.armies.get('a')!],s.turn);const v=conflictSummary(s,'me','enemy')!;assert.strictEqual(v.own.battles,0);assert.strictEqual(v.own.troopsLost,0);assert.strictEqual(v.own.territoriesGained,1);});
  test('Phase K: conquest records actually forfeited resource/structure/pool facts',()=>{const s=world();s.territoryEconomy.set('target',{territoryId:'target',lastAccrualTick:s.worldTick,uncollected:{gold:3,food:4,wood:5,iron:6,stone:7}});s.territoryInfrastructure.set('target',{territoryId:'target',farmCompletedAtTick:0,mineCompletedAtTick:null,lumberCompletedAtTick:null});s.territories.get('target')!.fortification=2;applyUnopposedOccupationToGameState(s,s.territories.get('target')!,'me',[s.armies.get('a')!],s.turn);const v=conflictSummary(s,'me','enemy')!;assert.strictEqual(v.opponent.resourcesLost.wood,5);assert.strictEqual(v.opponent.structuresLost,1);assert.strictEqual(v.opponent.fortificationLevelsLost,2);assert.strictEqual(s.territoryEconomy.get('target')!.uncollected.wood,0);});
  test('Phase K: invalidation during travel keeps physical work and records no fake arrival',()=>{const o=new Orchestrator(world());assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:attack()})).success);const s=cloneGameState(o.getState()),op=[...s.operations.values()][0]!;assert.strictEqual(settleOperation(s,op.id,'failed','objective lost'),false);const v=conflictSummary(s,'me','enemy')!;assert.ok(s.armies.get('a')!.movement);assert.strictEqual(v.own.arrivals,0);assert.strictEqual(v.own.failedAttacks,0);assert.strictEqual(v.own.troopsLost,0);});
  test('Phase K: actual Peace activation closes an episode but preserves its facts',()=>{const s=world();loss(s,'battle',10,20,'spectator');const d=peace(s),v=conflictSummary(d,'me','spectator')!;assert.ok(v.closed);assert.strictEqual(v.own.troopsLost,10);const before=ledger(d);processPeaceBoundary(d);assert.deepStrictEqual(ledger(d),before);});
  test('Phase K: clearance does not close in-flight hostility history',()=>{const s=world();recordConflictFact(s,'attack',{kind:'ATTACK_COMMITTED',actor:'me',target:'spectator'});const pairId=`pair:v1:${JSON.stringify(['me','spectator'])}`;s.peaceRelationships.set(pairId,{pairId,factions:['me','spectator'],state:'PENDING_HOSTILITIES_CLEARANCE',proposalId:null,acceptedAtMs:0,activatedAtMs:null,expiresAtMs:null,legacyExpiresTurn:null,finalizationTimer:null});assert.strictEqual(conflictSummary(s,'me','spectator')!.closed,false);loss(s,'still-fighting',2,3,'spectator');assert.strictEqual(conflictSummary(s,'me','spectator')!.own.battles,1);});
  test('Phase K: actual Peace expiry starts an empty new observed episode',()=>{const s=world();loss(s,'battle',1,2,'spectator');const d=peace(s),r=[...d.peaceRelationships.values()][0]!;d.aiClock.nowMs=r.expiresAtMs!;processPeaceBoundary(d);assert.strictEqual(relationshipBetween(d,'me','spectator'),'WAR');const p=d.conflictLedger.get(conflictPairId('me','spectator'))!;assert.strictEqual(p.currentEpisode,1);assert.strictEqual(p.episodes.get(0)!.totals[0].troopsLost,1);assert.strictEqual(conflictSummary(d,'me','spectator')!.own.battles,0);assert.deepStrictEqual(ledger(reload(d)),ledger(d));});
  test('Phase K: repeated war Peace periods preserve archives without history reconstruction',()=>{const s=world();for(let i=0;i<100;i++){loss(s,'battle'+i,1,2);recordConflictFact(s,'peace'+i,{kind:'PEACE_ACTIVATED',actor:'me',target:'enemy'});recordConflictFact(s,'expiry'+i,{kind:'WAR_RETURN',actor:'me',target:'enemy'});}const p=s.conflictLedger.values().next().value!;assert.strictEqual(p.episodes.size,101);assert.strictEqual(conflictSummary(s,'me','enemy')!.own.battles,0);assert.strictEqual(p.episodes.get(0)!.totals[p.factions.indexOf('me')].troopsLost,1);});
  test('Phase K: duration uses observed authoritative boundaries without exhaustion score',()=>{const s=world();loss(s,'battle');const before=war(s).facts.continuationBalance;s.worldTick+=10;s.aiClock.nowMs+=10000;const v=war(s).facts;assert.strictEqual(v.conflict!.observedDurationTicks,10);assert.strictEqual(v.conflict!.observedDurationMs,10000);assert.strictEqual(v.continuationBalance,before);});
  for(const [a,b,label]of [[1,100,'favorable'],[100,1,'unfavorable']] as const)
    test(`Phase K: ${label} casualty trajectory changes factual continuation`,()=>{const s=world(),before=war(s).facts.continuationBalance;loss(s,'battle',a,b);const after=war(s).facts.historyBalance;assert.ok(label==='favorable'?after>0:after<0);assert.notStrictEqual(war(s).facts.continuationBalance,before);});
  for(const actor of ['me','enemy'])test(`Phase K: territory trajectory is faction-relative for ${actor}`,()=>{const s=world();transfer(s,'territory',actor,actor==='me'?'enemy':'me');const f=war(s).facts;assert.strictEqual(f.territorialTrajectory!.net,actor==='me'?1:-1);assert.ok(actor==='me'?f.historyBalance>0:f.historyBalance<0);});
  test('Phase K: mixed recent trajectory is factual not a future prediction',()=>{const s=world();for(let i=0;i<C.recentWindow;i++)loss(s,'old'+i,2,100);for(let i=0;i<C.recentWindow;i++)loss(s,'recent'+i,100,2);const f=war(s).facts;assert.ok(f.previousMaterialBalance>0);assert.ok(f.recentMaterialBalance<0);assert.ok(f.trajectoryChange<0);assert.strictEqual(f.conflict!.materialFacts,2*C.recentWindow);});
  test('Phase K: recent window remains bounded while cumulative facts survive',()=>{const s=world();for(let i=0;i<1000;i++)loss(s,'event'+i,1,2);const e=s.conflictLedger.values().next().value!.episodes.get(0)!;assert.strictEqual(e.recent.length,2*C.recentWindow);assert.strictEqual(e.totals[s.conflictLedger.values().next().value!.factions.indexOf('me')].troopsLost,1000);assert.strictEqual(s.conflictEventReceipts.size,1000);assert.deepStrictEqual(war(reload(s)),war(s));});
  test('Phase K: activity counts do not independently become military success',()=>{const s=world(),before=war(s).facts.continuationBalance;for(let i=0;i<20;i++){recordConflictFact(s,'op'+i,{kind:'ATTACK_COMMITTED',actor:'me',target:'enemy'});recordConflictFact(s,'op'+i,{kind:'HOSTILE_ARRIVAL',actor:'me',target:'enemy'});}assert.strictEqual(war(s).facts.continuationBalance,before);assert.strictEqual(war(s).facts.conflict!.materialFacts,0);});
  test('Phase K: quiet observers do not scan ledger pairs or receipt history',()=>{const s=world();loss(s,'fact');for(const m of [s.conflictLedger,s.conflictEventReceipts])Object.defineProperty(m,Symbol.iterator,{value(){throw new Error('historical scan');}});assert.doesNotThrow(()=>observeSources(s,'me'));assert.doesNotThrow(()=>war(s));});
  test('Phase K: WAR evaluation reads no archived episodes or unbounded receipts',()=>{const s=world();loss(s,'battle');const p=s.conflictLedger.values().next().value!;Object.defineProperty(p.episodes,Symbol.iterator,{value(){throw new Error('episode scan');}});Object.defineProperty(s.conflictEventReceipts,Symbol.iterator,{value(){throw new Error('receipt scan');}});assert.doesNotThrow(()=>war(s));});
  for(const privateField of ['goals','memory','personality','ambition','diplomacy'] as const)
    test(`Phase K: factual ledger and WAR_VALUE never read private ${privateField}`,()=>{const s=world();loss(s,'battle');const before=war(s);for(const f of s.factions.values())Object.defineProperty(f,privateField,{get(){throw new Error('private '+privateField);}});assert.deepStrictEqual(war(s),before);assert.doesNotThrow(()=>loss(s,'next'));});
  test('Phase K: Opinion and Goals change preference but never the ledger/factual core',()=>{const s=world();loss(s,'battle');const facts=war(s),before=ledger(s);assignGoal(s,'me','defeat',{kind:'ELIMINATE_FACTION',factionId:'enemy'});applyOpinionEvent(s,'dislike','me','enemy','authored',-100);assert.deepStrictEqual(ledger(s),before);assert.deepStrictEqual(war(s),facts);});
  test('Phase K: future RNG cannot be consumed by ledger or WAR_VALUE',()=>{const s=world();loss(s,'battle');const old=SeededRNG.prototype.next;SeededRNG.prototype.next=()=>{throw new Error('future draw');};try{assert.doesNotThrow(()=>war(s));assert.doesNotThrow(()=>loss(s,'another'));}finally{SeededRNG.prototype.next=old;}});
  test('Phase K: unfavorable facts support own required Peace assessment outside Opinion',()=>{const s=world(),before=assessRequiredPeaceResponse(s,'me','enemy');loss(s,'loss',1000,0);const after=assessRequiredPeaceResponse(s,'me','enemy');assert.ok(after.factual>before.factual);assert.strictEqual(after.opinion,before.opinion);});
  test('Phase K: opponent B facts cannot pollute opponent C',()=>{const s=world(),other=war(s,'spectator');loss(s,'enemy-battle',1000,0);assert.deepStrictEqual(war(s,'spectator'),other);loss(s,'spectator-battle',0,1000,'spectator');assert.ok(war(s).facts.historyBalance<0);assert.ok(war(s,'spectator').facts.historyBalance>0);});
  test('Phase K: ledger presence alone creates no new source or candidate',()=>{const s=world(),before=deriveSources(s,'me',0);loss(s,'battle',1000,0);assert.deepStrictEqual(deriveSources(s,'me',0),before);assert.ok(!deriveSources(s,'me',0).some(c=>c.domain==='DIPLOMACY_PEACE'));});
  test('Phase K: attack comparison retains causal ownership and exact parameters',()=>{const s=world();loss(s,'history',100,0);observeSources(s,'me');const c=[...s.aiPressure.values()].find(c=>c.kind==='HOSTILE_OPPORTUNITY')!;const compared=new ContextPlanComparator().compare(s,c,sourceConcretePlans(s,c));for(const p of compared.comparisons){assert.strictEqual(new Set(p.contributions.map(x=>x.causalKey)).size,p.contributions.length);if(p.plan.action==='ATTACK')assert.strictEqual(p.plan.targetTerritoryId,'target');}});
  test('Phase K: schema 25 migration does not infer conflict facts from Memory Opinion or logs',()=>{const s=world();s.schemaVersion=25;s.factions.get('me')!.memory=[{id:'old',turn:0,type:'territory_lost',withFaction:'enemy',territory:'target',magnitude:100,details:{}}];delete (s as Partial<GameState>).conflictLedger;delete (s as Partial<GameState>).conflictEventReceipts;const d=reload(s);assert.strictEqual(d.schemaVersion,26);assert.strictEqual(d.conflictLedger.size,0);assert.strictEqual(d.conflictEventReceipts.size,0);assert.deepStrictEqual(d.factions.get('me')!.memory,s.factions.get('me')!.memory);});
  test('Phase K: current schema cannot silently recreate missing ledger authority',()=>{const s=world();delete (s as Partial<GameState>).conflictLedger;assert.throws(()=>reload(s));});
  test('Phase K: corruption invariants cover counts windows pair and receipt ownership',()=>{const s=world();loss(s,'battle');const p=s.conflictLedger.values().next().value!,e=p.episodes.get(0)!;e.totals[0].troopsLost=-1;e.recent[0]!.sequence=999;s.conflictEventReceipts.values().next().value!.pairId='missing';assert.ok(conflictStateProblems(s).length>=3);});
  test('Phase K: public DTO excludes ledger receipts and factual assessment details',()=>{const s=world();loss(s,'private-conflict');const r=new Orchestrator(s).execute(cmdReq('GET_GAME_STATE','player',{}));assert.ok(r.success);const json=JSON.stringify(r.payload);for(const key of ['conflictLedger','conflictEventReceipts','private-conflict','continuationBalance','historyBalance'])assert.ok(!json.includes(key));});
  test('Phase K: collection insertion order cannot change trajectory or receipts',()=>{const s=world();loss(s,'battle');transfer(s,'capture');const d=reload(s);d.factions=new Map([...d.factions].reverse());d.armies=new Map([...d.armies].reverse());d.territories=new Map([...d.territories].reverse());assert.deepStrictEqual(war(d),war(s));assert.deepStrictEqual(ledger(d),ledger(s));});
  test('Phase K: equivalent authoritative event chunking survives intermediate reloads',()=>{const a=world();let b=world();for(let i=0;i<50;i++){a.worldTick++;a.aiClock.nowMs+=1000;loss(a,'battle'+i,i,i+1);b.worldTick++;b.aiClock.nowMs+=1000;loss(b,'battle'+i,i,i+1);if(i%7===0)b=reload(b);}assert.deepStrictEqual(ledger(a),ledger(b));assert.deepStrictEqual(war(a),war(b));});
  test('Phase K: battle identity collision cannot silently suppress different consequences',()=>{
    const s=world(),{a,result}=resolvedBattle(s);applyBattleResultToGameState(s,result,[a],[],s.turn,'domain');
    const before=encodePersistable(s);assert.throws(()=>applyBattleResultToGameState(s,{...result,winner:'draw'},[a],[],s.turn,'domain'));assert.deepStrictEqual(encodePersistable(s),before);
  });
  test('Phase K: ordinary Battle Outlook evaluation cannot change the next real seeded battle',()=>{
    const a=world(),b=cloneGameState(a),e=new StrategicEvaluators(new FactualSupport(a));for(let i=0;i<20;i++){e.battleOutlook('a','target');e.warValue('me','enemy');}
    assert.deepStrictEqual(resolvedBattle(a).result,resolvedBattle(b).result);
  });
  test('Phase K: tied-roll Battle Engine draw records casualties without invented capture or victory',()=>{
    const s=world(),a=s.armies.get('a')!,t=s.territories.get('target')!;a.soldiers=600;a.knights=0;t.garrison=600;
    const atk=computeAttackerPower([a]).effectivePower,def=computeDefenderPower([],t.garrison,t).effectivePower;
    const input:BattleInput={turn:s.turn,seed:7,battleId:'draw-boundary',attackerFactionId:'me',defenderFactionId:'enemy',attackerArmies:[a],defenderArmies:[],defenderGarrison:t.garrison,territory:t,strategicAttackerBonus:Math.max(0,def-atk),strategicDefenderBonus:Math.max(0,atk-def)};
    // Exercise the resolver's exact equal-power/equal-roll boundary, which
    // cannot reliably be reached by searching ordinary random seeds.
    const old=SeededRNG.prototype.next;let result:ReturnType<BattleEngine['resolve']>;
    try{SeededRNG.prototype.next=()=>0.5;result=new BattleEngine().resolve(input);}finally{SeededRNG.prototype.next=old;}
    assert.strictEqual(result.winner,'draw');applyBattleResultToGameState(s,result,[a],[],s.turn);
    const v=conflictSummary(s,'me','enemy')!;assert.strictEqual(v.own.troopsLost,result.attacker.casualties.total);assert.strictEqual(v.own.victories,0);assert.strictEqual(v.opponent.victories,0);assert.strictEqual(v.own.territoriesGained,0);
  });
  test('Phase K: real staged attack fine coarse and reloaded progression have identical facts',()=>{
    const o=new Orchestrator(world(),registry());assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:attack()})).success);
    const s=cloneGameState(o.getState()),duration=s.armies.get('a')!.movement!.durationTicks;
    const coarse=advance(s,duration);let fine=cloneGameState(s),resumed=reload(s);
    for(let i=0;i<duration;i++){fine=advance(fine,1);resumed=advance(resumed,1);if(i===1)resumed=reload(resumed);}
    assert.deepStrictEqual(ledger(coarse),ledger(fine));assert.deepStrictEqual(ledger(coarse),ledger(resumed));assert.deepStrictEqual(war(coarse),war(fine));
    const v=conflictSummary(coarse,'me','enemy')!;assert.strictEqual(v.own.commitments,1);assert.strictEqual(v.own.arrivals,1);assert.strictEqual(v.own.battles,1);
  });
  test('Phase K: direct staged domain attack records one identity from start through arrival',()=>{
    const s=world();startStrategicAttack(s,{req:cmdReq('ATTACK','ai',{}),registry:registry()},{territoryId:'target',factionId:'me',onlyArmyId:'a'});
    assert.strictEqual(conflictSummary(s,'me','enemy')!.own.commitments,1);const duration=s.armies.get('a')!.movement!.durationTicks,d=advance(reload(s),duration);
    const v=conflictSummary(d,'me','enemy')!;assert.strictEqual(v.own.commitments,1);assert.strictEqual(v.own.arrivals,1);assert.strictEqual(v.own.battles,1);
  });
  test('Phase K: conquest reports actual undeployed forfeiture exactly once',()=>{
    const s=world();require('../src/gameplay/recruitment/recruitment').initializeRecruitment(s);s.territoryRecruitment.get('target')!.troops=80;
    applyUnopposedOccupationToGameState(s,s.territories.get('target')!,'me',[s.armies.get('a')!],s.turn,'pool-capture');
    assert.strictEqual(conflictSummary(s,'me','enemy')!.opponent.poolTroopsLost,80);const before=ledger(s);
    applyUnopposedOccupationToGameState(s,s.territories.get('target')!,'me',[s.armies.get('a')!],s.turn,'pool-capture');assert.deepStrictEqual(ledger(s),before);
  });
  test('Phase K: ledger never wakes an eliminated faction or invents a post-elimination war',()=>{
    const s=world();loss(s,'battle');s.factions.get('enemy')!.territories=[];s.factions.get('enemy')!.armies=[];s.territories.get('target')!.owner='me';const before=ledger(s);observeSources(s,'enemy');processPeaceBoundary(s);assert.deepStrictEqual(ledger(s),before);
  });
  test('Phase K: successful nested operation preserves canonical Opinion receipts too',()=>{
    const o=new Orchestrator(immediate());assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:attack('a',true)})).success);assert.ok(o.getState().opinionEvents.size>0);assert.deepStrictEqual(reload(o.getState()).opinionEvents,o.getState().opinionEvents);
  });
  test('Phase K: real clearance waits for attack while accepted Trade stays independent',()=>{
    const s=world();s.territories.set('refuge',makeTerritory({id:'refuge',owner:'enemy',neighboring:['target'],garrison:20}));s.territories.get('target')!.neighboring.push('refuge');s.factions.get('enemy')!.territories.push('refuge');Object.assign(s,require('./worldTestHelpers').authoredWorldFields(s.territories));
    const o=new Orchestrator(s,registry());assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:attack()})).success);assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:makeConcretePlan({action:'OFFER_PEACE',factionId:'me',counterpartyId:'enemy'})})).success);
    let d=cloneGameState(o.getState());accrueProactiveClocks(d,d.aiClock.nowMs+30000,'OFFLINE');processPeaceBoundary(d);assert.ok(settlePeaceProposal(d,livePeaceProposals(d)[0]!.id,'accepted'));processPeaceBoundary(d);
    assert.strictEqual(relationshipBetween(d,'me','enemy'),'PENDING_HOSTILITIES_CLEARANCE');assert.ok(!conflictSummary(d,'me','enemy')!.closed);assert.ok(d.armies.get('a')!.movement);
    const ledgerBeforeTrade=ledger(d),trade=makeConcretePlan({action:'TRADE',factionId:'me',counterpartyId:'enemy',offered:{wood:10},requested:{food:10},proposerSource:{kind:'faction_stock',factionId:'me',resources:{wood:10}},delivery:{proposerTerritoryId:'home',recipientTerritoryId:'refuge'}});
    const t=new Orchestrator(d,registry()),r=t.execute(cmdReq('START_AI_OPERATION','ai',{plan:trade}));assert.ok(r.success,JSON.stringify(r.errors));d=cloneGameState(t.getState());accrueProactiveClocks(d,d.aiClock.nowMs+60000,'OFFLINE');processTradeBoundary(d);
    assert.ok(settleTradeProposal(d,liveTradeProposals(d)[0]!.id,'accepted'));assert.deepStrictEqual(ledger(d),ledgerBeforeTrade);assert.strictEqual(d.tradeShipments.size,2);
    d=advance(reload(d),d.armies.get('a')!.movement!.durationTicks);processPeaceBoundary(d);accrueProactiveClocks(d,d.aiClock.nowMs+10000,'OFFLINE');processPeaceBoundary(d);
    assert.strictEqual(relationshipBetween(d,'me','enemy'),'PEACE');const v=conflictSummary(d,'me','enemy')!;assert.ok(v.closed);assert.strictEqual(v.own.commitments,1);assert.strictEqual(v.own.battles,1);assert.strictEqual(v.own.territoriesGained,1);
  });
  test('Phase K: failed atomic attack initiation consumes no ledger identity',()=>{
    const s=world();s.strategicAttention.capacity=0;const o=new Orchestrator(s),before=encodePersistable(o.getState());assert.strictEqual(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:attack()})).success,false);assert.deepStrictEqual(encodePersistable(o.getState()),before);
  });
  test('Phase K: actual attacking operation defeat settles failure without invented gains',()=>{
    const s=immediate();s.territories.get('target')!.garrison=1000000;const o=new Orchestrator(s);const r=o.execute(cmdReq('START_AI_OPERATION','ai',{plan:attack('a',true)}));assert.ok(r.success,JSON.stringify(r.errors));const v=conflictSummary(o.getState(),'me','enemy')!;
    assert.strictEqual(v.own.failedAttacks,1);assert.strictEqual(v.own.territoriesGained,0);assert.strictEqual(v.opponent.victories,1);const before=ledger(o.getState());settleOperation(o.getState(),String(r.payload.operationId),'failed','replay');assert.deepStrictEqual(ledger(o.getState()),before);
  });
  test('Phase K: distinct direct commands at one boundary cannot share factual chain identity',()=>{
    const s=world(),a=hostileFactIdentity(s,'target',['a'],null,'request:a'),b=hostileFactIdentity(s,'target',['a'],null,'request:b');assert.notStrictEqual(a,b);assert.strictEqual(hostileFactIdentity(reload(s),'target',['a'],null,'request:a'),a);
  });
  test('Phase K: staged command chain identity persists across processing request changes',()=>{
    const s=world(),req=cmdReq('ATTACK','ai',{});startStrategicAttack(s,{req,registry:registry()},{territoryId:'target',factionId:'me',onlyArmyId:'a'});const expected=s.armies.get('a')!.attackIntent!.conflictFactId!;
    const d=reload(s);d.worldTick++;assert.strictEqual(hostileFactIdentity(d,'target',['a'],null,'different-world-processing-request'),expected);
  });
  test('Phase K: invariants and serialization preserve a valid canonical pair',()=>{const s=world();loss(s,'battle');assert.deepStrictEqual(checkGameStateInvariants(s),[]);assert.deepStrictEqual(conflictStateProblems(reload(s)),[]);});
  test('Phase K review: immediate invasion retains the exact direct command identity',()=>{
    const s=immediate();s.playerFactionId='enemy';s.levelAnchorTerritoryIds=[];
    const req=cmdReq('ATTACK','ai',{factionId:'me',territoryId:'target',onlyArmyId:'a'});
    const expected=hostileFactIdentity(s,'target',['a'],null,req.requestId);
    executeAttack(s,{req,registry:registry()} as Parameters<typeof executeAttack>[1],'target','me');
    const d=s,invasion=[...d.activeInvasions.values()][0]!;
    assert.strictEqual(invasion.conflictFactId,expected);
    assert.strictEqual(reload(d).activeInvasions.get(invasion.id)!.conflictFactId,invasion.conflictFactId);
  });
  test('Phase K review: siege-only casualties remain material window facts without becoming troop losses',()=>{
    const s=world();recordConflictFact(s,'siege',{kind:'BATTLE',actor:'me',target:'enemy',troopLosses:[0,0],siegeLosses:[2,7],outcome:'draw'});
    const v=conflictSummary(s,'me','enemy')!;assert.strictEqual(v.materialFacts,1);assert.strictEqual(v.own.troopsLost,0);
    assert.strictEqual(v.recent.ownSiegeLost,2);assert.strictEqual(v.recent.opponentSiegeLost,7);
    assert.deepStrictEqual(conflictSummary(reload(s),'me','enemy'),v);
  });
  test('Phase K review: replayed unopposed capture cannot undo a later recapture',()=>{
    const s=world(),t=s.territories.get('target')!;t.garrison=0;
    applyUnopposedOccupationToGameState(s,t,'me',[],s.turn,'capture-1');
    applyUnopposedOccupationToGameState(s,t,'enemy',[],s.turn,'capture-2');
    const before=encodePersistable(s);applyUnopposedOccupationToGameState(s,t,'me',[],s.turn,'capture-1');
    assert.deepStrictEqual(encodePersistable(s),before);
  });
  for(const count of [16,17,32,33])test(`Phase K review: exact recent/previous rollover at ${count} material facts`,()=>{
    const s=world();for(let i=1;i<=count;i++)loss(s,'rollover-'+i,i,2*i);
    const v=conflictSummary(s,'me','enemy')!,sum=(start:number,end:number)=>end>=start?(start+end)*(end-start+1)/2:0;
    assert.strictEqual(v.own.troopsLost,sum(1,count));assert.strictEqual(v.opponent.troopsLost,2*sum(1,count));
    assert.strictEqual(v.recent.ownTroopsLost,sum(Math.max(1,count-C.recentWindow+1),count));
    assert.strictEqual(v.previous.ownTroopsLost,sum(Math.max(1,count-2*C.recentWindow+1),count-C.recentWindow));
    assert.deepStrictEqual(conflictSummary(reload(s),'me','enemy'),v);
  });
  test('Phase K review: closed Peace episode cannot be changed by a new terminal or retreat fact',()=>{
    const s=world();loss(s,'battle');recordConflictFact(s,'peace',{kind:'PEACE_ACTIVATED',actor:'me',target:'enemy'});const before=ledger(s);
    for(const kind of ['ATTACK_TERMINAL','RETREAT'] as const)assert.throws(()=>recordConflictFact(s,'late',{kind,actor:'me',target:'enemy',outcome:'failed'}));
    assert.deepStrictEqual(ledger(s),before);
  });
  test('Phase K review: legal physical withdrawal during Peace does not rewrite closed conflict totals',()=>{
    const s=world();s.armies.get('a')!.location='target';loss(s,'battle');recordConflictFact(s,'peace',{kind:'PEACE_ACTIVATED',actor:'me',target:'enemy'});setFixturePeace(s,'me','enemy');
    const before=ledger(s),plan=makeConcretePlan({action:'RETREAT',factionId:'me',armyId:'a',originTerritoryId:'target',fallbackTerritoryId:'stage',route:['target','stage']}),o=new Orchestrator(s);
    const r=o.execute(cmdReq('START_AI_OPERATION','ai',{plan}));assert.ok(r.success,JSON.stringify(r.errors));assert.ok(o.getState().armies.get('a')!.movement);assert.deepStrictEqual(ledger(o.getState()),before);
  });
  test('Phase K review: actual invasion mobilization records physical losses and defensive hold only',()=>{
    const s=immediate();s.playerFactionId='enemy';s.levelAnchorTerritoryIds=[];
    const r=beginInvasionAgainstPlayer(s,{attackerId:'me',territoryId:'target',armies:[s.armies.get('a')!],bypassPlayerDefenseGates:true}),id=String(r.payload.invasionId),i=s.activeInvasions.get(id)!;
    i.status='defense_in_progress';i.defenseWorkoutStartedAtTick=s.worldTick;i.defenseCompletionDeadlineTick=s.worldTick+720;
    i.defenseMobilization={applicationId:'defense',sessionId:'session',workoutId:'workout',playerId:'player',defensePower:100000,attachedAtTick:s.worldTick,workoutStartedAtTick:s.worldTick,sourcePhysicalOutput:100000};
    const initial=s.territories.get('target')!.garrison,d=reload(s),resolved=resolveInvasionBattle(d,new BattleEngine(),id,'defense_battle');assert.strictEqual(resolved.payload.winner,'defender');
    const v=conflictSummary(d,'me','enemy')!;assert.strictEqual(v.opponent.troopsLost,Math.max(0,initial-d.territories.get('target')!.garrison));
    assert.strictEqual(v.own.troopsLost,610);assert.strictEqual(v.opponent.victories,1);assert.strictEqual(v.opponent.territoriesGained,0);assert.strictEqual(v.own.failedAttacks,1);
  });
  test('Phase K review: schema 25 ongoing physical attack keeps its exact plan without historical outcomes',()=>{
    const o=new Orchestrator(world(),registry());assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:attack()})).success);const s=cloneGameState(o.getState());
    s.schemaVersion=25;delete (s as Partial<GameState>).conflictLedger;delete (s as Partial<GameState>).conflictEventReceipts;delete s.armies.get('a')!.attackIntent!.conflictFactId;
    const d=reload(s);assert.strictEqual(d.conflictLedger.size,0);assert.deepStrictEqual(d.operations,s.operations);assert.deepStrictEqual(d.operationClaims,s.operationClaims);assert.deepStrictEqual(d.armies,s.armies);
    const arrived=advance(d,d.armies.get('a')!.movement!.durationTicks),v=conflictSummary(arrived,'me','enemy')!;assert.strictEqual(v.own.battles,1);assert.strictEqual(v.own.territoriesGained,1);
  });
}
