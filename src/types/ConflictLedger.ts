import type {Resources} from './index';
export type ConflictFactKind='ATTACK_COMMITTED'|'HOSTILE_ARRIVAL'|'BATTLE'|'TERRITORY_TRANSFER'|'ATTACK_TERMINAL'|'RETREAT'|'PEACE_ACTIVATED'|'WAR_RETURN';
/** Exact domain consequences. No score, subjective stance or future outcome. */
export interface ConflictFact {
  kind:ConflictFactKind;actor:string;target:string;territoryId?:string;
  troopLosses?:readonly[number,number];siegeLosses?:readonly[number,number];
  resourcesLost?:Resources;structuresLost?:number;fortificationLevelsLost?:number;projectsLost?:number;poolTroopsLost?:number;
  outcome?:'attacker'|'defender'|'draw'|'completed'|'failed'|'interrupted';
  /** Exact resolved-domain replay identity, never a future battle prediction. */
  resultFingerprint?:string;
  casualtyBasis?:'battle_result'|'physical_settlement_excluding_virtual_defense';
}
export interface ConflictTotals {
  commitments:number;arrivals:number;battles:number;victories:number;failedAttacks:number;retreats:number;
  troopsLost:number;siegeLost:number;territoriesGained:number;territoriesLost:number;
  resourcesLost:Resources;structuresLost:number;fortificationLevelsLost:number;projectsLost:number;poolTroopsLost:number;
}
export interface ConflictMaterialDelta {
  atTick:number;atMs:number;sequence:number;troopLosses:[number,number];siegeLosses:[number,number];territoryGains:[number,number];
  resourcesLost:[Resources,Resources];structuresLost:[number,number];fortificationLevelsLost:[number,number];projectsLost:[number,number];poolTroopsLost:[number,number];
}
export interface ConflictEpisode {
  index:number;startedAtTick:number;startedAtMs:number;endedAtTick:number|null;endedAtMs:number|null;
  closure:'PEACE'|null;totals:[ConflictTotals,ConflictTotals];
  /** Bounded material-event window; operational activity never displaces it. */
  recent:ConflictMaterialDelta[];materialSequence:number;
}
export interface ConflictPairLedger {id:string;factions:[string,string];currentEpisode:number;episodes:Map<number,ConflictEpisode>}
/** Receipt is replay support, never reconstructed into a second factual state. */
export interface ConflictReceipt {pairId:string;episode:number;signature:string;atTick:number;atMs:number}
