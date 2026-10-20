import { invalidateStaleAttackIntents } from '../src/army/strategicAttack';
import { prepareProactiveDecision, startProactiveTimer, accrueProactiveClocks, nextProactiveBoundary } from '../src/engine/proactiveCognition';
import { InMemoryGameStateStore } from '../src/persistence/inMemoryGameStateStore';
import assert from 'assert';
import type { GameState } from '../src/types/GameState';
import { makeOperationTestWorld } from './aiOperationFixtures';
import { initializeRecruitment } from '../src/gameplay/recruitment/recruitment';
import { makeConcretePlan } from '../src/types/AIConcretePlan';
import { cloneGameState } from '../src/state/cloneGameState';
import { encodePersistable } from '../src/persistence/serialization';
import { hydratePersistedPayload } from '../src/persistence/hydrate';
import { Orchestrator, createDefaultRegistry } from '../src/orchestration';
import { progressProactiveThrough } from '../src/orchestration/handlers';
import { getCommandDefinition } from '../src/orchestration/commandIndex';
import { buildWarlordStates, toDecisionEngineSnapshot } from '../src/state/gameStateAdapters';
import { checkGameStateInvariants } from '../src/state/gameStateInvariants';
import { relationshipBetween, peacePairId, assertHostilityAllowed, hostileLifecyclesBetween } from '../src/gameplay/diplomacy/relationships';
import { livePeaceProposals, processPeaceBoundary, settlePeaceProposal, publicPeaceState } from '../src/gameplay/diplomacy/peace';
import { occupiedAttention, attentionCost } from '../src/engine/strategicAttention';
import { settleOperation } from '../src/engine/operations';
import { assessConcretePlanFeasibility } from '../src/engine/concretePlans';
import { assessRequiredPeaceResponse, counterpartyResponseEstimate, peaceEstimateView } from '../src/scoring/peaceAssessment';
import { PEACE_TIMING as T, PEACE_TUNING } from '../src/constants/peace';
import { emptyPeaceMetrics } from '../src/types/Peace';
import { timerRemaining } from '../src/engine/proactiveCognition';
import { observeSources, sourceConcretePlans } from '../src/engine/strategicPressure';
import { serializePublicGameState } from '../src/orchestration/publicView';
import { runStateTransaction } from '../src/orchestration/transaction';
import { primeSourceDecision } from './aiPressureFixtures';
import { STRATEGIC_EVALUATORS } from '../src/types/StrategicEvaluation';
import { applyUnopposedOccupationToGameState } from '../src/orchestration/applyBattle';
import { beginInvasionAgainstPlayer } from '../src/gameplay/invasion/create';
import { resolveInvasionBattle } from '../src/gameplay/invasion/resolve';
import { accrueWorldThroughReceipt } from '../src/world/worldAccrual';
import { progressArmyMovements } from '../src/army/movement';
import { FactualSupport } from '../src/scoring/factualSupport';
import { StrategicEvaluators } from '../src/scoring/strategicEvaluators';
import { EXECUTABLE_CONCRETE_ACTIONS, isExecutableCommitmentAction, isUnsupportedCommitmentAction } from '../src/engine/executableActions';
type Api=Pick<Parameters<typeof import('./aiStrategicEvaluation').registerAiStrategicEvaluationTests>[0],'test'|'makeSelf'|'makeTerritory'|'cmdReq'>;
export function registerAiPeaceTests({test,makeSelf,makeTerritory,cmdReq}:Api):void {
  const world=()=>{const s=makeOperationTestWorld(makeSelf,makeTerritory);initializeRecruitment(s);return s;};
  const online=(s:GameState,end=10000000)=>{s.gameplaySessionLeases=[{sessionId:'online',openedAtMs:0,expiresAtMs:end,endedAtMs:null,lastReceiptAtMs:0,lastRenewalRequestId:null} as GameState['gameplaySessionLeases'][number]];};
  const context=(s:GameState)=>({req:cmdReq('AI_DECIDE','ai',{warlordId:'me'}),def:getCommandDefinition('AI_DECIDE')!,registry:createDefaultRegistry(),runtime:{aiWarlordStates:buildWarlordStates(s)}});
  const advance=(s:GameState,ms:number)=>progressProactiveThrough(s,context(s),ms);
  const begin=(s:GameState,proposer='me',recipient='spectator')=>{const o=new Orchestrator(s),r=o.execute(cmdReq(proposer===s.playerFactionId?'OFFER_PEACE':'START_AI_OPERATION',proposer===s.playerFactionId?'player':'ai',{factionId:proposer,plan:makeConcretePlan({action:'OFFER_PEACE',factionId:proposer,counterpartyId:recipient})}));assert.ok(r.success,JSON.stringify(r.errors));return cloneGameState(o.getState());};
  const proposal=(s:GameState)=>[...s.peaceProposals.values()][0]!;
  const pending=(s=world(),proposer='me',recipient='spectator')=>{const d=begin(s,proposer,recipient);advance(d,T.initiationOfflineMs);assert.strictEqual(proposal(d).status,'pending');return d;};
  const respond=(s:GameState,response='ACCEPT_PEACE',actor=s.playerFactionId!)=>{const o=new Orchestrator(s),r=o.execute(cmdReq('RESPOND_PEACE',actor===s.playerFactionId?'player':'ai',{factionId:actor,proposalId:proposal(s).id,response}));assert.ok(r.success,JSON.stringify(r.errors));return cloneGameState(o.getState());};
  const attack=()=>makeConcretePlan({action:'ATTACK',factionId:'me',armyId:'a',originTerritoryId:'home',stagingTerritoryId:'stage',targetTerritoryId:'target',route:['home','stage','target']});
  const bilateralWorld=()=>{
    const s=world();s.playerFactionId=null;s.levelAnchorTerritoryIds=[];s.worldLevel=2;
    s.territories.get('safe')!.owner='enemy';s.territories.get('safe')!.neighboring=['target'];s.territories.get('target')!.neighboring.push('safe');
    s.factions.get('enemy')!.territories.push('safe');s.factions.get('spectator')!.territories=[];
    s.armies.set('enemy-army',{...s.armies.get('a')!,id:'enemy-army',owner:'enemy',location:'safe'});s.factions.get('enemy')!.armies=['enemy-army'];
    initializeRecruitment(s);return s;
  };
  const bilateralAttacks=[
    {factionId:'me',territoryId:'target',onlyArmyId:'a',stagingTerritoryId:'stage'},
    {factionId:'enemy',territoryId:'stage',onlyArmyId:'enemy-army',stagingTerritoryId:'target'},
  ];
  test('Phase H: known faction pairs default to symmetric WAR, independent of sentiment',()=>{const s=world();for(const mood of ['neutral','friendly','allied','hostile'] as const){s.factions.get('me')!.diplomacy.set('enemy',{target:'enemy',state:mood,opinion:100,treaties:[],yearsAtPeace:99,yearsAtWar:0});assert.strictEqual(relationshipBetween(s,'me','enemy'),'WAR');assert.strictEqual(relationshipBetween(s,'enemy','me'),'WAR');}});
  test('Phase H: pair identity is unordered, exact and collision safe',()=>{assert.strictEqual(peacePairId('a','b'),peacePairId('b','a'));assert.notStrictEqual(peacePairId('a:b','c'),peacePairId('a','b:c'));assert.notStrictEqual(peacePairId('a"','b'),peacePairId('a','"b'));});
  test('Phase H: offer initiates exact recipient and acquires proposer Attention only',()=>{const s=world(),d=begin(s),p=proposal(d);assert.strictEqual(p.recipient,'spectator');assert.strictEqual(p.status,'initiating');assert.ok(occupiedAttention(d,'me')>0);assert.strictEqual(occupiedAttention(d,'spectator'),0);assert.strictEqual(d.operationClaims.size,0);assert.strictEqual(relationshipBetween(d,'me','spectator'),'WAR');assert.strictEqual(publicPeaceState(d,'spectator').proposals.length,0);});
  test('Phase H: offer publication is exactly 30 seconds offline',()=>{const d=begin(world());advance(d,29999);assert.strictEqual(proposal(d).status,'initiating');advance(d,30000);assert.strictEqual(proposal(d).status,'pending');assert.strictEqual(proposal(d).pendingAtMs,30000);});
  test('Phase H: online offer publication is exactly one second',()=>{const s=world();online(s);const d=begin(s);advance(d,999);assert.strictEqual(proposal(d).status,'initiating');advance(d,1000);assert.strictEqual(proposal(d).status,'pending');});
  test('Phase H: offer timing promotes offline to online',()=>{const s=world();online(s);s.gameplaySessionLeases[0]!.openedAtMs=15000;s.gameplaySessionLeases[0]!.lastReceiptAtMs=15000;const d=begin(s);advance(d,15000);assert.strictEqual(proposal(d).status,'initiating');advance(d,15500);assert.strictEqual(proposal(d).status,'pending');});
  test('Phase H: offer timing cannot demote after disconnect',()=>{const s=world();online(s,500);const d=begin(s);advance(d,1000);assert.strictEqual(proposal(d).status,'pending');});
  test('Phase H: unordered pair rejects reverse/same duplicate atomically',()=>{const d=begin(world()),before=encodePersistable(d);const o=new Orchestrator(d);assert.ok(!o.execute(cmdReq('OFFER_PEACE','player',{plan:makeConcretePlan({action:'OFFER_PEACE',factionId:'spectator',counterpartyId:'me'})})).success);assert.deepStrictEqual(encodePersistable(o.getState()),before);});
  test('Phase H: different pairs coexist after primary initiation completes',()=>{const d=pending(),e=begin(d,'me','enemy');assert.strictEqual(livePeaceProposals(e).length,2);assert.ok(occupiedAttention(e,'me')>occupiedAttention(d,'me'));});
  test('Phase H: self/unknown/inactive counterparties rejected before operation creation',()=>{for(const target of ['me','missing','enemy']){const s=world();if(target==='enemy')s.factions.get('enemy')!.territories=[];const o=new Orchestrator(s),before=encodePersistable(s);assert.ok(!o.execute(cmdReq('START_AI_OPERATION','ai',{factionId:'me',plan:makeConcretePlan({action:'OFFER_PEACE',factionId:'me',counterpartyId:target})})).success);assert.deepStrictEqual(encodePersistable(o.getState()),before);}});
  test('Phase H: incoming offer does not consume recipient Attention',()=>{const s=world();s.strategicAttention.capacity=1;const d=pending(s);assert.strictEqual(occupiedAttention(d,'spectator'),0);assert.strictEqual(occupiedAttention(d,'me'),1);});
  test('Phase H: pending offer is not ceasefire',()=>{const d=pending();assert.doesNotThrow(()=>assertHostilityAllowed(d,'me','spectator','safe'));assert.doesNotThrow(()=>assertHostilityAllowed(d,'spectator','me','home'));});
  test('Phase H: player accept releases proposer charge before finalization',()=>{const d=respond(pending());assert.strictEqual(proposal(d).status,'accepted');assert.strictEqual(occupiedAttention(d,'me'),0);assert.strictEqual(relationshipBetween(d,'me','spectator'),'PENDING_HOSTILITIES_CLEARANCE');assert.strictEqual(d.operations.get(proposal(d).operationId)!.status,'completed');});
  test('Phase H: acceptance blocks new hostilities symmetrically',()=>{const d=respond(pending());assert.throws(()=>assertHostilityAllowed(d,'me','spectator','safe'));assert.throws(()=>assertHostilityAllowed(d,'spectator','me','home'));});
  test('Phase H: finalization waits ten seconds offline after clearance',()=>{const d=respond(pending());advance(d,39999);assert.strictEqual(relationshipBetween(d,'me','spectator'),'PENDING_HOSTILITIES_CLEARANCE');advance(d,40000);assert.strictEqual(relationshipBetween(d,'me','spectator'),'PEACE');});
  test('Phase H: finalization is two seconds online',()=>{const s=world();online(s);const d=begin(s);advance(d,1000);const e=respond(d);advance(e,2999);assert.strictEqual(relationshipBetween(e,'me','spectator'),'PENDING_HOSTILITIES_CLEARANCE');advance(e,3000);assert.strictEqual(relationshipBetween(e,'me','spectator'),'PEACE');});
  test('Phase H: finalization preserves no-demotion after presence loss',()=>{const s=world();online(s,1500);const d=begin(s);advance(d,1000);const e=respond(d);advance(e,3000);assert.strictEqual(relationshipBetween(e,'me','spectator'),'PEACE');});
  test('Phase H: decline releases charge and preserves WAR',()=>{const d=respond(pending(),'DECLINE_PEACE');assert.strictEqual(proposal(d).status,'declined');assert.strictEqual(relationshipBetween(d,'me','spectator'),'WAR');assert.strictEqual(occupiedAttention(d,'me'),0);});
  test('Phase H: player response window is 300/7200 seconds',()=>{const d=pending(),t=proposal(d).responseTimer!;assert.strictEqual(t.onlineDurationMs,300000);assert.strictEqual(t.offlineDurationMs,7200000);});
  test('Phase H: player expiry declines no offer and releases Attention once',()=>{const d=pending();advance(d,7230000);assert.strictEqual(proposal(d).status,'expired');assert.strictEqual(relationshipBetween(d,'me','spectator'),'WAR');assert.ok(d.operations.get(proposal(d).operationId)!.attention.releasedAtTick!==null);const before=encodePersistable(d);assert.strictEqual(settlePeaceProposal(d,proposal(d).id,'accepted'),false);processPeaceBoundary(d);assert.deepStrictEqual(encodePersistable(d),before);});
  test('Phase H: late player input cannot accept expired proposal',()=>{const d=pending();advance(d,7230000);const o=new Orchestrator(d);assert.ok(!o.execute(cmdReq('RESPOND_PEACE','player',{proposalId:proposal(d).id,response:'ACCEPT_PEACE'})).success);assert.strictEqual(proposal(o.getState()).status,'expired');});
  test('Phase H: player may withdraw own pending proposal',()=>{const s=world();const d=pending(s,'spectator','me'),o=new Orchestrator(d);assert.ok(o.execute(cmdReq('WITHDRAW_PEACE','player',{proposalId:proposal(d).id})).success);assert.strictEqual(proposal(o.getState()).status,'withdrawn');assert.strictEqual(occupiedAttention(o.getState(),'spectator'),0);});
  test('Phase H: AI cannot voluntarily withdraw',()=>{const d=pending(),o=new Orchestrator(d),before=encodePersistable(d);assert.ok(!o.execute(cmdReq('WITHDRAW_PEACE','ai',{factionId:'me',proposalId:proposal(d).id})).success);assert.deepStrictEqual(encodePersistable(o.getState()),before);});
  test('Phase H: non-recipient cannot accept',()=>{const d=pending(world(),'me','enemy'),o=new Orchestrator(d);assert.ok(!o.execute(cmdReq('RESPOND_PEACE','player',{proposalId:proposal(d).id,response:'ACCEPT_PEACE'})).success);});
  test('Phase H: repeat accepted response is idempotent',()=>{const d=respond(pending()),before=encodePersistable(d),e=respond(d);assert.deepStrictEqual(encodePersistable(e),before);});
  test('Phase H: required AI response timer is sampled once in locked range',()=>{const d=pending(world(),'me','enemy'),p=proposal(d),t=p.responseTimer!;assert.ok(t.onlineDurationMs>=3000&&t.onlineDurationMs<=8000);assert.strictEqual(t.offlineDurationMs,t.onlineDurationMs*10);const e=hydratePersistedPayload(encodePersistable(d));assert.deepStrictEqual(proposal(e).responseTimer,t);processPeaceBoundary(d);assert.deepStrictEqual(proposal(d).responseTimer,t);});
  test('Phase H: required AI response proceeds without Pressure, despite full Attention and spacing',()=>{const d=pending(world(),'me','enemy');d.strategicAttention.capacity=0;for(const op of d.operations.values())op.attention.grandfathered=true;const metrics=emptyPeaceMetrics();const due=30000+timerRemaining(d,proposal(d).responseTimer!);advance(d,due);assert.ok(['accepted','declined'].includes(proposal(d).status));assert.strictEqual(occupiedAttention(d,'me'),0);assert.strictEqual(d.aiPressure.get('fake'),undefined);assert.ok(checkGameStateInvariants(d).length===0);});
  test('Phase H: required decision uses recipient own current canonical state',()=>{const s=world();const a=assessRequiredPeaceResponse(s,'enemy','me');s.armies.set('enemy-force',{...s.armies.get('a')!,id:'enemy-force',owner:'enemy',location:'target',soldiers:100000});s.factions.get('enemy')!.armies=['enemy-force'];const b=assessRequiredPeaceResponse(s,'enemy','me');assert.notStrictEqual(a.factual,b.factual);assert.strictEqual(b.outcome,'DECLINE_PEACE');});
  test('Phase H: raw Memory cannot influence required response',()=>{const s=world(),a=assessRequiredPeaceResponse(s,'enemy','me');s.factions.get('enemy')!.memory=[{id:'revenge',type:'betrayal',turn:0,importance:100,emotionalWeight:100,description:'revenge'}] as never;assert.deepStrictEqual(assessRequiredPeaceResponse(s,'enemy','me'),a);});
  test('Phase H: counterparty estimate cannot inspect recipient private thought',()=>{const s=world(),a=counterpartyResponseEstimate(peaceEstimateView(s,'me','enemy'));s.factions.get('enemy')!.goals=[{type:'conquer_world',priority:100}] as never;s.factions.get('enemy')!.personality.riskTolerance=0;s.factions.get('enemy')!.memory=[{secret:1}] as never;assert.deepStrictEqual(counterpartyResponseEstimate(peaceEstimateView(s,'me','enemy')),a);assert.deepStrictEqual(a.acceptanceBounds,[0,1]);assert.strictEqual(STRATEGIC_EVALUATORS.length,7);});
  test('Phase H: hard proposer invalidation releases proposal but not physical work',()=>{const d=begin(world());d.factions.get('me')!.territories=[];d.factions.get('me')!.armies=[];processPeaceBoundary(d);assert.strictEqual(proposal(d).status,'invalidated');assert.strictEqual(occupiedAttention(d,'me'),0);assert.ok(!d.aiDecisionOpportunities.get('me')!.spacing);});
  test('Phase H: recipient loss during initiation never publishes',()=>{const d=begin(world());d.factions.get('spectator')!.territories=[];processPeaceBoundary(d);assert.strictEqual(proposal(d).status,'invalidated');assert.strictEqual(publicPeaceState(d,'me').proposals.length,0);assert.strictEqual(proposal(d).pendingAtMs,null);});
  test('Phase H: failed initiation leaves sequence, Attention and ledgers unchanged',()=>{const s=world();s.strategicAttention.capacity=0;const o=new Orchestrator(s),before=encodePersistable(s);assert.ok(!o.execute(cmdReq('START_AI_OPERATION','ai',{factionId:'me',plan:makeConcretePlan({action:'OFFER_PEACE',factionId:'me',counterpartyId:'enemy'})})).success);assert.deepStrictEqual(encodePersistable(o.getState()),before);});
  test('Phase H: thrown transaction cannot leak proposal mutation',()=>{const d=pending(),before=encodePersistable(d);assert.throws(()=>runStateTransaction(d,next=>{settlePeaceProposal(next,proposal(next).id,'accepted');throw new Error('abort');}));assert.deepStrictEqual(encodePersistable(d),before);});
  test('Phase H: clone deeply isolates response progress and relationship timer',()=>{const d=pending(),e=cloneGameState(d);proposal(e).responseTimer!.progress.wholeTicks=999;assert.notStrictEqual(proposal(d).responseTimer!.progress.wholeTicks,999);const a=respond(d),b=cloneGameState(a);[...b.peaceRelationships.values()][0]!.finalizationTimer!.progress.wholeTicks=100;assert.notStrictEqual([...a.peaceRelationships.values()][0]!.finalizationTimer!.progress.wholeTicks,100);});
  test('Phase H: reload during initiation retains identity and exact progress',()=>{const d=begin(world());advance(d,12345);const e=hydratePersistedPayload(encodePersistable(d));advance(d,30000);advance(e,30000);assert.deepStrictEqual(d.peaceProposals,e.peaceProposals);assert.deepStrictEqual(d.peaceProposalThreads,e.peaceProposalThreads);});
  test('Phase H: reload during required response does not reroll or duplicate response',()=>{const d=pending(world(),'me','enemy');advance(d,31000);const e=hydratePersistedPayload(encodePersistable(d));const end=30000+proposal(d).responseTimer!.offlineDurationMs;advance(d,end);advance(e,end);assert.deepStrictEqual(d.peaceProposals,e.peaceProposals);assert.deepStrictEqual(d.eventHistory,e.eventHistory);assert.deepStrictEqual(d.peaceRelationships,e.peaceRelationships);});
  test('Phase H: reload during finalization preserves remaining duration',()=>{const d=respond(pending());advance(d,33000);const e=hydratePersistedPayload(encodePersistable(d));advance(d,40000);advance(e,40000);assert.deepStrictEqual(d.peaceRelationships,e.peaceRelationships);assert.deepStrictEqual(d.eventHistory,e.eventHistory);});
  test('Phase H: central settlement cannot complete pending proposal early',()=>{const d=pending(),id=proposal(d).operationId,before=encodePersistable(d);assert.strictEqual(settleOperation(d,id,'completed','fake accept'),false);assert.deepStrictEqual(encodePersistable(d),before);});
  test('Phase H: central invalidation and repeated terminal handling do not duplicate history',()=>{const d=pending(),id=proposal(d).operationId;assert.ok(settleOperation(d,id,'failed','invalidated'));const before=encodePersistable(d);assert.strictEqual(settleOperation(d,id,'failed','repeat'),false);assert.deepStrictEqual(encodePersistable(d),before);assert.strictEqual(proposal(d).status,'invalidated');});
  test('Phase H: accepted long attack retains actual movement and claim',()=>{let d=world();d.playerFactionId='enemy';d.territoryRecruitment.delete('target');d.levelAnchorTerritoryIds=['target'];d.worldLevel=2;d.levelAnchorTerritoryIds=['safe'];const o=new Orchestrator(d);assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:attack()})).success);d=begin(cloneGameState(o.getState()),'me','enemy');advance(d,30000);const before=encodePersistable(d.armies.get('a')!.movement);d=respond(d);assert.deepStrictEqual(encodePersistable(d.armies.get('a')!.movement),before);assert.ok(hostileLifecyclesBetween(d,'me','enemy').length);assert.strictEqual([...d.peaceRelationships.values()][0]!.finalizationTimer,null);assert.ok(d.operationClaims.size>0);assert.strictEqual(occupiedAttention(d,'me'),3);});
  test('Phase H: compatibility rejects fresh bilateral attack after acceptance',()=>{const s=world();s.playerFactionId='enemy';s.territoryRecruitment.delete('target');const d=respond(pending(s,'me','enemy'));const f=assessConcretePlanFeasibility(attack(),toDecisionEngineSnapshot(d));assert.ok(f.rejections.some(r=>r.kind==='COMPATIBILITY'));assert.ok(!f.rejections.some(r=>r.kind==='CLAIM'));});
  test('Phase H: exact existing intent may continue after acceptance but fresh force may not',()=>{let d=world();d.playerFactionId='enemy';d.territoryRecruitment.delete('target');d.worldLevel=2;const o=new Orchestrator(d);assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:attack()})).success);d=respond(pending(cloneGameState(o.getState()),'me','enemy'));assert.doesNotThrow(()=>assertHostilityAllowed(d,'me','enemy','target',['a']));assert.throws(()=>assertHostilityAllowed(d,'me','enemy','target',['b']));});
  test('Phase H: captured hostile counterparty survives target ownership change',()=>{const s=world(),o=new Orchestrator(s);assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:attack()})).success);const d=cloneGameState(o.getState());d.territories.get('target')!.owner='spectator';assert.ok(hostileLifecyclesBetween(d,'me','enemy').length);assert.ok(!hostileLifecyclesBetween(d,'me','spectator').length);});
  test('Phase H: Peace ends to WAR at provisional real-world expiry',()=>{const d=respond(pending());advance(d,40000);const r=[...d.peaceRelationships.values()][0]!;assert.strictEqual(r.expiresAtMs,40000+PEACE_TUNING.treatyDurationMs);d.aiClock.nowMs=r.expiresAtMs!;processPeaceBoundary(d);assert.strictEqual(relationshipBetween(d,'me','spectator'),'WAR');});
  test('Phase H: legacy DECLARE_WAR command cannot terminate active Peace',()=>{const d=respond(pending()),o=new Orchestrator(d),before=encodePersistable(d);assert.ok(!o.execute(cmdReq('DECLARE_WAR','ai',{factionId:'me',targetFactionId:'spectator'})).success);assert.deepStrictEqual(encodePersistable(o.getState()),before);});
  test('Phase H: schema-22 sentiment does not migrate into Peace',()=>{const s=world();s.schemaVersion=22;s.factions.get('me')!.diplomacy.set('enemy',{target:'enemy',state:'allied',opinion:100,treaties:[],yearsAtPeace:100,yearsAtWar:0});const d=hydratePersistedPayload(encodePersistable(s));assert.strictEqual(d.schemaVersion,28);assert.strictEqual(d.peaceRelationships.size,0);assert.strictEqual(d.peaceProposals.size,0);});
  test('Phase H: explicit unexpired treaty preserves authored turn expiry',()=>{const s=world();s.schemaVersion=22;s.factions.get('me')!.diplomacy.set('enemy',{target:'enemy',state:'neutral',opinion:0,treaties:[{type:'non_aggression',with:'enemy',signedTurn:0,expiresTurn:5,terms:{}}],yearsAtPeace:0,yearsAtWar:0});const d=hydratePersistedPayload(encodePersistable(s));assert.strictEqual(relationshipBetween(d,'me','enemy'),'PEACE');d.turn=5;processPeaceBoundary(d);assert.strictEqual(relationshipBetween(d,'me','enemy'),'WAR');});
  test('Phase H: expired and unsigned/future historical treaties do not fabricate Peace',()=>{for(const t of [{signedTurn:0,expiresTurn:0},{signedTurn:2,expiresTurn:5}]){const s=world();s.schemaVersion=22;s.factions.get('me')!.diplomacy.set('enemy',{target:'enemy',state:'friendly',opinion:0,treaties:[{type:'non_aggression',with:'enemy',terms:{},...t}],yearsAtPeace:0,yearsAtWar:0});assert.strictEqual(hydratePersistedPayload(encodePersistable(s)).peaceRelationships.size,0);}});
  test('Phase H: migrating treaty with staged attack preserves travel and enters clearance',()=>{const s=world(),o=new Orchestrator(s);assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:attack()})).success);const d=cloneGameState(o.getState());d.schemaVersion=22;d.factions.get('me')!.diplomacy.set('enemy',{target:'enemy',state:'neutral',opinion:0,treaties:[{type:'non_aggression',with:'enemy',signedTurn:0,expiresTurn:8,terms:{}}],yearsAtPeace:0,yearsAtWar:0});const e=hydratePersistedPayload(encodePersistable(d));assert.strictEqual(relationshipBetween(e,'me','enemy'),'PENDING_HOSTILITIES_CLEARANCE');assert.deepStrictEqual(e.armies.get('a')!.movement,d.armies.get('a')!.movement);assert.deepStrictEqual(e.operationClaims,d.operationClaims);assert.strictEqual(e.peaceProposals.size,0);});
  test('Phase H: malformed pair/thread/timer ownership fails invariants',()=>{const d=pending();d.peaceProposalThreads.set('wrong',proposal(d).id);assert.ok(checkGameStateInvariants(d).some(v=>v.code==='peace.invalid_state'));d.peaceProposalThreads.delete('wrong');proposal(d).recipient='enemy';assert.ok(checkGameStateInvariants(d).some(v=>v.code==='peace.invalid_state'));});
  test('Phase H: public proposal data omits private timers, plans, scores and cognition',()=>{const d=pending(),view=JSON.stringify(publicPeaceState(d,'spectator'));for(const key of ['responseTimer','operationId','goals','memory','rng','pressure','score','progress'])assert.ok(!view.includes(key));assert.strictEqual(publicPeaceState(d,'enemy').proposals.length,0);assert.strictEqual((serializePublicGameState(d, 'spectator') as {diplomacy:ReturnType<typeof publicPeaceState>}).diplomacy.proposals[0]!.id,proposal(d).id);});
  test('Phase H: blocker rearm sees executable Peace only in its exact war source',()=>{const s=world();s.territories.get('target')!.garrison=20000;s.factions.get('me')!.stability=20;s.armies.set('enemy-force',{...s.armies.get('a')!,id:'enemy-force',owner:'enemy',location:'target',soldiers:20000});s.factions.get('enemy')!.armies=['enemy-force'];observeSources(s,'me');const c=[...s.aiPressure.values()].find(c=>c.kind==='WAR_BURDEN'&&c.counterpartyId==='enemy')!;assert.ok(c);const plans=sourceConcretePlans(s,c);assert.ok(plans.some(p=>p.action==='OFFER_PEACE'));assert.ok(plans.every(p=>p.action==='OFFER_PEACE'||p.action==='WAIT'));const d=begin(s,'me','enemy');observeSources(d,'me');const current=d.aiPressure.get(c.id);assert.ok(!current||sourceConcretePlans(d,current).every(p=>p.action==='WAIT'));});
  test('Phase H: source-bound cognition selects exact Peace and relief occurs only on publication',()=>{const s=world();s.armies.get('a')!.soldiers=1;s.armies.get('b')!.soldiers=1;s.territories.get('target')!.garrison=50000;s.factions.get('me')!.stability=20;s.armies.set('enemy-force',{...s.armies.get('a')!,id:'enemy-force',owner:'enemy',location:'target',soldiers:50000});s.factions.get('enemy')!.armies=['enemy-force'];s.factions.get('me')!.resources={gold:0,food:0,wood:0,stone:0,iron:0};observeSources(s,'me');const c=[...s.aiPressure.values()].find(c=>c.kind==='WAR_BURDEN')!;assert.ok(c);for(const other of s.aiPressure.values())other.pressure=0;primeSourceDecision(s,'me');const o=new Orchestrator(s),r=o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'}));assert.ok(r.success,JSON.stringify(r.errors));const selected=[...o.getState().operations.values()][0]!;assert.strictEqual(selected.action,'OFFER_PEACE');assert.ok(o.execute(cmdReq('RESOLVE_COMMITMENT','ai',{factionId:'me',operationId:selected.id})).success);const d=cloneGameState(o.getState()),before=d.aiPressure.get(selected.sourceContextId!)!.pressure;assert.ok(!d.aiDecisionOpportunities.get('me')!.spacing);advance(d,d.aiClock.nowMs+30000);assert.ok(d.aiDecisionOpportunities.get('me')!.spacing);assert.ok(d.aiPressure.get(selected.sourceContextId!)!.pressure<before);});
  test('Phase H: required response preempts unfinished proactive thought, not committed initiation',()=>{
    const d=pending(world(),'me','enemy');
    const o=d.aiDecisionOpportunities.get('enemy')!;
    o.primary={phase:'deliberating',contextId:'stale-source',contextRevision:0,opportunityId:'temporary-test',timer:proposal(d).responseTimer};
    const due=d.aiClock.nowMs+timerRemaining(d,proposal(d).responseTimer!);
    advance(d,due);assert.strictEqual(o.primary,null);assert.ok(['accepted','declined'].includes(proposal(d).status));
  });
  test('Phase H: required response promotion and no demotion retain sampled identity',()=>{
    const s=world();online(s,35000);s.gameplaySessionLeases[0]!.openedAtMs=30000;s.gameplaySessionLeases[0]!.lastReceiptAtMs=30000;
    const d=pending(s,'me','enemy'),duration=proposal(d).responseTimer!.onlineDurationMs;
    advance(d,30000+duration);assert.ok(['accepted','declined'].includes(proposal(d).status));
  });
  test('Phase H: unrelated faction remains WAR after bilateral acceptance',()=>{
    const d=respond(pending());assert.strictEqual(relationshipBetween(d,'me','enemy'),'WAR');
    assert.doesNotThrow(()=>assertHostilityAllowed(d,'me','enemy','target'));
  });
  test('Phase H: live proposal lookup never scans terminal proposal history',()=>{
    const d=pending();const original=d.peaceProposals.values;
    d.peaceProposals.values=()=>{throw new Error('historical scan');};
    assert.strictEqual(livePeaceProposals(d).length,1);processPeaceBoundary(d);
    d.peaceProposals.values=original;
  });
  test('Phase H: acceptance during attack proceeds through actual invasion and terminal clearance',()=>{
    const s=world();s.playerFactionId='enemy';s.territoryRecruitment.delete('target');s.worldLevel=2;
    s.territories.get('safe')!.owner='enemy';s.factions.get('enemy')!.territories.push('safe');s.factions.get('spectator')!.territories=[];
    const o=new Orchestrator(s);const started=o.execute(cmdReq('START_AI_OPERATION','ai',{plan:attack()}));assert.ok(started.success,JSON.stringify(started.errors));
    const d=respond(pending(cloneGameState(o.getState()),'me','enemy'));
    assert.strictEqual([...d.peaceRelationships.values()][0]!.finalizationTimer,null);
    const a=new Orchestrator(d);const r=a.execute(cmdReq('ADVANCE_WORLD','ai',{elapsedTicks:60}));assert.ok(r.success,JSON.stringify(r.errors));
    const final=a.getState();assert.strictEqual(final.operations.get(started.payload.operationId as string)!.phase,'terminal');
    assert.strictEqual(hostileLifecyclesBetween(final,'me','enemy').length,0);
    assert.strictEqual(relationshipBetween(final,'me','enemy'),'PEACE');
  });
  test('Phase H: duplicate same-pair CAS attempts persist one exact thread',()=>{
    const s=world(),store=new InMemoryGameStateStore();assert.ok(store.save('peace-cas',s,0).ok);const a=begin(s),b=begin(cloneGameState(s));assert.deepStrictEqual(a.peaceProposals,b.peaceProposals);assert.ok(store.save('peace-cas',a,1).ok);assert.ok(!store.save('peace-cas',b,1).ok);const loaded=store.load('peace-cas');assert.ok(loaded.ok);if(loaded.ok)assert.strictEqual(loaded.state.peaceProposalThreads.size,1);
    const o=new Orchestrator(a),before=encodePersistable(a);assert.ok(!o.execute(cmdReq('START_AI_OPERATION','ai',{plan:makeConcretePlan({action:'OFFER_PEACE',factionId:'me',counterpartyId:'spectator'})})).success);
    assert.deepStrictEqual(encodePersistable(o.getState()),before);
  });
  test('Phase H: legacy treaty expiry during clearance restores WAR without clearing movement',()=>{
    const s=world(),o=new Orchestrator(s);assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:attack()})).success);
    const d=cloneGameState(o.getState());d.schemaVersion=22;d.factions.get('me')!.diplomacy.set('enemy',{target:'enemy',state:'neutral',opinion:0,treaties:[{type:'non_aggression',with:'enemy',signedTurn:0,expiresTurn:1,terms:{}}],yearsAtPeace:0,yearsAtWar:0});
    const e=hydratePersistedPayload(encodePersistable(d)),before=encodePersistable(e.armies.get('a')!.movement);e.turn=1;processPeaceBoundary(e);
    assert.strictEqual(relationshipBetween(e,'me','enemy'),'WAR');assert.deepStrictEqual(encodePersistable(e.armies.get('a')!.movement),before);
  });
  test('Phase H: missing schema-23 authority fails hydration rather than recreating default stores',()=>{
    const s=world();delete (s as unknown as {peaceRelationships?:unknown}).peaceRelationships;
    assert.throws(()=>hydratePersistedPayload(encodePersistable(s)));
  });
  test('Phase H: terminal response replay cannot duplicate goal or Memory feedback',()=>{
    const d=respond(pending()),fid=proposal(d).proposer,before=encodePersistable({memory:d.factions.get(fid)!.memory,goals:d.factions.get(fid)!.goals,history:d.eventHistory});
    assert.strictEqual(settlePeaceProposal(d,proposal(d).id,'accepted'),false);assert.strictEqual(settleOperation(d,proposal(d).operationId,'completed','repeat'),false);
    assert.deepStrictEqual(encodePersistable({memory:d.factions.get(fid)!.memory,goals:d.factions.get(fid)!.goals,history:d.eventHistory}),before);
  });

  test('Phase H: physical Peace operation cannot lose its proposal ledger link',()=>{
    const d=begin(world());d.peaceProposals.clear();d.peaceProposalThreads.clear();assert.ok(checkGameStateInvariants(d).some(v=>v.code==='peace.invalid_state'));
  });
  test('Phase H: undefended invasion uses existing occupation without a zero-defender battle',()=>{
    const s=world();s.playerFactionId='enemy';s.territoryRecruitment.delete('target');s.worldLevel=2;s.territories.get('target')!.garrison=0;
    const o=new Orchestrator(s);const a=o.execute(cmdReq('START_AI_OPERATION','ai',{plan:attack()}));assert.ok(a.success,JSON.stringify(a.errors));
    const r=o.execute(cmdReq('ADVANCE_WORLD','ai',{elapsedTicks:60}));assert.ok(r.success,JSON.stringify(r.errors));
    assert.strictEqual(o.getState().territories.get('target')!.owner,'me');assert.strictEqual(o.getState().operations.get(a.payload.operationId as string)!.status,'completed');
  });

  test('Phase H: recipient own required response distinguishes Goals from factual WAR findings',()=>{
    const s=world(),a=assessRequiredPeaceResponse(s,'enemy','me');
    s.factions.get('enemy')!.goals=[{id:'peace-goal',type:'destroy_rival',priority:100,targetFaction:'me',targetTerritory:null,targetRegion:null,targetResource:null,progress:0,targetProgress:100,deadlineTurn:null,createdTurn:0}] as never;
    const b=assessRequiredPeaceResponse(s,'enemy','me');assert.deepStrictEqual(a.war,b.war);assert.ok(b.modifier<a.modifier);
  });
  test('Phase H: reversing pair/thread insertion order preserves required response results and history',()=>{
    let a=world();a=pending(a,'me','enemy');a=begin(a,'me','spectator');advance(a,60000);
    const b=cloneGameState(a);b.peaceProposals=new Map([...b.peaceProposals].reverse());b.peaceProposalThreads=new Map([...b.peaceProposalThreads].reverse());
    advance(a,150000);advance(b,150000);assert.deepStrictEqual(a.peaceProposals,b.peaceProposals);assert.deepStrictEqual(a.eventHistory,b.eventHistory);
  });

  test('Phase H: required response removes elapsed spacing without one-millisecond polling',()=>{
    const d=pending(world(),'me','enemy'),o=d.aiDecisionOpportunities.get('enemy')!;
    o.spacing=startProactiveTimer(d,'enemy','spacing-test',1000,1000,1);accrueProactiveClocks(d,31000,'ONLINE');
    assert.strictEqual(prepareProactiveDecision(d,'enemy'),null);assert.strictEqual(o.spacing,null);
    assert.ok(nextProactiveBoundary(d,50000,'ONLINE')>d.aiClock.nowMs+1);
  });
  test('Phase H: third-party target transfer invalidates only objective and preserves travel',()=>{
    const s=world(),o=new Orchestrator(s);const r=o.execute(cmdReq('START_AI_OPERATION','ai',{plan:attack()}));assert.ok(r.success);
    const d=cloneGameState(o.getState()),movement=encodePersistable(d.armies.get('a')!.movement);d.territories.get('target')!.owner='spectator';
    const invalid=invalidateStaleAttackIntents(d);assert.strictEqual(invalid.length,1);assert.deepStrictEqual(encodePersistable(d.armies.get('a')!.movement),movement);
    assert.strictEqual(d.operations.get(r.payload.operationId as string)!.phase,'recovery');assert.ok(hostileLifecyclesBetween(d,'me','enemy').length);
  });

  test('Phase H review: direct attack recovery travel still blocks Peace clearance',()=>{
    const s=world();s.playerFactionId='me';s.worldLevel=2;s.levelAnchorTerritoryIds=['home'];
    s.territories.get('safe')!.owner='enemy';s.factions.get('enemy')!.territories.push('safe');s.factions.get('spectator')!.territories=[];
    initializeRecruitment(s);
    const o=new Orchestrator(s),r=o.execute(cmdReq('ATTACK','player',{territoryId:'target',onlyArmyId:'a',stagingTerritoryId:'stage'}));
    assert.ok(r.success,JSON.stringify(r.errors));assert.strictEqual(o.getState().operations.size,0);
    const d=pending(cloneGameState(o.getState()),'me','enemy');advance(d,d.aiClock.nowMs+timerRemaining(d,proposal(d).responseTimer!));
    assert.strictEqual(proposal(d).status,'accepted');
    const travel=encodePersistable(d.armies.get('a')!.movement);
    d.territories.get('target')!.garrison=0;
    applyUnopposedOccupationToGameState(d,d.territories.get('target')!,'spectator',[],d.turn);
    assert.strictEqual(invalidateStaleAttackIntents(d).length,1);processPeaceBoundary(d);
    assert.deepStrictEqual(encodePersistable(d.armies.get('a')!.movement),travel);
    assert.ok(hostileLifecyclesBetween(d,'me','enemy').length,'unfinished hostile physical travel must remain tracked without an AI operation');
    assert.strictEqual([...d.peaceRelationships.values()][0]!.finalizationTimer,null);
    const loaded=hydratePersistedPayload(encodePersistable(d));assert.ok(hostileLifecyclesBetween(loaded,'me','enemy').length);
  });
  test('Phase H review: negative historical treaty dates cannot fabricate Peace',()=>{
    const s=world();s.schemaVersion=22;s.factions.get('me')!.diplomacy.set('enemy',{target:'enemy',state:'friendly',opinion:100,
      treaties:[{type:'non_aggression',with:'enemy',signedTurn:-1,expiresTurn:5,terms:{}}],yearsAtPeace:0,yearsAtWar:0});
    const d=hydratePersistedPayload(encodePersistable(s));assert.strictEqual(relationshipBetween(d,'me','enemy'),'WAR');
    assert.strictEqual(d.peaceRelationships.size,0);
  });
  test('Phase H review: authoritative direct attack remains legal both ways while pending',()=>{
    const d=pending(bilateralWorld(),'me','enemy');
    for(const parameters of bilateralAttacks){const o=new Orchestrator(cloneGameState(d)),r=o.execute(cmdReq('ATTACK','ai',parameters));
      assert.ok(r.success,JSON.stringify(r.errors));assert.strictEqual(proposal(o.getState()).status,'pending');
      assert.strictEqual(o.getState().armies.get(parameters.onlyArmyId)!.movement!.status,'moving');
      assert.strictEqual(relationshipBetween(o.getState(),'me','enemy'),'WAR');}
  });
  test('Phase H review: stale direct attacks fail symmetrically in clearance and Peace',()=>{
    const d=respond(pending(bilateralWorld(),'me','enemy'),'ACCEPT_PEACE','enemy');
    for(const phase of ['PENDING_HOSTILITIES_CLEARANCE','PEACE']){
      assert.strictEqual(relationshipBetween(d,'me','enemy'),phase);
      for(const parameters of bilateralAttacks){const o=new Orchestrator(cloneGameState(d)),before=encodePersistable(o.getState());
        const r=o.execute(cmdReq('ATTACK','ai',parameters));assert.strictEqual(r.success,false);assert.deepStrictEqual(encodePersistable(o.getState()),before);}
      if(phase==='PENDING_HOSTILITIES_CLEARANCE')advance(d,40000);
    }
    const expiry=[...d.peaceRelationships.values()][0]!.expiresAtMs!;d.aiClock.nowMs=expiry;processPeaceBoundary(d);
    assert.strictEqual(relationshipBetween(d,'me','enemy'),'WAR');
    assert.ok(![...d.armies.values()].some(a=>a.movement||a.attackIntent));
    assert.strictEqual(d.operations.size,1,'expiry must not initiate attacks or proposals');
    const o=new Orchestrator(d);assert.ok(o.execute(cmdReq('ATTACK','ai',bilateralAttacks[0]!)).success);
  });
  test('Phase H review: attack and acceptance CAS order survives stale-writer retries',()=>{
    for(const attackFirst of [true,false]){
      const base=pending(bilateralWorld(),'me','enemy'),store=new InMemoryGameStateStore();assert.ok(store.save('h-order',base,0).ok);
      const attackWriter=new Orchestrator(cloneGameState(base)),r=attackWriter.execute(cmdReq('START_AI_OPERATION','ai',{plan:attack()}));assert.ok(r.success);
      const accepted=respond(cloneGameState(base),'ACCEPT_PEACE','enemy');
      const first=attackFirst?attackWriter.getState():accepted,stale=attackFirst?accepted:attackWriter.getState();
      assert.ok(store.save('h-order',first,1).ok);assert.ok(!store.save('h-order',stale,1).ok);
      const loaded=store.load('h-order');assert.ok(loaded.ok);if(!loaded.ok)throw new Error('CAS fixture load failed');
      if(attackFirst){const retry=respond(loaded.state,'ACCEPT_PEACE','enemy');assert.ok(store.save('h-order',retry,2).ok);
        assert.strictEqual(retry.operations.get(r.payload.operationId as string)!.phase,'physical');assert.ok(retry.armies.get('a')!.movement);
        assert.ok(retry.operationClaims.has('force:a'));assert.strictEqual([...retry.peaceRelationships.values()][0]!.finalizationTimer,null);
      }else{const retry=new Orchestrator(loaded.state),before=encodePersistable(loaded.state);
        assert.strictEqual(retry.execute(cmdReq('START_AI_OPERATION','ai',{plan:attack()})).success,false);
        assert.deepStrictEqual(encodePersistable(retry.getState()),before);}
    }
  });
  test('Phase H review: finishing one of several attacks does not start finalization',()=>{
    const s=bilateralWorld();s.armies.delete('enemy-army');s.factions.get('enemy')!.armies=[];
    s.territories.get('other')!.terrain='mountain';s.territories.get('other')!.neighboring.push('safe');s.territories.get('safe')!.neighboring.push('other');
    s.strategicAttention.capacity=3*attentionCost(attack())+attentionCost(makeConcretePlan({action:'OFFER_PEACE',factionId:'me',counterpartyId:'enemy'}));
    const second=makeConcretePlan({action:'ATTACK',factionId:'me',armyId:'b',originTerritoryId:'home',stagingTerritoryId:'other',targetTerritoryId:'safe',route:['home','other','safe']});
    const o=new Orchestrator(s),a=o.execute(cmdReq('START_AI_OPERATION','ai',{plan:attack()})),b=o.execute(cmdReq('START_AI_OPERATION','ai',{plan:second}));assert.ok(a.success&&b.success,JSON.stringify([a.errors,b.errors]));
    const d=respond(pending(cloneGameState(o.getState()),'me','enemy'),'ACCEPT_PEACE','enemy');
    const firstArrival=d.armies.get('a')!.movement!.durationTicks;assert.ok(firstArrival<d.armies.get('b')!.movement!.durationTicks);
    const next=new Orchestrator(d),r=next.execute(cmdReq('ADVANCE_WORLD','ai',{elapsedTicks:firstArrival}));assert.ok(r.success,JSON.stringify(r.errors));
    const after=next.getState();assert.strictEqual(after.operations.get(a.payload.operationId as string)!.phase,'terminal');
    assert.strictEqual(after.operations.get(b.payload.operationId as string)!.phase,'physical');assert.ok(after.armies.get('b')!.movement);
    assert.ok(hostileLifecyclesBetween(after,'me','enemy').length);assert.strictEqual([...after.peaceRelationships.values()][0]!.finalizationTimer,null);
    assert.strictEqual(occupiedAttention(after,'me'),attentionCost(attack()));
  });
  test('Phase H review: undefended occupation never bypasses real field or mobilized defense',()=>{
    for(const mobilized of [false,true]){
      const s=world();s.playerFactionId='enemy';s.worldLevel=2;s.levelAnchorTerritoryIds=['safe'];s.territoryRecruitment.delete('target');
      s.territories.get('target')!.garrison=0;s.armies.get('a')!.location='stage';
      if(!mobilized){s.armies.set('defender',{...s.armies.get('b')!,id:'defender',owner:'enemy',location:'target',soldiers:200});s.factions.get('enemy')!.armies=['defender'];}
      const created=beginInvasionAgainstPlayer(s,{attackerId:'me',territoryId:'target',armies:[s.armies.get('a')!]});
      const invasionId=created.payload.invasionId as string;
      if(mobilized)s.activeInvasions.get(invasionId)!.defenseMobilization={applicationId:'defense',sessionId:'session',workoutId:'workout',playerId:'player',defensePower:200,attachedAtTick:0,workoutStartedAtTick:0,sourcePhysicalOutput:200};
      const battle=createDefaultRegistry().requireBattle(),original=battle.resolve.bind(battle);let calls=0;
      battle.resolve=input=>{calls++;return original(input);};
      const r=resolveInvasionBattle(s,battle,invasionId,mobilized?'defense_battle':'undefended');
      assert.strictEqual(calls,1);assert.notStrictEqual(r.payload.resolvedWithoutBattle,true);assert.strictEqual(s.activeInvasions.size,0);
      assert.throws(()=>resolveInvasionBattle(s,battle,invasionId));assert.strictEqual(calls,1);
    }
  });
  test('Phase H review: malformed treaty and default-WAR migration remain idempotent',()=>{
    const s=world();s.schemaVersion=22;s.factions.get('me')!.diplomacy.set('enemy',{target:'enemy',state:'allied',opinion:100,
      treaties:[{type:'non_aggression',with:'enemy',signedTurn:'invalid',expiresTurn:null,terms:{}},{type:'non_aggression',with:'enemy',signedTurn:0,expiresTurn:0,terms:{}}] as never,yearsAtPeace:0,yearsAtWar:0});
    const first=hydratePersistedPayload(encodePersistable(s)),second=hydratePersistedPayload(encodePersistable(first));
    assert.strictEqual(relationshipBetween(first,'me','enemy'),'WAR');assert.deepStrictEqual(encodePersistable(first),encodePersistable(second));
    s.factions.get('me')!.diplomacy.get('enemy')!.treaties=[null] as never;
    assert.throws(()=>hydratePersistedPayload(encodePersistable(s)),'structurally corrupt historical records must fail closed');
  });
  test('Phase H review: multiple incoming responses use deadline order despite reversed storage',()=>{
    const s=world();s.playerFactionId=null;initializeRecruitment(s);
    let a=begin(begin(s,'me','enemy'),'spectator','enemy');advance(a,30000);assert.strictEqual(livePeaceProposals(a).length,2);
    const expected=livePeaceProposals(a).sort((x,y)=>timerRemaining(a,x.responseTimer!)-timerRemaining(a,y.responseTimer!)||x.pendingAtMs!-y.pendingAtMs!||(x.id<y.id?-1:1)).map(p=>p.id);
    const b=hydratePersistedPayload(encodePersistable(a));b.peaceProposals=new Map([...b.peaceProposals].reverse());b.peaceProposalThreads=new Map([...b.peaceProposalThreads].reverse());
    advance(a,150000);advance(b,150000);
    const responses=(d:GameState)=>d.eventHistory.filter(e=>e.typeId==='PEACE_LIFECYCLE'&&['accepted','declined'].includes(e.detail?.transition as string)).map(e=>e.detail?.proposalId);
    assert.deepStrictEqual(responses(a),expected);assert.deepStrictEqual(responses(b),expected);
    assert.deepStrictEqual(encodePersistable(a.peaceProposals),encodePersistable(new Map([...b.peaceProposals].reverse())));
    assert.strictEqual(a.peaceProposalThreads.size,0);assert.strictEqual(occupiedAttention(a,'me'),0);assert.strictEqual(occupiedAttention(a,'spectator'),0);
  });
  test('Phase H review: required responses ignore unexpired proactive spacing and tiny-wake churn',()=>{
    const d=pending(world(),'me','enemy'),o=d.aiDecisionOpportunities.get('enemy')!;
    o.spacing=startProactiveTimer(d,'enemy','required-spacing',450000,450000,100);
    const due=d.aiClock.nowMs+timerRemaining(d,proposal(d).responseTimer!);
    assert.strictEqual(nextProactiveBoundary(d,900000,'OFFLINE'),due);
    advance(d,due);assert.ok(['accepted','declined'].includes(proposal(d).status));
    assert.ok(o.spacing&&timerRemaining(d,o.spacing)>0);assert.ok(nextProactiveBoundary(d,900000,'OFFLINE')>d.aiClock.nowMs+1);
  });
  test('Phase H review: arrival precedes a simultaneous player response deadline at server receipt',()=>{
    const s=world();s.playerFactionId='me';s.worldLevel=2;s.levelAnchorTerritoryIds=['home'];s.territories.get('stage')!.terrain='mountain';
    s.territories.get('safe')!.owner='enemy';s.factions.get('enemy')!.territories.push('safe');s.factions.get('spectator')!.territories=[];
    s.territories.get('target')!.garrison=0;for(const f of s.factions.values())f.resources={gold:0,food:0,wood:0,stone:0,iron:0};
    initializeRecruitment(s);online(s);accrueWorldThroughReceipt(s,0);
    const o=new Orchestrator(s),offer=o.executeAtAuthoritativeReceipt(cmdReq('START_AI_OPERATION','ai',{plan:makeConcretePlan({action:'OFFER_PEACE',factionId:'enemy',counterpartyId:'me'})}),59000);
    assert.ok(offer.success,JSON.stringify(offer.errors));
    assert.ok(o.executeAtAuthoritativeReceipt(cmdReq('SET_PLAYER_PAUSE','player',{paused:false}),60000).success);
    assert.strictEqual(proposal(o.getState()).pendingAtMs,60000);
    assert.ok(o.executeAtAuthoritativeReceipt(cmdReq('ATTACK','player',{territoryId:'target',onlyArmyId:'a',stagingTerritoryId:'stage'}),120000).success);
    const peace=require('../src/gameplay/diplomacy/peace') as typeof import('../src/gameplay/diplomacy/peace');
    const original=peace.processPeaceBoundary;let sawDeadline=false;
    peace.processPeaceBoundary=(draft,metrics)=>{
      if(draft.aiClock.nowMs===360000&&proposal(draft).status==='pending'){
        sawDeadline=true;assert.strictEqual(draft.territories.get('target')!.owner,'me','physical arrival/capture must precede the deadline gate');
      }original(draft,metrics);
    };
    try{const req=cmdReq('SET_PLAYER_PAUSE','player',{paused:false});req.timestamp=999999999;
      const r=o.executeAtAuthoritativeReceipt(req,360000);assert.ok(r.success,JSON.stringify(r.errors));
    }finally{peace.processPeaceBoundary=original;}
    assert.ok(sawDeadline);assert.strictEqual(proposal(o.getState()).status,'expired');assert.strictEqual(o.getState().aiClock.nowMs,360000);
    assert.strictEqual(o.getState().armies.get('a')!.movement,null);
  });
  test('Phase H review: finalization promotion after clearance cannot demote on logout',()=>{
    const d=respond(pending());assert.strictEqual([...d.peaceRelationships.values()][0]!.state,'PENDING_HOSTILITIES_CLEARANCE');
    online(d);d.gameplaySessionLeases[0]!.openedAtMs=35000;d.gameplaySessionLeases[0]!.lastReceiptAtMs=35000;d.gameplaySessionLeases[0]!.endedAtMs=35500;
    advance(d,34999);assert.strictEqual(relationshipBetween(d,'me','spectator'),'PENDING_HOSTILITIES_CLEARANCE');
    advance(d,35000);advance(d,36500);assert.strictEqual(relationshipBetween(d,'me','spectator'),'PEACE');
  });
  test('Phase H review: interrupted direct hostile travel retains clearance through reload',()=>{
    const o=new Orchestrator(bilateralWorld());assert.ok(o.execute(cmdReq('ATTACK','ai',bilateralAttacks[0]!)).success);
    const d=respond(pending(cloneGameState(o.getState()),'me','enemy'),'ACCEPT_PEACE','enemy');
    const start=d.armies.get('a')!.movement!.startedAtTick;d.worldTick=1;d.accruedTargetWorldTick=1;
    d.territories.get('home')!.neighboring=d.territories.get('home')!.neighboring.filter(id=>id!=='stage');
    d.territories.get('stage')!.neighboring=d.territories.get('stage')!.neighboring.filter(id=>id!=='home');
    assert.strictEqual(progressArmyMovements(d,1)[0]!.status,'interrupted');processPeaceBoundary(d);
    assert.strictEqual(d.armies.get('a')!.location,'home');assert.strictEqual(d.armies.get('a')!.movement!.startedAtTick,start);
    assert.strictEqual(d.armies.get('a')!.movement!.status,'blocked');assert.strictEqual(d.armies.get('a')!.attackIntent,null);
    assert.ok(hostileLifecyclesBetween(d,'me','enemy').length);assert.strictEqual([...d.peaceRelationships.values()][0]!.finalizationTimer,null);
    const reloaded=hydratePersistedPayload(encodePersistable(d));assert.ok(hostileLifecyclesBetween(reloaded,'me','enemy').length);
    assert.deepStrictEqual(reloaded.armies.get('a')!.movement,d.armies.get('a')!.movement);
  });
  test('Phase H review: corrupt hostile movement linkage cannot impersonate another pair',()=>{
    const o=new Orchestrator(world()),r=o.execute(cmdReq('START_AI_OPERATION','ai',{plan:attack()}));assert.ok(r.success);
    const d=cloneGameState(o.getState());d.armies.get('a')!.movement!.hostileCounterpartyId='spectator';
    assert.ok(checkGameStateInvariants(d).some(v=>v.code==='peace.invalid_hostile_march'));
    assert.throws(()=>hydratePersistedPayload(encodePersistable(d)));
  });
  test('Phase H review: factual danger retains committed attacks during clearance',()=>{
    const s=bilateralWorld(),o=new Orchestrator(s);assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:attack()})).success);
    const d=pending(cloneGameState(o.getState()),'me','enemy');d.armies.get('b')!.location='stage';
    const before=new StrategicEvaluators(new FactualSupport(d)).localDanger('enemy','target');assert.deepStrictEqual(before.facts.hostileForceIds,['a','b']);
    const accepted=respond(d,'ACCEPT_PEACE','enemy'),after=new StrategicEvaluators(new FactualSupport(accepted)).localDanger('enemy','target');
    assert.deepStrictEqual(after.facts.hostileForceIds,['a'],'existing committed attack survives; idle force cannot start new hostility');
    assert.strictEqual(after.facts.committedThreats,1);assert.ok(after.facts.hostilePower>0);
    const loaded=hydratePersistedPayload(encodePersistable(accepted));assert.deepStrictEqual(new StrategicEvaluators(new FactualSupport(loaded)).localDanger('enemy','target'),after);
  });
  test('Phase H review: historical declaration helpers cannot advertise executable WAR changes',()=>{
    assert.strictEqual(isExecutableCommitmentAction('DECLARE_WAR'),false);assert.strictEqual(isUnsupportedCommitmentAction('DECLARE_WAR'),true);
    assert.strictEqual(EXECUTABLE_CONCRETE_ACTIONS.has('DECLARE_WAR'),false);assert.strictEqual(getCommandDefinition('DECLARE_WAR')!.status,'unsupported');
    assert.strictEqual(EXECUTABLE_CONCRETE_ACTIONS.has('OFFER_PEACE'),true);
  });

}
