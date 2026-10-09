import type { GameState } from '../../types/GameState';
import { BALANCE } from '../../constants/balance';
import { WORLD_TICK_DURATION_MS } from '../../world/realtimeClock';
import { RECRUITMENT_TUNING as T } from '../../constants/recruitment';
import type { FixedPointAccrual } from '../../world/timeToTick';
import { projectWorldAccrual } from '../../world/temporalBoundaries';
import { derivePresenceSegments } from '../../world/presenceLeases';
import { cityIdFor } from '../cities/city';
import { persistTerritoryFoodAccrual } from '../economy/accrual';
export const RECRUITMENT_WORK_PER_TICK = BigInt(BALANCE.temporal.microticksPerSimulationTick)*BigInt(WORLD_TICK_DURATION_MS);
export function simulationWork(clock:FixedPointAccrual):bigint {
  return BigInt(clock.wholeTicks)*RECRUITMENT_WORK_PER_TICK+BigInt(clock.subTickMicroticks)*BigInt(WORLD_TICK_DURATION_MS)+BigInt(clock.accrualDivisionRemainder);
}
export function recruitmentPoolId(territoryId:string):string {return `local-pool:v1:${JSON.stringify(territoryId)}`;}
export function eligibleRecruitmentOwner(state:GameState,owner:string|null):owner is string {
  return owner!==null && owner!==state.playerFactionId && state.factions.has(owner);
}
export interface RecruitmentMetrics {territoriesProcessed:number;troopsGenerated:number;foodConsumed:number}
/** Local Food contract: existing physically local uncollected yield. No bank
 * access/auto-collect/logistics. Production must be settled at its own boundary
 * before subsequent work; newly produced Food never funds earlier starved work. */
export function progressRecruitment(state:GameState,throughWork=BigInt(state.worldTick)*RECRUITMENT_WORK_PER_TICK):RecruitmentMetrics {
  const metrics:RecruitmentMetrics={territoriesProcessed:0,troopsGenerated:0,foodConsumed:0};
  for(const t of [...state.territories.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)) {
    if(!eligibleRecruitmentOwner(state,t.owner))continue;
    let pool=state.territoryRecruitment.get(t.id);
    if(!pool) {
      pool={territoryId:t.id,factionId:t.owner,troops:0,fractionalWork:'0',accruedThroughWork:throughWork.toString()};
      state.territoryRecruitment.set(t.id,pool);
    }
    if(pool.factionId!==t.owner)throw new Error('Recruitment ownership must settle at the ownership boundary');
    const before=BigInt(pool.accruedThroughWork);
    if(throughWork<=before)continue;
    metrics.territoriesProcessed++;
    const elapsed=throughWork-before;pool.accruedThroughWork=throughWork.toString();
    const food=state.territoryEconomy.get(t.id)?.uncollected.food??0;
    const affordable=Math.floor(food/T.foodPerTroop);
    if(affordable===0)continue; // Preserve earned fraction, never accrue starving backlog.
    // City records are authored by CITY onComplete; buildings[] contains
    // fortification metadata and is not the completion authority for the city.
    const city=state.cities.get(cityIdFor(t.id));
    const multiplier=city?.factionId===t.owner?T.completedCityRateMultiplier:1;
    const work=BigInt(pool.fractionalWork)+elapsed*BigInt(T.troopsPerSimulationTick*multiplier);
    const generated=Math.min(affordable,Number(work/RECRUITMENT_WORK_PER_TICK));
    if(!Number.isSafeInteger(generated)||!Number.isSafeInteger(pool.troops+generated))throw new Error('Local recruitment exceeds safe troop storage');
    pool.troops+=generated;
    pool.fractionalWork=generated===affordable?'0':(work%RECRUITMENT_WORK_PER_TICK).toString();
    const consumed=generated*T.foodPerTroop;
    state.territoryEconomy.get(t.id)!.uncollected.food-=consumed;
    metrics.troopsGenerated+=generated;metrics.foodConsumed+=consumed;
  }
  return metrics;
}
/** No fabrication of pre-migration work, Food or troops. */
export function initializeRecruitment(state:GameState,work=BigInt(state.worldTick)*RECRUITMENT_WORK_PER_TICK):void {
  state.territoryRecruitment=new Map();
  for(const t of state.territories.values())if(eligibleRecruitmentOwner(state,t.owner))
    state.territoryRecruitment.set(t.id,{territoryId:t.id,factionId:t.owner,troops:0,fractionalWork:'0',accruedThroughWork:work.toString()});
}
/** Earn sub-tick work only through the already-authoritative receipt clock.
 * Explicit tick simulation settles the same numerator at physical boundaries. */
export function progressRecruitmentThroughReceipt(state:GameState,atMs:number):RecruitmentMetrics|undefined {
  const anchor=state.aiClock.worldAnchor;
  if(!anchor||state.lastAccrualAtMs===null)return;
  atMs=Math.min(atMs,state.lastAccrualAtMs); // Never recruit against unearned future wall time.
  if(atMs<anchor.lastAccrualAtMs)return;
  const projected=projectWorldAccrual(anchor,derivePresenceSegments(state.gameplaySessionLeases,anchor.lastAccrualAtMs,atMs));
  return progressRecruitment(state,simulationWork({wholeTicks:projected.accruedTargetWorldTick,subTickMicroticks:projected.subTickMicroticks,accrualDivisionRemainder:projected.accrualDivisionRemainder}));
}
/** At the production boundary, old local Food pays old interval first. */
export function settleRecruitmentWorldBoundary(state:GameState):RecruitmentMetrics {
  const metrics=progressRecruitment(state);
  for(const t of state.territories.values())if(eligibleRecruitmentOwner(state,t.owner))persistTerritoryFoodAccrual(state,t.id);
  return metrics;
}
