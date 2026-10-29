import type { AICommitment } from './index';
import type { OperationAttention } from './AIStrategy';

/** Domain timing/state lives on the linked army/project/invasion, never here. */
export interface AIOperation extends AICommitment {
  sourceContextId?: string;
  /** Non-proactive provenance never earns source relief or proactive spacing. */
  responseContextId?: string;
  /** Exact opposing faction at hostile initiation, unaffected by later conquest. */
  hostileCounterpartyId?: string;
  initiationTimer?: import('./AIPressure').ProactiveTimer;
  attention: OperationAttention;
  phase: 'selected' | 'physical' | 'recovery' | 'terminal';
  objective: 'valid' | 'invalid';
  createdAtTick: number;
  claimIds: string[];
  links: { armyId?: string; constructionId?: string; invasionId?: string; peaceProposalId?: string; tradeProposalId?:string };
  terminal: { outcome: 'completed' | 'failed' | 'interrupted'; reason: string; atTick: number } | null;
  /** Archived legacy reasoning may lack an exact plan. It cannot start a physical operation. */
  legacy?: boolean;
  /** Schema-18 BUILD could already have applied terminal feedback at start. */
  legacyFeedbackApplied?: boolean;
  /** Preserve the original audit identity when faction-local legacy IDs collided. */
  legacyCommitmentId?: string;
}
export interface AIOperationClaim {
  id: string;
  operationId: string;
  kind: 'force' | 'construction_site' | 'engagement_target' | 'invasion_target' | 'banked_troops' | 'local_troops' | 'garrison' | 'resource';
  quantity?: number;
  resourceType?: import('./index').ResourceType;
  subjectId: string;
  /** Existing pending-attack limit is faction-local, not ownership of enemy land. */
  scopeFactionId?: string;
}
