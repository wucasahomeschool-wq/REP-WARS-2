import assert from 'node:assert/strict';
import { createDependencyBudget } from '../src/server/dependencyBudget';

type Report = (name: string, fn: () => Promise<void>) => Promise<void>;
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes,no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const defaults = { maxPending: 1, timeoutMs: 100 };
export async function runDependencyBudgetTests(report: Report): Promise<void> {
  await report('dependency budget: invalid operational limits fail at construction', async () => {
    for (const key of ['maxPending','timeoutMs'] as const) for (const value of [0,-1,0.5,NaN,Infinity,null,'2',Number.MAX_SAFE_INTEGER+1]) {
      assert.throws(() => createDependencyBudget({[key]:value as unknown as number},defaults),new RegExp(key));
    }
    assert.throws(() => createDependencyBudget({timeoutMs:2_147_483_648},defaults),/timeoutMs/);
  });
  await report('dependency budget: sync and async completion release slots', async () => {
    const run=createDependencyBudget({},defaults);
    assert.deepEqual(await run(()=> 'one'),{ok:true,value:'one'});
    assert.deepEqual(await run(async()=> 'two'),{ok:true,value:'two'});
    assert.deepEqual(await run(()=> {throw new Error('secret');}),{ok:false});
    assert.deepEqual(await run(async()=> {throw new Error('secret');}),{ok:false});
    assert.deepEqual(await run(()=> 'three'),{ok:true,value:'three'});
  });
  await report('dependency budget: occupied slots reject without invoking more work', async () => {
    const run=createDependencyBudget({},defaults), held=deferred<string>(); let calls=0;
    const first=run(()=>{calls++;return held.promise;});
    assert.deepEqual(await run(()=>{calls++;return 'unexpected';}),{ok:false});
    assert.equal(calls,1);held.resolve('done');assert.deepEqual(await first,{ok:true,value:'done'});
    assert.deepEqual(await run(()=> 'next'),{ok:true,value:'next'});
  });
  await report('dependency budget: timed-out work stays counted until actual completion', async () => {
    const run=createDependencyBudget({timeoutMs:20},defaults), held=deferred<string>(); let aborted=0;
    const first=run(signal=>{signal.addEventListener('abort',()=>aborted++);return held.promise;});
    assert.deepEqual(await first,{ok:false});assert.equal(aborted,1);
    for(let i=0;i<10;i++)assert.deepEqual(await run(()=>assert.fail('orphan bypassed capacity')),{ok:false});
    held.resolve('late-success');await flush();
    assert.deepEqual(await first,{ok:false});assert.deepEqual(await run(()=> 'recovered'),{ok:true,value:'recovered'});
  });
  await report('dependency budget: late rejection is consumed and capacity recovers', async () => {
    const run=createDependencyBudget({timeoutMs:20},defaults), held=deferred<string>();
    assert.deepEqual(await run(()=>held.promise),{ok:false});held.reject(new Error('private late error'));await flush();
    assert.deepEqual(await run(()=>true),{ok:true,value:true});
  });
  await report('dependency budget: cooperative cancellation settles safely', async () => {
    const run=createDependencyBudget({timeoutMs:20},defaults);let aborted=0;
    const result=await run(signal=>new Promise<string>((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted++;reject(new Error('aborted'));})));
    assert.deepEqual(result,{ok:false});await flush();assert.equal(aborted,1);
    assert.deepEqual(await run(()=>true),{ok:true,value:true});
  });
  await report('dependency budget: provider error objects are never inspected', async () => {
    let traps=0;
    const error=new Proxy({}, {get(){traps++;throw new Error('get');},getPrototypeOf(){traps++;throw new Error('prototype');},ownKeys(){traps++;throw new Error('keys');}});
    const run=createDependencyBudget({},defaults);
    assert.deepEqual(await run(()=>{throw error;}),{ok:false});assert.equal(traps,0);
  });
  await report('dependency budget: event-loop starvation cannot authorize an elapsed result', async () => {
    const run=createDependencyBudget({timeoutMs:1},defaults);let aborted=0;
    const result=await run(signal=>{
      signal.addEventListener('abort',()=>aborted++);
      const until=performance.now()+10;while(performance.now()<until) { /* bounded deliberate synchronous stall */ }
      return 'late identity';
    });
    assert.deepEqual(result,{ok:false});assert.equal(aborted,1);
  });
}
