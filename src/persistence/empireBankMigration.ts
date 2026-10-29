import {addResourcesChecked} from '../gameplay/economy/production';
import {tradeStateProblems} from '../state/tradeInvariants';
import {bundleEntries} from '../gameplay/trade/resources';
import type {GameState} from '../types/GameState';
import {creditTroopBank} from '../gameplay/military/troopBank';
import {activeOperations,settleOperation} from '../engine/operations';
import {persistAllTerritoryAccrual} from '../gameplay/economy/accrual';

/** Schema 30 -> 31. No simulation advance, historical recruitment or reward minting.
 * Pending local allocations are cancelled before moving existing reserves into
 * the faction bank. Exact old plans remain in terminal history and never retarget. */
export function migrateEmpireBanks(s:GameState):void {
  // Validate old custody before treating it as money. Each source manifest was
  // debited at old ACCEPT, so migration credits only the agreed receiving bank.
  const tradeProblems=tradeStateProblems(s);if(tradeProblems.length)throw new Error(tradeProblems[0]);
  for(const sh of s.tradeShipments.values())if(sh.phase!=='delivered'){
    const recipient=s.factions.get(sh.recipient);if(!recipient)throw new Error('Cargo recipient missing');
    for(const [r,n] of bundleEntries(sh.cargo))if(!Number.isSafeInteger(recipient.resources[r]+n))throw new Error('Cargo migration bank overflow');
    for(const [r,n] of bundleEntries(sh.cargo))recipient.resources[r]+=n;
    sh.phase='delivered';sh.deliveredAtMs=s.aiClock.nowMs;sh.legIndex=sh.route.length-1;
    sh.timer=null;sh.legStartedAtTick=null;sh.legDurationTicks=null;sh.blockedReason=null;sh.blockedAtTick=null;
    s.tradeShipments.set(sh.id,sh);
  }
  s.empireFoodBaselinePerCycle=0;
  s.completedWorldIds=[]; // No fictional trophy history from contained-world geometry.
  for(const f of s.factions.values()){f.bankedTroops=0;f.knownTerritories=[...s.territories.keys()];f.knownFactions=[...s.allFactionIds];}
  for(const op of activeOperations(s))if(op.action==='REINFORCE')
    if(!settleOperation(s,op.id,'failed','Local reserve migrated to empire troop bank'))throw new Error('Cannot migrate active local allocation');
  for(const pool of s.territoryRecruitment.values()) {
    if(!Number.isSafeInteger(pool.troops)||pool.troops<0)throw new Error('Invalid legacy troop reserve');
    creditTroopBank(s,pool.factionId,pool.troops);pool.troops=0;
  }
  // Schema <=30 stored genuinely unbanked yield. Credit that stock exactly once
  // while retaining it as the nonspendable Golden Yield eligibility basis. The
  // accrual reducer then banks only production after its existing watermark.
  for (const [id, rec] of s.territoryEconomy) {
    const owner = s.territories.get(id)?.owner;
    if (owner) {
      const faction = s.factions.get(owner);
      if (!faction) throw new Error('Legacy production owner missing');
      faction.resources = addResourcesChecked(faction.resources, rec.uncollected);
    }
  }
  persistAllTerritoryAccrual(s);
}
