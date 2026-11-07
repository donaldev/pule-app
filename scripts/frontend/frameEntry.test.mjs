import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const source = await readFile(new URL('../../src/features/connected/SessionView.tsx', import.meta.url), 'utf8')
let values = [], cursor = 0
const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }), Fragment: 'fragment' }
globalThis.__frameTest = { React, useState(initial) { const index = cursor++; if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial; return [values[index], value => { values[index] = typeof value === 'function' ? value(values[index]) : value }] } }
const defaultsSource=await readFile(new URL('../../src/features/connected/frameDefaults.ts',import.meta.url),'utf8')
const defaultsCode=ts.transpileModule(defaultsSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
globalThis.__frameTest.frameDefaults=(await import('data:text/javascript;base64,'+Buffer.from(defaultsCode).toString('base64'))).frameDefaults
const input = source.replace(/^import .*$/gm, '') + '\nexport { FrameEntry, PairSetup }'
const code = ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.React } }).outputText
const { FrameEntry, PairSetup } = await import('data:text/javascript;base64,' + Buffer.from('const {React,useState,frameDefaults}=globalThis.__frameTest;\n' + code).toString('base64'))
function nodes(node) { return node && typeof node === 'object' ? [node, ...node.children.flatMap(nodes)] : [] }
const find = (tree, predicate) => nodes(tree).find(predicate)
test('Golden Break selects breaker and Yes; changing winner or No restores Normal', async () => {
 values = []; let payload
 const props = { frame: {id:'frame',participants:[{player_id:'a',side:1},{player_id:'b',side:2}],breaker_id:'a'}, state: {session:{id:'night',revision:1},participants:[{player_id:'a',display_name:'A'},{player_id:'b',display_name:'B'}],scores:{a:0,b:0}}, game: {canScore:true, scoring:async (_command,args)=>{payload=args;return true}}, correcting:false,onSaved:()=>{} }
 const render = () => { cursor = 0; return FrameEntry(props) }
 let tree = render()
 nodes(tree).filter(n=>n.props.className==='winner-choice')[1].props.onClick()
 tree = render()
 const choose = value => { find(tree,n=>n.type==='select').props.onChange({target:{value}});tree=render() }
 choose('golden_break')
 const potButton = value => find(tree,n=>n.type==='button' && n.children.includes(value))
 assert.equal(potButton('Yes').props['aria-pressed'],true)
 assert.equal(find(tree,n=>n.props.className?.includes('confirm-frame')).props.disabled,true)
 find(tree,n=>n.props['aria-label']==='Top left').props.onClick();tree=render()
 assert.equal(find(tree,n=>n.props.className?.includes('confirm-frame')).props.disabled,false)
 await tree.props.onSubmit({preventDefault(){}})
 // onSubmit schedules submit synchronously up to the awaited scoring call.
 assert.equal(payload.p_special,'golden_break');assert.equal(payload.p_potted_on_break,true);assert.equal(payload.p_winner,'a')
 const winners=()=>nodes(tree).filter(n=>n.props.className==='winner-choice')
 assert.equal(winners()[0].props['aria-pressed'],true);assert.equal(winners()[1].props['aria-pressed'],false)
 winners()[1].props.onClick();tree=render()
 assert.equal(find(tree,n=>n.type==='select').props.value,'regular')
 assert.equal(winners()[1].props['aria-pressed'],true)
 choose('golden_break')
 potButton('No').props.onClick();tree=render()
 assert.equal(find(tree,n=>n.type==='select').props.value,'regular')
 choose('break_and_run');potButton('No').props.onClick();tree=render()
 assert.equal(find(tree,n=>n.type==='select').props.value,'regular')
})
test('all six pockets remain rendered through selection and saving, without a default pocket', async () => {
 values=[];let finish
 const props={frame:{id:'f',winner_id:'a',participants:[{player_id:'a',side:1},{player_id:'b',side:2}]},state:{session:{id:'n',revision:1},participants:[],scores:{}},game:{canScore:true,scoring:()=>new Promise(resolve=>{finish=resolve})},onSaved:()=>{}}
 const render=()=>{cursor=0;return FrameEntry(props)}
 const pockets=tree=>nodes(find(tree,n=>n.props.className==='pocket-table')).filter(n=>n.type==='button')
 let tree=render();assert.equal(pockets(tree).length,6);assert.ok(pockets(tree).every(n=>!n.props['aria-pressed']))
 pockets(tree)[4].props.onClick();tree=render();assert.equal(pockets(tree).filter(n=>n.props['aria-pressed']).length,1)
 assert.equal(find(tree,n=>n.props.className?.includes('confirm-frame')).props.disabled,false)
 find(tree,n=>n.type==='button' && n.children.includes('Clear pocket')).props.onClick();tree=render()
 assert.equal(find(tree,n=>n.props.className?.includes('confirm-frame')).props.disabled,true)
 pockets(tree)[4].props.onClick();tree=render()
 tree.props.onSubmit({preventDefault(){}});props.game.blocked=true;tree=render()
 assert.equal(pockets(tree).length,6);assert.equal(pockets(tree)[4].props['aria-pressed'],true);finish(true)
})

test('editing an earlier frame preserves saved duration and sends only its existing correction payload',async()=>{
 values=[];const calls=[]
 const frame={id:'first',frame_number:1,winner_id:'a',potted_on_break:false,special_event:'regular',elapsed_ms:123000,participants:[{player_id:'a',side:1,foul_count:2},{player_id:'b',side:2,foul_count:1}]}
 const props={frame,state:{session:{id:'night',status:'active',revision:9},participants:[{player_id:'a',display_name:'Alpha'},{player_id:'b',display_name:'Beta'}],scores:{a:5,b:3}},game:{canScore:true,scoring:async(name,args)=>{calls.push({name,args});return true}},correcting:true,onSaved:()=>{}}
 const before=JSON.stringify(frame),render=()=>{cursor=0;return FrameEntry(props)}
 let tree=render()
 assert.ok(find(tree,n=>n.props.className==='correction-duration'))
 assert.equal(find(tree,n=>n.props.className==='clock-toggle'),undefined)
 assert.equal(find(tree,n=>n.children.includes('Save changes')).props.disabled,false)
 assert.equal(find(tree,n=>n.type==='textarea'),undefined)
 await tree.props.onSubmit({preventDefault(){}})
 assert.deepEqual(calls,[{name:'correct_frame',args:{p_session:'night',p_expected_revision:9,p_frame:'first',p_winner:'a',p_p1_fouls:2,p_p2_fouls:1,p_reason:'Edited saved frame',p_details:{special_event:'regular',potted_on_break:false,offender_id:null}}}])
 assert.equal(JSON.stringify(frame),before)
 props.state.session.status='finalized';await render().props.onSubmit({preventDefault(){}});assert.equal(calls.length,1)
})

test('editor win-type controls retain dependencies until explicitly corrected and persist one correction',async()=>{
 values=[];const calls=[]
 const props={frame:{id:'earlier',frame_number:1,winner_id:'b',breaker_id:'a',potted_on_break:false,special_event:'regular',elapsed_ms:61000,participants:[{player_id:'a',side:1,foul_count:0},{player_id:'b',side:2,foul_count:0}]},state:{session:{id:'night',status:'active',revision:8},participants:[{player_id:'a',display_name:'Alpha'},{player_id:'b',display_name:'Beta'}],scores:{a:2,b:1}},game:{canScore:true,scoring:async(name,args)=>{calls.push({name,args});return true}},correcting:true,onSaved:()=>{}}
 const render=()=>{cursor=0;return FrameEntry(props)};let tree=render()
 const selectType=value=>{find(tree,n=>n.type==='select').props.onChange({target:{value}});tree=render()}
 const save=()=>find(tree,n=>n.children.includes('Save changes'))
 selectType('golden_break');assert.equal(save().props.disabled,true)
 assert.equal(find(tree,n=>n.children.includes('No')).props['aria-pressed'],true)
 assert.equal(find(tree,n=>n.props.className==='winner-choice'&&n.props['aria-pressed']).children[0],'Beta')
 find(tree,n=>n.children.includes('Yes')).props.onClick();tree=render();assert.equal(save().props.disabled,true)
 find(tree,n=>n.props.className==='winner-choice').props.onClick();tree=render();assert.equal(save().props.disabled,false)
 await tree.props.onSubmit({preventDefault(){}});assert.deepEqual(calls.at(-1).args.p_details,{special_event:'golden_break',potted_on_break:true,offender_id:null})
 selectType('regular');assert.equal(save().props.disabled,false)
 selectType('super_foul');assert.equal(save().props.disabled,true)
 nodes(tree).filter(n=>n.type==='select')[1].props.onChange({target:{value:'b'}});tree=render();assert.equal(save().props.disabled,false)
 await tree.props.onSubmit({preventDefault(){}});assert.equal(calls.at(-1).args.p_details.offender_id,'b')
 selectType('regular');await tree.props.onSubmit({preventDefault(){}});assert.equal(calls.at(-1).args.p_details.offender_id,null)
 assert.equal(props.frame.elapsed_ms,61000);assert.ok(calls.every(c=>c.name==='correct_frame'&&c.args.p_frame==='earlier'))
})

test('editor prepopulates saved Golden Break and Super Foul without changing their observations',()=>{
 for(const special of ['golden_break','super_foul']){
 values=[];const props={frame:{id:'f',frame_number:12,winner_id:'a',breaker_id:'a',potted_on_break:true,special_event:special,offender_id:special==='super_foul'?'b':null,elapsed_ms:234000,participants:[{player_id:'a',side:1,foul_count:2},{player_id:'b',side:2,foul_count:3}]},state:{session:{status:'active'},participants:[],scores:{}},game:{canScore:true},correcting:true,onSaved:()=>{}}
 const before=JSON.stringify(props.frame);cursor=0;const tree=FrameEntry(props),selects=nodes(tree).filter(n=>n.type==='select')
 assert.equal(selects[0].props.value,special);assert.equal(find(tree,n=>n.children.includes('Yes')).props['aria-pressed'],true)
 if(special==='super_foul')assert.equal(selects[1].props.value,'b')
 assert.equal(find(tree,n=>n.children.includes('Save changes')).props.disabled,false);assert.equal(JSON.stringify(props.frame),before)
 }
})

test('fixed pair starts with one submission, uses saved defaults and keeps safe fallback/rotating selectors',async()=>{
 const calls=[];const game={canScore:true,scoring:async(name,args)=>{calls.push({name,args})}}
 const state={session:{id:'night',revision:1,initial_breaker_id:'b'},frames:[],participants:[{player_id:'a',side:1,display_name:'Alpha'},{player_id:'b',side:2,display_name:'Beta'}]}
 const render=()=>{cursor=0;return PairSetup({game,state})};values=[]
 let tree=render();assert.equal(nodes(tree).filter(n=>n.type==='select').length,0)
 assert.equal(find(tree,n=>n.children.includes('Start frame')).props.disabled,false)
 tree.props.onSubmit({preventDefault(){}});assert.deepEqual(calls[0],{name:'start_frame',args:{p_session:'night',p_expected_revision:1,p_players:['a','b'],p_breaker:'b'}})
 state.frames.push({frame_number:1,status:'completed',breaker_id:'b',winner_id:'a'});tree=render();tree.props.onSubmit({preventDefault(){}});assert.equal(calls[1].args.p_breaker,'a')
 state.frames[0].breaker_id=null;values=[];tree=render();assert.equal(nodes(tree).filter(n=>n.type==='select').length,1);assert.equal(find(tree,n=>n.children.includes('Start frame')).props.disabled,true)
 find(tree,n=>n.type==='select').props.onChange({target:{value:'b'}});tree=render();assert.equal(find(tree,n=>n.children.includes('Start frame')).props.disabled,false)
 state.participants.push({player_id:'c',side:3,display_name:'Gamma'});values=[];tree=render();assert.equal(nodes(tree).filter(n=>n.type==='select').length,3)
})
