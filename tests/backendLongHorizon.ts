import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runLongSimulation} from '../src/simulation/longRunHarness';
import {SAMPLE_MAP,WARLORD_SPECS} from '../src/simulation/SampleMap';
import {checkGameStateInvariants} from '../src/state';
import {snapshotGameState} from '../src/persistence/snapshot';

/** Actual engine and legacy AI-only fixture, not a model of a human calendar day.
 * Existing lease tests own online/offline accounting. No balance claims here. */
export function registerBackendLongHorizonTests({test}:{test:(name:string,fn:()=>void)=>void}) {
  for(const seed of [11,29])test(`long horizon: 1440-tick canonical replay seed ${seed}`,()=>{
    let prior:string|undefined;
    for(let replay=0;replay<2;replay++) {
      const start=performance.now();
      const r=runLongSimulation({seed,ticks:1440,mapSpecs:SAMPLE_MAP,warlordSpecs:WARLORD_SPECS});
      assert.equal(r.ticksAdvanced,1440);assert.equal(r.advanceFailures,0);assert.equal(r.engineErrors,0);assert.equal(r.decisionsForEliminatedFactions,0);
      assert.deepEqual(checkGameStateInvariants(r.finalState),[]);
      const canonical=JSON.stringify(snapshotGameState(r.finalState));
      if(prior!==undefined)assert.equal(canonical,prior);prior=canonical;
      console.log(JSON.stringify({scenario:'legacy-ai-only',seed,replay,ticks:1440,elapsedMs:Math.round(performance.now()-start),
        sha256:createHash('sha256').update(canonical).digest('hex'),bytes:Buffer.byteLength(canonical),
        battles:r.battlesResolved,failedAttacks:r.attacksFailed,operations:r.finalState.operations.size}));
    }
  });
}
