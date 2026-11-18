import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {parseHTML} from 'linkedom';
import {registerHooks} from 'node:module';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {scratchpadChanges} from '../components/scratchpad-changes.ts';
import type {ScratchScene} from '../src/core/scratchpad.ts';

const globals = globalThis as typeof globalThis & {React: typeof React; editorProps: Record<string, (...args: any[]) => void>; sceneCopies: number};
globals.React = React;
globals.sceneCopies = 0;
const mock = 'data:text/javascript,' + encodeURIComponent(`
 export function Excalidraw(props) { globalThis.editorProps=props; return null; }
 export function getSceneVersion(elements) { return elements.reduce((sum,e)=>sum+e.version,0); }
 export function serializeAsJSON(elements,appState,files) {
  globalThis.sceneCopies++; return JSON.stringify({type:'excalidraw',version:2,elements,appState,files});
 }
 export async function exportToBlob() { return null; }
`);
const hooks = registerHooks({resolve(specifier, context, next) {
 if (specifier === '@excalidraw/excalidraw') return {url: mock, shortCircuit: true};
 if (specifier.endsWith('.css')) return {url: 'data:text/javascript,export {}', shortCircuit: true};
 return next(specifier, context);
}});
const {default: Editor} = await import('../components/scratchpad-editor.tsx');
const empty: ScratchScene = {type: 'excalidraw', version: 2, elements: [], appState: {}, files: {}};

test('real editor callbacks defer serialization of embedded images and readonly callbacks stay silent', async () => {
 const dom = parseHTML('<html><body><div id="root"></div></body></html>');
 Object.assign(globalThis, {window: dom.window, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true});
 const root = createRoot(document.getElementById('root')!);
 const changes = scratchpadChanges(empty);
 let handle: import('../components/scratchpad-editor.tsx').ScratchEditorHandle | undefined;
 const props = {initial: empty, onChange: changes.change, onReady: (value: NonNullable<typeof handle>) => {handle=value;}};
 try {
  await act(async () => root.render(<Editor {...props} disabled={false}/>));
  let elements = [{id: 'stroke', version: 0}], state = {scrollX: 0, scrollY: 0, zoom: {value: 1}, activeTool: {type: 'freedraw'}, currentItemStrokeWidth: 1, currentItemStrokeColor: '#1b1b1f'};
  const files = {image: {id: 'image', dataURL: 'data:image/png;base64,' + 'x'.repeat(1024 * 1024)}};
  await act(async () => globals.editorProps.excalidrawAPI!({getSceneElementsIncludingDeleted: () => elements, getAppState: () => state, getFiles: () => files}));
  await act(async () => {
   for (let version=1; version<=100; version++) {
    elements=[{id: 'stroke', version}]; state={...state, scrollX: version};
    globals.editorProps.onChange!(elements, state, files);
   }
  });
  assert.equal(globals.sceneCopies, 0, 'pen/pan burst must not serialize the image');
  const capture=changes.capture();
  assert.equal(globals.sceneCopies, 1);
  assert.equal(capture.scene.elements[0]!.version, 100);
  assert.equal(capture.scene.appState.scrollX, 100);
  assert.equal(capture.scene.files.image, files.image);
  changes.saved(capture.version);
  await act(async () => root.render(<Editor {...props} disabled/>));
  await act(async () => globals.editorProps.onChange!([{id:'readonly', version:101}], state, files));
  assert.equal(changes.dirty(), false, 'readonly scene must not schedule saves');
  assert.equal(globals.sceneCopies, 1);
 } finally {
  await act(async () => root.unmount());
  hooks.deregister();
 }
});
