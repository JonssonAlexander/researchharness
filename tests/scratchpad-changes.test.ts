import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scratchpadChanges } from '../components/scratchpad-changes.ts';
import type { ScratchScene } from '../src/core/scratchpad.ts';

const empty: ScratchScene = {type: 'excalidraw', version: 2, elements: [], files: {}, appState: {}};

test('a burst of scene changes copies no embedded assets until capture and retains the latest scene', () => {
 const changes = scratchpadChanges(empty);
 let copies = 0;
 const asset = 'data:image/png;base64,' + 'x'.repeat(1024 * 1024);
 for (let i = 1; i <= 100; i++) changes.change(() => {
  copies++;
  return JSON.parse(JSON.stringify({...empty, elements: [{id: `stroke-${i}`}], files: {image: {dataURL: asset}}}));
 });
 assert.equal(copies, 0);
 assert.equal(changes.dirty(), true);
 const capture = changes.capture();
 assert.equal(copies, 1);
 assert.equal(capture.scene.elements[0]!.id, 'stroke-100');
 assert.equal((capture.scene.files.image as {dataURL: string}).dataURL, asset);
 changes.saved(capture.version);
 assert.equal(changes.dirty(), false);
});

test('late save receipts cannot mark newer strokes saved; failed saves remain retryable', () => {
 const changes = scratchpadChanges(empty);
 changes.change(() => ({...empty, elements: [{id: 'old'}]}));
 const older = changes.capture();
 changes.change(() => ({...empty, elements: [{id: 'new'}]}));
 changes.saved(older.version);
 assert.equal(changes.dirty(), true);
 const latest = changes.capture();
 assert.equal(latest.scene.elements[0]!.id, 'new');
 assert.equal(changes.dirty(), true, 'capture or a failed request is not a save receipt');
 changes.saved(latest.version);
 changes.saved(older.version);
 assert.equal(changes.dirty(), false);
 changes.reset({...empty, elements: [{id: 'restored'}]});
 assert.equal(changes.capture().scene.elements[0]!.id, 'restored');
 assert.equal(changes.dirty(), false);
});

test('restoring a scene replaces the pending reader before the next editor callback', () => {
 const changes = scratchpadChanges(empty);
 changes.change(() => ({...empty, elements: [{id: 'old'}]}));
 const restored = {...empty, elements: [{id: 'restored'}]};
 changes.change(() => restored);
 assert.equal(changes.capture().scene, restored);
 assert.equal(changes.dirty(), true);
});
