import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const compile=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React}}).outputText).toString('base64')
const source=async path=>readFile(new URL('../../src/'+path,import.meta.url),'utf8')
const geometry=await import(compile(await source('features/replays/recordingGeometry.ts')))
const {displaySize,validCorners}=geometry
const actor='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',frame='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',id='cccccccc-cccc-cccc-cccc-cccccccccccc'
const response={upload_id:id,frame_id:frame,session_id:actor,storage_path:`${actor}/${frame}/${id}.mp4`,bucket:'pule-frame-recordings',source_provider:'r2',status:'reserved',expected_bytes:100,expires_at:'2030-01-01T00:00:00Z'}
let ui=await source('features/replays/RecordingUpload.tsx')
ui=ui.replaceAll('import.meta.env.VITE_RECORDING_UPLOAD_API_URL',"'https://test/api/recordings'").replace(/^import .*$/gm,'').replaceAll('import.meta.env.VITE_SUPABASE_URL',"'https://test.supabase.co'")
globalThis.geometry=geometry
const uiPrelude=`const navigator={locks:{request:async(key,options,fn)=>fn({})}};const {displaySize,displayToSource,pointerToDisplay,sourceToDisplay,validCorners}=globalThis.geometry;
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
test('one save uploads, finalizes and queues; failures retain the same operation and stop safely',async()=>{
 const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL
 URL.createObjectURL=()=> 'blob:local-preview';URL.revokeObjectURL=()=>{}
 try {
  for(const failure of [null,'interrupted','finalizeFailed']) {
   const render=component();let tree=render()
   find(tree,n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[{name:'recording.mp4',type:'video/mp4',size:100}]}})
   await tick();tree=render();find(tree,n=>n.type==='video').props.onLoadedData();tree=render()
   for(const [x,y] of [[20,20],[620,20],[620,460],[20,460]]) {
    find(tree,n=>n.type==='svg').props.onPointerDown({clientX:x,clientY:y,currentTarget:{getBoundingClientRect:()=>({left:0,top:0,width:640,height:480})}});tree=render()
   }
   if(failure)h[failure]=true
   assert.equal(button(tree,'Save & Create Replay').props.disabled,false)
   button(tree,'Save & Create Replay').props.onClick();await tick();tree=render()
   const sequence=h.calls.filter(c=>c[0]!=='persist').map(c=>c[0])
   assert.deepEqual(sequence,failure==='interrupted'?['reserve','transfer']:failure==='finalizeFailed'?['reserve','transfer','finalize']:['reserve','transfer','finalize','queue'])
   assert.ok(h.calls.findIndex(c=>c[0]==='persist')<h.calls.findIndex(c=>c[0]==='reserve'))
   const operations=h.calls.filter(c=>c[0]==='persist').map(c=>c[1].operation)
   assert.equal(new Set(operations).size,1)
   if(failure){assert.ok(find(tree,n=>n.props.role==='alert'));assert.equal(button(tree,'Save & Create Replay').props.disabled,false)}
   else {assert.match(JSON.stringify(tree),/Creating replay/);const queue=h.calls.find(c=>c[0]==='queue');assert.equal(validCorners(queue[3],640,480),true)}
  }
 } finally {URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke}
})
