import type { ConstructionProjectType } from './GameState';
import type { ResourceType } from './index';
/** Concrete predicates, not new AI actions or evaluators. */
export type GoalObjective =
  | {kind:'CONTROL_TERRITORY';territoryId:string}
  | {kind:'CONTROL_REGION';regionId:string}
  | {kind:'ELIMINATE_FACTION';factionId:string}
  | {kind:'PEACE';factionId:string}
  | {kind:'DEVELOPMENT';territoryId:string;projectType:ConstructionProjectType;level?:number}
  | {kind:'RESOURCE_HOLDING';resource:ResourceType;quantity:number}
  | {kind:'FORCE_POSITION';armyId:string;territoryId:string};
export interface GoalLifecycle {
  ownerId:string; objective:GoalObjective|null;
  status:'ACTIVE'|'COMPLETED'|'INVALIDATED';visibility:'PRIVATE';
  /** null only for legacy creation tick that was never persisted; createdTurn remains known. */
  createdAtTick:number|null;resolvedAtTick:number|null;reason:string|null;
}
/** Receipt proves an event was incorporated once. Not an Opinion/world authority
 * and never rebuilt from Memory/history. No conflict trajectory is recorded. */
export interface OpinionEventReceipt {
  id:string;observer:string;target:string;kind:string;delta:number;atTick:number;
}
export interface GoalProgressAssessment {
  goalId:string;direction:'ADVANCE'|'HARM'|'NEUTRAL';
  realization:'IMMEDIATE'|'DELAYED'|'CONTINGENT'|'ALREADY_COMMITTED';
  magnitude:number;explanation:string;
}
