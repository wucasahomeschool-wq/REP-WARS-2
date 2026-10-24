import assert from 'node:assert/strict';
import { request } from 'node:http';
import { inspect } from 'node:util';
import { createCommandHttpServer, CommandHttpOptions } from '../src/server/http';
import { createSessionHost } from '../src/server/session';
import { createInMemoryPersistence } from '../src/server/persistencePort';
import { InMemoryGameStateStore } from '../src/persistence/inMemoryGameStateStore';
import { createProductionHttpServer } from '../src/server/production';
import { snapshotGameState } from '../src/persistence/snapshot';

type Report = (name: string, fn: () => Promise<void>) => Promise<void>;
function deferred<T>() { let resolve!: (value: T) => void; const promise=new Promise<T>(yes=>{resolve=yes;}); return {promise,resolve}; }
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture() {
  const store=new InMemoryGameStateStore(),port=createInMemoryPersistence(store);let loads=0;
  const host=createSessionHost({...port,ensure(id){loads++;return port.ensure(id);}},{nowMs:()=>1000});
  return {store,host,loads:()=>loads};
}
async function serve(s: ReturnType<typeof fixture>, options: CommandHttpOptions, run:(send:(path:string,body?:unknown)=>Promise<{status:number;body:Record<string,unknown>;raw:string}>)=>Promise<void>) {
  const server=createCommandHttpServer(s.host,options);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const send=(path:string,body?:unknown)=>new Promise<{status:number;body:Record<string,unknown>;raw:string}>((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port:address.port,path,method:body===undefined?'GET':'POST',agent:false,
      headers:body===undefined?{}:{'Content-Type':'application/json'}},res=>{
      const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(Buffer.from(chunk)));
      res.on('end',()=>{const raw=Buffer.concat(chunks).toString('utf8');resolve({status:res.statusCode!,body:JSON.parse(raw),raw});});
    });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
  try {await run(send);} finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
}
export async function runDependencyHttpTests(report:Report):Promise<void> {
  for(const path of ['/commands','/session/open','/session/heartbeat','/session/end']) await report(`dependency HTTP: authentication timeout protects ${path} without loading a world`,async()=>{
    const s=fixture(),held=deferred<string>();let aborted=0,calls=0;
    await serve(s,{authenticationLimits:{maxPending:1,timeoutMs:20},identity:{mode:'authenticated',authenticate:(_req,signal)=>{
      calls++;signal!.addEventListener('abort',()=>aborted++);return held.promise;
    }}},async send=>{
      const response=await send(path,{commandId:'GET_GAME_STATE',requestId:'session',playerId:'victim',
        authenticationLimits:{maxPending:999999,timeoutMs:999999}});
      assert.equal(response.status,503);assert.equal(response.body.error,'AUTHENTICATION_UNAVAILABLE');
      assert.equal(calls,1);assert.equal(aborted,1);assert.equal(s.loads(),0);assert.equal(s.store.saveCount.value,0);
      const retry=await send(path,{commandId:'GET_GAME_STATE',requestId:'retry'});
      assert.equal(retry.status,503);assert.equal(calls,1);
      held.resolve('victim');await flush();assert.equal(s.loads(),0);
    });
  });
  await report('dependency HTTP: all protected routes share authentication capacity',async()=>{
    const s=fixture(),held=deferred<string>(),entered=deferred<void>();let calls=0;
    await serve(s,{authenticationLimits:{maxPending:1,timeoutMs:1000},identity:{mode:'authenticated',authenticate:()=>{calls++;entered.resolve();return held.promise;}}},async send=>{
      const first=send('/commands',{commandId:'GET_COMMAND_INDEX'});await entered.promise;
      for(const path of ['/commands','/session/open','/session/heartbeat','/session/end']) {
        const response=await send(path,{commandId:'GET_GAME_STATE',requestId:'busy'});assert.equal(response.status,503);
      }
      assert.equal(calls,1);assert.equal(s.loads(),0);assert.equal((await send('/health')).status,200);
      held.resolve('alice');assert.equal((await first).status,200);
      assert.equal((await send('/commands',{commandId:'GET_COMMAND_INDEX'})).status,200);assert.equal(calls,2);
    });
  });
  await report('dependency HTTP: timeout then retry preserves logical command receipts exactly once',async()=>{
    const s=fixture(),held=deferred<string>();let stalled=true;
    const lease=await s.host.openGameplaySession('alice','open');
    const command={commandId:'SET_PLAYER_PAUSE',requestId:'pause',gameplaySessionId:lease.sessionId,commandSequence:1,renewalSequence:1,parameters:{paused:true}};
    const load=()=>{const result=s.store.load('alice');assert.ok(result.ok);return snapshotGameState(result.state);};
    await serve(s,{authenticationLimits:{maxPending:1,timeoutMs:20},identity:{mode:'authenticated',authenticate:()=>stalled?held.promise:'alice'}},async send=>{
      const before=load(),writes=s.store.saveCount.value;
      assert.equal((await send('/commands',command)).status,503);assert.deepEqual(load(),before);assert.equal(s.store.saveCount.value,writes);
      stalled=false;held.resolve('alice');await flush();assert.deepEqual(load(),before);
      const success=await send('/commands',command);assert.equal(success.body.success,true);
      const committed=load();const replay=await send('/commands',command);assert.equal(replay.body.idempotentReplay,true);assert.deepEqual(load(),committed);
    });
  });
  await report('dependency HTTP: adapter errors stay private and cannot execute diagnostic hooks',async()=>{
    const s=fixture();let hooks=0;
    const error=Object.defineProperties({}, {message:{get(){hooks++;return 'private-token';}},stack:{get(){hooks++;return 'private-stack';}}});
    Object.assign(error,{toJSON(){hooks++;return 'private-token';},[inspect.custom](){hooks++;return 'private-token';}});
    await serve(s,{identity:{mode:'authenticated',authenticate:()=>{throw error;}}},async send=>{
      const response=await send('/commands',{commandId:'GET_GAME_STATE'});assert.equal(response.status,503);
      assert.equal(response.raw.includes('private-'),false);assert.equal(hooks,0);assert.equal(s.loads(),0);
    });
  });
  await report('dependency HTTP: one-argument adapters retain 401, 403 and successful identity behavior',async()=>{
    const s=fixture();let identity:string|null=null;
    await serve(s,{identity:{mode:'authenticated',authenticate:()=>identity}},async send=>{
      assert.equal((await send('/commands',{commandId:'GET_COMMAND_INDEX'})).status,401);
      identity='alice';assert.equal((await send('/commands',{commandId:'GET_COMMAND_INDEX',playerId:'bob'})).status,403);
      assert.equal(s.loads(),0);assert.equal((await send('/commands',{commandId:'GET_COMMAND_INDEX',playerId:'alice'})).status,200);
    });
  });
  await report('dependency HTTP: readiness timeout is bounded, retains occupied slot, and leaves health available',async()=>{
    const s=fixture(),held=deferred<boolean>();let calls=0,aborted=0;
    await serve(s,{identity:{mode:'authenticated',authenticate:()=> 'alice'},readinessLimits:{maxPending:1,timeoutMs:20},
      readiness:signal=>{calls++;signal!.addEventListener('abort',()=>aborted++);return held.promise;}},async send=>{
      const response=await send('/ready');assert.equal(response.status,503);assert.equal(response.body.ready,false);assert.equal(aborted,1);
      assert.equal((await send('/ready')).status,503);assert.equal(calls,1);assert.equal((await send('/health')).status,200);
      held.resolve(true);await flush();assert.equal((await send('/ready')).status,200);assert.equal(calls,2);assert.equal(s.loads(),0);
    });
  });
  await report('dependency HTTP: readiness saturation does not queue more dependency probes',async()=>{
    const s=fixture(),held=deferred<boolean>(),entered=deferred<void>();let calls=0;
    await serve(s,{identity:{mode:'authenticated',authenticate:()=> 'alice'},readinessLimits:{maxPending:1,timeoutMs:1000},
      readiness:()=>{calls++;entered.resolve();return held.promise;}},async send=>{
      const first=send('/ready');await entered.promise;
      assert.equal((await send('/ready')).status,503);assert.equal(calls,1);
      held.resolve(true);assert.equal((await first).status,200);
    });
  });
  await report('dependency HTTP: failed and non-boolean readiness never claim a ready server',async()=>{
    const s=fixture();let kind=0;
    await serve(s,{identity:{mode:'authenticated',authenticate:()=> 'alice'},readiness:()=>{
      if(kind===0)throw new Error('private database endpoint');return (kind===1?'yes':true) as unknown as boolean;
    }},async send=>{
      const failed=await send('/ready');assert.equal(failed.status,503);assert.equal(failed.raw.includes('private'),false);
      kind=1;assert.equal((await send('/ready')).status,503);kind=2;assert.equal((await send('/ready')).status,200);
    });
  });
  await report('dependency HTTP: malformed limits fail eagerly before opening or loading state',async()=>{
    const s=fixture();
    for(const key of ['authenticationLimits','readinessLimits'] as const) {
      assert.throws(()=>createCommandHttpServer(s.host,{[key]:{maxPending:0}}),/maxPending/);
      assert.throws(()=>createCommandHttpServer(s.host,{[key]:{timeoutMs:Infinity}}),/timeoutMs/);
    }
    assert.equal(s.loads(),0);
  });
  await report('dependency HTTP: default authentication admission bounds 64 outstanding callbacks',async()=>{
    const s=fixture(),held=deferred<string|null>();let calls=0;
    await serve(s,{identity:{mode:'authenticated',authenticate:()=>{calls++;return held.promise;}}},async send=>{
      const responses=Array.from({length:65},()=>send('/commands',{commandId:'GET_GAME_STATE'}));
      const first=await Promise.race(responses);assert.equal(first.status,503);assert.equal(calls,64);assert.equal(s.loads(),0);
      held.resolve(null);const all=await Promise.all(responses);
      assert.equal(all.filter(r=>r.status===401).length,64);assert.equal(all.filter(r=>r.status===503).length,1);
    });
  });
  await report('dependency HTTP: production composition forwards verification limits without external I/O',async()=>{
    const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_URL='https://example.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='test-only-not-a-credential';
    try {
      for(const key of ['authenticationLimits','readinessLimits'] as const) assert.throws(()=>createProductionHttpServer({
        authenticate:()=>null,readiness:()=>false,[key]:{maxPending:0},
      }),/maxPending/);
    } finally {
      if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
      if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;
    }
  });
}
