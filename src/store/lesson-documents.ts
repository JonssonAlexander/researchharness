import {writeFileAtomicSync} from "./atomic-write.ts";
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {lessonDocument,type LessonDocumentStore} from '../core/lesson-documents.ts';
import {AtlasError} from '../core/atlas.ts';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
/** Immutable, content-addressed originals; metadata is published last. */
export function createLessonDocumentStore(root:string):LessonDocumentStore{
 const dir=(chat:string)=>{if(!/^[\w-]+$/.test(chat))throw new AtlasError('Invalid session ID.');const folder=path.join(root,chat);if(fs.existsSync(folder)&&(!fs.lstatSync(folder).isDirectory()||fs.lstatSync(folder).isSymbolicLink()))throw new AtlasError('Invalid source directory.',409);return folder;};
 const regular=(file:string)=>{if(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink())throw new AtlasError('Invalid source file.',409);};
 const list:LessonDocumentStore['list']=chat=>{const folder=dir(chat);if(!fs.existsSync(folder))return [];return fs.readdirSync(folder).filter(f=>/^ls_[a-f0-9]{64}\.json$/.test(f)).map(f=>{const file=path.join(folder,f);regular(file);const d=lessonDocument.parse(JSON.parse(fs.readFileSync(file,'utf8')));if(f!==`${d.id}.json`)throw new AtlasError('Source metadata changed.',409);return d;});};
 return {list,put:(chat,name,bytes,kind,pages)=>{
  const digest=hash(bytes),id=`ls_${digest}`,folder=dir(chat),old=list(chat).find(d=>d.id===id);if(old)return old;if(list(chat).length>=8)throw new AtlasError('Use up to eight sources per lesson.');
  const document=lessonDocument.parse({version:1,id,name:name.replace(/[\x00-\x1f/\\]/g,'_').slice(0,180),hash:digest,kind,size:bytes.length,pages,createdAt:new Date().toISOString()});fs.mkdirSync(folder,{recursive:true,mode:0o700});
  const original=path.join(folder,`${id}.original`);if(fs.existsSync(original)){regular(original);if(hash(fs.readFileSync(original))!==digest)throw new AtlasError('Source original changed.',409);}else fs.writeFileSync(original,bytes,{flag:'wx',mode:0o600});
  writeFileAtomicSync(path.join(folder,`${id}.json`),JSON.stringify(document),{mode:0o600});return document;
 },asset:(chat,id)=>{const document=list(chat).find(d=>d.id===id);if(!document)throw new AtlasError('Source not found in this lesson.',404);const file=path.join(dir(chat),`${document.id}.original`);if(!fs.existsSync(file))throw new AtlasError('Source original is missing. Restore it from backup.',404);regular(file);if(fs.statSync(file).size!==document.size)throw new AtlasError('Source original changed. Restore it from backup.',409);const bytes=fs.readFileSync(file);if(hash(bytes)!==document.hash||bytes.length!==document.size)throw new AtlasError('Source original changed. Restore it from backup.',409);return {document,path:file,bytes};}};
}
