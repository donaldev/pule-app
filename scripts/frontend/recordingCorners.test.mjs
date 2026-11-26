import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'

async function load(name, prelude = '') {
  const source = await readFile(new URL(`../../src/features/replays/${name}`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(prelude + source.replace(/^import .*$/gm, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.React },
  })
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
}

const viewport = await load('cornerViewport.ts')
const geometry = await load('recordingGeometry.ts')
globalThis.cornerHelpers = { ...viewport, ...geometry }
const { RecordingCorners } = await load('RecordingCorners.tsx', `
const {displaySize,displayToSource,sourceToDisplay,validCorners,clampViewport,fitScale,imageToStage,initialViewport,limitToImage,replaceCorner,stageToImage,zoomViewport}=globalThis.cornerHelpers;
const HTMLMediaElement={HAVE_CURRENT_DATA:2};
const React={Fragment:'fragment',createElement:(type,props,...children)=>{
  if(props?.ref) props.ref.current=globalThis.cornerTest.refs[type==='div'?'stage':type];
  return {type,props:props??{},children};
}};
const useState=initial=>{const h=globalThis.cornerTest,i=h.cursor++;if(!(i in h.hooks))h.hooks[i]=initial;return [h.hooks[i],next=>h.hooks[i]=next]};
const useRef=initial=>{const h=globalThis.cornerTest,i=h.cursor++;return h.hooks[i]??(h.hooks[i]={current:initial})};
const useEffect=()=>{}; const useId=()=> 'keyboard-help';
`)
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(nodes)] : []
const find = (tree, match) => nodes(tree).find(match)
const button = (tree, label) => find(tree, node => node.type === 'button' && node.children.includes(label))
const bounds = { left: 10, top: 40, width: 360, height: 480 }
function harness() {
  let current = 0
  const captures = []
  const changes = []
  const refs = {
    video: {
      videoWidth: 720, videoHeight: 1280, duration: 80, seeking: false, readyState: 2,
      get currentTime() { return current },
      set currentTime(time) { current = time; this.seeking = true },
    },
    canvas: { getContext: () => ({ drawImage: player => captures.push(player.currentTime) }) },
    stage: { getBoundingClientRect: () => bounds, setPointerCapture() {} },
  }
  globalThis.cornerTest = { hooks: [], refs }
  const props = {
    src: 'blob:recording', geometry: { width: 1280, height: 720, rotation: 90 },
    corners: [], disabled: false, confirmed: false, onDuration: () => {},
    onConfirm: () => { props.confirmed = true },
    onChange: next => { props.corners = next; props.confirmed = false; changes.push(next) },
  }
  function render() {
    cornerTest.cursor = 0
    return RecordingCorners(props)
  }
  function media(event) {
    find(render(), node => node.type === 'video').props[event]()
  }
  function pointer(event, id, x, y, marker = null) {
    const stage = find(render(), node => node.props.className === 'recording-table')
    stage.props[event]({
      pointerId: id, button: 0, clientX: x + bounds.left, clientY: y + bounds.top, currentTarget: refs.stage,
      target: { closest: () => marker === null ? null : { getAttribute: () => String(marker) } },
    })
  }
  return { props, render, media, pointer, refs, captures, changes }
}

test('scrubbing coalesces pending seeks and draws only the requested frame; the step controls seek by a quarter second', () => {
  const h = harness()
  h.media('onLoadedData')
  const scrub = value => find(h.render(), n => n.type === 'input').props.onChange({ currentTarget: { value } })
  scrub('20')
  scrub('37.5')
  assert.equal(h.refs.video.currentTime, 20)
  h.refs.video.seeking = false
  h.media('onSeeked')
  assert.equal(h.refs.video.currentTime, 37.5)
  assert.deepEqual(h.captures, [0])
  h.refs.video.seeking = false
  h.media('onSeeked')
  assert.deepEqual(h.captures, [0, 37.5])
  assert.equal(find(h.render(), n => n.type === 'input').props['aria-valuetext'], '0:37.50')
  button(h.render(), '+0.25 s').props.onClick()
  assert.equal(h.refs.video.currentTime, 37.75)
})

test('viewport math handles letterboxing and keeps the pinch anchor fixed under pan for rotated portrait footage', () => {
  const frame = { width: 720, height: 1280 }
  const initial = viewport.initialViewport
  assert.ok(viewport.stageToImage([20, 240], initial, bounds, frame)[0] < 0)
  const position = [210, 260], shifted = [220, 280]
  const zoom = viewport.zoomViewport(initial, 3, position, shifted, bounds, frame)
  assert.deepEqual(viewport.stageToImage(shifted, zoom, bounds, frame), viewport.stageToImage(position, initial, bounds, frame))
})

test('pinching and dragging the viewport never add corners; a dragged marker changes only its original-space point', () => {
  const h = harness()
  h.media('onLoadedData')
  const click = (x, y) => {
    h.pointer('onPointerDown', 1, x, y)
    h.pointer('onPointerUp', 1, x, y)
  }
  click(20, 120)
  assert.equal(h.props.corners.length, 0)
  h.pointer('onPointerDown', 1, 140, 240)
  h.pointer('onPointerDown', 2, 220, 240)
  h.pointer('onPointerMove', 1, 60, 240)
  h.pointer('onPointerMove', 2, 300, 240)
  h.pointer('onPointerUp', 1, 60, 240)
  h.pointer('onPointerUp', 2, 300, 240)
  h.pointer('onPointerDown', 1, 180, 240)
  h.pointer('onPointerMove', 1, 205, 230)
  h.pointer('onPointerUp', 1, 205, 230)
  assert.equal(h.changes.length, 0)
  button(h.render(), 'Reset zoom').props.onClick()
  for (const [x,y] of [[100,100],[260,100],[260,360],[100,360]]) click(x,y)
  const before = h.props.corners
  assert.deepEqual(before[0], geometry.displayToSource(viewport.stageToImage([100,100], viewport.initialViewport, bounds, {width:720,height:1280}), h.props.geometry))
  button(h.render(), 'Confirm table').props.onClick()
  assert.equal(button(h.render(), 'Confirm table').props.disabled, true)
  h.pointer('onPointerDown', 1, 100, 100, 0)
  h.pointer('onPointerMove', 1, 110, 120)
  h.pointer('onPointerUp', 1, 110, 120)
  assert.notDeepEqual(h.props.corners[0], before[0])
  assert.deepEqual(h.props.corners.slice(1), before.slice(1))
  assert.equal(h.props.confirmed, false)
})

test('selecting a marker focuses zoom and nudges one original pixel in the displayed direction',()=>{
 const h=harness()
 h.media('onLoadedData')
 const picture={width:720,height:1280}
 const source=geometry.displayToSource([400,850],h.props.geometry)
 h.props.corners=[source]
 h.props.confirmed=true
 const [x,y]=viewport.imageToStage([400,850],viewport.initialViewport,bounds,picture)
 h.pointer('onPointerDown',1,x,y,0)
 h.pointer('onPointerUp',1,x,y,0)
 assert.equal(h.changes.length,0)
 assert.ok(find(h.render(),n=>n.props['data-selected']===true))
 const action=label=>find(h.render(),n=>n.props['aria-label']===label).props.onClick()
 action('Zoom in')
 const focal=viewport.zoomViewport(viewport.initialViewport,1.5,[x,y],[180,240],bounds,picture)
 assert.equal(find(h.render(),n=>n.props.className==='recording-table-layer').props.style.transform,
  `translate(${focal.x}px, ${focal.y}px) scale(1.5)`)
 assert.deepEqual(h.props.corners,[source])
 action('Move corner up')
 assert.deepEqual(h.props.corners,[geometry.displayToSource([400,849],h.props.geometry)])
 assert.equal(h.props.confirmed,false)
})

test('a pinch that begins on an existing marker cancels its drag',()=>{
 const h=harness()
 h.media('onLoadedData')
 h.props.corners=[geometry.displayToSource([360,640],h.props.geometry)]
 h.pointer('onPointerDown',1,180,240,0)
 h.pointer('onPointerMove',1,190,240,0)
 h.pointer('onPointerDown',2,220,240)
 h.pointer('onPointerMove',2,310,240)
 h.pointer('onPointerUp',2,310,240)
 h.pointer('onPointerUp',1,190,240)
 assert.equal(h.changes.length,0)
})
