import type {GameState} from '../types/GameState';
import {ErrorCode,OrchestrationError} from '../orchestration/errors';
import {getDefaultWorldCatalog,isLegacyDefinitionWorldId,assertWorldIdentity} from '../worldDefinition';
import {createGameStateFromWorld} from '../worldDefinition/instantiate';
import {carryPlayerScopedFitness} from './worldTransition';
import {workoutStartBlockReason} from './workoutStart';
import {validateGameplaySessionLease} from '../world/presenceLeases';
import {overwriteGameState} from '../state/cloneGameState';

/** A fresh attempt of the exact same authored definition. The external workout
 * history store is untouched; permanent canonical fitness/paid identities survive. */
export function restartDefeatedWorld(s:GameState):void {
  if(s.levelDefeat.status!=='defeated'||!s.playerFactionId||[...s.territories.values()].some(t=>t.owner===s.playerFactionId))
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED,'Only a defeated world attempt can restart');
  const block=workoutStartBlockReason(s);if(block)throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED,block);
  if(!s.definitionWorldId||isLegacyDefinitionWorldId(s.definitionWorldId))throw new OrchestrationError(ErrorCode.INVALID_GAME_STATE,'Restart requires an authored world');
  const loaded=getDefaultWorldCatalog().load(s.definitionWorldId);
  if(!loaded.ok)throw new OrchestrationError(ErrorCode.INVALID_GAME_STATE,'Restart world definition unavailable');
  assertWorldIdentity(s,loaded.definition);
  const next=createGameStateFromWorld(loaded.definition,{seed:s.worldSeed,playerFactionId:s.playerFactionId});
  next.nextArmySequence=s.nextArmySequence;
  next.completedWorldIds=[...s.completedWorldIds];
  next.gameplaySessionLeases=s.gameplaySessionLeases.map(validateGameplaySessionLease);
  carryPlayerScopedFitness(s.playerFitness,next.playerFitness);
  next.playerRewards.appliedRewards=s.playerRewards.appliedRewards.map(r=>({...r,result:structuredClone(r.result)}));
  overwriteGameState(s,next);
}
