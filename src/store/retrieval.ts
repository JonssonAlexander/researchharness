import {createHash,randomUUID} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";
import {AtlasError} from "../core/atlas.ts";
import {reviewSettings,DEFAULT_REVIEW_SETTINGS,REVIEW_LIMIT,type ReviewStore,type ReviewActivity,type ReviewItem,type ReviewEvent} from "../core/retrieval.ts";
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function createReviewStore(database:<T>(run:(db:DatabaseSync)=>T)=>T):ReviewStore{
 function read<T>(db:DatabaseSync,table:string,id:string):T|null{const row=db.prepare(`SELECT record,hash FROM ${table} WHERE id=?`).get(id);if(!row)return null;const value=JSON.parse(String(row.record));if(hash(value)!==row.hash)throw new AtlasError('Review data changed outside Atlas. Restore its saved copy.',409);return value as T;}
 function list<T>(db:DatabaseSync,table:string,where='',args:(string|number)[]=[]){return db.prepare(`SELECT id FROM ${table} ${where} ORDER BY rowid`).all(...args).map(row=>read<T>(db,table,String(row.id))!);}
 function write<T extends {id:string}>(db:DatabaseSync,table:string,value:T){db.prepare(`INSERT INTO ${table}(id,record,hash) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record,hash=excluded.hash`).run(value.id,JSON.stringify(value),hash(value));}
 function tx<T>(fn:(db:DatabaseSync)=>T){return database(db=>{db.exec('BEGIN IMMEDIATE');try{const value=fn(db);db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}});}
 const settings=(db:DatabaseSync)=>{const value=read<{id:string}&typeof DEFAULT_REVIEW_SETTINGS>(db,'retrieval_settings','settings');if(!value)return {...DEFAULT_REVIEW_SETTINGS};const {id:_id,...body}=value;void _id;return reviewSettings.parse(body);};
 const activities=(db:DatabaseSync,day?:string)=>list<ReviewActivity>(db,'retrieval_activities',day?"WHERE json_extract(record,'$.day')=?":'',day?[day]:[]);
 const active=(db:DatabaseSync)=>{const row=db.prepare("SELECT id FROM retrieval_activities WHERE json_extract(record,'$.status') IN ('preparing','ready','revealed') LIMIT 1").get();return row?read<ReviewActivity>(db,'retrieval_activities',String(row.id)):null;};
 const events=(db:DatabaseSync,itemId:string)=>list<ReviewEvent>(db,'retrieval_events',"WHERE json_extract(record,'$.itemId')=?",[itemId]);
 return {
 items:()=>database(db=>list<ReviewItem>(db,'retrieval_items')),active:()=>database(active),last:()=>database(db=>{const row=db.prepare("SELECT id FROM retrieval_activities WHERE json_extract(record,'$.status')='rated' ORDER BY rowid DESC LIMIT 1").get();return row?read<ReviewActivity>(db,'retrieval_activities',String(row.id)):null;}),activities:day=>database(db=>activities(db,day)),activity:id=>database(db=>read<ReviewActivity>(db,'retrieval_activities',id)),events:id=>database(db=>events(db,id)),settings:()=>database(settings),
 saveSettings:input=>tx(db=>{const old=settings(db);if(input.revision!==old.revision)throw new AtlasError('Review settings changed. Reload.',409);const value=reviewSettings.parse({...input,revision:old.revision+1});write(db,'retrieval_settings',{id:'settings',...value});return value;}),
 saveItem:(item,expected)=>tx(db=>{const old=read<ReviewItem>(db,'retrieval_items',item.id);if((old?.revision??0)!==expected)throw new AtlasError('This review target changed. Reload.',409);if(active(db)?.items.some(i=>i.id===item.id))throw new AtlasError('Finish or skip the active review before editing its target.',409);write(db,'retrieval_items',item);}),
 applyHelp:(id,revision,item,expected)=>tx(db=>{
  const a=read<ReviewActivity>(db,'retrieval_activities',id),old=read<ReviewItem>(db,'retrieval_items',item.id);if(!a||a.revision!==revision||a.help?.state!=='ready'||a.help.applied||a.items.length!==1||a.items[0]!.id!==item.id||old?.revision!==expected||!['revealed','rated'].includes(a.status))throw new AtlasError('The card or review changed. Check it again before applying.',409);
  const current=active(db);if(current&&current.id!==id&&current.items.some(i=>i.id===item.id))throw new AtlasError('Finish the current review before editing this card.',409);
  write(db,'retrieval_items',item);const next:ReviewActivity={...a,status:a.status==='rated'?'rated':'skipped',help:{...a.help,applied:true},revision:a.revision+1};write(db,'retrieval_activities',next);return next;
 }),
 reserve:activity=>tx(db=>{
  const old=read<ReviewActivity>(db,'retrieval_activities',activity.id);if(old){if(old.items.map(i=>i.id).join()!==activity.items.map(i=>i.id).join())throw new AtlasError('Review token was already used for other targets.',409);return old;}
  if(active(db))throw new AtlasError('Finish or skip the active review first.',409);
  const config=settings(db),today=activities(db,activity.day).filter(a=>a.status!=='failed');
  if(today.length>=Math.min(REVIEW_LIMIT,config.dailyGoal))throw new AtlasError('Today’s review limit is reached. Remaining work stays due.',409);
  const seconds=today.reduce((n,a)=>n+Math.min(900,Math.max(a.items.length>1?180:45,(Date.parse(a.revealedAt??a.ratedAt??a.createdAt)-Date.parse(a.readyAt??a.createdAt))/1000)),0);
  if(seconds+(activity.items.length>1?180:45)>config.minutes*60)throw new AtlasError('Today’s review-time budget is reached. Remaining work stays due.',409);
  for(const item of activity.items){const current=read<ReviewItem>(db,'retrieval_items',item.id);if(!current||current.revision!==item.revision||current.paused)throw new AtlasError('The selected review targets changed. Reload.',409);}
  write(db,'retrieval_activities',activity);return activity;
 }),
 update:(activity,expected)=>tx(db=>{const old=read<ReviewActivity>(db,'retrieval_activities',activity.id);if(!old||old.revision!==expected)throw new AtlasError('This review changed in another window. Reload.',409);write(db,'retrieval_activities',activity);return activity;}),
 rate:(id,revision,ratings,now,apply)=>tx(db=>{
  const a=read<ReviewActivity>(db,'retrieval_activities',id);if(!a||!['revealed','rated'].includes(a.status)||!a.attempted)throw new AtlasError('Attempt and reveal the question before rating it.',409);
  if(a.status==='rated'&&Object.keys(ratings).length===Object.keys(a.ratings??{}).length&&Object.keys(ratings).every(id=>ratings[id]===a.ratings?.[id]))return a;
  if(a.revision!==revision)throw new AtlasError('This review changed. Reload before rating.',409);
  const ids=a.items.map(i=>i.id);if(Object.keys(ratings).length!==ids.length||Object.keys(ratings).some(id=>!ids.includes(id)))throw new AtlasError('Rate only the concepts actually tested; choose Not tested for others.');
  if(a.status==='rated'&&active(db)&&active(db)!.id!==id)throw new AtlasError('Finish the active review before correcting a rating.',409);
  for(const snapshot of a.items){
   const item=read<ReviewItem>(db,'retrieval_items',snapshot.id);if(!item||item.targetVersion!==snapshot.targetVersion)throw new AtlasError('The target was rewritten. Its earlier review cannot change the new target’s schedule.',409);
   if(a.status!=='rated'&&item.revision!==snapshot.revision)throw new AtlasError('This target’s schedule changed. Reload before rating.',409);
   const event:ReviewEvent={id:`re_${randomUUID()}`,activityId:id,itemId:item.id,targetVersion:item.targetVersion,at:a.revealedAt!,recordedAt:now,rating:ratings[item.id]??null,config:a.config,revlog:null};
   const history=[...events(db,item.id),event],effective=[...new Map(history.filter(e=>e.targetVersion===item.targetVersion).map(e=>[e.activityId,e])).values()].sort((a,b)=>a.at.localeCompare(b.at)||a.activityId.localeCompare(b.activityId));
   const result=apply(item,effective);event.revlog=result.logs.get(event.id)??null;write(db,'retrieval_events',event);write(db,'retrieval_items',{...item,revision:item.revision+1,card:result.card});
  }
  const next={...a,revision:a.revision+1,status:'rated' as const,ratedAt:a.ratedAt??now,ratings};write(db,'retrieval_activities',next);return next;
 }),
 };
}
