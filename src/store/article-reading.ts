import fs from "node:fs";
import path from "node:path";
import {AtlasError} from "../core/atlas.ts";
import {readingWorkspace,readingHash,initialReading,type ReadingArticle,type ReadingWorkspace} from "../core/article-reading.ts";
import {writeFileAtomicSync} from "./atomic-write.ts";
export function createReadingStore(root:string){
 const directory=(chat:string)=>{if(!/^[\w-]+$/.test(chat))throw new AtlasError("Invalid session.");const folder=path.join(root,chat);for(const p of [root,folder])if(fs.existsSync(p)&&(!fs.lstatSync(p).isDirectory()||fs.lstatSync(p).isSymbolicLink()))throw new AtlasError("Invalid reading directory.",409);return folder;};
 const file=(chat:string,hash:string)=>path.join(directory(chat),`${readingHash.parse(hash)}.json`);
 const read=(chat:string,hash:string):ReadingWorkspace|null=>{const p=file(chat,hash);if(!fs.existsSync(p))return null;if(!fs.lstatSync(p).isFile()||fs.lstatSync(p).isSymbolicLink())throw new AtlasError("Invalid reading record.",409);const w=readingWorkspace.parse(JSON.parse(fs.readFileSync(p,'utf8')));if(w.hash!==hash)throw new AtlasError("Reading source changed.",409);return w;};
 const list=(chat:string)=>{const dir=directory(chat);return fs.existsSync(dir)?fs.readdirSync(dir).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(n=>read(chat,n.slice(0,-5))!):[];};
 const save=(chat:string,value:ReadingWorkspace,expected:number)=>{const old=read(chat,value.hash);if((old?.revision??0)!==expected)throw new AtlasError("Reading notes changed in another window. Keep your work open and reload.",409);const next=readingWorkspace.parse({...value,revision:expected+1});fs.mkdirSync(directory(chat),{recursive:true,mode:0o700});writeFileAtomicSync(file(chat,next.hash),JSON.stringify(next),{mode:0o600});return next;};
 return {read,list,save,open(chat:string,a:ReadingArticle){const w=read(chat,a.hash)??save(chat,initialReading(a),0);fs.mkdirSync(directory(chat),{recursive:true,mode:0o700});writeFileAtomicSync(path.join(directory(chat),'active.json'),JSON.stringify({sourceId:a.id}),{mode:0o600});return w;},active(chat:string){const p=path.join(directory(chat),'active.json');if(!fs.existsSync(p))return null;if(!fs.lstatSync(p).isFile()||fs.lstatSync(p).isSymbolicLink())throw new AtlasError("Invalid reading state.",409);return JSON.parse(fs.readFileSync(p,'utf8')).sourceId as string;},target(chat:string,pad:string){return list(chat).flatMap(w=>w.pads).find(p=>p.target.id===pad)?.target??null;},remove(chat:string){fs.rmSync(directory(chat),{recursive:true,force:true});}};
}
