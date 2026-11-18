import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { AtlasError } from '../core/atlas.ts';
import { researchRunSchema, researchRunIndexSchema, researchApplySchema, type PreparedResearch, type ResearchImportSource, type ResearchApply } from '../core/research-integration.ts';
import { researchTrailId, researchWorkspaceId, type ResearchStore } from '../core/research-trails.ts';

const hash = (value:string | Buffer) => createHash('sha256').update(value).digest('hex');
const inside = (file:string, root:string) => file === root || file.startsWith(root + path.sep);
const prohibited = /^(?:\.env(?:\..*)?|\.ssh|\.aws|\.gnupg|\.codex|\.config|\.git|\.npmrc|\.pypirc|\.netrc|\.git-credentials|auth\.json|chatgpt-credentials.*)$/i;
const manifest = z.object({schemaVersion:z.literal(1),workspaceId:researchWorkspaceId,trails:z.array(z.object({trailId:researchTrailId,relativePath:z.string()}).strict()).max(10000)}).strict().refine(m=>new Set(m.trails.map(t=>t.trailId)).size===m.trails.length && m.trails.every(t=>t.relativePath===`trails/${t.trailId}`));
const canonicalPotential = (value:string) => { let at=path.resolve(value); const missing:string[]=[]; while(!fs.existsSync(at)) {const next=path.dirname(at); if(next===at) break; missing.unshift(path.basename(at)); at=next;} return path.join(fs.realpathSync(at),...missing); };
function rootFor(input:string,dataRoot:string) {
 if (!path.isAbsolute(input) || input.split(path.sep).includes('..')) throw new Error('Invalid registered workspace path.');
 const root=fs.realpathSync(input), home=fs.realpathSync(os.homedir()), data=canonicalPotential(dataRoot);
 if(root!==input || root===path.parse(root).root || root===home || inside(root,data) || inside(data,root) || /(^|\/)(\.ssh|\.aws|\.gnupg|\.codex|\.config|Library)(\/|$)/i.test(root) || !fs.statSync(root).isDirectory()) throw new Error('Workspace path is unavailable or unsafe; rebind it.');
 return root;
}
function readBounded(root:string,relative:string,limit:number,artifact=false):Buffer {
 if (!relative || path.isAbsolute(relative) || relative.includes('\\') || relative.includes('\0')) throw new Error('Invalid source path.');
 const parts=relative.split('/');
 if(parts.some(p=>!p || p==='.' || p==='..' || (artifact && prohibited.test(p)))) throw new Error('Source path is outside the approved workspace.');
 let file=root;
 for(let i=0;i<parts.length;i++) {file=path.join(file,parts[i]!); const stat=fs.lstatSync(file); if(stat.isSymbolicLink() || (i<parts.length-1 ? !stat.isDirectory() : !stat.isFile())) throw new Error('Source paths cannot contain symlinks or special files.');}
 const fd=fs.openSync(file,fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
 try {
  const before=fs.fstatSync(fd), actual=fs.realpathSync(file), named=fs.lstatSync(file); if(actual!==file || !inside(actual,root) || !named.isFile() || named.ino!==before.ino || named.dev!==before.dev) throw new Error('Source path changed while reading.');
  if(!before.isFile() || before.size>limit) throw new Error('Source exceeds the permitted size.');
  const bytes=Buffer.alloc(before.size); let offset=0; while(offset<bytes.length) { const n=fs.readSync(fd,bytes,offset,bytes.length-offset,offset); if(!n) throw new Error('Source changed while reading; retry.'); offset+=n; }
  const after=fs.fstatSync(fd); if(fs.realpathSync(file)!==file || fs.lstatSync(file).ino!==before.ino || before.size!==after.size || before.mtimeMs!==after.mtimeMs || before.ctimeMs!==after.ctimeMs) throw new Error('Source changed while reading; retry.');
  return bytes;
 } finally {fs.closeSync(fd);}
}
function gitState(root:string,baseline:string|null) {
 const env={NODE_ENV:process.env.NODE_ENV,PATH:'/usr/bin:/bin',HOME:os.homedir(),LANG:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_CEILING_DIRECTORIES:path.dirname(root)};
 const base=['--no-pager','--no-optional-locks','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null'];
 const invoke=(args:string[])=>spawnSync('/usr/bin/git',[...base,...args],{cwd:root,encoding:'utf8',timeout:5000,maxBuffer:256*1024,env});
 const top=invoke(['rev-parse','--show-toplevel']); if(top.status!==0 || top.stdout.trim()!==root) return {git:null,fingerprint:hash('no-git'),state:hash('no-git')};
 const filters=invoke(['config','--name-only','--get-regexp','^filter\\..*\\.(clean|smudge|process|required)$']);
 if(filters.error || (filters.status!==0 && !(filters.status===1 && !filters.stdout)) || Buffer.byteLength(filters.stdout)>256*1024) return {git:null,fingerprint:hash('unavailable-git'),state:hash('unavailable-git')};
 const names=new Set<string>();
 for(const key of filters.stdout.split('\n').filter(Boolean)) {const match=/^filter\.([A-Za-z0-9][A-Za-z0-9._-]{0,127})\.(?:clean|smudge|process|required)$/.exec(key); if(!match || names.size>=256) return {git:null,fingerprint:hash('unavailable-git'),state:hash('unavailable-git')}; names.add(match[1]!);}
 const overrides=[...names].flatMap(name=>['clean','smudge','process','required'].flatMap(key=>['-c',`filter.${name}.${key}=${key==='required'?'false':''}`]));
 const run=(args:string[])=>invoke([...overrides,...args]);
 const head=run(['rev-parse','--verify','HEAD']), status=run(['status','--porcelain=v1','--untracked-files=normal']), unstaged=run(['diff','--stat','--no-ext-diff','--no-textconv']), staged=run(['diff','--cached','--stat','--no-ext-diff','--no-textconv']);
 if(head.status!==0 || status.status!==0 || unstaged.status!==0 || staged.status!==0) return {git:null,fingerprint:hash('unavailable-git'),state:hash('unavailable-git')};
 const revision=head.stdout.trim(); if(!/^[a-f0-9]{40,64}$/.test(revision)) return {git:null,fingerprint:hash('invalid-git'),state:hash('invalid-git')};
 const compared=baseline && /^[a-f0-9]{40,64}$/.test(baseline) ? run(['diff','--stat','--no-ext-diff','--no-textconv',baseline,revision]) : null;
 const lines=[...status.stdout.split('\n').filter(Boolean),...(compared?.status===0 ? compared.stdout.split('\n').filter(Boolean).map(line=>`Baseline: ${line}`) : [])]; const files:string[]=[]; let bytes=0;
 for(const line of lines) { const next=line.slice(0,1000); bytes+=Buffer.byteLength(next); if(files.length>=500 || bytes>32000) break; files.push(next); }
 const limitation=(compared?.status===0 ? 'Baseline comparison is available.' : 'No reliable Git baseline.')+' Working-tree fingerprint uses status and diff statistics, not file contents.'+(files.length<lines.length?' File list truncated.':'');
 return {git:{revision,dirty:!!status.stdout,files,limitation},fingerprint:hash(JSON.stringify([revision,status.stdout,unstaged.stdout,staged.stdout,compared?.status===0 ? compared.stdout : null])),state:hash(JSON.stringify([revision,status.stdout,unstaged.stdout,staged.stdout]))};
}

export function createResearchIntegrationService(store:ResearchStore,dataRoot:string) {
 const registered=(trailId:string) => {
  const detail=store.detail(trailId), workspace=detail.workspace;
  if(!workspace || detail.trail.workspaceId!==workspace.id) throw new Error('Bind a workspace before reviewing project changes.');
  if(workspace.provision!=='ready') throw new Error('Repair the workspace before reviewing project changes.');
  const root=rootFor(workspace.localRoot,dataRoot), manifestPath='.research-atlas/workspace.json';
  const manifestBytes=readBounded(root,manifestPath,1024*1024); let parsed:z.infer<typeof manifest>;
  try {parsed=manifest.parse(JSON.parse(manifestBytes.toString('utf8')));} catch {throw new Error('Workspace manifest is invalid or incompatible.');}
  if(parsed.workspaceId!==workspace.id || !parsed.trails.some(t=>t.trailId===trailId)) throw new Error('Workspace manifest does not match this trail.');
  return {detail,workspace,root,manifestPath,manifestBytes};
 };
 const verify=(snapshot:PreparedResearch) => {
  let captured:ReturnType<typeof registered>; try {captured=registered(snapshot.trailId);} catch {throw new AtlasError('Workspace changed; prepare a fresh review.',409);} const {root,workspace}=captured;
  if(workspace.id!==snapshot.workspaceId || workspace.revision!==snapshot.base.workspaceRevision) throw new AtlasError('Workspace changed; prepare a fresh review.',409);
  for(const [relative,expected] of Object.entries(snapshot.fileHashes)) {
   if(relative==='@git' || relative==='@git-state') continue;
   const limit=relative.endsWith('/workspace.json') || relative.endsWith('/index.jsonl') ? 1024*1024 : 65536;
   try {if(hash(readBounded(root,relative,limit))!==expected) throw new Error('changed');} catch {throw new AtlasError('Project sources changed; prepare a fresh review.',409);}
  }
  const cp=store.integration.checkpoint(snapshot.trailId,snapshot.workspaceId);
  if(hash(JSON.stringify(cp?.receipt ?? null))!==hash(JSON.stringify(snapshot.base.checkpointReceipt))) throw new AtlasError('Integration checkpoint changed; prepare a fresh review.',409);
  if(gitState(root,cp?.git?.revision ?? null).fingerprint!==snapshot.fileHashes['@git']) throw new AtlasError('Git state changed; prepare a fresh review.',409);
 };
 return {
  prepare(trailId:string):PreparedResearch {
   researchTrailId.parse(trailId); const {detail,workspace,root,manifestPath,manifestBytes}=registered(trailId), cp=store.integration.checkpoint(trailId,workspace.id);
   const basePath=`.research-atlas/trails/${trailId}`, fileHashes:Record<string,string>={[manifestPath]:hash(manifestBytes)},runHashes:Record<string,string>={},sources:ResearchImportSource[]=[],warnings:string[]=[];
   for(const [kind,name] of [['brief','brief.md'],['handoff','handoff.md']] as const) {
    const relative=`${basePath}/${name}`, bytes=readBounded(root,relative,65536), digest=hash(bytes); fileHashes[relative]=digest;
    if(cp?.fileHashes[relative]!==digest) sources.push({id:kind,kind,path:relative,hash:digest,content:bytes.toString('utf8')});
   }
   const indexPath=`${basePath}/runs/index.jsonl`, index=readBounded(root,indexPath,1024*1024); fileHashes[indexPath]=hash(index);
   const lines=index.toString('utf8').split('\n'), start=cp?.fileHashes[indexPath]===fileHashes[indexPath] ? Math.min(cp.runCursor ?? 0,lines.length) : 0;
   const seen=new Set<string>(); for(let i=0;i<start;i++) {try {seen.add(researchRunIndexSchema.parse(JSON.parse(lines[i]!)).runId);} catch {}}
   let remaining=0,runCursor=0,attempts=0;
   const warn=(message:string)=>{if(warnings.length<199) warnings.push(message);else if(warnings.length===199) warnings.push('Additional warnings were omitted.');};
   for(let i=start;i<lines.length;i++) {
    const line=lines[i]!.trim(); if(!line) continue;
    let entry:z.infer<typeof researchRunIndexSchema>|undefined; try {entry=researchRunIndexSchema.parse(JSON.parse(line));} catch {}
    const duplicate=entry && seen.has(entry.runId);
    if(entry && !duplicate && cp?.runHashes[entry.runId]===entry.hash) {seen.add(entry.runId);continue;}
    if(attempts>=20) {
     runCursor=i; const pendingSeen=new Set(seen);
     for(const next of lines.slice(i)) {if(!next.trim()) continue; try {const parsed=researchRunIndexSchema.parse(JSON.parse(next)); const repeated=pendingSeen.has(parsed.runId); pendingSeen.add(parsed.runId); if(!repeated && cp?.runHashes[parsed.runId]===parsed.hash) continue;} catch {} remaining++;}
     break;
    }
    attempts++;
    if(!entry) {warn(`Run index line ${i+1} is invalid.`); continue;}
    if(duplicate) {warn(`Run index line ${i+1} duplicates an earlier run ID.`);continue;} seen.add(entry.runId);
    const relative=`${basePath}/runs/${entry.path}`;
    try {
     const bytes=readBounded(root,relative,65536); if(hash(bytes)!==entry.hash) throw new Error('record hash differs');
     const run=researchRunSchema.parse(JSON.parse(bytes.toString('utf8'))); if(run.runId!==entry.runId || run.trailId!==trailId) throw new Error('record identity differs');
     fileHashes[relative]=entry.hash; runHashes[entry.runId]=entry.hash;
     sources.push({id:`run_${hash(entry.runId).slice(0,32)}`,kind:'run',path:relative,hash:entry.hash,content:bytes.toString('utf8'),run});
     const missing=['timestamp','codeReference','command','seed','environment','evaluators','metrics'].filter(key=>run[key as keyof typeof run]===undefined); if(missing.length) warn(`Run ${entry.runId} lacks reproducibility details: ${missing.join(', ')}.`);
     if(run.workbench) warn(`Run ${entry.runId} references a Workbench record; the reference has not been independently verified.`);
    } catch {warn(`Run ${entry.runId} is unavailable, invalid, or does not match its index.`);}
   }
   const git=gitState(root,cp?.git?.revision ?? null); fileHashes['@git']=git.fingerprint; fileHashes['@git-state']=git.state;
   if(!git.git) warn('Git metadata is unavailable; file-based changes remain reviewable.');
   else if(!cp?.git || cp.git.revision!==git.git.revision || cp.git.dirty!==git.git.dirty || cp.fileHashes['@git-state']!==git.state) sources.push({id:'git',kind:'git',path:'',hash:git.fingerprint,content:JSON.stringify(git.git)});
   const unsigned={id:randomUUID(),trailId,workspaceId:workspace.id,createdAt:new Date().toISOString(),status:'prepared' as const,base:{trailRevision:detail.trail.revision,workspaceRevision:workspace.revision,nodes:detail.nodes.map(n=>({id:n.id,revision:n.revision})),checkpointReceipt:cp?.receipt ?? null},sources,fileHashes,runHashes,git:git.git,warnings,remaining,runCursor};
   const snapshot:PreparedResearch={...unsigned,digest:hash(JSON.stringify(unsigned))}; verify(snapshot); return store.integration.prepare(snapshot);
  },
  apply(input:ResearchApply) {
   const parsed=researchApplySchema.parse(input), review=store.integration.review(parsed.reviewId);
   if(review.digest!==parsed.digest) throw new AtlasError('Review digest does not match.',409);
   if(review.status==='prepared') verify(review);
   return store.integration.apply(parsed);
  },
  inspect({reviewId,sourceId,artifactIndex,approve}:{reviewId:string;sourceId:string;artifactIndex?:number;approve:true}) {
   if(approve!==true) throw new Error('Explicit approval is required to inspect sources.');
   const review=store.integration.review(reviewId), source=review.sources.find(s=>s.id===sourceId); if(!source) throw new Error('Source not found in this review.');
   if(artifactIndex===undefined) return {content:source.content,mime:'text/plain'};
   if(!Number.isInteger(artifactIndex) || artifactIndex<0 || !source.run?.artifacts[artifactIndex]) throw new Error('Artifact not found in this review.');
   const artifact=source.run.artifacts[artifactIndex]!, {root,workspace}=registered(review.trailId); if(workspace.id!==review.workspaceId) throw new AtlasError('Workspace changed; prepare a fresh review.',409);
   const mime=artifact.mime; if(!mime) throw new Error('Artifact type must be declared.');
   const bytes=readBounded(root,artifact.path,mime.startsWith('text/') || mime==='application/json' ? 65536 : 2*1024*1024,true);
   if(hash(bytes)!==artifact.hash) throw new Error('Artifact changed since its run record.');
   if(mime.startsWith('text/') || mime==='application/json') return {content:bytes.toString('utf8'),mime};
   if(mime==='application/pdf' && !bytes.subarray(0,5).equals(Buffer.from('%PDF-')) || mime==='image/png' && !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || mime==='image/jpeg' && !bytes.subarray(0,3).equals(Buffer.from([255,216,255])) || mime==='image/webp' && (bytes.subarray(0,4).toString()!=='RIFF' || bytes.subarray(8,12).toString()!=='WEBP')) throw new Error('Artifact content does not match its declared type.');
   return {base64:bytes.toString('base64'),mime};
  },
 };
}
