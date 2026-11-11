import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { sha256 } from '@noble/hashes/sha2.js'
import ts from 'typescript'
const compile=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React}}).outputText).toString('base64')
const source=async path=>readFile(new URL('../../src/'+path,import.meta.url),'utf8')
const geometry=await import(compile(await source('features/replays/recordingGeometry.ts')))
const {displaySize,displayToSource,sourceToDisplay,pointerToDisplay,validCorners,inspectRecording}=geometry

test('scaled and scrolled portrait/landscape previews invert exactly to original pixels',()=>{
 for(const rotation of [0,90,180,270]){
  const g={width:1920,height:1080,rotation},size=displaySize(g)
  for(const p of [[0,0],[1919,1079],[300,400]])assert.deepEqual(displayToSource(sourceToDisplay(p,g),g),p)
  const rect={left:20,top:120,width:size.width/4,height:size.height/4}
  assert.deepEqual(pointerToDisplay(20+rect.width/2,120+rect.height/2,rect,g),[size.width/2,size.height/2])
 }
})
test('corner validation rejects crossing, duplicates, tiny polygons and out-of-bounds',()=>{
 assert.equal(validCorners([[10,10],[630,10],[630,470],[10,470]],640,480),true)
 for(const points of [[[0,0],[640,0],[640,480],[0,480]],[[0,0],[1,0],[1,1],[0,1]],[[10,10],[630,470],[630,10],[10,470]],[[10,10],[10,10],[630,470],[10,470]]])assert.equal(validCorners(points,640,480),false)
})
test('real MP4 display matrices map preview pixels to raw pixels for every phone rotation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pule-rotation-'))
 try{
  const base=join(dir,'base.mp4')
  execFileSync('ffmpeg',['-y','-v','error','-f','lavfi','-i','color=red:s=64x48:r=15','-vf','drawbox=x=32:y=0:w=32:h=24:color=green:t=fill,drawbox=x=0:y=24:w=32:h=24:color=blue:t=fill,drawbox=x=32:y=24:w=32:h=24:color=white:t=fill','-t','1','-c:v','libx264','-pix_fmt','yuv420p',base])
  const raw=execFileSync('ffmpeg',['-v','error','-noautorotate','-i',base,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'])
  for(const angle of [0,90,180,270]){
   const path=join(dir,angle+'.mp4');execFileSync('ffmpeg',['-y','-v','error','-display_rotation:v:0',String(angle),'-i',base,'-c','copy',path])
   const g=await inspectRecording(new Blob([readFileSync(path)]));assert.equal(g.width,64);assert.equal(g.height,48);assert.equal(g.rotation,(360-angle)%360)
   const size=displaySize(g),shown=execFileSync('ffmpeg',['-v','error','-i',path,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'])
   assert.equal(shown.length,size.width*size.height*3)
   for(const p of [[8,8],[size.width-9,8],[8,size.height-9],[size.width-9,size.height-9]]){
    const r=displayToSource(p,g),a=(p[1]*size.width+p[0])*3,b=(r[1]*g.width+r[0])*3
    for(let c=0;c<3;c++)assert.ok(Math.abs(shown[a+c]-raw[b+c])<8,`angle ${angle}, matrix ${g.rotation}, channel ${c}`)
   }
  }
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('non-MP4 and incomplete files fail closed before any reservation',async()=>{
 await assert.rejects(inspectRecording(new Blob(['not a video'])))
})

globalThis.localStorage={data:new Map(),getItem(key){return this.data.get(key)??null},setItem(key,value){this.data.set(key,value)},removeItem(key){this.data.delete(key)}}
globalThis.realSha=sha256
let journal=await source('features/replays/recordingJournal.ts')
journal=journal.replace(/^import .*$/gm,'')
const {recordingKey,readRecording,saveRecording,hashRecording}=await import(compile('const sha256=globalThis.realSha;'+journal))
const actor='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',frame='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',id='cccccccc-cccc-cccc-cccc-cccccccccccc'
const draft={version:1,userId:actor,frameId:frame,operation:id,hash:'a'.repeat(64),bytes:100,geometry:{width:640,height:480,rotation:90},corners:[]}
test('recovery is scoped to project, account and frame and never rewrites another actor',()=>{
 const key=recordingKey('project',actor,frame);saveRecording(key,draft);assert.deepEqual(readRecording(key,actor,frame),draft)
 assert.notEqual(key,recordingKey('other',actor,frame));assert.throws(()=>readRecording(key,'other',frame));assert.deepEqual(JSON.parse(localStorage.getItem(key)),draft)
})
test('hash identity covers the complete file, not only its name or endpoints',async()=>{
 assert.notEqual(await hashRecording(new Blob(['first middle last'])),await hashRecording(new Blob(['first changed last'])))
 const controller=new AbortController();controller.abort();await assert.rejects(hashRecording(new Blob(['x']),controller.signal))
})
test('unavailable storage and malformed recovery block rather than discard',()=>{
 const key=recordingKey('project',actor,frame);localStorage.setItem(key,'{}');assert.throws(()=>readRecording(key,actor,frame));assert.equal(localStorage.getItem(key),'{}')
 const original=localStorage.setItem;localStorage.setItem=()=>{throw Error('storage blocked')};assert.throws(()=>saveRecording(key,draft));localStorage.setItem=original
})

let service=await source('data/remote/recordingService.ts')
service=service.replace(/^import .*$/gm,'').replace('import.meta.env.VITE_SUPABASE_URL',"'https://test.supabase.co'")
const prelude=`const r2RecordingEnabled=()=>false;const actorAuthorization=async uid=>{if(uid!==globalThis.s.actor)throw Error('Wrong actor');return 'Bearer caller'};
const getSupabase=()=>({auth:{onAuthStateChange:callback=>{globalThis.s.authChange=callback;return {data:{subscription:{unsubscribe(){}}}}}},rpc:(name,args)=>{globalThis.s.calls.push({name,args});const q={setHeader:(key,value)=>{globalThis.s.header={key,value};return q},retry:value=>{globalThis.s.retry=value;return q},abortSignal:async()=>({data:globalThis.s.response,error:globalThis.s.error})};return q}});
class Upload{constructor(file,options){this.options=options;globalThis.s.upload=this}async findPreviousUploads(){return []}start(){globalThis.s.started=true}async abort(){globalThis.s.aborted=true}};`
const api=await import(compile(prelude+service))
const response={upload_id:id,frame_id:frame,session_id:actor,storage_path:`${actor}/${frame}/${id}.mp4`,bucket:'frame-recordings',status:'reserved',expected_bytes:100,expires_at:'2030-01-01T00:00:00Z'}
function setup(){globalThis.s={actor,calls:[],response}}
test('reservation/finalization/corner submission use actor-bound existing RPCs and raw dimensions',async()=>{
 setup();await api.reserveRecording(actor,frame,id,100);assert.deepEqual(s.header,{key:'Authorization',value:'Bearer caller'});assert.equal(s.retry,false)
 await api.finalizeRecording(actor,id);await api.queueRecording(actor,id,[[10,10],[630,10],[630,470],[10,470]],640,480)
 assert.deepEqual(s.calls.map(c=>c.name),['reserve_frame_replay_upload','finalize_frame_replay_upload','queue_frame_replay_processing'])
 assert.equal(s.calls[2].args.p_width,640);await assert.rejects(api.reserveRecording('other',frame,id,100));assert.equal(s.calls.length,3)
})
test('a pre-processing backend response cannot redirect sources into the replay bucket',()=>{
 assert.throws(()=>api.validateUploadStatus({...response,bucket:'frame-replays'}),/backend/)
})
test('TUS is exact-path, six-MiB, non-upsert and explicit-resume only; pause/account switch abort',async()=>{
 setup();const transfer=api.transferRecording({},actor,response,'hash',()=>{});const pending=transfer.start();await new Promise(r=>setImmediate(r))
 assert.equal(s.upload.options.chunkSize,6*1024*1024);assert.equal(s.upload.options.retryDelays,null);assert.equal(s.upload.options.metadata.bucketName,'frame-recordings')
 const headers={};await s.upload.options.onBeforeRequest({getURL:()=>s.upload.options.endpoint,setHeader:(k,v)=>headers[k]=v});assert.equal(headers.Authorization,'Bearer caller');assert.equal(headers['x-upsert'],'false')
 await assert.rejects(s.upload.options.onBeforeRequest({getURL:()=> 'https://evil.test/upload',setHeader(){throw Error('credential leak')}}))
 s.authChange('SIGNED_OUT',null);await assert.rejects(pending,/paused/);assert.equal(s.aborted,true)
})

const {recordingLabel}=await import(compile((await source('features/replays/recordingPresentation.ts')).replace(/^import .*$/gm,'')))
globalThis.recordingLabel=recordingLabel
let ui=await source('features/replays/RecordingUpload.tsx')
ui=ui.replaceAll('import.meta.env.VITE_RECORDING_UPLOAD_API_URL','undefined').replace(/^import .*$/gm,'').replaceAll('import.meta.env.VITE_SUPABASE_URL',"'https://test.supabase.co'")
globalThis.geometry=geometry
const uiPrelude=`const navigator={locks:{request:async(key,options,fn)=>fn({})}};const clearRecording=()=>{};const recordingLabel=globalThis.recordingLabel;const {displaySize,displayToSource,pointerToDisplay,sourceToDisplay,validCorners}=globalThis.geometry;
const React={createElement:(type,props,...children)=>{if(props?.ref&&type==='video')props.ref.current={...displaySize(globalThis.h.g),videoWidth:displaySize(globalThis.h.g).width,videoHeight:displaySize(globalThis.h.g).height,duration:100,pause(){}};if(props?.ref&&type==='canvas')props.ref.current={getContext:()=>({drawImage(){}})};return {type,props:props??{},children}},Fragment:'fragment'};
const Modal='modal';
const useState=initial=>{const h=globalThis.h,i=h.cursor++;if(!(i in h.states))h.states[i]=typeof initial==='function'?initial():initial;return [h.states[i],next=>{h.states[i]=typeof next==='function'?next(h.states[i]):next}]};
const useRef=value=>{const h=globalThis.h,i=h.cursor++;return h.states[i]??(h.states[i]={current:value})};const useEffect=f=>globalThis.h.effects.push(f);
const recordingKey=()=> 'journal';const readRecording=()=>globalThis.h.initial;
const saveRecording=(key,draft)=>{if(globalThis.h.storageFailed)throw Error('Storage blocked');globalThis.h.calls.push(['persist',structuredClone(draft)])};
const hashRecording=async()=> 'a'.repeat(64);const inspectRecording=async()=>globalThis.h.g;
const reserveRecording=async()=>{globalThis.h.calls.push(['reserve']);return globalThis.h.response};
const getRecordingStatus=async()=>globalThis.h.response;
const transferRecording=()=>({pause(){globalThis.h.paused=true},start:async()=>{globalThis.h.calls.push(['transfer']);if(globalThis.h.interrupted)throw Error('Upload interrupted.');}});
const finalizeRecording=async()=>{globalThis.h.calls.push(['finalize']);if(globalThis.h.finalizeFailed)throw Error('Not confirmed');return {...globalThis.h.response,status:'committed',processing_status:'uploaded'}};
const queueRecording=async(...args)=>{globalThis.h.calls.push(['queue',...args]);return {...globalThis.h.response,status:'committed',processing_status:'queued'}};
`
const {RecordingUpload}=await import(compile(uiPrelude+ui))
const nodes=n=>Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...n.children.flatMap(nodes)]:[]
const find=(tree,predicate)=>nodes(tree).find(predicate)
const button=(tree,label)=>find(tree,n=>n.type==='button'&&n.children.includes(label))
const tick=()=>new Promise(resolve=>setImmediate(resolve))
function component({initial=null,rotation=0,status=null}={}){
 globalThis.h={cursor:0,states:[],effects:[],initial,g:{width:640,height:480,rotation},response:status??response,calls:[]}
 const render=()=>{h.cursor=0;h.effects=[];return RecordingUpload({userId:actor,frame:{id:frame,frame_number:1},onPublished:()=>h.calls.push(['published'])})}
 return render
}
const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL
URL.createObjectURL=()=> 'blob:local-preview';URL.revokeObjectURL=()=>{}
async function selectAndMark(render){
 let tree=render();find(tree,n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[{name:'recording.mp4',type:'video/mp4',size:100}]}});await tick();tree=render()
 button(tree,'Use this view to mark corners').props.onClick();tree=render()
 const size=displaySize(h.g)
 for(const p of [[20,20],[size.width-20,20],[size.width-20,size.height-20],[20,size.height-20]]){
  find(tree,n=>n.type==='svg').props.onPointerDown({clientX:p[0],clientY:p[1],currentTarget:{getBoundingClientRect:()=>({left:0,top:0,width:size.width,height:size.height})}});tree=render()
 }
 return tree
}
test('full upload persists before reserving and queues original coordinates after explicit confirmation',async()=>{
 for(const rotation of [0,90,180,270]){
  const render=component({rotation});let tree=await selectAndMark(render)
  assert.equal(button(tree,'Upload full frame').props.disabled,false);button(tree,'Upload full frame').props.onClick();await tick();tree=render()
  const calls=h.calls.map(c=>c[0]);assert.ok(calls.indexOf('persist')<calls.indexOf('reserve'));assert.ok(calls.indexOf('reserve')<calls.indexOf('transfer'));assert.ok(calls.indexOf('transfer')<calls.indexOf('finalize'))
  assert.equal(h.calls.some(c=>c[0]==='queue'),false)
  button(tree,'Create replay').props.onClick();await tick();tree=render()
  const queue=h.calls.find(c=>c[0]==='queue');assert.equal(queue[4],640);assert.equal(queue[5],480);assert.equal(validCorners(queue[3],640,480),true)
  assert.equal(find(tree,n=>n.type==='input'&&n.props.type==='file'),undefined);assert.match(JSON.stringify(tree),/replay is queued/)
 }
})
test('unavailable journal storage sends no reservation or transfer',async()=>{
 const render=component();h.storageFailed=true;const tree=render();find(tree,n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[{name:'recording.mp4',type:'video/mp4',size:100}]}});await tick();assert.equal(h.calls.length,0);assert.match(JSON.stringify(render()),/Storage blocked/)
})
test('interrupted upload retains original operation and never finalizes or queues',async()=>{
 const render=component();let tree=await selectAndMark(render);h.interrupted=true;button(tree,'Upload full frame').props.onClick();await tick();tree=render()
 assert.match(JSON.stringify(tree),/Upload interrupted/);assert.equal(h.calls.some(c=>c[0]==='finalize'||c[0]==='queue'),false)
 const saved=h.calls.filter(c=>c[0]==='persist').at(-1)[1];assert.equal(saved.uploadId,id);assert.equal(saved.reservationRequested,true)
})
test('unknown finalization result stays recoverable without automatically queueing',async()=>{
 const render=component();let tree=await selectAndMark(render);h.finalizeFailed=true;button(tree,'Upload full frame').props.onClick();await tick();tree=render()
 assert.match(JSON.stringify(tree),/Not confirmed/);assert.ok(button(tree,'Check status'));assert.equal(h.calls.some(c=>c[0]==='queue'),false)
 assert.equal(h.calls.filter(c=>c[0]==='persist').at(-1)[1].transferred,true)
})
test('processing, failed and completed recovery states are explicit; checks refresh playback only on completion',async()=>{
 for(const state of ['queued','processing','failed','completed']){
  const render=component({initial:{...draft,uploadId:id,reservationRequested:true},status:{...response,status:'committed',processing_status:state}})
  render();h.effects.forEach(f=>f());await tick();let tree=render();assert.match(JSON.stringify(tree),new RegExp(recordingLabel({...response,status:'committed',processing_status:state}).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')))
  if(state!=='failed')assert.equal(find(tree,n=>n.type==='input'&&n.props.type==='file'),undefined)
  button(tree,'Check status').props.onClick();await tick();assert.equal(h.calls.some(c=>c[0]==='published'),state==='completed')
 }
})
// Restore APIs after this file's tests finish, not before queued test callbacks execute.
process.on('exit',()=>{URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke})

let historySource=await source('features/connected/FrameReplays.tsx')
historySource=historySource.replace(/^import .*$/gm,'').replaceAll('import.meta.env?.VITE_FRAME_RECORDING_UPLOADS',"'true'")
const historyModule=await import(compile(uiPrelude+`const RecordingUploadAction='recording-action';const listFrameReplays=async()=>[];const signFrameReplay=async()=>'';`+historySource))
test('Frame History gates uploads on ready metadata, completion, detail eligibility and linked participation',()=>{
 const frameRow={id:frame,group_id:actor,frame_number:1,status:'completed',detail_eligible:true,participants:[{player_id:actor}]}
 function history({replays=[],availability='ready',playerId=actor,sessionDetail=true,frameDetail=true,state='completed'}={}){
  globalThis.h={cursor:0,states:[replays,availability,0,null],effects:[],g:{width:640,height:480,rotation:0}}
  return historyModule.FrameReplays({userId:actor,sessionId:actor,upload:{playerId,detailEligible:sessionDetail},children:action=>action({...frameRow,status:state,detail_eligible:frameDetail})})
 }
 assert.ok(find(history(),n=>n.type==='recording-action'))
 for(const input of [{availability:'loading'},{availability:'failed'},{playerId:'viewer'},{sessionDetail:false},{frameDetail:false},{state:'running'}])assert.equal(find(history(input),n=>n.type==='recording-action'),undefined)
 const tree=history({replays:[{frame_id:frame,group_id:actor}]});assert.equal(find(tree,n=>n.type==='recording-action'),undefined);assert.ok(button(tree,'Watch Replay'))
})

test('a second tab cannot replace an active reservation journal',()=>{
 const key=recordingKey('tabs',actor,frame);saveRecording(key,{...draft,reservationRequested:true});assert.throws(()=>saveRecording(key,{...draft,operation:actor}),/Another tab/);assert.equal(readRecording(key,actor,frame).operation,id)
})

test('lost transfer acknowledgment can finalize an already-stored source without reuploading bytes',async()=>{
 const render=component({initial:{...draft,uploadId:id,reservationRequested:true},status:response});render();h.effects.forEach(f=>f());await tick();button(render(),'Confirm finished upload').props.onClick();await tick()
 assert.equal(h.calls.some(c=>c[0]==='finalize'),true);assert.equal(h.calls.some(c=>c[0]==='transfer'||c[0]==='queue'),false);assert.equal(h.calls.filter(c=>c[0]==='persist').at(-1)[1].transferred,true)
})
