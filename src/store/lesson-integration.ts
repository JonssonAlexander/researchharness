import {createHash} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";
import {AtlasError,type AtlasSnapshot} from "../core/atlas.ts";
import {lessonSummary,type LessonReview,type LessonReviewStore} from "../core/lesson-integration.ts";
export const lessonHash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function lessonMint(id:string,key:string,prefix:string){const h=lessonHash([id,key]);return (prefix==="ac"||prefix==="dl")?`${prefix}_${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`:`${prefix}_${h.slice(0,24)}`;}
export function readLessonReview(db:DatabaseSync,id:string):LessonReview|null{
 const row=db.prepare("SELECT * FROM lesson_reviews WHERE id=?").get(id);if(!row)return null;
 const r=JSON.parse(String(row.record)) as LessonReview;const {digest,...body}=r;
 if(r.schemaVersion!==1||r.id!==row.id||lessonHash(body)!==digest||lessonHash(r)!==row.contentHash)throw new AtlasError("Lesson review is unsupported or changed outside Atlas.",409);
 if(r.draft)lessonSummary.parse(r.draft);return r;
}
export function readLessonReviews(db:DatabaseSync,chatId?:string):LessonReview[]{return db.prepare(chatId?"SELECT id FROM lesson_reviews WHERE json_extract(record,'$.chatId')=? ORDER BY rowid DESC":"SELECT id FROM lesson_reviews ORDER BY rowid DESC").all(...chatId?[chatId]:[]).map(row=>readLessonReview(db,String(row.id))!);}
export function createLessonReviewStore(database:<T>(run:(db:DatabaseSync)=>T)=>T,snapshot:(db:DatabaseSync)=>AtlasSnapshot,writeNote:(id:string,text:string)=>string|null):LessonReviewStore{
 function write(db:DatabaseSync,r:LessonReview){const {digest:_digest,...body}=r;void _digest;const saved={...body,digest:lessonHash(body)};db.prepare("INSERT INTO lesson_reviews VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record,contentHash=excluded.contentHash").run(r.id,JSON.stringify(saved),lessonHash(saved));return saved;}
 return {read:id=>database(db=>readLessonReview(db,id)),list:chatId=>database(db=>readLessonReviews(db,chatId)),put:(r,expected)=>database(db=>{
  db.exec("BEGIN IMMEDIATE");try{const old=readLessonReview(db,r.id);if((old?.digest??null)!==expected)throw new AtlasError("Review changed. Reload before saving.",409);
   if(old?.status==="committed"||r.status==="committed"||old?.status==="applying"&&r.status!=="applying")throw new AtlasError("This approved review cannot be edited.",409);
   const result=write(db,r);db.exec("COMMIT");return result;
  }catch(e){db.exec("ROLLBACK");throw e;}
 }),finish:(id,approvalDigest)=>database(db=>{
  db.exec("BEGIN IMMEDIATE");try{
   const r=readLessonReview(db,id);if(!r||r.approval?.digest!==approvalDigest||!r.plan)throw new AtlasError("Exact lesson approval is required.",409);
   if(r.status==="committed"){db.exec("COMMIT");return r;}if(r.status!=="applying")throw new AtlasError("Lesson is not ready to integrate.",409);
   const current=snapshot(db),plan=r.plan,marker=`<!-- lesson-review:${r.id} -->`;
   for(const c of plan.concepts){
    const old=current.concepts.find(n=>n.id===c.id);if((old?.revision??0)!==c.expectedRevision)throw new AtlasError("An approved concept changed. Resolve this conflict before resuming integration.",409);
    const markdown=`${old?.markdown??""}\n\n${marker}\nAI session synthesis · source assertion, not independently verified\n\n${c.notes}\n\nSession: ${r.chatId}\n`;
    if(markdown.length>16000)throw new AtlasError(`Notes for ${c.title} exceed the limit.`);
    const note=writeNote(c.id,markdown);
    if(old)db.prepare("UPDATE concepts SET markdownPath=?,revision=revision+1 WHERE id=?").run(note,c.id);
    else{if(db.prepare("SELECT id FROM atlas_archive WHERE kind='concept' AND id=?").get(c.id))throw new AtlasError("An approved concept was removed.",409);db.prepare("INSERT INTO concepts VALUES (?,?,?,?,1,?,?,?)").run(c.id,c.title,JSON.stringify(c.aliases),c.preferredSubjectId,c.x,c.y,note);for(const subject of c.subjectIds)db.prepare("INSERT INTO concept_subjects VALUES (?,?)").run(c.id,subject);}
    for(const proposition of c.propositionIds)db.prepare("INSERT OR IGNORE INTO concept_propositions VALUES (?,?)").run(c.id,proposition);
   }
   for(const link of plan.drawingLinks){const record=JSON.stringify(link);db.prepare("INSERT INTO atlas_drawing_links VALUES (?,?,?)").run(link.id,record,lessonHash(link));}
   const result=write(db,{...r,status:"committed",committedAt:new Date().toISOString()});db.exec("UPDATE atlas_layout_version SET revision=revision+1; COMMIT");return result;
  }catch(e){db.exec("ROLLBACK");throw e;}
 })};
}
