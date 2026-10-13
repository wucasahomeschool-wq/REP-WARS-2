import type { ProactiveTimer } from './AIPressure';

export type AuthoritativeRelationship = 'WAR' | 'PENDING_HOSTILITIES_CLEARANCE' | 'PEACE';
export type PeaceProposalStatus = 'initiating' | 'pending' | 'accepted' | 'declined' | 'expired' | 'withdrawn' | 'invalidated';
export interface PeaceProposal {
  id: string;
  pairId: string;
  proposer: string;
  recipient: string;
  operationId: string;
  status: PeaceProposalStatus;
  createdAtMs: number;
  pendingAtMs: number | null;
  resolvedAtMs: number | null;
  responseTimer: ProactiveTimer | null;
}
/** Only non-WAR exceptions are stored. Sentiment is not relationship authority. */
export interface PeaceRelationship {
  pairId: string;
  factions: [string, string];
  state: Exclude<AuthoritativeRelationship, 'WAR'>;
  proposalId: string | null;
  acceptedAtMs: number;
  finalizationTimer: ProactiveTimer | null;
  activatedAtMs: number | null;
  expiresAtMs: number | null;
  /** Only imported explicitly signed historical treaties use the authored turn clock. */
  legacyExpiresTurn?: number | null;
}
export interface PeaceMetrics {
  timerUpdates: number; requiredDeliberations: number; responses: number;
  clearanceChecks: number; relationshipTransitions: number; historyRecords: number;
}
export const emptyPeaceMetrics = (): PeaceMetrics => ({timerUpdates:0,requiredDeliberations:0,responses:0,clearanceChecks:0,relationshipTransitions:0,historyRecords:0});
