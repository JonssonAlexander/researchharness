import type { ScratchScene } from '@/src/core';

/** Keep only the latest scene reader; copying assets waits until save/submit. */
export function scratchpadChanges(initial: ScratchScene) {
 let read = () => initial, version = 0, savedVersion = 0;
 return {
  change(next: () => ScratchScene) { read = next; version++; },
  capture() { return { scene: read(), version }; },
  saved(capturedVersion: number) { savedVersion = Math.max(savedVersion, capturedVersion); },
  dirty() { return version !== savedVersion; },
  reset(scene: ScratchScene) { read = () => scene; version = savedVersion = 0; },
 };
}
