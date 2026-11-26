import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { assertDirectReplayUploadSize, compressedReplayOutputLimit, directReplayUploadLimit } from '../../src/data/replayUploadLimit.mjs'
const compile=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React}}).outputText).toString('base64')
const source=async path=>readFile(new URL('../../src/'+path,import.meta.url),'utf8')
const geometry=await import(compile(await source('features/replays/recordingGeometry.ts')))
const {displaySize,validCorners}=geometry
const actor='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',frame='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',id='cccccccc-cccc-cccc-cccc-cccccccccccc'
const response={upload_id:id,frame_id:frame,session_id:actor,storage_path:`${actor}/${frame}/${id}.mp4`,bucket:'pule-frame-recordings',source_provider:'r2',status:'reserved',expected_bytes:100,expires_at:'2030-01-01T00:00:00Z'}
let ui=await source('features/replays/RecordingUpload.tsx')
ui=ui.replaceAll('import.meta.env.VITE_RECORDING_UPLOAD_API_URL',"'https://test/api/recordings'").replaceAll('import.meta.env?.VITE_REPLAY_COMPRESSION_PILOT', "(globalThis.h.pilot ? 'true' : 'false')").replace(/^import .*$/gm,'').replaceAll('import.meta.env.VITE_SUPABASE_URL',"'https://test.supabase.co'")
const encoderSource=(await source('features/replays/videoCompression.ts')).replace(/^import .*$/gm,'')
globalThis.scaleCompressionCorners=(await import(compile(encoderSource))).scaleCompressionCorners
globalThis.geometry=geometry
globalThis.uploadSizeRules={assertDirectReplayUploadSize,compressedReplayOutputLimit,directReplayUploadLimit}
const uiPrelude=`const navigator={locks:{request:async(key,options,fn)=>fn({})}};const {displaySize,displayToSource,pointerToDisplay,sourceToDisplay,validCorners}=globalThis.geometry;
const React={createElement:(type,props,...children)=>({type,props:props??{},children}),Fragment:'fragment'};
const Modal='modal',RecordingCorners='RecordingCorners',RecordingFilePicker='RecordingFilePicker',RecordingProgress='RecordingProgress';
const recordingSize=bytes=>(bytes/1e6).toFixed(2)+' MB';
const useState=initial=>{const h=globalThis.h,i=h.cursor++;if(!(i in h.states))h.states[i]=typeof initial==='function'?initial():initial;return [h.states[i],next=>{h.states[i]=typeof next==='function'?next(h.states[i]):next}]};
const useRef=value=>{const h=globalThis.h,i=h.cursor++;return h.states[i]??(h.states[i]={current:value})};const useEffect=f=>globalThis.h.effects.push(f);const useLayoutEffect=f=>{if(!globalThis.h.unmount)globalThis.h.unmount=f()};
const recordingKey=()=> 'journal';const readRecording=()=>globalThis.h.initial;
const saveRecording=(key,draft)=>{if(globalThis.h.storageFailed)throw Error('Storage blocked');globalThis.h.calls.push(['persist',structuredClone(draft)])};
const hashRecording=async (file,_signal,progress)=>{
  globalThis.h.hashes.push(file.name);progress?.(37);
  await globalThis.h.holdHash;
  return (file.name?.endsWith('_compressed.mp4') ? 'b' : 'a').repeat(64);
};
const inspectRecording=async()=>{await globalThis.h.holdDetails;return globalThis.h.g};
const inspectRecordingTiming=async()=>({source:'mvhd',startMs:100000,durationMs:100000,reliability:'medium'});
const videoSampleTypes=async()=>({audio:['mp4a']});
const compressionSupport=()=>globalThis.h.encoderAvailable!==false;
const {assertDirectReplayUploadSize,compressedReplayOutputLimit,directReplayUploadLimit}=globalThis.uploadSizeRules;
const planCompression=()=>({audio:true,width:240,height:320});
const scaleCompressionCorners=globalThis.scaleCompressionCorners;
const compressVideo=async(_file,_duration,_plan,signal,progress)=>{
  globalThis.h.calls.push(['compress']);progress(0.25,12);
  await globalThis.h.holdCompression;
  progress(1,100);
  await globalThis.h.holdOutput;
  if(globalThis.h.compressionFailure==='cancel') await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  if(globalThis.h.compressionFailure==='error') throw Error('Encoding failed.');
  const size=globalThis.h.compressedBytes ?? 50;
  const outputChunk=new Blob([new Uint8Array(Math.min(size,1_000_000))]);
  const blob=globalThis.h.compressionFailure==='oversized' ? {size:compressedReplayOutputLimit+1} : new Blob(Array(size/outputChunk.size).fill(outputChunk),{type:'video/mp4'});
  return {blob,geometry:{width:240,height:320,rotation:0}};
};
const reserveRecording=async(...args)=>{globalThis.h.calls.push(['reserve',...args]);return globalThis.h.response};
const getRecordingStatus=async()=>globalThis.h.response;
const transferRecording=(file)=>({pause(){globalThis.h.paused=true},start:async()=>{globalThis.h.calls.push(['transfer',file.size,file.name]);if(globalThis.h.interrupted)throw Error('Upload interrupted.');await globalThis.h.holdTransfer;}});
const finalizeRecording=async()=>{globalThis.h.calls.push(['finalize']);if(globalThis.h.finalizeFailed)throw Error('Not confirmed');return {...globalThis.h.response,status:'committed',processing_status:'uploaded'}};
const queueRecording=async(...args)=>{globalThis.h.calls.push(['queue',...args]);await globalThis.h.holdQueue;return {...globalThis.h.response,status:'committed',processing_status:'queued'}};
`
const {RecordingUpload}=await import(compile(uiPrelude+ui))
const nodes=n=>Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...n.children.flatMap(nodes)]:[]
const find=(tree,predicate)=>nodes(tree).find(predicate)
const button=(tree,label)=>find(tree,n=>n.type==='button'&&n.children.includes(label))
const tick=()=>new Promise(resolve=>setImmediate(resolve))
function component({initial=null,rotation=0,status=null,pilot=false}={}){
 globalThis.h={cursor:0,states:[],effects:[],initial,g:{width:640,height:480,rotation},response:status??response,pilot,calls:[],hashes:[]}
 const render=()=>{h.cursor=0;h.effects=[];return RecordingUpload({userId:actor,frame:{id:frame,frame_number:1},onPublished:()=>h.calls.push(['published'])})}
 return render
}
function mark(render, points) {
 const editor = tree => find(tree,n=>n.type==='RecordingCorners').props
 editor(render()).onDuration(100)
 editor(render()).onChange(points.map(point=>geometry.displayToSource(point,h.g)))
 const tree=render()
 assert.equal(button(tree,'Upload & create replay'),undefined)
 assert.equal(button(tree,'Compress video'),undefined)
 editor(tree).onConfirm()
 return render()
}
test('double-click reserves, transfers and queues once; ambiguous failures preserve the same operation',async()=>{
 const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL
 URL.createObjectURL=()=> 'blob:local-preview';URL.revokeObjectURL=()=>{}
 try {
  for(const failure of [null,'interrupted','finalizeFailed']) {
   const render=component();let tree=render()
   find(tree,n=>n.type==='RecordingFilePicker').props.onChoose({name:'recording.mp4',type:'video/mp4',size:100})
   await tick()
   tree=mark(render,[[20,20],[620,20],[620,460],[20,460]])
   if(failure)h[failure]=true
   assert.equal(button(tree,'Upload & create replay').props.disabled,false)
   button(tree,'Upload & create replay').props.onClick();button(tree,'Upload & create replay').props.onClick();await tick();tree=render()
   const sequence=h.calls.filter(c=>!['persist','published'].includes(c[0])).map(c=>c[0])
   assert.deepEqual(sequence,failure==='interrupted'?['reserve','transfer']:failure==='finalizeFailed'?['reserve','transfer','finalize']:['reserve','transfer','finalize','queue'])
   assert.ok(h.calls.findIndex(c=>c[0]==='persist')<h.calls.findIndex(c=>c[0]==='reserve'))
   const operations=h.calls.filter(c=>c[0]==='persist').map(c=>c[1].operation)
   assert.equal(new Set(operations).size,1)
   if(failure){assert.ok(find(tree,n=>n.props.role==='alert'));assert.equal(button(tree,'Resume upload').props.disabled,false)}
   else {assert.match(JSON.stringify(tree),/Recording uploaded/);const queue=h.calls.find(c=>c[0]==='queue');assert.equal(validCorners(queue[3],640,480),true)}
  }
 } finally {URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke}
})

test('pilot hands off rotated corners and compressed bytes, and retries the same saved file', async () => {
 const render=component({rotation:90,pilot:true,status:{...response,expected_bytes:50}})
 const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL
 URL.createObjectURL=()=> 'blob:local-preview';URL.revokeObjectURL=()=>{}
 try {
  let tree=render()
  find(tree,n=>n.type==='RecordingFilePicker').props.onChoose({name:'recording.mp4',type:'video/mp4',size:100})
  await tick()
  tree=mark(render,[[20,40],[460,40],[460,600],[20,600]])
  for(const effect of h.effects) effect()
  await tick();tree=render()
  const toggle=find(tree,n=>n.type==='input'&&n.props.type==='checkbox')
  assert.equal(toggle.props.checked,false)
  toggle.props.onChange({currentTarget:{checked:true}});tree=render()
  h.interrupted=true
  const submit=button(tree,'Upload & create replay')
  submit.props.onClick();submit.props.onClick();await tick();tree=render()
  assert.equal(h.calls.filter(c=>c[0]==='compress').length,1)
  assert.deepEqual(h.hashes,['recording_compressed.mp4'])
  h.interrupted=false
  button(tree,'Resume upload').props.onClick();await tick()
  const reservations=h.calls.filter(c=>c[0]==='reserve')
  assert.equal(reservations.length,1)
  assert.equal(h.calls.filter(c=>c[0]==='compress').length,1)
  assert.deepEqual(h.hashes,['recording_compressed.mp4'])
  assert.equal(reservations[0][4],50)
  assert.equal(reservations[0][5],'b'.repeat(64))
  assert.deepEqual(h.calls.filter(c=>c[0]==='transfer'),[
   ['transfer',50,'recording_compressed.mp4'],['transfer',50,'recording_compressed.mp4'],
  ])
  const queue=h.calls.find(c=>c[0]==='queue')
  assert.deepEqual(queue.slice(3),[[[10,20],[230,20],[230,300],[10,300]],240,320])
 } finally {URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke}
})

test('an oversized original requires compression even with the optional pilot flag off', async () => {
 const render=component({status:{...response,expected_bytes:50}})
 const restore=mockPreviewUrl()
 try {
  const tree=await selectOversized(render)
  assert.equal(find(tree,n=>n.type==='input'&&n.props.type==='checkbox'),undefined)
  button(tree,'Upload & create replay').props.onClick();await tick()
  assert.equal(h.calls.find(c=>c[0]==='reserve')[4],50)
  assert.deepEqual(h.calls.find(c=>c[0]==='transfer'),['transfer',50,'large_compressed.mp4'])
  assert.ok(h.calls.some(c=>c[0]==='queue'))
 } finally {restore()}
})

test('a valid original at exactly 200 MB uploads directly', async () => {
 const render=component({status:{...response,expected_bytes:directReplayUploadLimit}})
 const restore=mockPreviewUrl()
 try {
  const picker=find(render(),n=>n.type==='RecordingFilePicker')
  picker.props.onChoose({name:'original.mp4',type:'video/mp4',size:directReplayUploadLimit})
  await tick()
  const tree=mark(render,[[20,20],[620,20],[620,460],[20,460]])
  assert.equal(button(tree,'Compress video'),undefined)
  button(tree,'Upload & create replay').props.onClick();await tick()
  assert.deepEqual(h.calls.find(c=>c[0]==='transfer'),['transfer',200_000_000,'original.mp4'])
  assert.ok(h.calls.some(c=>c[0]==='queue'))
 } finally {restore()}
})

test('a 200 MB compressed result can upload, but one more byte cannot', async () => {
 const restore=mockPreviewUrl()
 try {
  for(const oversized of [false,true]) {
   const render=component({status:{...response,expected_bytes:compressedReplayOutputLimit}})
   const tree=await selectOversized(render)
   h.compressedBytes=compressedReplayOutputLimit
   if(oversized)h.compressionFailure='oversized'
   button(tree,'Upload & create replay').props.onClick();await tick()
   const result=render()
   if(oversized) {
    assert.match(JSON.stringify(result),/200 MB compressed output limit/)
    assert.equal(button(result,'Upload & create replay').props.disabled,false)
    assert.equal(h.calls.some(c=>['reserve','transfer'].includes(c[0])),false)
   } else {
    assert.deepEqual(h.calls.find(c=>c[0]==='transfer'),['transfer',200_000_000,'large_compressed.mp4'])
   }
  }
 } finally {restore()}
})

test('failed, cancelled, unsupported and oversized compression cannot fall back to the oversized original', async () => {
 const restore=mockPreviewUrl()
 try {
  for (const mode of ['error','cancel','oversized','unsupported']) {
   const render=component()
   let tree=await selectOversized(render)
   if(mode==='unsupported'){
    h.encoderAvailable=false
    for(const effect of h.effects) effect()
    await tick();tree=render()
    assert.equal(button(tree,'Upload & create replay').props.disabled,true)
   } else {
    h.compressionFailure=mode
    button(tree,'Upload & create replay').props.onClick();await tick()
    if(mode==='cancel') { button(render(),'Cancel compression').props.onClick();await tick() }
    tree=render()
    assert.equal(button(tree,'Upload & create replay').props.disabled,false)
   }
   assert.ok(find(tree,n=>n.props.role==='alert'))
   assert.equal(h.calls.some(c=>['reserve','transfer','finalize','queue'].includes(c[0])),false)
   if(mode==='cancel' || mode==='error'){
    h.compressionFailure=null
    h.response={...response,expected_bytes:50}
    button(tree,'Upload & create replay').props.onClick();await tick()
    assert.equal(h.calls.filter(c=>c[0]==='compress').length,2)
    assert.equal(h.calls.filter(c=>c[0]==='reserve').length,1)
    assert.equal(h.calls.filter(c=>c[0]==='queue').length,1)
   }
  }
 } finally {restore()}
})

test('an existing oversized R2 reservation is blocked before selecting a file or resuming', async () => {
 const render=component({status:{...response,expected_bytes:directReplayUploadLimit+1},initial:{
  source_provider:'r2',bytes:directReplayUploadLimit+1,reservationRequested:true,uploadId:id,
 }})
 render();for(const effect of h.effects) effect()
 await tick()
 const tree=render()
 assert.equal(find(tree,n=>n.type==='RecordingFilePicker'),undefined)
 assert.equal(button(tree,'Upload & create replay'),undefined)
 assert.match(JSON.stringify(tree),/saved upload exceeds the 200 MB/)
 assert.equal(h.calls.some(c=>['reserve','transfer','finalize','queue'].includes(c[0])),false)
})

function mockPreviewUrl() {
 const create=URL.createObjectURL,revoke=URL.revokeObjectURL
 URL.createObjectURL=()=> 'blob:local-preview';URL.revokeObjectURL=()=>{}
 return ()=>{URL.createObjectURL=create;URL.revokeObjectURL=revoke}
}

async function selectOversized(render) {
 const picker=find(render(),n=>n.type==='RecordingFilePicker')
 picker.props.onChoose({name:'large.mp4',type:'video/mp4',size:directReplayUploadLimit+1})
 await tick()
 mark(render,[[20,20],[620,20],[620,460],[20,460]])
 for(const effect of h.effects) effect()
 await tick()
 return render()
}

test('replacement clears old corners and hashing starts only when the original is ready to upload',async()=>{
 const render=component()
 const restore=mockPreviewUrl()
 try {
  let openDetails
  h.holdDetails=new Promise(resolve=>{openDetails=resolve})
  const picker=tree=>find(tree,n=>n.type==='RecordingFilePicker')
  const progress=tree=>find(tree,n=>n.type==='RecordingProgress').props
  picker(render()).props.onChoose({name:'first.mp4',type:'video/mp4',size:100})
  await tick()
  assert.equal(progress(render()).title,'Preparing video on this device')
  assert.equal(progress(render()).percent,undefined)
  openDetails();await tick()
  mark(render,[[20,20],[620,20],[620,460],[20,460]])
  picker(render()).props.onChoose({name:'replacement.mp4',type:'video/mp4',size:100})
  await tick()
  assert.equal(picker(render()).props.file.name,'replacement.mp4')
  const editor=find(render(),n=>n.type==='RecordingCorners').props
  assert.deepEqual(editor.corners,[])
  assert.equal(editor.confirmed,false)
  assert.deepEqual(h.hashes,[])
  mark(render,[[20,20],[620,20],[620,460],[20,460]])
  let finishHash
  h.holdHash=new Promise(resolve=>{finishHash=resolve})
  button(render(),'Upload & create replay').props.onClick();await tick()
  assert.equal(progress(render()).title,'Preparing upload')
  assert.equal(progress(render()).percent,37)
  assert.deepEqual(h.hashes,['replacement.mp4'])
  assert.equal(h.calls.some(c=>c[0]==='reserve'),false)
  finishHash();await tick()
  assert.ok(h.calls.some(c=>c[0]==='queue'))
 } finally {restore()}
})

test('combined upload reports measured compression, hash and transfer followed by an indeterminate submission', async () => {
 const render=component({status:{...response,expected_bytes:50}})
 const restore=mockPreviewUrl()
 try {
  const tree=await selectOversized(render)
  const progress=()=>find(render(),n=>n.type==='RecordingProgress').props
  const gates={}
  for(const stage of ['Compression','Output','Hash','Transfer','Queue']) h['hold'+stage]=new Promise(resolve=>{gates[stage]=resolve})
  button(tree,'Upload & create replay').props.onClick()
  assert.equal(progress().title,'Compressing video')
  assert.equal(progress().percent,25)
  assert.match(progress().detail,/12s elapsed/)
  gates.Compression();await tick()
  assert.equal(progress().title,'Checking compressed video')
  assert.equal(progress().percent,undefined)
  gates.Output();await tick()
  assert.equal(progress().title,'Preparing upload')
  assert.equal(progress().percent,37)
  gates.Hash();await tick()
  assert.equal(progress().title,'Uploading recording')
  assert.equal(progress().percent,0)
  gates.Transfer();await tick()
  assert.equal(progress().title,'Creating replay job')
  assert.equal(progress().percent,undefined)
  gates.Queue();await tick()
  assert.equal(progress().title,'Recording uploaded')
  assert.equal(progress().received,true)
 } finally {restore()}
})

test('cancelling compression blocks upload even when the encoder resolves after abort', async () => {
 const render=component({status:{...response,expected_bytes:50}})
 const restore=mockPreviewUrl()
 try {
  const tree=await selectOversized(render)
  let release
  h.holdCompression=new Promise(resolve=>{release=resolve})
  button(tree,'Upload & create replay').props.onClick()
  button(render(),'Cancel compression').props.onClick()
  release();await tick()
  assert.deepEqual(h.calls,[['compress']])
  assert.match(JSON.stringify(render()),/Compression cancelled/)
 } finally {restore()}
})

test('dismissal during compression or transfer prevents stale submission work', async () => {
 const restore=mockPreviewUrl()
 try {
  for (const phase of ['Compression','Transfer']) {
   const render=component({status:{...response,expected_bytes:50}})
   const tree=await selectOversized(render)
   let release
   h['hold'+phase]=new Promise(resolve=>{release=resolve})
   button(tree,'Upload & create replay').props.onClick();await tick()
   h.unmount()
   release();await tick()
   const calls=h.calls.map(c=>c[0])
   assert.equal(calls.includes('finalize'),false)
   assert.equal(calls.includes('queue'),false)
   if(phase==='Compression') assert.deepEqual(calls,['compress'])
   else assert.equal(h.paused,true)
  }
 } finally {restore()}
})
