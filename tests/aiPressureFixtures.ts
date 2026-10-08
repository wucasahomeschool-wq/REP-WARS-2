import assert from 'assert';
import type { GameState } from '../src/types/GameState';
import { observeSources, sourceConcretePlans } from '../src/engine/strategicPressure';
import { prepareProactiveDecision, accrueProactiveClocks } from '../src/engine/proactiveCognition';
import { STRATEGIC_PRESSURE_TUNING } from '../src/constants/strategicPressure';
/** Explicit test authoring: earn a real source's deliberation before testing
 * transaction-boundary cognition. Never manufactures a world capability. */
export function primeSourceDecision(state:GameState,fid:string):void {
  observeSources(state,fid);
  const s=[...state.aiPressure.values()].filter(s=>s.factionId===fid&&!s.blocked&&sourceConcretePlans(state,s).some(p=>p.action!=='WAIT')).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)[0];
  assert.ok(s,`Fixture needs a genuine actionable source for ${fid}`);
  s.pressure=STRATEGIC_PRESSURE_TUNING.ready;
  prepareProactiveDecision(state,fid);
  const timer=state.aiDecisionOpportunities.get(fid)!.primary!.timer!;
  accrueProactiveClocks(state,state.aiClock.nowMs+timer.offlineDurationMs,'OFFLINE');
}
