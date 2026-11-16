import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomicSync } from './atomic-write.ts';
import type { LearningEvent, LearningLedger, LearningPolicyStore } from '../core/learning-policy.ts';
/** One process writer, immutable logical events, atomic replacement and idempotent receipts. */
export function createLearningPolicyStore(root: string): LearningPolicyStore {
    function file(id: string) { if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id))
        throw new Error('Invalid learning session ID.'); return path.join(root, id + '.json'); }
    function read(id: string): LearningLedger { const f = file(id); if (!fs.existsSync(f))
        return { schemaVersion: 1, revision: 0, events: [] }; const v = JSON.parse(fs.readFileSync(f, 'utf8')); if (v.schemaVersion !== 1 || !Array.isArray(v.events))
        throw new Error('Unsupported learning ledger.'); return v; }
    return { read, list: () => fs.existsSync(root) ? fs.readdirSync(root).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)) : [], remove: id => fs.rmSync(file(id), { force: true }), append(id: string, event: LearningEvent) { const old = read(id), prior = old.events.find(e => e.id === event.id); if (prior) {
            if (JSON.stringify(prior) !== JSON.stringify(event))
                throw new Error('Learning event identity conflict.');
            return old;
        } const next = { ...old, revision: old.revision + 1, events: [...old.events, event] }; fs.mkdirSync(root, { recursive: true, mode: 0o700 }); writeFileAtomicSync(file(id), JSON.stringify(next), { mode: 0o600 }); return next; } };
}
