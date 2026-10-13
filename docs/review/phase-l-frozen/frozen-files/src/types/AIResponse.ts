import type { AIConcretePlan } from './AIConcretePlan';
import type { ProactiveTimer } from './AIPressure';

export const NON_PROACTIVE_LANES = ['REACTIVE_EMERGENCY','REQUIRED_RESPONSE','OPERATION_RECOVERY'] as const;
export type NonProactiveLane = typeof NON_PROACTIVE_LANES[number];
export type ResponseSubject =
  | {kind:'peace'; id:string}
  | {kind:'trade'; id:string}
  | {kind:'hostile_force'; id:string; territoryId:string; hostileCommitmentId?:string}
  | {kind:'invasion'; id:string; territoryId:string}
  | {kind:'operation'; id:string}
  | {kind:'cargo'; id:string};
/** References and lifecycle only. Facts are always re-read from the transaction.
 * Required proposal windows remain domain-owned, not copied into this record. */
export interface AIResponseContext {
  id:string; factionId:string; lane:NonProactiveLane; subject:ResponseSubject;
  severity:'CRITICAL'|'URGENT'|'REQUIRED'|'RECOVERY'; irreversibility:number;
  createdAtMs:number; revision:number; materialSignature:string;
  status:'queued'|'thinking'|'blocked'|'resolved'|'invalidated';
  timer:ProactiveTimer|null;
  outcome:'NO_ADDITIONAL_INTERVENTION'|'INTERVENTION_STARTED'|'RESPONSE_SETTLED'|'CONTEXT_INVALIDATED'|null;
  selectedPlan:AIConcretePlan|null; operationId:string|null;
  /** Complete candidate AND prerequisites, OR across alternatives. */
  blockers:AIConcretePlan[];
}
export interface AIResponseScheduler {
  primaryByFaction:Map<string,string>;
  lastBoundaryByFaction:Map<string,number>;
  observedWorldTick:number|null;
  /** Next material arrival threshold, not a per-tick observer/poll. */
  nextThreatBoundaryTick?:number|null;
  dirty:boolean;
}
export interface ResponseMetrics {
  observations:number; contextsCreated:number; materialRearms:number; preemptions:number;
  deliberations:number; requiredResponses:number; candidatePlans:number; interventions:number;
  noIntervention:number; invalidations:number;
}
export const emptyResponseMetrics=():ResponseMetrics=>({observations:0,contextsCreated:0,materialRearms:0,preemptions:0,deliberations:0,requiredResponses:0,candidatePlans:0,interventions:0,noIntervention:0,invalidations:0});
