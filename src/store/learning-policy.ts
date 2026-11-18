import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { LearningEvent, LearningLedger, LearningPolicyStore } from '../core/learning-policy.ts';

/** Legacy JSON remains a recovery copy after its transactional import. */
export function createLearningPolicyStore(root: string): LearningPolicyStore {
    function legacy(id: string) {
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('Invalid learning session ID.');
        return path.join(root, id + '.json');
    }
    function database<T>(run: (db: DatabaseSync) => T): T {
        fs.mkdirSync(root, { recursive: true, mode: 0o700 });
        fs.chmodSync(root, 0o700);
        const file = path.join(root, 'learning.sqlite');
        const fd = fs.openSync(file, 'a', 0o600);
        fs.closeSync(fd);
        fs.chmodSync(file, 0o600);
        const db = new DatabaseSync(file, { timeout: 1000 });
        try {
            const version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
            if (version > 1) throw new Error('Unsupported learning database version.');
            if (version === 0) db.exec('BEGIN IMMEDIATE; CREATE TABLE sessions (id TEXT PRIMARY KEY, revision INTEGER NOT NULL); CREATE TABLE events (seq INTEGER PRIMARY KEY, chat_id TEXT NOT NULL, id TEXT NOT NULL, type TEXT NOT NULL, record TEXT NOT NULL, UNIQUE(chat_id,id)); CREATE INDEX events_by_type ON events(chat_id,type,seq); PRAGMA user_version=1; COMMIT;');
            return run(db);
        } finally { db.close(); }
    }
    function migrate(db: DatabaseSync, id: string) {
        const file = legacy(id);
        if (db.prepare('SELECT 1 FROM sessions WHERE id=?').get(id)) return;
        let ledger: LearningLedger = { schemaVersion: 1, revision: 0, events: [] };
        if (fs.existsSync(file)) {
            ledger = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (ledger.schemaVersion !== 1 || !Array.isArray(ledger.events) || !Number.isSafeInteger(ledger.revision) || ledger.revision !== ledger.events.length || ledger.events.some(e => !e || typeof e.id !== 'string' || typeof e.type !== 'string')) throw new Error('Unsupported learning ledger.');
        }
        db.exec('BEGIN IMMEDIATE');
        try {
            if (!db.prepare('SELECT 1 FROM sessions WHERE id=?').get(id)) {
                db.prepare('INSERT INTO sessions VALUES (?,?)').run(id, ledger.revision);
                const insert = db.prepare('INSERT INTO events(chat_id,id,type,record) VALUES (?,?,?,?)');
                for (const event of ledger.events) insert.run(id, event.id, event.type, JSON.stringify(event));
            }
            db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    function records(db: DatabaseSync, id: string, type?: LearningEvent['type']): LearningEvent[] {
        const rows = type ? db.prepare('SELECT record FROM events WHERE chat_id=? AND type=? ORDER BY seq').all(id, type) : db.prepare('SELECT record FROM events WHERE chat_id=? ORDER BY seq').all(id);
        return rows.map(row => JSON.parse(String(row.record)));
    }
    function readFrom(db: DatabaseSync, id: string): LearningLedger {
        return { schemaVersion: 1, revision: Number(db.prepare('SELECT revision FROM sessions WHERE id=?').get(id)!.revision), events: records(db, id) };
    }
    function insert(db: DatabaseSync, id: string, event: LearningEvent, activity: boolean) {
        db.exec('BEGIN IMMEDIATE');
        try {
            const row = db.prepare('SELECT record FROM events WHERE chat_id=? AND id=?').get(id, event.id);
            if (row) {
                const prior = JSON.parse(String(row.record)) as LearningEvent;
                if (activity ? prior.type !== 'activity' || JSON.stringify(prior.data) !== JSON.stringify(event.data) : JSON.stringify(prior) !== JSON.stringify(event)) throw new Error(activity ? 'Activity receipt conflict.' : 'Learning event identity conflict.');
            } else {
                db.prepare('INSERT INTO events(chat_id,id,type,record) VALUES (?,?,?,?)').run(id,event.id,event.type,JSON.stringify(event));
                db.prepare('UPDATE sessions SET revision=revision+1 WHERE id=?').run(id);
            }
            db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    return {
        list: () => database(db => [...new Set([...fs.readdirSync(root).filter(f => f.endsWith('.json')).map(f => f.slice(0,-5)), ...db.prepare('SELECT id FROM sessions WHERE revision>0').all().map(row => String(row.id))])]),
        remove: id => database(db => { const file = legacy(id); migrate(db,id); db.exec('BEGIN IMMEDIATE'); try { db.prepare('DELETE FROM events WHERE chat_id=?').run(id); db.prepare('DELETE FROM sessions WHERE id=?').run(id); fs.rmSync(file, { force: true }); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; } }),
        read: id => database(db => { migrate(db,id); return readFrom(db,id); }),
        events: (id,type) => database(db => { migrate(db,id); return records(db,id,type); }),
        event: (id,eventId) => database(db => { migrate(db,id); const row = db.prepare('SELECT record FROM events WHERE chat_id=? AND id=?').get(id,eventId); return row ? JSON.parse(String(row.record)) : undefined; }),
        append: (id,event) => database(db => { migrate(db,id); insert(db,id,event,false); return readFrom(db,id); }),
        appendActivity: (id,event) => database(db => { migrate(db,id); insert(db,id,event,true); }),
    };
}
