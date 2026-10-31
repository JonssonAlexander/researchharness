import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {learningSession,lessonPlan,lessonChange,type LearningSessionStore,type LearningSession} from "../core/learning-session.ts";
import {AtlasError} from "../core/atlas.ts";
/** One logical writer; optimistic saves, atomic head replacement, retained previous revisions. */
export function createLearningSessionStore(root:string):LearningSessionStore{
 const directory=(id:string)=>{if(!/^[a-zA-Z0-9_-]+$/.test(id))throw new AtlasError("Invalid session ID.");const dir=path.join(root,id);if(fs.existsSync(dir)&&!fs.lstatSync(dir).isDirectory())throw new AtlasError("Lesson directory must be a regular directory.",409);return dir;};
 function read(id:string){const file=path.join(directory(id),"current.json");if(!fs.existsSync(file))return null;if(!fs.lstatSync(file).isFile())throw new AtlasError("Lesson must be a regular file.",409);const raw=JSON.parse(fs.readFileSync(file,"utf8"));if(raw.schemaVersion!==1)throw new AtlasError("This lesson needs a newer app.",409);return learningSession.parse(raw);}
 function write(id:string,value:LearningSession,previous?:LearningSession){
  const dir=directory(id);fs.mkdirSync(dir,{recursive:true,mode:0o700});
  if(previous){const archive=path.join(dir,`revision-${previous.revision}.json`),body=JSON.stringify(previous);if(fs.existsSync(archive)){if(fs.readFileSync(archive,"utf8")!==body)throw new AtlasError("Lesson history changed outside the app.",409);}else fs.writeFileSync(archive,body,{flag:"wx",mode:0o600});}
  const temporary=path.join(dir,`.${randomUUID()}.tmp`);
  try{fs.writeFileSync(temporary,JSON.stringify(value),{flag:"wx",mode:0o600});fs.renameSync(temporary,path.join(dir,"current.json"));}finally{fs.rmSync(temporary,{force:true});}
  return value;
 }
 return {read,create:(id,plan)=>{if(read(id))throw new AtlasError("Lesson already exists.",409);return write(id,{schemaVersion:1,revision:1,status:"active",plan:lessonPlan.parse(plan)});},save:(id,input)=>{const change=lessonChange.parse(input),old=read(id);if(!old||old.revision!==change.expectedRevision)throw new AtlasError("Lesson changed. Reload before saving.",409);return write(id,{schemaVersion:1,revision:old.revision+1,status:change.status,plan:change.plan},old);},remove:id=>fs.rmSync(directory(id),{force:true,recursive:true})};
}
