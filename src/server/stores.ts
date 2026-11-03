import {createProblemStore} from "../store/problems.ts";
import {createLessonDocumentStore} from "../store/lesson-documents.ts";
/**
 * THE COMPOSITION ROOT for storage — the single place concrete store
 * adapters are wired. Everything else (core, services, agents) codes against
 * the port types in core/ports.ts and receives instances through this
 * module. Swapping the fs adapter for SQLite later changes exactly this
 * file (and the adapter implementations in src/store/).
 */

import {createScratchpadStore} from "../store/scratchpad.ts";
import {createLearningSessionStore} from "../store/learning-session.ts";
import { chatStore } from "../store/chats.ts";
import { graphStore } from "../store/graph.ts";
import { jobStore } from "../store/jobs.ts";
import { settingsStore } from "../store/settings.ts";
import path from "node:path";
import { PATHS } from "../../config.ts";
import { createAtlasStore } from "../store/atlas.ts";
import { resolveSettings, type EffectiveSettings } from "../core/settings-resolution.ts";
/** The wired adapters. Satisfies core/graph.ts's GraphDeps structurally. */
export const stores = {
 problemStore:createProblemStore(path.join(PATHS.data,"problems")),
 lessonDocuments:createLessonDocumentStore(path.join(PATHS.data,"lesson-sources")),
 scratchpadStore:createScratchpadStore(path.join(PATHS.data,"scratchpads")),
 lessonStore:createLearningSessionStore(path.join(PATHS.data,"lessons")),
	chatStore,
	graphStore,
	jobStore,
	settingsStore,
	atlasStore: createAtlasStore(path.join(PATHS.data, "atlas.sqlite")),
};

export type Stores = typeof stores;

/**
 * The resolved view of the settings record (core/settings-resolution.ts):
 * every knob concrete over its factory default — EXCEPT MODELS (BYOK all
 * the way down, owner 2026-09-22): no factory pins exist, so unset model
 * slots resolve to null and per-need refusal gates fire downstream. Read
 * fresh on every call — the record is a small file and turns are rare, so
 * no caching layer (stale toggles after a settings PUT would be worse).
 */
export function effectiveSettings(): EffectiveSettings {
	return resolveSettings(settingsStore.readSettings());
}
