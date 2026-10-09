import assert from 'assert';
import {primeSourceDecision} from './aiPressureFixtures';
import type {GameState} from '../src/types/GameState';
import type {TradePlan} from '../src/types/AIConcretePlan';
import {makeConcretePlan,concretePlanProblem,PROACTIVE_AI_ACTIONS} from '../src/types/AIConcretePlan';
import {makeOperationTestWorld} from './aiOperationFixtures';
import {initializeRecruitment} from '../src/gameplay/recruitment/recruitment';
import {Orchestrator,createDefaultRegistry} from '../src/orchestration';
import {cloneGameState,adoptOwnedTransactionState} from '../src/state/cloneGameState';
import {checkGameStateInvariants} from '../src/state/gameStateInvariants';
import {encodePersistable} from '../src/persistence/serialization';
import {hydratePersistedPayload} from '../src/persistence/hydrate';
import {getCommandDefinition} from '../src/orchestration/commandIndex';
import {progressProactiveThrough} from '../src/orchestration/handlers';
import {buildWarlordStates,toDecisionEngineSnapshot,toWorldStepInput} from '../src/state/gameStateAdapters';
import {tradePlanProblem,acceptanceProblem,nextTradeBoundary,recipientManifest,settleTradeProposal,processTradeBoundary,liveTradeProposals,liveTradeShipments,publicTradeState} from '../src/gameplay/trade/trade';
import {availableResource,reservedResource} from '../src/gameplay/trade/resources';
import {tradeRoute,tradeNode} from '../src/gameplay/trade/policy';
import {tradeCandidates,tradeDemand,observableTradeCounterparties} from '../src/gameplay/trade/candidates';
import {TRADE_TIMING as T,TRADE_RESPONSE_POLICY as R} from '../src/constants/trade';
import {occupiedAttention,attentionCost} from '../src/engine/strategicAttention';
import {settleOperation} from '../src/engine/operations';
import {startProactiveTimer,accrueProactiveClocks} from '../src/engine/proactiveCognition';
import {assessConcretePlanFeasibility} from '../src/engine/concretePlans';
import {ensureCity} from '../src/gameplay/cities/city';
import {GAMEPLAY_CONFIG} from '../src/gameplay/config';
import {relationshipBetween,peacePairId,assertHostilityAllowed} from '../src/gameplay/diplomacy/relationships';
import {startConstruction} from '../src/gameplay/construction/consume';
import {consumeEmpireFood} from '../src/gameplay/economy/foodConsumption';
import {ConsequenceApplier,WorldSimulator} from '../src/events/WorldSimulator';
import {FactualSupport} from '../src/scoring/factualSupport';
import {StrategicEvaluators} from '../src/scoring/strategicEvaluators';
import {tradeResponseEstimate,assessRequiredTradeResponse} from '../src/scoring/tradeAssessment';
import {observeSources,sourceConcretePlans} from '../src/engine/strategicPressure';
import {ContextPlanComparator,selectContextComparison} from '../src/scoring/contextPlanComparison';
import {SeededRNG} from '../src/utils/SeededRNG';
import {InMemoryGameStateStore} from '../src/persistence/inMemoryGameStateStore';
import {calculateMovementDuration} from '../src/army/movement';
import {emptyTradeMetrics} from '../src/types/Trade';
import {runStateTransaction} from '../src/orchestration/transaction';
type Api=Pick<Parameters<typeof import('./aiStrategicEvaluation').registerAiStrategicEvaluationTests>[0],'test'|'makeSelf'|'makeTerritory'|'cmdReq'>;
export function registerAiTradeTests({test,makeSelf,makeTerritory,cmdReq}:Api):void {
  const world=()=>{
    const s=makeOperationTestWorld(makeSelf,makeTerritory);s.worldLevel=1;
    s.territories.get('safe')!.neighboring=['target'];s.territories.get('target')!.neighboring.push('safe');
    for(const t of s.territories.values()){t.garrison=1000000;t.fortification=GAMEPLAY_CONFIG.maxFortificationLevel;t.resourceOutput={gold:0,food:0,wood:0,iron:0,stone:0};ensureCity(s,t.id,t.owner!);s.territoryInfrastructure.set(t.id,{territoryId:t.id,farmCompletedAtTick:0,mineCompletedAtTick:0,lumberCompletedAtTick:0});}
    for(const f of s.factions.values())f.resources={gold:100,food:100,wood:100,iron:100,stone:100};
    initializeRecruitment(s);assert.deepStrictEqual(checkGameStateInvariants(s),[]);return s;
  };
  const online=(s:GameState,expiresAtMs=100000000)=>{s.gameplaySessionLeases=[{sessionId:'online',openedAtMs:0,expiresAtMs,endedAtMs:null,lastReceiptAtMs:0,lastRenewalRequestId:null} as GameState['gameplaySessionLeases'][number]];};
  const context=(s:GameState)=>({req:cmdReq('AI_DECIDE','ai',{warlordId:'me'}),def:getCommandDefinition('AI_DECIDE')!,registry:createDefaultRegistry(),runtime:{aiWarlordStates:buildWarlordStates(s)}});
  const advance=(s:GameState,at:number)=>progressProactiveThrough(s,context(s),at);
  const plan=(s:GameState,fid='me',other='spectator',offered={wood:70},requested={food:50})=>makeConcretePlan({action:'TRADE',factionId:fid,counterpartyId:other,offered,requested,proposerSource:{kind:'faction_stock',factionId:fid,resources:offered},delivery:{proposerTerritoryId:tradeNode(s,fid)!,recipientTerritoryId:tradeNode(s,other)!}}) as TradePlan;
  const begin=(s=world(),p=plan(s))=>{const o=new Orchestrator(s),r=o.execute(cmdReq(p.factionId===s.playerFactionId?'TRADE':'START_AI_OPERATION',p.factionId===s.playerFactionId?'player':'ai',{factionId:p.factionId,plan:p}));assert.ok(r.success,JSON.stringify(r.errors));return cloneGameState(o.getState());};
  const proposal=(s:GameState)=>liveTradeProposals(s)[0]??[...s.tradeProposals.values()][0]!;
  const pending=(s=world(),p=plan(s))=>{const d=begin(s,p);advance(d,d.gameplaySessionLeases.length?T.initiationOnlineMs:T.initiationOfflineMs);assert.strictEqual(proposal(d).status,'pending');return d;};
  const respond=(s:GameState,response='ACCEPT_TRADE',id=proposal(s).id)=>{const o=new Orchestrator(s),p=s.tradeProposals.get(id)!,r=o.execute(cmdReq(p.recipient===s.playerFactionId?'RESPOND_TRADE':'RESPOND_TRADE',p.recipient===s.playerFactionId?'player':'ai',{factionId:p.recipient,proposalId:id,response}));assert.ok(r.success,JSON.stringify(r.errors));return cloneGameState(o.getState());};
  const physical=(s:GameState,ticks=32)=>{const registry=createDefaultRegistry();
    // Isolate Trade conservation from independently authored random world losses.
    class QuietEvents extends WorldSimulator {simulate(input:import('../src/events/EventModel').WorldStepInput):import('../src/events/EventModel').WorldStepOutput {return {perTurnConsequences:[],expiredEvents:[],unresolvedDecisions:[],mutatedTerritories:input.territories,mutatedFactions:input.factions,mutatedArmies:input.armies,newActiveEvents:input.activeEvents,newEventHistory:input.eventHistory,triggeredEvents:[],summary:[]} as import('../src/events/EventModel').WorldStepOutput;}}
    registry.events=new QuietEvents();const o=new Orchestrator(s,registry),r=o.execute(cmdReq('ADVANCE_WORLD','ai',{elapsedTicks:ticks}));assert.ok(r.success,JSON.stringify(r.errors));adoptOwnedTransactionState(s,cloneGameState(o.getState()));s.accruedTargetWorldTick=Math.max(s.accruedTargetWorldTick,s.worldTick);};
  const total=(s:GameState,r:'food'|'wood')=>[...s.factions.values()].reduce((n,f)=>n+f.resources[r],0)+[...s.tradeShipments.values()].filter(sh=>sh.phase!=='delivered').reduce((n,sh)=>n+(sh.cargo[r]??0),0);
  const reload=(s:GameState)=>hydratePersistedPayload(encodePersistable(s));
  test('Phase I: exact eight proactive categories; Trade supported, NEGOTIATE not restored',()=>{assert.strictEqual(PROACTIVE_AI_ACTIONS.length,8);assert.ok(!PROACTIVE_AI_ACTIONS.includes('NEGOTIATE' as never));assert.strictEqual(getCommandDefinition('TRADE')!.status,'implemented');});
  test('Phase I: exact Trade manifest/endpoint plan is immutable and stable',()=>{const s=world(),p=plan(s);assert.strictEqual(concretePlanProblem(p),null);assert.ok(Object.isFrozen(p.offered));assert.ok(Object.isFrozen(p.delivery));assert.strictEqual(plan(s).id,p.id);});
  test('Phase I: incomplete historical terms cannot invent a source/endpoint',()=>{const p=makeConcretePlan({action:'TRADE',factionId:'me',counterpartyId:'enemy',offered:{wood:1},requested:{food:1}}) as TradePlan;assert.ok(tradePlanProblem(world(),p));});
  test('Phase I: Trade initiation reserves exact offered side without subtracting it',()=>{const s=begin();assert.strictEqual(s.factions.get('me')!.resources.wood,100);assert.strictEqual(reservedResource(s,'me','wood'),70);assert.strictEqual(availableResource(s,'me','wood'),30);assert.strictEqual(occupiedAttention(s,'me'),attentionCost(proposal(s).plan));assert.strictEqual(s.tradeShipments.size,0);});
  test('Phase I: requested recipient resources unreserved during initiation and pending',()=>{for(const s of [begin(),pending()]){assert.strictEqual(reservedResource(s,'spectator','food'),0);assert.strictEqual(availableResource(s,'spectator','food'),100);assert.strictEqual(occupiedAttention(s,'spectator'),0);}});
  test('Phase I: online initiation exact 2 seconds',()=>{const s=world();online(s);const d=begin(s);advance(d,1999);assert.strictEqual(proposal(d).status,'initiating');advance(d,2000);assert.strictEqual(proposal(d).status,'pending');});
  test('Phase I: offline initiation exact 60 seconds',()=>{const d=begin();advance(d,59999);assert.strictEqual(proposal(d).status,'initiating');advance(d,60000);assert.strictEqual(proposal(d).status,'pending');});
  test('Phase I: initiation promotion never demotes on logout',()=>{const s=world();online(s,1000);const d=begin(s);advance(d,2000);assert.strictEqual(proposal(d).status,'pending');});
  test('Phase I: reload during initiation retains exact reserved terms and timer',()=>{const d=begin();advance(d,12345);const e=reload(d);advance(d,60000);advance(e,60000);assert.deepStrictEqual(encodePersistable(d),encodePersistable(e));});
  test('Phase I: Trade is legal at WAR and pending creates no ceasefire',()=>{const d=pending();assert.strictEqual(relationshipBetween(d,'me','spectator'),'WAR');assert.doesNotThrow(()=>assertHostilityAllowed(d,'me','spectator','safe'));});
  test('Phase I: Trade independent from clearance and PEACE',()=>{for(const state of ['PENDING_HOSTILITIES_CLEARANCE','PEACE'] as const){const s=world(),pairId=peacePairId('me','spectator');s.peaceRelationships.set(pairId,{pairId,factions:['me','spectator'],state,proposalId:null,acceptedAtMs:0,activatedAtMs:state==='PEACE'?0:null,finalizationTimer:null,expiresAtMs:state==='PEACE'?10000000:null,legacyExpiresTurn:null});assert.strictEqual(tradePlanProblem(s,plan(s)),null);assert.ok(begin(s).tradeProposals.size);}});
  test('Phase I: second offer cannot double-reserve the same quantities',()=>{const d=pending(),o=new Orchestrator(d),before=encodePersistable(d);assert.ok(!o.execute(cmdReq('START_AI_OPERATION','ai',{factionId:'me',plan:plan(d)})).success);assert.deepStrictEqual(encodePersistable(o.getState()),before);});
  test('Phase I: same faction and same pair allow non-overlapping concurrent proposals',()=>{const d=pending();const e=begin(d,plan(d,'me','spectator',{gold:20} as any,{iron:10} as any));assert.strictEqual(liveTradeProposals(e).length,2);assert.strictEqual(reservedResource(e,'me','wood'),70);assert.strictEqual(reservedResource(e,'me','gold'),20);});
  test('Phase I: exact resource source mismatch/wrong ownership reject atomically',()=>{const s=world(),p=makeConcretePlan({...plan(s),id:undefined,proposerSource:{kind:'faction_stock',factionId:'enemy',resources:{wood:70}}} as any) as TradePlan;assert.ok(concretePlanProblem(p));const o=new Orchestrator(s);assert.ok(!o.execute(cmdReq('START_AI_OPERATION','ai',{plan:p})).success);assert.deepStrictEqual(encodePersistable(o.getState()),encodePersistable(s));});
  test('Phase I: fractional/zero/invalid resource terms are rejected',()=>{for(const offered of [{wood:0},{wood:-1},{wood:.5},{unobtainium:2}]){const s=world();assert.ok(tradePlanProblem(s,plan(s,'me','spectator',offered as any)));}});
  test('Phase I: BUILD cannot consume pending offered Wood',()=>{const s=world();s.territoryInfrastructure.get('home')!.farmCompletedAtTick=null;const d=pending(s,plan(s,'me','spectator',{wood:90}));const f=d.factions.get('me')!;f.resources.gold=10000;assert.throws(()=>startConstruction(d,{factionId:'me',territoryId:'home',projectType:'FARM'}));assert.strictEqual(f.resources.wood,100);assert.strictEqual(reservedResource(d,'me','wood'),90);});
  test('Phase I: exact-plan feasibility distinguishes resource CLAIM from ATTENTION',()=>{const d=pending();d.strategicAttention.capacity=occupiedAttention(d,'me');const a=assessConcretePlanFeasibility(plan(d),toDecisionEngineSnapshot(d));assert.ok(a.rejections.some(r=>r.kind==='CLAIM'));assert.ok(a.rejections.some(r=>r.kind==='ATTENTION'));assert.ok(!a.rejections.some(r=>r.kind==='LEGALITY'));});
  test('Phase I: construction paid resources are unavailable to Trade',()=>{const s=world();s.territoryInfrastructure.get('home')!.lumberCompletedAtTick=null;s.factions.get('me')!.resources={gold:10000,wood:10000,food:10000,iron:10000,stone:10000};const before=s.factions.get('me')!.resources.gold;startConstruction(s,{factionId:'me',territoryId:'home',projectType:'LUMBER'});assert.ok(s.factions.get('me')!.resources.gold<before);const offer=plan(s,'me','spectator',{gold:before} as any,{food:1});assert.ok(tradePlanProblem(s,offer));});
  test('Phase I: empire upkeep consumes only unreserved bank Food',()=>{const s=world();s.worldLevel=2;const d=pending(s,plan(s,'me','spectator',{food:70} as any,{wood:1} as any));d.worldTick=6000;d.lastFoodConsumptionTick=0;consumeEmpireFood(d);assert.ok(d.factions.get('me')!.resources.food>=70);assert.strictEqual(reservedResource(d,'me','food'),70);});
  test('Phase I: event spending/cost eligibility cannot consume reserved bank stock',()=>{const d=pending(),input=toWorldStepInput(d),applier=new ConsequenceApplier(input.territories,input.factions,input.armies,input.reservedResources);assert.strictEqual(applier.canAfford({wood:50},'me'),false);applier.payCost({wood:50},'me');assert.strictEqual(applier.factions.get('me')!.resources.wood,70);assert.strictEqual(d.factions.get('me')!.resources.wood,100);});
  test('Phase I: exact requested side must still exist at acceptance',()=>{const d=pending();d.factions.get('spectator')!.resources.food=40;assert.ok(acceptanceProblem(d,proposal(d)));const o=new Orchestrator(d),before=encodePersistable(d);const r=o.execute(cmdReq('RESPOND_TRADE','player',{proposalId:proposal(d).id,response:'ACCEPT_TRADE'}));assert.ok(!r.success);assert.deepStrictEqual(encodePersistable(o.getState()),before);assert.strictEqual(o.getState().tradeShipments.size,0);});
  test('Phase I: recipient 60 minus own 20 leaves 40, not partially accepted/debt',()=>{const d=pending();d.factions.get('spectator')!.resources.food=60;d.worldLevel=2;d.worldTick=1200;d.accruedTargetWorldTick=1200;d.lastFoodConsumptionTick=0;consumeEmpireFood(d);assert.strictEqual(d.factions.get('spectator')!.resources.food,40);assert.strictEqual(recipientManifest(d,proposal(d)),null);assert.strictEqual(reservedResource(d,'me','wood'),70);assert.strictEqual(proposal(d).status,'pending');});
  test('Phase I: recipient exact bank manifest is deterministic without RNG',()=>{const d=pending();const a=recipientManifest(d,proposal(d)),e=reload(d);assert.deepStrictEqual(recipientManifest(e,proposal(e)),a);assert.deepStrictEqual(a,{kind:'faction_stock',factionId:'spectator',resources:{food:50}});});
  test('Phase I: ACCEPT creates two exact physical custody manifests, no teleport',()=>{const d=respond(pending());assert.strictEqual(d.tradeShipments.size,2);assert.strictEqual(d.factions.get('me')!.resources.wood,30);assert.strictEqual(d.factions.get('spectator')!.resources.food,50);assert.strictEqual(d.factions.get('me')!.resources.food,100);assert.strictEqual(d.factions.get('spectator')!.resources.wood,100);assert.ok([...d.tradeShipments.values()].every(sh=>sh.phase==='loading'));assert.strictEqual(occupiedAttention(d,'me'),0);assert.strictEqual(d.operationClaims.size,0);assert.deepStrictEqual(checkGameStateInvariants(d),[]);});
  test('Phase I: ACCEPT/delivery preserve exact resource totals',()=>{const d=pending(),wood=total(d,'wood'),food=total(d,'food'),e=respond(d);assert.strictEqual(total(e,'wood'),wood);assert.strictEqual(total(e,'food'),food);physical(e);assert.strictEqual(total(e,'wood'),wood);assert.strictEqual(total(e,'food'),food);assert.ok([...e.tradeShipments.values()].every(sh=>sh.phase==='delivered'));});
  test('Phase I: duplicate ACCEPT/terminal settlement creates no extra shipments or transfer',()=>{const d=respond(pending()),before=encodePersistable(d);assert.strictEqual(settleTradeProposal(d,proposal(d).id,'accepted'),false);assert.strictEqual(settleOperation(d,proposal(d).operationId,'completed','duplicate'),false);assert.deepStrictEqual(encodePersistable(d),before);});
  test('Phase I: accepted Trade does not ceasefire or hold diplomatic Attention',()=>{const d=respond(pending());assert.strictEqual(relationshipBetween(d,'me','spectator'),'WAR');assert.doesNotThrow(()=>assertHostilityAllowed(d,'me','spectator','safe'));assert.strictEqual(occupiedAttention(d,'me'),0);});
  test('Phase I: load then route then unload exact persisted phases',()=>{const s=world();online(s);const d=respond(pending(s));advance(d,11999);assert.ok([...d.tradeShipments.values()].every(sh=>sh.phase==='loading'));advance(d,12000);assert.ok([...d.tradeShipments.values()].every(sh=>sh.phase==='transit'));for(const sh of d.tradeShipments.values())assert.strictEqual(sh.legDurationTicks,calculateMovementDuration({origin:d.territories.get(sh.route[0]!)!,destination:d.territories.get(sh.route[1]!)!}));});
  test('Phase I: interrupted route retains cargo and consumed travel without refund',()=>{const d=respond(pending());advance(d,120000);const sh=[...d.tradeShipments.values()][0]!,from=d.territories.get(sh.route[sh.legIndex]!)!,to=d.territories.get(sh.route[sh.legIndex+1]!)!;const elapsed=d.worldTick-sh.legStartedAtTick!;from.neighboring=from.neighboring.filter(x=>x!==to.id);to.neighboring=to.neighboring.filter(x=>x!==from.id);const before=total(d,'wood');processTradeBoundary(d);assert.strictEqual(sh.phase,'blocked');assert.strictEqual(d.worldTick-sh.legStartedAtTick!,elapsed);assert.strictEqual(total(d,'wood'),before);assert.deepStrictEqual(reload(d).tradeShipments.get(sh.id),sh);});
  test('Phase I: unroutable ACCEPT fails but offered resources remain reserved/pending',()=>{const s=world();s.territories.get('safe')!.neighboring=[];s.territories.get('target')!.neighboring=['stage'];const d=pending(s);assert.ok(acceptanceProblem(d,proposal(d))?.includes('route'));assert.strictEqual(proposal(d).status,'pending');assert.strictEqual(d.factions.get('me')!.resources.wood,100);assert.strictEqual(reservedResource(d,'me','wood'),70);});
  test('Phase I: decline releases exact reservations and Attention, no shipments',()=>{const d=respond(pending(),'DECLINE_TRADE');assert.strictEqual(proposal(d).status,'declined');assert.strictEqual(availableResource(d,'me','wood'),100);assert.strictEqual(occupiedAttention(d,'me'),0);assert.strictEqual(d.tradeShipments.size,0);});
  test('Phase I: player may withdraw own pending offer without transferring goods',()=>{const s=world(),d=pending(s,plan(s,'spectator','me'));const o=new Orchestrator(d),r=o.execute(cmdReq('WITHDRAW_TRADE','player',{proposalId:proposal(d).id}));assert.ok(r.success,JSON.stringify(r.errors));assert.strictEqual(proposal(o.getState()).status,'withdrawn');assert.strictEqual(o.getState().operationClaims.size,0);assert.strictEqual(o.getState().tradeShipments.size,0);});
  test('Phase I: AI cannot voluntarily withdraw pending Trade',()=>{const d=pending(),o=new Orchestrator(d);assert.ok(!o.execute(cmdReq('WITHDRAW_TRADE','ai',{factionId:'me',proposalId:proposal(d).id})).success);assert.strictEqual(proposal(o.getState()).status,'pending');});
  test('Phase I: player expiry releases reservations without fabricated decline cognition',()=>{const d=pending(),id=proposal(d).id;advance(d,60000+R.playerOfflineMs);assert.strictEqual(d.tradeProposals.get(id)!.status,'expired');assert.strictEqual(reservedResource(d,'me','wood'),0);assert.strictEqual(d.tradeShipments.size,0);});
  test('Phase I: AI required response proceeds at full normal Attention and spacing',()=>{const s=world();s.playerFactionId=null;s.levelAnchorTerritoryIds=[];const d=pending(s,plan(s,'me','enemy'));const o=d.aiDecisionOpportunities.get('enemy')!;o.spacing=startProactiveTimer(d,'enemy','spacing',45000,45000,100);d.strategicAttention.capacity=occupiedAttention(d,'me');const id=proposal(d).id;advance(d,60000+R.onlineMaxMs*R.offlineDivisor);assert.ok(['accepted','declined'].includes(d.tradeProposals.get(id)!.status));assert.ok(!liveTradeProposals(d).some(p=>p.id===id));});
  test('Phase I: own canonical RESOURCE_VALUE response declines unfundable exact request',()=>{const d=pending();d.factions.get('spectator')!.resources.food=0;assert.strictEqual(assessRequiredTradeResponse(d,proposal(d)).outcome,'DECLINE_TRADE');});
  test('Phase I: pending clone/hydration never aliases source manifests or timer progress',()=>{const d=pending(),e=cloneGameState(d);e.tradeProposals.get(proposal(d).id)!.plan=plan(e,'me','spectator',{wood:1},{food:1});assert.strictEqual(proposal(d).plan.offered.wood,70);const r=reload(d);assert.deepStrictEqual(encodePersistable(r),encodePersistable(d));});
  test('Phase I: reload during shipment preserves exact IDs/routes/cargo/progress',()=>{const d=respond(pending());advance(d,120001);const e=reload(d);assert.deepStrictEqual(e.tradeShipments,d.tradeShipments);physical(d);physical(e);assert.deepStrictEqual(encodePersistable(d),encodePersistable(e));});
  test('Phase I: fine/coarse delivery gives exact canonical result',()=>{const d=respond(pending()),e=cloneGameState(d);for(let i=0;i<32;i++)physical(d,1);physical(e,32);assert.deepStrictEqual(encodePersistable(d),encodePersistable(e));});
  test('Phase I: same-boundary duplicate progression cannot deliver twice',()=>{const d=respond(pending());physical(d);assert.ok([...d.tradeShipments.values()].every(sh=>sh.phase==='delivered'));const before=encodePersistable(d);processTradeBoundary(d);processTradeBoundary(d);assert.deepStrictEqual(encodePersistable(d),before);});
  test('Phase I: counteroffer is new exact proposal with old reservations released',()=>{const d=pending(),old=proposal(d).id,p=plan(d,'spectator','me',{food:20} as any,{wood:10} as any),o=new Orchestrator(d);const r=o.execute(cmdReq('COUNTEROFFER_TRADE','player',{proposalId:old,plan:p}));assert.ok(r.success,JSON.stringify(r.errors));const e=o.getState();assert.strictEqual(e.tradeProposals.get(old)!.status,'counteroffered');assert.strictEqual(reservedResource(e,'me','wood'),0);assert.strictEqual(reservedResource(e,'spectator','food'),20);const fresh=liveTradeProposals(e)[0]!;assert.notStrictEqual(fresh.id,old);assert.strictEqual(fresh.replacesProposalId,old);assert.deepStrictEqual(fresh.plan,p);assert.strictEqual(occupiedAttention(e,'me'),0);});
  test('Phase I: invalid counteroffer rolls back old settlement and both resource/Attention changes',()=>{const d=pending(),before=encodePersistable(d),o=new Orchestrator(d);const r=o.execute(cmdReq('COUNTEROFFER_TRADE','player',{proposalId:proposal(d).id,plan:plan(d,'spectator','me',{food:1000} as any)}));assert.ok(!r.success);assert.deepStrictEqual(encodePersistable(o.getState()),before);});
  test('Phase I: invalidation during initiation releases claims and grants no success spacing',()=>{const d=begin(),op=proposal(d).operationId;d.factions.get('me')!.territories=[];d.factions.get('me')!.armies=[];processTradeBoundary(d);assert.strictEqual(proposal(d).status,'invalidated');assert.strictEqual(d.operationClaims.size,0);assert.strictEqual(d.aiDecisionOpportunities.get('me')?.spacing,null);assert.ok(d.operations.get(op)!.terminal);});
  test('Phase I: accepted shipments retain obligations regardless of ongoing WAR',()=>{const d=respond(pending());for(const f of d.factions.values())f.diplomacy.clear();processTradeBoundary(d);assert.strictEqual(d.tradeShipments.size,2);assert.ok([...d.tradeShipments.values()].every(sh=>sh.phase==='loading'));});
  test('Phase I: missing/remote/new fake stockpile manifests cannot spend local yield',()=>{const s=world(),base=plan(s),p=makeConcretePlan({...base,id:undefined,proposerSource:{kind:'local_stockpiles',holdings:[{stockpileId:'fake',territoryId:'home',resources:{wood:70}}]}} as any) as TradePlan;assert.ok(tradePlanProblem(s,p));});
  test('Phase I: committed factual stocks exclude pending offers and accepted cargo',()=>{const d=pending();assert.strictEqual(new FactualSupport(d).stocks.get('me')!.wood,30);const e=respond(d);assert.strictEqual(new FactualSupport(e).stocks.get('me')!.wood,30);assert.strictEqual(new FactualSupport(e).stocks.get('me')!.food,100);});
  test('Phase I: public view contains exact visible terms/status and no private cognition',()=>{const d=pending(),view=JSON.stringify(publicTradeState(d,'spectator'));assert.ok(view.includes('wood'));for(const word of ['pressure','personality','goals','memory','rng','score','acceptanceBounds','responseTimer','proposerSource'])assert.ok(!view.includes(word));assert.strictEqual(publicTradeState(d,'enemy').proposals.length,0);assert.strictEqual(publicTradeState(begin(),'spectator').proposals.length,0);});
  test('Phase I: proposer estimate accepts only visible terms, no recipient private view',()=>{const p=plan(world()),a=tradeResponseEstimate({offered:p.offered,requested:p.requested});assert.deepStrictEqual(a.acceptanceBounds,[0,1]);assert.strictEqual(a.confidence,'limited');});
  test('Phase I: schema 23 migration creates no historical Trade or delivery',()=>{const s=pending();s.schemaVersion=23;delete (s as any).tradeProposals;delete (s as any).tradeShipments;s.operations.clear();s.operationClaims.clear();s.aiDecisionOpportunities.clear();const before=encodePersistable(s.peaceRelationships),e=reload(s);assert.strictEqual(e.schemaVersion,25);assert.strictEqual(e.tradeProposals.size,0);assert.strictEqual(e.tradeShipments.size,0);assert.deepStrictEqual(encodePersistable(e.peaceRelationships),before);});
  test('Phase I: schema 24 corrupt missing Trade storage fails hydration',()=>{const s=world();delete (s as any).tradeShipments;assert.throws(()=>reload(s));});
  test('Phase I: invariants reject missing bilateral shipment and altered accepted quantity',()=>{const d=respond(pending()),ids=proposal(d).shipmentIds;d.tradeShipments.delete(ids[0]!);assert.ok(checkGameStateInvariants(d).some(v=>v.code==='trade.invalid_state'));const e=respond(pending());[...e.tradeShipments.values()][0]!.cargo={wood:71};assert.ok(checkGameStateInvariants(e).some(v=>v.code==='trade.invalid_state'));});
  test('Phase I: invariants reject over-reservation and terminal claim leakage',()=>{const d=pending();d.factions.get('me')!.resources.wood=69;assert.ok(checkGameStateInvariants(d).some(v=>v.code==='trade.invalid_state'));});
  test('Phase I: acceptance stale CAS cannot duplicate bilateral cargo',()=>{const d=pending(),store=new InMemoryGameStateStore();assert.ok(store.save('player',d,0).ok);const a=store.load('player'),b=store.load('player');assert.ok(a.ok&&b.ok);if(!a.ok||!b.ok)throw new Error('CAS fixture load failed');const x=respond(a.state),y=respond(b.state);assert.ok(store.save('player',x,a.record.stateVersion).ok);assert.strictEqual(store.save('player',y,b.record.stateVersion).ok,false);const final=store.load('player');assert.ok(final.ok);if(final.ok)assert.strictEqual(final.state.tradeShipments.size,2);});
  test('Phase I: deterministic route and node do not depend on map insertion order',()=>{const s=world(),a=tradeRoute(s,'home','safe');s.territories=new Map([...s.territories].reverse());for(const t of s.territories.values())t.neighboring.reverse();assert.deepStrictEqual(tradeRoute(s,'home','safe'),a);assert.strictEqual(tradeNode(s,'me'),'home');});
  test('Phase I: candidate set complete within resource-pair bound and deterministic',()=>{const s=world();for(const t of s.territories.values())t.fortification=0;for(const id of ['home','target'])s.territoryInfrastructure.get(id)!.lumberCompletedAtTick=null;s.factions.get('me')!.resources={gold:10000,food:100,wood:0,iron:0,stone:0};s.factions.get('enemy')!.resources={gold:0,food:100,wood:10000,iron:10000,stone:10000};const a=tradeCandidates(s,'me','enemy');assert.ok(a.length>0&&a.length<=20);assert.strictEqual(new Set(a.map(p=>p.id)).size,a.length);s.factions=new Map([...s.factions].reverse());assert.deepStrictEqual(tradeCandidates(s,'me','enemy'),a);assert.deepStrictEqual(tradeCandidates(reload(s),'me','enemy'),a);});
  test('Phase I: real complementary Trade source scores only RESOURCE_VALUE support within its context',()=>{const s=world();for(const id of ['home','target'])s.territoryInfrastructure.get(id)!.farmCompletedAtTick=null;s.factions.get('me')!.resources={gold:10000,food:100,wood:0,iron:100,stone:100};s.factions.get('enemy')!.resources={gold:0,food:100,wood:10000,iron:100,stone:100};observeSources(s,'me');const source=[...s.aiPressure.values()].find(c=>c.domain==='TRADE_ECONOMIC'&&c.counterpartyId==='enemy')!;assert.ok(source&&!source.blocked);const ps=sourceConcretePlans(s,source),c=new ContextPlanComparator().compare(s,source,ps);assert.ok(ps.some(p=>p.action==='TRADE'));assert.ok(c.evaluatorCalls.RESOURCE_VALUE>0);assert.ok(c.comparisons.every(p=>p.plan.action==='TRADE'||p.plan.action==='WAIT'));assert.deepStrictEqual(selectContextComparison(c.comparisons,new SeededRNG(37)),selectContextComparison(c.comparisons,new SeededRNG(37)));assert.strictEqual(selectContextComparison(c.comparisons,new SeededRNG(37)).selected.plan.action,'TRADE');});
  test('Phase I: all-no-surplus world has no Trade source or per-pair full cognition',()=>{const s=world();for(const f of s.factions.values())f.resources={gold:0,food:0,wood:0,iron:0,stone:0};observeSources(s,'me');assert.ok(![...s.aiPressure.values()].some(c=>c.domain==='TRADE_ECONOMIC'));});
  test('Phase I: terminal proposal history excluded from live hot paths',()=>{const d=respond(pending(),'DECLINE_TRADE');for(let i=0;i<5000;i++)d.tradeProposals.set('old'+i,{...proposal(d),id:'old'+i});const original=d.tradeProposals.values;d.tradeProposals.values=()=>{throw new Error('Terminal history scan');};assert.strictEqual(liveTradeProposals(d).length,0);processTradeBoundary(d);d.tradeProposals.values=original;});
  test('Phase I: actual canonical cognition selects and publishes an exact profitable Trade',()=>{
    const s=world();for(const id of ['home','target'])s.territoryInfrastructure.get(id)!.farmCompletedAtTick=null;
    s.factions.get('me')!.resources={gold:10000,food:100,wood:0,iron:100,stone:100};s.factions.get('enemy')!.resources={gold:0,food:100,wood:10000,iron:100,stone:100};
    primeSourceDecision(s,'me');const o=new Orchestrator(s),r=o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'}));assert.ok(r.success,JSON.stringify(r.errors));
    const ids=r.payload.selectedOperationIds as string[];assert.strictEqual(ids.length,1);const selected=o.getState().operations.get(ids[0]!)!;assert.strictEqual(selected.plan!.action,'TRADE');
    const chosen=selected.plan;const started=o.execute(cmdReq('RESOLVE_COMMITMENT','ai',{factionId:'me',operationId:selected.id}));assert.ok(started.success,JSON.stringify(started.errors));
    const d=cloneGameState(o.getState()),p=proposal(d);assert.deepStrictEqual(p.plan,chosen);assert.strictEqual(p.status,'initiating');advance(d,d.aiClock.nowMs+T.initiationOfflineMs);assert.strictEqual(d.tradeProposals.get(p.id)!.status,'pending');assert.deepStrictEqual(d.tradeProposals.get(p.id)!.plan,chosen);
  });
  test('Phase I: shipment arrival and unload complete through authoritative world commands',()=>{const d=respond(pending());physical(d,32);assert.ok([...d.tradeShipments.values()].every(sh=>sh.phase==='delivered'));assert.strictEqual(d.factions.get('me')!.resources.food,150);assert.strictEqual(d.factions.get('spectator')!.resources.wood,170);assert.deepStrictEqual(checkGameStateInvariants(d),[]);});
  test('Phase I: several offered resource types remain exact across bilateral allocation',()=>{const s=world(),p=plan(s,'me','spectator',{wood:7,gold:9} as any,{food:11,iron:13} as any),d=respond(pending(s,p));const outgoing=[...d.tradeShipments.values()].find(sh=>sh.sender==='me')!;assert.deepStrictEqual(outgoing.cargo,p.offered);assert.strictEqual(d.factions.get('me')!.resources.gold,91);assert.strictEqual(d.factions.get('me')!.resources.wood,93);});
  test('Phase I: recipient cannot ACCEPT using quantities reserved for another own proposal',()=>{const d=pending(),e=begin(d,plan(d,'spectator','enemy',{food:70} as any,{wood:1} as any));assert.ok(acceptanceProblem(e,e.tradeProposals.get(proposal(d).id)!));assert.strictEqual(availableResource(e,'spectator','food'),30);});
  test('Phase I: single primary initiation blocks a racing Trade without reserving partial resources',()=>{const d=begin(),o=new Orchestrator(d),before=encodePersistable(d);assert.ok(!o.execute(cmdReq('START_AI_OPERATION','ai',{factionId:'me',plan:plan(d,'me','enemy',{gold:10} as any,{food:1})})).success);assert.deepStrictEqual(encodePersistable(o.getState()),before);});
  test('Phase I: Attention rejection leaves sequence/resources/claims and physical state unchanged',()=>{const s=world();s.strategicAttention.capacity=0;const o=new Orchestrator(s),before=encodePersistable(s);assert.ok(!o.execute(cmdReq('START_AI_OPERATION','ai',{factionId:'me',plan:plan(s)})).success);assert.deepStrictEqual(encodePersistable(o.getState()),before);});
  test('Phase I: recipient insufficiency does not forbid proposal publication',()=>{const s=world();s.factions.get('spectator')!.resources.food=0;const d=pending(s);assert.strictEqual(proposal(d).status,'pending');assert.strictEqual(reservedResource(d,'me','wood'),70);assert.ok(acceptanceProblem(d,proposal(d)));});
  test('Phase I: failed initiation grants no source relief or successful spacing',()=>{const d=begin(),p=proposal(d);d.territories.get(p.plan.delivery!.proposerTerritoryId)!.owner='enemy';processTradeBoundary(d);assert.strictEqual(p.status,'invalidated');assert.strictEqual(d.aiDecisionOpportunities.get('me')!.spacing,null);assert.strictEqual(reservedResource(d,'me','wood'),0);assert.strictEqual(d.tradeShipments.size,0);});
  test('Phase I: accepted cargo is an explicit committed effect, never a free bank balance',()=>{const d=respond(pending()),support=new FactualSupport(d);assert.strictEqual(support.committed.filter(e=>e.resourceDelivery).length,2);assert.strictEqual(support.stocks.get('me')!.food,100);assert.ok(support.committed.every(e=>!e.resourceDelivery||e.resourceDelivery.work));});
  test('Phase I: inactive recipient hard-invalidates without fabricated response',()=>{const d=pending();d.factions.get('spectator')!.territories=[];d.factions.get('spectator')!.armies=[];processTradeBoundary(d);assert.strictEqual(proposal(d).status,'invalidated');assert.strictEqual(d.tradeShipments.size,0);assert.strictEqual(reservedResource(d,'me','wood'),0);});
  test('Phase I: corrupt proposal operation identity and mutated shipment timing fail hydration',()=>{const d=pending();proposal(d).operationId='missing';assert.throws(()=>reload(d));const e=respond(pending());[...e.tradeShipments.values()][0]!.timer!.offlineDurationMs=1;assert.throws(()=>reload(e));});
  test('Phase I: proposal resource claim validation ignores JSON property insertion order',()=>{const d=pending();for(const c of [...d.operationClaims.values()])d.operationClaims.set(c.id,Object.fromEntries(Object.entries(c).reverse()) as any);assert.deepStrictEqual(checkGameStateInvariants(d),[]);assert.deepStrictEqual(reload(d).operationClaims,d.operationClaims);});

  test('Phase I: blocked load/unload work retains custody without expired-timer wake churn',()=>{
    const d=respond(pending());d.territories.get('home')!.neighboring=[];d.territories.get('stage')!.neighboring=d.territories.get('stage')!.neighboring.filter(id=>id!=='home');d.territories.get('other')!.neighboring=d.territories.get('other')!.neighboring.filter(id=>id!=='home');
    advance(d,120000);const sh=[...d.tradeShipments.values()].find(sh=>sh.sender==='me')!;assert.strictEqual(sh.phase,'blocked');
    const progress={...sh.timer!.progress};advance(d,1000000);assert.deepStrictEqual(sh.timer!.progress,progress);assert.strictEqual(nextTradeBoundary(d,2000000,'OFFLINE'),2000000);assert.strictEqual(total(d,'wood'),300);
  });

  test('Phase I review: loss of dispatch node while loading blocks intact cargo immediately',()=>{
    const d=respond(pending()),sh=[...d.tradeShipments.values()].find(x=>x.sender==='me')!;
    const before=total(d,'wood');d.territories.get(sh.originTerritoryId)!.owner='enemy';processTradeBoundary(d);
    assert.strictEqual(sh.phase,'blocked');assert.strictEqual(total(d,'wood'),before);assert.strictEqual(occupiedAttention(d,'me'),0);
  });
  test('Phase I review: loss of receiving node during transit blocks without waiting for arrival',()=>{
    const d=respond(pending());advance(d,120000);const sh=[...d.tradeShipments.values()].find(x=>x.sender==='me')!;
    d.territories.get(sh.destinationTerritoryId)!.owner='enemy';processTradeBoundary(d);assert.strictEqual(sh.phase,'blocked');assert.strictEqual(total(d,'wood'),300);
  });
  test('Phase I review: blocked transit timing cannot keep earning physical progress',()=>{
    const d=respond(pending());advance(d,120000);const sh=[...d.tradeShipments.values()].find(x=>x.sender==='me')!;
    d.territories.get(sh.route[0]!)!.neighboring=[];processTradeBoundary(d);
    const before=new FactualSupport(d).committed.find(e=>e.id===sh.id)!.timing;
    assert.strictEqual(before.remainingTicks,sh.legDurationTicks);
    d.worldTick+=20;processTradeBoundary(d);
    assert.deepStrictEqual(new FactualSupport(d).committed.find(e=>e.id===sh.id)!.timing,before);
  });
  test('Phase I review: hydration rejects unloading before exact route arrival',()=>{
    const d=respond(pending()),sh=[...d.tradeShipments.values()][0]!;
    sh.phase='unloading';sh.timer=startProactiveTimer(d,sh.recipient,'corrupt-unload',5000,5000,6);
    assert.throws(()=>reload(d));
  });
  test('Phase I review: ACCEPT rejects resource reservation with wrong authoritative subject',()=>{
    const d=pending(),c=[...d.operationClaims.values()][0]!;c.subjectId='wrong-bank';assert.ok(acceptanceProblem(d,proposal(d)));
  });
  test('Phase I review: failure on second cargo insertion rolls back both banks, claims, Attention, timers and history',()=>{
    const d=pending(),before=encodePersistable(d),set=Map.prototype.set;let cargoWrites=0;
    Map.prototype.set=function(key,value){if(typeof key==='string'&&key.startsWith('shipment:v1:')&&++cargoWrites===2)throw new Error('Injected second cargo failure');return set.call(this,key,value);};
    try{assert.throws(()=>runStateTransaction(d,draft=>settleTradeProposal(draft,proposal(draft).id,'accepted')));}finally{Map.prototype.set=set;}
    assert.strictEqual(cargoWrites,2);assert.deepStrictEqual(encodePersistable(d),before);
  });
  test('Phase I review: committed incoming cargo covers exchange need without becoming spendable stock',()=>{
    const s=world();s.playerFactionId=null;s.levelAnchorTerritoryIds=[];for(const id of ['home','target'])s.territoryInfrastructure.get(id)!.farmCompletedAtTick=null;
    s.factions.get('me')!.resources={gold:10000,food:100,wood:0,iron:100,stone:100};s.factions.get('enemy')!.resources={gold:0,food:100,wood:10000,iron:100,stone:100};
    const need=tradeDemand(s,'me').wood;assert.ok(need>0);const p=plan(s,'me','enemy',{gold:50} as any,{wood:need} as any),d=respond(pending(s,p));
    assert.strictEqual(availableResource(d,'me','wood'),0);assert.ok(!observableTradeCounterparties(d,'me').includes('enemy'));
    assert.strictEqual(tradeCandidates(d,'me','enemy').length,0);
    const control=cloneGameState(d);control.tradeShipments.clear();
    const actual=new StrategicEvaluators(new FactualSupport(d)).resourceValue('me','wood',50,'gain').facts.marginalUtility;
    const uncommitted=new StrategicEvaluators(new FactualSupport(control)).resourceValue('me','wood',50,'gain').facts.marginalUtility;
    assert.ok(actual<uncommitted);
  });
  test('Phase I review: proactive generation excludes currently unroutable bilateral delivery',()=>{
    const s=world();for(const id of ['home','target'])s.territoryInfrastructure.get(id)!.farmCompletedAtTick=null;
    s.factions.get('me')!.resources={gold:10000,food:100,wood:0,iron:100,stone:100};s.factions.get('enemy')!.resources={gold:0,food:100,wood:10000,iron:100,stone:100};
    assert.ok(tradeCandidates(s,'me','enemy').length);s.territories.get('target')!.neighboring=[];
    assert.strictEqual(tradeCandidates(s,'me','enemy').length,0);assert.strictEqual(tradePlanProblem(s,plan(s,'me','enemy',{gold:1} as any,{wood:1} as any)),null);
  });
  test('Phase I review: recipient BUILD and event spending remain legal while incoming terms are pending',()=>{
    const s=world();s.territoryInfrastructure.get('safe')!.farmCompletedAtTick=null;s.factions.get('spectator')!.resources.gold=10000;
    const d=pending(s,plan(s,'me','spectator',{wood:10},{wood:70} as any));
    const before=d.factions.get('spectator')!.resources.wood;startConstruction(d,{factionId:'spectator',territoryId:'safe',projectType:'FARM'});
    assert.ok(d.factions.get('spectator')!.resources.wood<before);assert.strictEqual(reservedResource(d,'spectator','wood'),0);
    const input=toWorldStepInput(d),events=new ConsequenceApplier(input.territories,input.factions,input.armies,input.reservedResources);
    assert.ok(events.canAfford({wood:20},'spectator'));const eventBefore=events.factions.get('spectator')!.resources.wood;events.payCost({wood:20},'spectator');
    assert.strictEqual(events.factions.get('spectator')!.resources.wood,eventBefore-20);
  });
  test('Phase I review: losing receiving node before unload cannot credit new owner',()=>{
    const d=respond(pending()),id=[...d.tradeShipments.values()].find(x=>x.sender==='me')!.id;
    for(let i=0;i<32&&d.tradeShipments.get(id)!.phase!=='unloading';i++)physical(d,1);
    const sh=d.tradeShipments.get(id)!;assert.strictEqual(sh.phase,'unloading');const before=d.factions.get('enemy')!.resources.wood;
    d.territories.get(sh.destinationTerritoryId)!.owner='enemy';processTradeBoundary(d);assert.strictEqual(sh.phase,'blocked');
    assert.strictEqual(d.factions.get('enemy')!.resources.wood,before);assert.strictEqual(total(d,'wood'),300);
  });
  test('Phase I review: dispatch conquest after departure cannot erase a valid outgoing route',()=>{
    const d=respond(pending());advance(d,120000);const sh=[...d.tradeShipments.values()].find(x=>x.sender==='me')!;
    d.territories.get(sh.originTerritoryId)!.owner='enemy';processTradeBoundary(d);assert.strictEqual(sh.phase,'transit');assert.strictEqual(total(d,'wood'),300);
  });
  test('Phase I review: pending endpoint loss invalidates without transfer or substitute node',()=>{
    const d=pending(),p=proposal(d),before=total(d,'wood');d.territories.get(p.plan.delivery!.recipientTerritoryId)!.owner='enemy';processTradeBoundary(d);
    assert.strictEqual(p.status,'invalidated');assert.strictEqual(reservedResource(d,'me','wood'),0);assert.strictEqual(total(d,'wood'),before);assert.strictEqual(d.tradeShipments.size,0);
  });
  test('Phase I review: all cargo phases including unload reload preserve future progression',()=>{
    const d=respond(pending()),id=[...d.tradeShipments.values()][0]!.id;
    for(let i=0;i<32&&d.tradeShipments.get(id)!.phase!=='unloading';i++)physical(d,1);
    assert.strictEqual(d.tradeShipments.get(id)!.phase,'unloading');const e=reload(d);physical(d,10);physical(e,10);assert.deepStrictEqual(encodePersistable(e),encodePersistable(d));
  });
  test('Phase I review: counteroffer replay cannot spawn a second replacement or duplicate release',()=>{
    const d=pending(),id=proposal(d).id,p=plan(d,'spectator','me',{food:20} as any,{wood:10} as any),o=new Orchestrator(d);
    assert.ok(o.execute(cmdReq('COUNTEROFFER_TRADE','player',{proposalId:id,plan:p})).success);const before=encodePersistable(o.getState());
    assert.ok(!o.execute(cmdReq('COUNTEROFFER_TRADE','player',{proposalId:id,plan:p})).success);assert.deepStrictEqual(encodePersistable(o.getState()),before);
    assert.deepStrictEqual(encodePersistable(reload(o.getState())),before);
  });
  test('Phase I review: six independent quantities share one source bank without a broad lock',()=>{
    let d=world();d.strategicAttention.capacity=6*attentionCost(plan(d));for(let i=0;i<6;i++){const p=plan(d,'me','spectator',i%2?{gold:10+i} as any:{wood:10+i},{food:1+i});d=begin(d,p);advance(d,d.aiClock.nowMs+60000);}
    assert.strictEqual(liveTradeProposals(d).length,6);assert.strictEqual(reservedResource(d,'me','wood'),36);assert.strictEqual(reservedResource(d,'me','gold'),39);
    const before=encodePersistable(d),o=new Orchestrator(d);assert.ok(!o.execute(cmdReq('START_AI_OPERATION','ai',{factionId:'me',plan:plan(d,'me','spectator',{wood:1},{food:1})})).success);
    assert.deepStrictEqual(encodePersistable(o.getState()),before);assert.deepStrictEqual(reload(d).operationClaims,d.operationClaims);
  });
  test('Phase I review: Trade and pending Peace coexist without terminating either',()=>{
    const s=world(),o=new Orchestrator(s);assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{factionId:'me',plan:makeConcretePlan({action:'OFFER_PEACE',factionId:'me',counterpartyId:'spectator'})})).success);
    const d=cloneGameState(o.getState());advance(d,60000);const e=begin(d);advance(e,120000);
    assert.ok([...e.peaceProposals.values()].some(p=>p.status==='pending'));assert.strictEqual(proposal(e).status,'pending');assert.strictEqual(relationshipBetween(e,'me','spectator'),'WAR');
  });
  test('Phase I review: directed route missing only reverse path rejects bilateral ACCEPT',()=>{
    const d=pending();d.territories.get('safe')!.neighboring=[];assert.ok(tradeRoute(d,'home','safe'));assert.strictEqual(tradeRoute(d,'safe','home'),null);
    assert.ok(acceptanceProblem(d,proposal(d)));assert.strictEqual(d.tradeShipments.size,0);assert.strictEqual(reservedResource(d,'me','wood'),70);
  });
  test('Phase I review: duplicate response commands do not duplicate custody or lifecycle history',()=>{
    const d=respond(pending()),before=encodePersistable(d),e=respond(d);assert.deepStrictEqual(encodePersistable(e),before);physical(e);
    const history=e.eventHistory.map(x=>x.id);assert.strictEqual(new Set(history).size,history.length);assert.strictEqual(total(e,'wood'),300);
  });
  test('Phase I review: independent counterparties may hold simultaneous exact proposals',()=>{
    const s=world();online(s);let d=pending(s,plan(s,'me','spectator',{wood:10},{food:1}));
    d=begin(d,plan(d,'me','enemy',{gold:10} as any,{iron:1} as any));advance(d,4000);
    assert.strictEqual(liveTradeProposals(d).length,2);assert.ok(liveTradeProposals(d).every(p=>p.status==='pending'));assert.strictEqual(reservedResource(d,'me','wood'),10);assert.strictEqual(reservedResource(d,'me','gold'),10);
  });
}
