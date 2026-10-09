import type {GameState} from '../types/GameState';
import {refreshGoals} from './goals';
import {boundOpinion} from './opinion';
/** Schema 24 -> 25. Preserve current directed stance; never replay Memory to
 * fabricate historical Opinion. Goal IDs and grounded targets survive. Ambiguous
 * goals are explicitly invalidated, not assigned invented exact objectives. */
export function initializeCognition(s:GameState):void {
  s.opinionEvents=new Map();
  for(const f of s.factions.values())for(const r of f.diplomacy.values())r.opinion=boundOpinion(r.opinion);
  refreshGoals(s);
}
