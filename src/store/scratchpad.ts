import {writeFileAtomicSync} from "./atomic-write.ts";
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {inflateSync} from "node:zlib";
import {AtlasError} from "../core/atlas.ts";
import {scratchKey,attemptId,scratchScene,scratchTarget,SCRATCH_LIMITS,type ScratchDraft,type ScratchAttempt,type ScratchpadStore,type ScratchNote,type RetainedScratchwork} from "../core/scratchpad.ts";
const hash=(b:Uint8Array|string)=>createHash("sha256").update(b).digest("hex");
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(bytes:Uint8Array){let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]!^(n>>>8);return (n^0xffffffff)>>>0;}
/** Validate the PNG structure/decompression before exposing it as a model attachment. */
export function checkScratchPng(b:Uint8Array){
 const v=Buffer.from(b);if(v.length>SCRATCH_LIMITS.imageBytes||v.length<45||v.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")throw new AtlasError("Use a PNG image up to 10 MB.");
 if(v.toString("ascii",12,16)!=="IHDR")throw new AtlasError("Invalid PNG header.");const w=v.readUInt32BE(16),h=v.readUInt32BE(20);if(!w||!h||w>8192||h>8192||w*h>32000000)throw new AtlasError("Drawing image is too large. Zoom into a smaller attempt.");
 if(v[24]!==8||![2,6].includes(v[25]!)||v[26]!==0||v[27]!==0||v[28]!==0)throw new AtlasError("Use a standard RGB/RGBA PNG export.");
 const channels=v[25]===6?4:3;const chunks:Buffer[]=[];let end=false;for(let at=8;at<v.length;){if(at+12>v.length)throw new AtlasError("Truncated drawing image.");const size=v.readUInt32BE(at),type=v.toString("ascii",at+4,at+8);if(at+size+12>v.length)throw new AtlasError("Truncated drawing image.");if(crc(v.subarray(at+4,at+8+size))!==v.readUInt32BE(at+8+size))throw new AtlasError("Drawing image has a corrupt checksum.");if(type==="IDAT")chunks.push(v.subarray(at+8,at+8+size));at+=size+12;if(type==="IEND"){end=at===v.length;break;}}
 if(!end||!chunks.length)throw new AtlasError("Invalid drawing image.");try{const raw=inflateSync(Buffer.concat(chunks),{maxOutputLength:h*(w*channels+1)});if(raw.length!==h*(w*channels+1))throw new Error("Invalid PNG pixels");for(let y=0;y<h;y++)if(raw[y*(w*channels+1)]!>4)throw new Error("Invalid PNG filter");}catch{throw new AtlasError("Drawing image is corrupt or too large.");}
}
export function createScratchpadStore(root:string):ScratchpadStore{
 function dir(...keys:string[]){if(fs.existsSync(root)&&!fs.lstatSync(root).isDirectory())throw new AtlasError("Scratchpad root must be a regular directory.",409);let current=root;for(const key of keys){scratchKey.parse(key);current=path.join(current,key);if(fs.existsSync(current)&&!fs.lstatSync(current).isDirectory())throw new AtlasError("Scratchpad path must be a regular directory.",409);}return current;}
 function readJson(file:string){if(!fs.existsSync(file))return null;if(!fs.lstatSync(file).isFile())throw new AtlasError("Scratchpad must be a regular file.",409);return JSON.parse(fs.readFileSync(file,"utf8"));}
 function atomic(file:string,value:unknown){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});writeFileAtomicSync(file,JSON.stringify(value),{mode:0o600});}
 function draft(value:ScratchDraft):ScratchDraft{if(typeof value.text!=="string"||value.text.length>SCRATCH_LIMITS.text||value.schemaVersion!==1||!Number.isSafeInteger(value.revision)||value.revision<1)throw new AtlasError("Unsupported scratchpad revision.",409);scratchScene.parse(value.scene);scratchTarget.parse(value.target);return value;}
 const read=(chat:string,pad:string)=>{const v=readJson(path.join(dir(chat,pad),"current.json"));return v?draft(v):null;};
 const attempt=(chat:string,id:string):ScratchAttempt|null=>{attemptId.parse(id);const a=readJson(path.join(dir(chat,"attempts"),`${id}.json`)) as ScratchAttempt|null;if(a&&(a.schemaVersion!==1||a.id!==id||a.chatId!==chat||hash(JSON.stringify(draft(a.draft)))!==a.sceneHash))throw new AtlasError("Submitted attempt is unsupported or corrupt.",409);return a;};
 const retained=(id:string):RetainedScratchwork|null=>{
  if(!/^sw_[0-9a-f]{64}$/.test(id))throw new AtlasError("Invalid scratchwork reference.");
  const value=readJson(path.join(dir("_retained"),`${id}.json`)) as RetainedScratchwork|null;
  if(value){const {id:stored,...body}=value.note;if(stored!==id||`sw_${hash(JSON.stringify(body))}`!==id||hash(JSON.stringify(draft(value.draft)))!==value.note.sceneHash)throw new AtlasError("Saved scratchwork is corrupt.",409);}
  return value;
 };
 const image=(chat:string,id:string)=>{const a=attempt(chat,id);if(!a?.imageHash)throw new AtlasError("Attempt image not found.",404);const file=path.join(dir(chat,"attempts"),`${id}.png`);if(!fs.existsSync(file)||!fs.lstatSync(file).isFile())throw new AtlasError("Attempt image is missing.",409);const bytes=fs.readFileSync(file);if(hash(bytes)!==a.imageHash)throw new AtlasError("Attempt image is corrupt.",409);return bytes;};
 return {read,attempt,retained,image,
 retain:(chat,pad,value,token)=>{
  scratchKey.parse(chat);scratchKey.parse(pad);draft(value);
  const a=token?attempt(chat,token):null;if(token&&(!a||a.padId!==pad||a.sceneHash!==hash(JSON.stringify(value))))throw new AtlasError("Scratchwork capture changed.",409);
  const pixels=a?.imageHash?image(chat,a.id):null;
  const body={chatId:chat,padId:pad,title:value.target.title,revision:value.revision,updatedAt:value.updatedAt,sceneHash:hash(JSON.stringify(value)),imageHash:a?.imageHash??null,...a?{attemptId:a.id}:{}};
  const note:ScratchNote={id:`sw_${hash(JSON.stringify(body))}`,...body},folder=dir("_retained");
  fs.mkdirSync(folder,{recursive:true,mode:0o700});
  // Publish the manifest last: interruption leaves only an unreferenced image, safe to retry.
  if(pixels){const file=path.join(folder,`${note.id}.png`);if(fs.existsSync(file)){if(!fs.lstatSync(file).isFile()||hash(fs.readFileSync(file))!==note.imageHash)throw new AtlasError("Saved scratchwork image changed.",409);}else fs.writeFileSync(file,pixels,{flag:"wx",mode:0o600});}
  if(!retained(note.id))atomic(path.join(folder,`${note.id}.json`),{note,draft:value});return note;
 },retainedImage:id=>{const entry=retained(id);if(!entry?.note.imageHash)throw new AtlasError("Scratchwork preview not found.",404);const file=path.join(dir("_retained"),`${id}.png`);if(!fs.existsSync(file)||!fs.lstatSync(file).isFile())throw new AtlasError("Saved scratchwork image is missing.",409);const bytes=fs.readFileSync(file);if(hash(bytes)!==entry.note.imageHash)throw new AtlasError("Saved scratchwork image is corrupt.",409);return bytes;},save:(chat,pad,expected,input)=>{
  const old=read(chat,pad);if((old?.revision??0)!==expected)throw new AtlasError("Scratchpad changed in another window. Reload or download your local drawing before replacing it.",409);
  const scene=scratchScene.parse(input.scene),target=scratchTarget.parse(input.target);if(input.text.length>SCRATCH_LIMITS.text||Buffer.byteLength(JSON.stringify(scene))>SCRATCH_LIMITS.sceneBytes)throw new AtlasError("Scratchpad exceeds its save limit.",413);
  for(const file of Object.values(scene.files))if(!file.dataURL.startsWith(`data:${file.mimeType};base64,`))throw new AtlasError("Embedded images must be local PNG, JPEG or WebP data.");
  const value:ScratchDraft={schemaVersion:1,revision:expected+1,scene,text:input.text,target,updatedAt:new Date().toISOString()},folder=dir(chat,pad);
  // Keep a rolling recovery copy; immutable submissions retain full history without archiving every pen stroke.
  if(old)atomic(path.join(folder,"previous.json"),old);
  atomic(path.join(folder,"current.json"),value);return value;
 },list:(chat,pad)=>{scratchKey.parse(pad);const folder=dir(chat,"attempts");return fs.existsSync(folder)?fs.readdirSync(folder).filter(n=>/^sa_[0-9a-f-]{36}\.json$/.test(n)).map(n=>attempt(chat,n.slice(0,-5))!).filter(a=>a.padId===pad).sort((a,b)=>a.number-b.number):[];},capture:(chat,pad,id,revision,image)=>{
  attemptId.parse(id);const existing=attempt(chat,id);if(existing){if(existing.padId!==pad||existing.draft.revision!==revision)throw new AtlasError("Attempt token was already used for different work.",409);return existing;}
  const current=read(chat,pad);if(!current||current.revision!==revision)throw new AtlasError("Save this exact drawing revision before sending.",409);
  if(!current.text.trim()&&!current.scene.elements.some(e=>!e.isDeleted))throw new AtlasError("Write or draw an attempt first.");
  if(image)checkScratchPng(image);if(!image&&current.scene.elements.some(e=>!e.isDeleted))throw new AtlasError("Export the drawing image before sending.");
  const folder=dir(chat,"attempts");fs.mkdirSync(folder,{recursive:true,mode:0o700});
  const files=fs.readdirSync(folder).filter(n=>/^sa_.*\.json$/.test(n)),number=files.map(n=>attempt(chat,n.slice(0,-5))!).filter(a=>a.padId===pad).reduce((n,a)=>Math.max(n,a.number),0)+1;
  if(image){const file=path.join(folder,`${id}.png`);if(fs.existsSync(file)){if(!fs.lstatSync(file).isFile())throw new AtlasError("Attempt image must be a regular file.",409);if(hash(fs.readFileSync(file))!==hash(image))throw new AtlasError("Attempt image changed. Retry with the original capture.",409);}else fs.writeFileSync(file,image,{flag:"wx",mode:0o600});}
  const a:ScratchAttempt={schemaVersion:1,id,chatId:chat,padId:pad,number,draft:current,sceneHash:hash(JSON.stringify(current)),imageHash:image?hash(image):null,createdAt:new Date().toISOString()};atomic(path.join(folder,`${id}.json`),a);return a;
 },remove:chat=>fs.rmSync(dir(chat),{recursive:true,force:true})};
}
