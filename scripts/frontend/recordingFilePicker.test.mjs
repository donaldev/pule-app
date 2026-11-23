import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../../src/features/replays/RecordingFilePicker.tsx', import.meta.url), 'utf8')
const prelude = "const Icon='Icon';const React={createElement:(type,props,...children)=>({type,props:props??{},children})};"
const { outputText } = ts.transpileModule(prelude + source.replace(/^import .*$/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.React },
})
const { RecordingFilePicker, RecordingProgress } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))

test('the styled label owns a named native MP4 picker and clears its value for repeat selection', () => {
  const file = { name: 'frame.mp4', size: 72_400_000 }
  const selected = []
  const picker = RecordingFilePicker({ onChoose: value => selected.push(value) })
  const input = picker.children[0]
  assert.equal(picker.type, 'label')
  assert.equal(input.props.type, 'file')
  assert.equal(input.props['aria-label'], 'Choose video')
  assert.equal(input.props.accept, 'video/mp4,.mp4')
  for (let i = 0; i < 2; i++) {
    const currentTarget = { files: [file], value: 'frame.mp4' }
    input.props.onChange({ currentTarget })
    assert.equal(currentTarget.value, '')
  }
  assert.deepEqual(selected, [file, file])
  const chosen = RecordingFilePicker({ file, onChoose: () => {} })
  assert.match(JSON.stringify(chosen), /Change video/)
  assert.match(JSON.stringify(chosen), /72.40 MB/)
})

test('only measured progress renders a percentage', () => {
  const waiting = RecordingProgress({ title: 'Reading video details', detail: 'Checking the MP4' })
  assert.equal(waiting.children[1].type, 'progress')
  assert.equal(waiting.children[1].props.value, undefined)
  assert.equal(waiting.children[2], false)
  const measured = RecordingProgress({ title: 'Uploading video', detail: 'Sending the file', percent: 37 })
  assert.equal(measured.children[1].props.value, 37)
  assert.deepEqual(measured.children[2].children, [37, '%'])
})
