import {writeFileAtomicSync} from "./atomic-write.ts";
import {emit} from "../core/events.ts";
import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {AtlasError} from "../core/atlas.ts";
import {problemKey,savedProblem,problemSubmission,type SavedProblem,type ProblemSubmission,type ProblemAttempt,type ProblemStore} from "../core/problems.ts";
/** One owner process, synchronous read-modify-write and atomic replacement per problem. */
export function createProblemStore(root:string):ProblemStore{
 function file(id:string){problemKey.parse(id);return path.join(root,`${id}.json`);}
 function read(id:string):SavedProblem|null{const f=file(id);if(!fs.existsSync(f))return null;if(!fs.lstatSync(f).isFile())throw new AtlasError("Problem must be a regular file.",409);return savedProblem.parse(JSON.parse(fs.readFileSync(f,"utf8")));}
 function put(p:SavedProblem){savedProblem.parse(p);fs.mkdirSync(root,{recursive:true,mode:0o700});writeFileAtomicSync(file(p.id),JSON.stringify(p),{mode:0o600});emit("problems-changed",{});return p;}
 function list(){if(!fs.existsSync(root))return [];return fs.readdirSync(root).filter(n=>/^pb_[0-9a-f-]{36}\.json$/.test(n)).map(n=>read(n.slice(0,-5))!).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 function byChat(chatId:string){return list().flatMap(p=>p.attempts.filter(a=>a.chatId===chatId).map(a=>({problem:p,attempt:a})));}
 function create(input:ProblemSubmission,chatId:string,callId:string,minutes:number){const old=byChat(chatId).find(x=>x.attempt.callId===callId);if(old)return old;const now=new Date().toISOString(),attempt:ProblemAttempt={id:`pa_${randomUUID()}`,chatId,callId,minutes,createdAt:now,events:[]},problem=put({...problemSubmission.parse(input),schemaVersion:1,id:`pb_${randomUUID()}`,createdAt:now,attempts:[attempt],integrationReviewIds:[]});return {problem,attempt};}
 function append(id:string,attemptId:string,event:ProblemAttempt["events"][number]){const p=read(id),a=p?.attempts.find(a=>a.id===attemptId);if(!p||!a)throw new AtlasError("Problem attempt not found.",404);a.events.push({...event,at:new Date().toISOString()});return put(p);}
 function retry(id:string,chatId:string,callId:string,minutes:number,attemptId=`pa_${randomUUID()}`){const p=read(id);if(!p)throw new AtlasError("Problem not found.",404);const old=p.attempts.find(a=>a.chatId===chatId);if(old)return {problem:p,attempt:old};const a:ProblemAttempt={id:attemptId,chatId,callId,minutes,createdAt:new Date().toISOString(),events:[]};p.attempts.push(a);return {problem:put(p),attempt:a};}
 function link(id:string,reviewId:string){const p=read(id);if(!p)throw new AtlasError("Problem not found.",404);if(!p.integrationReviewIds.includes(reviewId)){p.integrationReviewIds.push(reviewId);put(p);}}
 function bindCall(id:string,attemptId:string,callId:string){const p=read(id),a=p?.attempts.find(a=>a.id===attemptId);if(!p||!a)throw new AtlasError("Attempt not found.",404);if(a.callId!==callId){a.callId=callId;put(p);}}
 return {read,list,byChat,create,append,retry,link,bindCall};
}
