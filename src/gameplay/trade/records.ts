/** Derived live-key index only. Canonical records remain sole authority; rebuild
 * on hydration/clone. Hot paths never traverse terminal proposal/shipment history. */
const indices=new WeakMap<Map<string,unknown>,Set<string>>();
export function indexedTradeMap<T>(active:(record:T)=>boolean,entries?:Iterable<readonly[string,T]>):Map<string,T> {
  const map=new Map<string,T>(),keys=new Set<string>();indices.set(map,keys);
  Object.defineProperties(map,{set:{value:function(id:string,value:T){Map.prototype.set.call(this,id,value);active(value)?keys.add(id):keys.delete(id);return this;}},delete:{value:function(id:string){keys.delete(id);return Map.prototype.delete.call(this,id);}},clear:{value:function(){keys.clear();Map.prototype.clear.call(this);}}});
  if(entries)for(const [id,value]of entries)map.set(id,value);return map;
}
export function liveTradeRecords<T>(map:Map<string,T>,active:(record:T)=>boolean):T[] {
  const keys=indices.get(map);
  return (keys?[...keys].map(id=>map.get(id)!):[...map.values()]).filter(active).sort((a,b)=>{
    const x=(a as {id:string}).id,y=(b as {id:string}).id;return x<y?-1:x>y?1:0;
  });
}
