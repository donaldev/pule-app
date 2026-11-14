import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const text = await readFile(new URL('../../src/features/connected/FrameReplays.tsx', import.meta.url), 'utf8')
const source = text.replace(/^import .*$/gm, '').replaceAll("import.meta.env?.VITE_FRAME_RECORDING_UPLOADS", "'true'")
const prelude = `
const React={createElement:(type,props,...children)=>({type,props:props??{},children}),Fragment:'fragment'};
const Icon='Icon',Modal='Modal',MatchDisclosureHeading='Disclosure',RecordingUploadAction='RecordingUploadAction';
const useState=initial=>{const h=globalThis.archive,i=h.cursor++;if(!(i in h.states))h.states[i]=typeof initial==='function'?initial():initial;return [h.states[i],next=>h.states[i]=typeof next==='function'?next(h.states[i]):next]};
const useRef=initial=>{const h=globalThis.archive,i=h.cursor++;return h.states[i]??(h.states[i]={current:initial})};const useEffect=()=>{};
const listFrameReplays=async()=>[];const signFrameReplay=async(user,replay)=>{globalThis.archive.signed.push([user,replay.frame_id]);if(globalThis.archive.signError)throw Error('offline');return 'https://private.test/signed'};
const removeFrameReplay=async(...args)=>{globalThis.archive.removed.push(args);if(globalThis.archive.removeError)throw Error('Removal unconfirmed')};
`
const compiled = ts.transpileModule(prelude + source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.React } }).outputText
const { FrameReplays } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
const frame = n => ({ id: `frame-${n}`, group_id: 'group', frame_number: n, status: 'completed', detail_eligible: true, participants: [{ player_id: 'player' }], elapsed_ms: 74000 })
const replay = n => ({ frame_id: `frame-${n}`, group_id: 'group', session_id: 'session', storage_path: `session/frame-${n}.mp4` })
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(nodes)] : []
const find = (tree, predicate) => nodes(tree).find(predicate)
const button = (tree, label) => find(tree, n => n.type === 'button' && nodes(n).some(child => child.children.includes(label)))
const tick = () => new Promise(resolve => setImmediate(resolve))
function setup(rows, count=1, authorized=true) {
 globalThis.archive={states:[rows,'ready',0,null,null,false,'',null],cursor:0,signed:[],removed:[]}
 const frames=Array.from({length:count},(_,i)=>frame(i+1))
 return () => { archive.cursor=0;return FrameReplays({userId:'account',sessionId:'session',upload:{playerId:authorized?'player':'viewer',detailEligible:true},describeFrame:()=> 'Donal won · 1:14',children:(action,total)=>({type:'history',props:{total},children:frames.map(f=>({type:'frame',props:{id:f.id},children:[action(f),action(f,'details')]}))})}) }
}
test('empty, one and 40-frame archives count only loaded published replays; add stays in details',()=>{
 for(const count of [0,1,40]) {
  const rows=count?[replay(1),...(count>1?[replay(20)]:[])]:[]
  const render=setup(rows,count), tree=render()
  assert.equal(find(tree,n=>n.type==='history').props.total,rows.length)
  assert.equal(nodes(tree).filter(n=>n.type==='button'&&n.props.className?.includes('frame-replay-indicator')).length,rows.length)
  assert.equal(nodes(tree).filter(n=>n.type==='RecordingUploadAction').length,count-rows.length)
  if(count){const indicator=find(tree,n=>n.type==='frame').children[0];assert.equal(indicator.type,'button');assert.equal(typeof indicator.props.onClick,'function')}
 }
 const render=setup([],1,false);assert.equal(find(render(),n=>n.type==='RecordingUploadAction'),undefined)
})
test('replay opens exact source, respects metadata aspect ratio, confirmation and deletion authorization',async()=>{
 const render=setup([replay(1)]);let tree=render()
 button(tree,'Watch replay').props.onClick();await tick();tree=render()
 assert.deepEqual(archive.signed,[['account','frame-1']])
 let video=find(tree,n=>n.type==='video');assert.equal(video.props.controls,true);assert.equal(video.props.playsInline,true)
 for(const [width,height] of [[576,1024],[1920,1080]]) {
  video.props.onLoadedMetadata({currentTarget:{videoWidth:width,videoHeight:height}});tree=render();video=find(tree,n=>n.type==='video');assert.equal(video.props.style.aspectRatio,`${width} / ${height}`)
 }
 button(tree,'Delete recording').props.onClick();tree=render();assert.equal(archive.removed.length,0)
 button(tree,'Keep replay').props.onClick();tree=render();assert.equal(find(tree,n=>n.type==='Modal'&&n.props.title.startsWith('Delete replay')),undefined)
 button(tree,'Delete recording').props.onClick();tree=render();await button(tree,'Delete video').props.onClick();tree=render()
 assert.deepEqual(archive.removed,[['account','frame-1',{path:'session/frame-1.mp4'}]])
 assert.equal(find(tree,n=>n.type==='history').props.total,0);assert.ok(find(tree,n=>n.type==='RecordingUploadAction'))
 const readOnly=setup([replay(1)],1,false);button(readOnly(),'Watch replay').props.onClick();await tick();assert.equal(button(readOnly(),'Delete recording'),undefined)
})
test('signing, expired playback and deletion errors remain visible without discarding the replay',async()=>{
 const render=setup([replay(1)]);archive.signError=true;button(render(),'Watch replay').props.onClick();await tick();let tree=render();assert.ok(button(tree,'Open fresh replay link'))
 archive.signError=false;button(tree,'Open fresh replay link').props.onClick();await tick();tree=render();find(tree,n=>n.type==='video').props.onError();tree=render();assert.match(JSON.stringify(tree),/expired/)
 button(tree,'Open fresh replay link').props.onClick();await tick();tree=render();archive.removeError=true;button(tree,'Delete recording').props.onClick();tree=render();await button(tree,'Delete video').props.onClick();tree=render();assert.match(JSON.stringify(tree),/Removal unconfirmed/);assert.equal(find(tree,n=>n.type==='history').props.total,1)
 find(tree,n=>n.type==='Modal'&&n.props.title==='Frame 1 replay').props.onClose();assert.equal(find(render(),n=>n.type==='video'),undefined)
})

const uploadText = await readFile(new URL('../../src/features/replays/RecordingUpload.tsx', import.meta.url), 'utf8')
const uploadSource = uploadText.replace(/^import .*$/gm, '')
const uploadPrelude = prelude.replace(",RecordingUploadAction='RecordingUploadAction'", '') + 'const getFrameRecording=async()=>null;'
const uploadCompiled = ts.transpileModule(uploadPrelude + uploadSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.React } }).outputText
const { RecordingUploadAction } = await import('data:text/javascript;base64,' + Buffer.from(uploadCompiled).toString('base64'))
test('Add recording launches existing file picker; queued and failed recordings retain management access',()=>{
 let picks=0
 for (const status of [null,'queued','processing','failed']) {
  const pending=status?{processing_status:status}:null
  globalThis.archive={states:[null,{current:{click(){picks++}}},pending,true,false,false],cursor:0}
  const render=()=>{archive.cursor=0;return RecordingUploadAction({userId:'account',frame:frame(1),onPublished(){}})}
  let tree=render()
  if (!pending) {button(tree,'Add recording').props.onClick();assert.equal(picks,1);assert.equal(nodes(tree).filter(n=>n.type==='button').length,1)}
  else {const action=find(tree,n=>n.type==='button');action.props.onClick();tree=render();assert.ok(find(tree,n=>n.type==='Modal'));assert.equal(button(tree,'Add recording'),undefined)}
 }
})

const outcomeText = await readFile(new URL('../../src/features/connected/frameHistoryPresentation.ts', import.meta.url), 'utf8')
const { frameOutcome } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(outcomeText, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText).toString('base64'))
globalThis.frameOutcome = frameOutcome
const sessionText = (await readFile(new URL('../../src/features/connected/SessionView.tsx', import.meta.url), 'utf8')).replace(/^import .*$/gm, '')
const sessionPrelude = prelude.replace("const Icon='Icon',Modal='Modal',MatchDisclosureHeading='Disclosure',RecordingUploadAction='RecordingUploadAction';", "const Icon='Icon',Modal='Modal',RecordingUploadAction='RecordingUploadAction',FrameReplays='FrameReplays',MatchDisclosureHeading='Disclosure',MatchMomentumSection='Momentum',PageHeading='Heading',Eyebrow='Eyebrow'; const displayDate=value=>value??'Date not recorded';")
 .replace("({type,props:props??{},children})", "(type==='FrameReplays'?children[0]((f,placement)=>placement==='details'?null:({type:'button',props:{onClick:()=>globalThis.archive.watched++},children:['Replay']}),1):({type,props:props??{},children}))")
const sessionCompiled = ts.transpileModule(sessionPrelude + 'const frameOutcome=globalThis.frameOutcome;' + sessionText, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.React } }).outputText
const { SessionView } = await import('data:text/javascript;base64,' + Buffer.from(sessionCompiled).toString('base64'))
test('frame disclosure is a native full-row button, independent of Replay; observations preserve zero, false and unknown',()=>{
 const frames=Array.from({length:40},(_,i)=>({...frame(i+1),winner_id:'player',breaker_id:i?'player':null,special_event:i?'break_and_run':null,black_pocket_code:i?'TM':null,potted_on_break:i?false:null,participants:[{player_id:'player',foul_count:i?0:null}]}))
 globalThis.archive={cursor:0,states:[],watched:0}
 const state={session:{id:'session',status:'finalized',origin:'native',detail_eligible:true,occurred_on:null,date_precision:'unknown'},frames,participants:[{player_id:'player',display_name:'Donal'}],scores:{player:40},standings:[],corrections:[]}
 const render=()=>{archive.cursor=0;return SessionView({game:{state,userId:'account',options:{venues:[]},matchupCatalog:{player_id:'player'}},sessionId:'session'})}
 let tree=render();find(tree,n=>n.props.className==='frame-history-entry').props.onClick();tree=render();const toggles=nodes(tree).filter(n=>n.props.className==='frame-summary-toggle');assert.equal(toggles.length,40)
 assert.equal(toggles[0].type,'button');assert.equal(toggles[0].props['aria-expanded'],false)
 const details=id=>find(tree,n=>n.props.id===`frame-details-${id}`)
 assert.equal(details('frame-1').props.hidden,true)
 toggles[0].props.onClick();tree=render();assert.equal(details('frame-1').props.hidden,false)
 assert.equal(details('frame-1').props.hidden,false)
 assert.match(JSON.stringify(details('frame-1')),/Not recorded/)
 assert.match(JSON.stringify(details('frame-2')),/Top middle/);assert.match(JSON.stringify(details('frame-2')),/Break and run/)
 assert.match(JSON.stringify(details('frame-2')),/Donal 0/);assert.match(JSON.stringify(details('frame-2')),/No/)
 find(tree,n=>n.props.className==='frame-summary-toggle').props.onClick();tree=render();assert.equal(details('frame-1').props.hidden,true)
})

test('dedicated archive shares published frames and excludes them from the Add frame selector',()=>{
 for(const rows of [[],[replay(1)],[replay(1),replay(2)],Array.from({length:5},(_,i)=>replay(i+1))]) {
  globalThis.archive={states:[rows,'ready',0,null,null,false,'',null],cursor:0,signed:[],removed:[]}
  const frames=Array.from({length:6},(_,i)=>frame(i+1))
  const render=()=>{archive.cursor=0;return FrameReplays({userId:'account',sessionId:'session',archiveFrames:frames,upload:{playerId:'player',detailEligible:true},describeFrame:f=>`Donal won · ${f.frame_number}`,children:()=>null})}
  let tree=render();const heading=find(tree,n=>n.type==='h2');assert.ok(heading.children.join('').includes(` · ${rows.length}`))
  assert.equal(nodes(tree).filter(n=>n.type==='article').length,Math.min(3,rows.length))
  if(rows.length>3){find(tree,n=>n.props.className?.includes('view-all-replays')).props.onClick();tree=render();assert.equal(nodes(tree).filter(n=>n.type==='article').length,rows.length)}
  assert.notEqual(find(tree,n=>n.props.id==='match-replays-content').props.hidden,true)
  button(tree,'Add frame recording').props.onClick();tree=render();const options=nodes(tree).filter(n=>n.type==='option'&&n.props.value)
  assert.deepEqual(options.map(n=>n.props.value),frames.filter(f=>!rows.some(r=>r.frame_id===f.id)).map(f=>f.id))
  assert.equal(button(tree,'Add recording').props.disabled,true)
  find(tree,n=>n.type==='select').props.onChange({target:{value:'frame-6'}});tree=render();assert.equal(find(tree,n=>n.type==='RecordingUploadAction').props.frame.id,'frame-6')
 }
})

test('frame outcomes use only linked participant UUIDs; tied match scores never fabricate drawn frames',()=>{
 const saved={...frame(1),winner_id:'player'}
 assert.equal(frameOutcome(saved,'player'),'won')
 assert.equal(frameOutcome({...saved,participants:[{player_id:'player'},{player_id:'opponent'}]},'opponent'),'lost')
 for(const identity of [null,undefined,'viewer'])assert.equal(frameOutcome(saved,identity),'neutral')
 assert.equal(frameOutcome({...saved,winner_id:null},'player'),'neutral')
 assert.equal(frameOutcome({...saved,status:'voided'},'player'),'neutral')
})
