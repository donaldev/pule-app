import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runReplayCleanup } from '../storage/cleanup-frame-replays.mjs'
const path='8926207a-9936-5762-a991-492b45ef7e50/366064c1-d7d3-5bf6-a17b-131fa5cf1fbb/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.mp4'
const lease={bucket:'frame-replays',storage_path:path,lease_id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'}
function mock({bad=false,removeError=false,ackError=false}={}) {
 const calls=[]
 return {calls,rpc:async(name,args)=>{calls.push([name,args]);return name==='claim_frame_replay_cleanup'?{data:[bad?{...lease,storage_path:'../other'}:lease]}:{error:ackError}},storage:{from:bucket=>({remove:async paths=>{calls.push(['remove',bucket,paths]);return {error:removeError}}})}}
}
test('worker deletes only the exact leased object through Storage API before acknowledging',async()=>{
 const client=mock();assert.deepEqual(await runReplayCleanup(client),{claimed:1,completed:1,failed:0});assert.deepEqual(client.calls[1],['remove','frame-replays',[path]]);assert.equal(client.calls[2][1].p_success,true)
})
test('worker reports failed removals for durable retry; never claims successful cleanup',async()=>{
 const client=mock({removeError:true});assert.equal((await runReplayCleanup(client)).failed,1);assert.equal(client.calls[2][1].p_success,false)
})
test('lost acknowledgment leaves recovery to lease expiry',async()=>{
 const client=mock({ackError:true});assert.equal((await runReplayCleanup(client)).failed,1);assert.equal(client.calls.length,3)
})
test('invalid queue paths fail closed before any Storage request',async()=>{
 const client=mock({bad:true});await assert.rejects(runReplayCleanup(client),/Invalid/);assert.equal(client.calls.length,1)
})
