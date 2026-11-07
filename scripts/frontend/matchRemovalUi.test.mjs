import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
let values=[],cursor=0
const React={createElement:(type,props,...children)=>typeof type==='function'&&['MatchDisclosureHeading','DisclosureHeading'].includes(type.name)?type({...props,children:children.flat(Infinity)}):({type,props:props??{},children:children.flat(Infinity)}),Fragment:'fragment'}
const Modal=()=>null
const state=initial=>{const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return [values[i],next=>{values[i]=typeof next==='function'?next(values[i]):next}]}
globalThis.__removalUi={React,Modal,useState:state,useEffect(){},useRef:v=>({current:v}),PageHeading:()=>null,Eyebrow:()=>null,displayDate:v=>v??'Unknown date'}
const headingSource=(await readFile(new URL('../../src/components/ui/DisclosureHeading.tsx',import.meta.url),'utf8')).replace(/^import .*$/gm,'')
const headingCode=ts.transpileModule('const {React}=globalThis.__removalUi;'+headingSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React}}).outputText
globalThis.__removalUi.MatchDisclosureHeading=(await import('data:text/javascript;base64,'+Buffer.from(headingCode).toString('base64'))).DisclosureHeading
const source=(await readFile(new URL('../../src/features/connected/SessionView.tsx',import.meta.url),'utf8')).replace(/^import .*$/gm,'')
const code=ts.transpileModule('const {React,Modal,useState,useEffect,useRef,PageHeading,Eyebrow,displayDate,MatchDisclosureHeading}=globalThis.__removalUi;const MatchMomentumSection=()=>null;\n'+source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React}}).outputText
const {SessionView}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const nodes=n=>n&&typeof n==='object'?[n,...n.children.flatMap(nodes)]:[]
const find=(tree,fn)=>nodes(tree).find(fn)
function fixture(status='active') {
 values=[]
 const calls=[]
 const game={canAdmin:true,canScore:true,busy:false,inputBlocked:true,error:'',actionError:'',options:{venues:[{id:'venue',display_name:'Test hall'}]},state:{session:{id:'night',status,revision:7,venue_id:'venue',occurred_on:'2026-11-05'},participants:[{player_id:'a',display_name:'Alpha'},{player_id:'b',display_name:'Beta'}],frames:[],scores:{a:0,b:0},standings:[],corrections:[]},setup:async(name,args)=>{calls.push({name,args});return true}}
 const render=()=>{cursor=0;return SessionView({game,sessionId:'night'})}
 return {game,calls,render}
}
test('Abandon and Delete open confirmation during background refresh; cancel sends nothing',()=>{
 for(const status of ['active','finalized']) {
 const {game,calls,render}=fixture(status);let tree=render()
 const open=find(tree,n=>n.props.className?.includes('remove-match'))
 assert.equal(open.props.disabled,false);open.props.onClick();tree=render()
 const modal=find(tree,n=>n.type===Modal);assert.equal(modal.props.title,status==='active'?'Abandon match?':'Delete match?')
 assert.equal(calls.length,0);find(modal,n=>n.children.includes('Keep match')).props.onClick()
 assert.equal(find(render(),n=>n.type===Modal),undefined)
 game.canAdmin=false;assert.equal(find(render(),n=>n.props.className?.includes('remove-match')),undefined)
 }
})
test('confirmation calls remove_match exactly, keeps failure local, and closes only on success',async()=>{
 for(const status of ['active','finalized']) {
 const {game,calls,render}=fixture(status);let tree=render();find(tree,n=>n.props.className?.includes('remove-match')).props.onClick();tree=render()
 game.setup=async(name,args)=>{calls.push({name,args});game.actionError='A previous action needs confirmation.';return false}
 await find(tree,n=>n.props.className?.includes('removal-confirm')).props.onClick();tree=render()
 assert.deepEqual(calls[0],{name:'remove_match',args:{p_session:'night',p_expected_revision:7,p_mode:status==='active'?'abandon':'delete'}})
 const modal=find(tree,n=>n.type===Modal);assert.ok(modal)
 assert.ok(find(modal,n=>n.props.role==='alert'&&n.children.includes('A previous action needs confirmation.')))
 game.setup=async()=>true;await find(tree,n=>n.props.className?.includes('removal-confirm')).props.onClick()
 assert.equal(find(render(),n=>n.type===Modal),undefined)
 }
})

test('history exposes every completed frame through Edit, with no duplicate last-frame action',()=>{
 const {game,render}=fixture();game.inputBlocked=false
 game.state.frames=[1,2,3].map(n=>({id:'f'+n,frame_number:n,status:'completed',winner_id:'a',elapsed_ms:n*60000,participants:[]}))
 let tree=render()
 assert.equal(find(tree,n=>n.children.includes('Edit last frame')),undefined)
 assert.equal(find(tree,n=>n.children.includes('Tonight’s standings')),undefined)
 for(const n of [1,2,3]){
  const edit=find(tree,node=>node.props['aria-label']==='Edit frame '+n);assert.ok(edit);assert.ok(edit.props.className.includes('button-secondary'))
  edit.props.onClick();tree=render();const modal=find(tree,node=>node.type===Modal);assert.equal(modal.props.title,'Editing frame '+n);modal.props.onClose();tree=render()
 }
 game.state.session.status='finalized';assert.equal(nodes(render()).filter(n=>n.props.className?.includes('edit-frame')).length,0)
})

test('completed history has explicit counted disclosures and preserves two-player scores',()=>{
 for(const count of [0,1,18]){
 const {game,render}=fixture('finalized');game.state.scores={a:12,b:6}
 game.state.frames=Array.from({length:count},(_,i)=>({id:'f'+i,frame_number:i+1,status:'completed',winner_id:i%2?'b':'a',elapsed_ms:60000,participants:[]}))
 let tree=render();assert.equal(find(tree,n=>n.type==='table'),undefined)
 assert.ok(find(tree,n=>n.props.className==='big-score'&&n.children.includes(12)))
 assert.equal(find(tree,n=>n.props.id==='session-frame-history').props.hidden,true)
 const control=find(tree,n=>n.props['aria-controls']==='session-frame-history');assert.equal(control.props['aria-expanded'],false);control.props.onClick();tree=render()
 assert.equal(find(tree,n=>n.props.id==='session-frame-history').props.hidden,false)
 assert.equal(find(tree,n=>n.props.className==='timeline').children.length,count)
 assert.equal(find(tree,n=>n.props['aria-controls']==='session-frame-history').props['aria-expanded'],true)
 assert.equal(nodes(tree).filter(n=>n.props.className?.includes('edit-frame')).length,0)
 if(!count)assert.ok(find(tree,n=>n.children.includes('No frame records are available for this night.')))
 const options=find(tree,n=>n.props['aria-controls']==='session-match-options');assert.equal(options.props['aria-expanded'],false);options.props.onClick();tree=render()
 assert.equal(find(tree,n=>n.props.id==='session-match-options').props.hidden,false)
 assert.ok(find(tree,n=>n.props.className?.includes('remove-match')&&n.children.includes('Delete match')))
 }
})
test('multiplayer keeps standings and imported result-only history explains absent details',()=>{
 const {game,render}=fixture('finalized');game.state.participants.push({player_id:'c',display_name:'Third'});game.state.scores.c=1
 assert.ok(find(render(),n=>n.type==='table'))
 game.state.session.origin='imported';game.state.session.detail_eligible=false
 assert.ok(find(render(),n=>n.children.includes('Only the final result is available for this night.')))
})
