import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { researchTrailId, researchWorkspaceId, type ResearchStore, type ResearchWorkspace } from '../core/research-trails.ts';
import { writeFileAtomicSync } from '../store/atomic-write.ts';

const within = (file: string, root: string) => file === root || file.startsWith(root + path.sep);
const manifestSchema = z.object({schemaVersion:z.literal(1),workspaceId:researchWorkspaceId,trails:z.array(z.object({trailId:researchTrailId,relativePath:z.string()}).strict()).max(10000)}).strict().refine(m => new Set(m.trails.map(t => t.trailId)).size === m.trails.length && m.trails.every(t => t.relativePath === `trails/${t.trailId}`), 'Invalid trail registry');
const canonicalPotential = (input:string):string => {
 let current=path.resolve(input); const missing:string[]=[];
 while (!fs.existsSync(current)) { const parent=path.dirname(current); if (parent === current) break; missing.unshift(path.basename(current)); current=parent; }
 return path.join(fs.realpathSync(current),...missing);
};
const noSymlink = (file: string, directory: boolean) => {
 const stat = fs.lstatSync(file);
 if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw new Error('Research Atlas paths must be regular files and folders, not symlinks.');
};
function syncDirectory(dir:string) { const fd=fs.openSync(dir,'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function ensureDirectory(dir: string) {
 try { fs.mkdirSync(dir, {mode:0o700}); syncDirectory(path.dirname(dir)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
 noSymlink(dir, true);
}
function readManifest(file: string) {
 noSymlink(file, false);
 if (fs.statSync(file).size > 1024 * 1024) throw new Error('Workspace manifest is too large.');
 try { return manifestSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8'))); }
 catch { throw new Error('Workspace manifest is invalid or incompatible.'); }
}
function publishMissing(file: string, content: string) {
 const temp = path.join(path.dirname(file), `.atlas-${randomUUID()}.tmp`);
 let fd: number | undefined;
 try {
  fd = fs.openSync(temp, 'wx', 0o600); fs.writeFileSync(fd, content); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
  try { fs.linkSync(temp, file); syncDirectory(path.dirname(file)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  noSymlink(file, false);
 } finally { if (fd !== undefined) fs.closeSync(fd); try { fs.unlinkSync(temp); } catch {} }
}
async function openEditor(root: string) {
 if (process.platform !== 'darwin') throw new Error('Opening VS Code currently supports macOS.');
 await new Promise<void>((resolve, reject) => {
  const child = spawn('/usr/bin/open', ['-a', 'Visual Studio Code', root], {stdio:'ignore'});
  child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error('Install Visual Studio Code to open this project.')));
 });
}
export function createResearchWorkspaceService(store: ResearchStore, dataRoot: string, options: {openEditor?: (root:string) => Promise<void>; defaultBase?: string; onStep?: (step:string) => void} = {}) {
 const workspace = (id:string) => { researchWorkspaceId.parse(id); const w = store.list().workspaces.find(item => item.id === id); if (!w) throw new Error('Workspace not found.'); return w; };
 const validateRoot = (input:string) => {
  if (typeof input !== 'string' || input.length > 4096 || !path.isAbsolute(input) || input.split(path.sep).includes('..')) throw new Error('Choose an absolute project folder path.');
  const root = fs.realpathSync(input), home = fs.realpathSync(os.homedir()), data = canonicalPotential(dataRoot);
  if (!fs.statSync(root).isDirectory() || root === path.parse(root).root || root === home || within(root, data) || within(data, root) || /(^|\/)(\.ssh|\.aws|\.gnupg|\.codex|\.config|Library)(\/|$)/i.test(root)) throw new Error('Choose a dedicated project folder outside app data and private configuration.');
  return root;
 };
 const saveState = (w:ResearchWorkspace, provision:ResearchWorkspace['provision'], localRoot = w.localRoot) => {
  store.save({kind:'workspace',requestId:randomUUID(),id:w.id,label:w.label,localRoot,expectedRevision:w.revision,provision}); return workspace(w.id);
 };
 const inspectIdentity = (root:string, id?:string, required = false) => {
  const dir = path.join(root,'.research-atlas'), file = path.join(dir,'workspace.json');
  if (!fs.existsSync(dir)) { if (required) throw new Error('Workspace manifest is missing; select the original workspace folder.'); return; }
  noSymlink(dir,true);
  if (!fs.existsSync(file)) { if (required) throw new Error('Workspace manifest is missing; select the original workspace folder.'); return; }
  const manifest = readManifest(file);
  if (!id || manifest.workspaceId !== id) throw new Error('This folder belongs to a different Research Atlas workspace.');
 };
 const bindExisting = ({path:input,label,requestId}:{path:string;label:string;requestId:string}) => {
  z.string().uuid().parse(requestId); const name = z.string().trim().min(1).max(160).parse(label), root = validateRoot(input);
  const existing = store.list().workspaces.find(w => w.localRoot === root);
  if (existing) { inspectIdentity(root, existing.id); return existing; }
  const id = `rw_${requestId}`; inspectIdentity(root,id);
  store.save({kind:'workspace',requestId,id,label:name,localRoot:root,expectedRevision:0,provision:'pending'}); return workspace(id);
 };
 return {
  bindExisting,
  create({basePath,name,label,requestId}:{basePath?:string;name:string;label?:string;requestId:string}) {
   z.string().uuid().parse(requestId);
   const folder = z.string().trim().min(1).max(160).regex(/^(?!\.{1,2}$)[^/\\\x00-\x1f]+$/).parse(name);
   const base = basePath ?? options.defaultBase ?? path.join(os.homedir(),'Documents','Research Atlas Projects');
   if (!basePath && !options.defaultBase) { const docs = path.join(os.homedir(),'Documents'); noSymlink(docs,true); ensureDirectory(base); }
   const rootBase = validateRoot(base);
   const target = path.join(rootBase,folder);
   try { fs.mkdirSync(target,{mode:0o700}); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (!store.list().workspaces.some(w => w.id === `rw_${requestId}` && w.localRoot === target)) throw new Error('That folder already exists; bind it explicitly or choose a new name.');
   }
   noSymlink(target,true);
   return bindExisting({path:target,label:label ?? folder,requestId});
  },
  rebind({workspaceId,path:input,expectedRevision,requestId}:{workspaceId:string;path:string;expectedRevision:number;requestId:string}) {
   z.string().uuid().parse(requestId); const w=workspace(workspaceId); const root=validateRoot(input); inspectIdentity(root,w.id,true);
   if (w.revision !== expectedRevision) { if (w.revision === expectedRevision + 1 && w.localRoot === root && w.provision === 'pending') return w; throw new Error('Workspace changed; refresh and retry.'); }
   if (store.list().workspaces.some(other => other.id !== w.id && other.localRoot === root)) throw new Error('This folder is already registered.');
   store.save({kind:'workspace',requestId,id:w.id,label:w.label,localRoot:root,expectedRevision,provision:'pending'}); return workspace(w.id);
  },
  provision({workspaceId,trailId,requestId}:{workspaceId:string;trailId:string;requestId:string}) {
   z.string().uuid().parse(requestId); researchTrailId.parse(trailId); let w=workspace(workspaceId); const detail=store.detail(trailId);
   if (detail.trail.workspaceId !== w.id) throw new Error('Bind the trail to this workspace first.');
   w=saveState(w,'pending');
   try {
    const root=validateRoot(w.localRoot); if (root !== w.localRoot) throw new Error('Workspace moved; rebind it explicitly.');
    inspectIdentity(root,w.id); const dir=path.join(root,'.research-atlas'); ensureDirectory(dir); options.onStep?.('directory');
    const file=path.join(dir,'workspace.json');
    if (!fs.existsSync(file)) publishMissing(file,JSON.stringify({schemaVersion:1,workspaceId:w.id,trails:[]},null,2)+'\n');
    let manifest=readManifest(file); if (manifest.workspaceId !== w.id) throw new Error('This folder belongs to a different Research Atlas workspace.'); options.onStep?.('manifest');
    const trailsDir=path.join(dir,'trails'); ensureDirectory(trailsDir); const trailDir=path.join(trailsDir,trailId); ensureDirectory(trailDir); const runs=path.join(trailDir,'runs'); ensureDirectory(runs);
    const rootNode=detail.nodes.find(n => n.id === detail.trail.rootNodeId); if (!rootNode) throw new Error('Research root node is missing.');
    publishMissing(path.join(trailDir,'brief.md'),`# Research question\n\n${rootNode.title}\n\n## Context and assumptions\n\n${rootNode.body}\n\nRelevant Atlas concepts: ${[...new Set([...detail.trail.anchorConceptIds,...rootNode.relatedConceptIds])].join(', ') || 'None linked yet.'}\n\n## What we want to establish\n\n## Known issues / constraints\n\n## Candidate approaches\n`); options.onStep?.('brief');
    publishMissing(path.join(trailDir,'handoff.md'),'# Research handoff\n\n## What changed\nNothing recorded yet.\n\n## Findings and evidence references\nNo findings recorded yet.\n\n## Failed or inconclusive approaches\nNone recorded yet.\n\n## Open mathematical questions\n\n## Suggested next action\n'); options.onStep?.('handoff');
    publishMissing(path.join(runs,'index.jsonl'),''); options.onStep?.('index');
    if (!manifest.trails.some(t=>t.trailId===trailId)) {
     const current=readManifest(file); if (JSON.stringify(current) !== JSON.stringify(manifest)) throw new Error('Workspace manifest changed; retry provisioning.');
     manifest={...manifest,trails:[...manifest.trails,{trailId,relativePath:`trails/${trailId}`}]}; writeFileAtomicSync(file,JSON.stringify(manifest,null,2)+'\n',{mode:0o600}); syncDirectory(dir);
    }
    readManifest(file); options.onStep?.('registry'); return saveState(w,'ready');
   } catch (error) { try { saveState(w,'repair-needed'); } catch {} throw error; }
  },
  async open(workspaceId:string) {
   const w=workspace(workspaceId); if (w.provision !== 'ready') throw new Error('Workspace needs repair before opening.');
   const root=validateRoot(w.localRoot); if (root !== w.localRoot) throw new Error('Workspace moved; rebind it explicitly.'); inspectIdentity(root,w.id,true);
   await (options.openEditor ?? openEditor)(root);
  },
 };
}
