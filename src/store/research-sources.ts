import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { researchSource, researchPassage, type ResearchSourceStore } from "../core/maths-companion.ts";
import { AtlasError } from "../core/atlas.ts";
import { writeFileAtomicSync } from "./atomic-write.ts";
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
/** Session-scoped immutable sources; metadata/citations publish only after originals. */
export function createResearchSourceStore(root: string): ResearchSourceStore {
    const regular = (file: string) => { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink())
        throw new AtlasError("Invalid research source file.", 409); };
    const dir = (chat: string) => {
        if (!/^[\w-]+$/.test(chat))
            throw new AtlasError("Invalid session ID.");
        const folder = path.join(root, chat);
        for (const candidate of [root, folder])
            if (fs.existsSync(candidate) && (!fs.lstatSync(candidate).isDirectory() || fs.lstatSync(candidate).isSymbolicLink()))
                throw new AtlasError("Invalid research source directory.", 409);
        return folder;
    };
    const source = (chat: string, id: string) => {
        if (!/^rs_[a-f0-9]{64}$/.test(id))
            throw new AtlasError("Invalid source ID.");
        const file = path.join(dir(chat), `${id}.json`);
        if (!fs.existsSync(file))
            throw new AtlasError("Research source not found.", 404);
        regular(file);
        const result = researchSource.parse(JSON.parse(fs.readFileSync(file, "utf8")));
        if (result.id !== id || result.id !== `rs_${result.hash}`)
            throw new AtlasError("Research source metadata changed.", 409);
        return result;
    };
    const store: ResearchSourceStore = {
        retain(chat, input) {
            const digest = hash(input.bytes), id = `rs_${digest}`, folder = dir(chat);
            const record = researchSource.parse({ version: 1, id, hash: digest, title: input.title, authors: input.authors, url: input.url, pages: input.pages, size: input.bytes.length, retrievedAt: new Date().toISOString() });
            fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
            const original = path.join(folder, `${id}.pdf`);
            if (fs.existsSync(original)) {
                regular(original);
                if (hash(fs.readFileSync(original)) !== digest)
                    throw new AtlasError("Research source original changed.", 409);
            }
            else
                writeFileAtomicSync(original, input.bytes, { mode: 0o600 });
            const metadata = path.join(folder, `${id}.json`);
            if (fs.existsSync(metadata)) {
                store.asset(chat, id);
                return source(chat, id);
            }
            writeFileAtomicSync(metadata, JSON.stringify(record), { mode: 0o600 });
            return record;
        },
        putPassage(chat, input) {
            const saved = source(chat, input.source.id);
            if (saved.hash !== input.source.hash || input.page > saved.pages)
                throw new AtlasError("Invalid source passage.");
            const parsed = researchPassage.omit({ id: true, version: true }).parse({ ...input, source: saved });
            if (parsed.location === "exact" && !parsed.rects.length || parsed.location === "page-only" && parsed.rects.length)
                throw new AtlasError("Invalid passage highlight.");
            const id = `rp_${hash(JSON.stringify(parsed))}`, record = researchPassage.parse({ version: 1, id, ...parsed });
            writeFileAtomicSync(path.join(dir(chat), `${id}.json`), JSON.stringify(record), { mode: 0o600 });
            return record;
        },
        passage(chat, id) {
            if (!/^rp_[a-f0-9]{64}$/.test(id))
                throw new AtlasError("Invalid passage ID.");
            const file = path.join(dir(chat), `${id}.json`);
            if (!fs.existsSync(file))
                throw new AtlasError("Research passage not found.", 404);
            regular(file);
            const record = researchPassage.parse(JSON.parse(fs.readFileSync(file, "utf8")));
            const { id: storedId, version: _version, ...content } = record;
            if (storedId !== id || id !== `rp_${hash(JSON.stringify(content))}`)
                throw new AtlasError("Research passage metadata changed.", 409);
            const original = store.asset(chat, record.source.id);
            if (original.source.hash !== record.source.hash || record.page > original.source.pages)
                throw new AtlasError("Research passage source changed.", 409);
            return record;
        },
        asset(chat, id) {
            const record = source(chat, id), file = path.join(dir(chat), `${id}.pdf`);
            regular(file);
            if (fs.statSync(file).size !== record.size)
                throw new AtlasError("Research source original changed.", 409);
            const bytes = fs.readFileSync(file);
            if (hash(bytes) !== record.hash)
                throw new AtlasError("Research source original changed.", 409);
            return { source: record, bytes };
        },
    };
    return store;
}
