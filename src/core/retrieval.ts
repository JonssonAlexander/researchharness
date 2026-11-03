import {scratchScene,type ScratchNote} from "./scratchpad.ts";
import {z} from "zod";
import {drawingConnections} from "./atlas-drawing.ts";
import type {AtlasSnapshot} from "./atlas.ts";
import type {JobUsage} from "./contracts.ts";
export const REVIEW_LIMIT=20,REVIEW_VERSION={library:"ts-fsrs@6.0.0",model:"FSRS-7"} as const;
const uuid=z.string().regex(/^ra_[0-9a-f-]{36}$/),itemId=z.string().regex(/^ri_[0-9a-f-]{36}$/),date=z.string().datetime();
export const reviewSettings=z.object({revision:z.number().int().nonnegative(),dailyGoal:z.number().int().min(1).max(REVIEW_LIMIT),minutes:z.number().int().min(1).max(60),retention:z.number().min(.7).max(.97),timeZone:z.string().refine(t=>{try{new Intl.DateTimeFormat('en',{timeZone:t});return true;}catch{return false;}},"Choose a valid study timezone")}).strict();
export type ReviewSettings=z.infer<typeof reviewSettings>;
export const DEFAULT_REVIEW_SETTINGS:ReviewSettings={revision:0,dailyGoal:6,minutes:12,retention:.9,timeZone:"Europe/Stockholm"};
export type ReviewCard=Record<string,unknown>&{dueAt:string;lastReviewAt:string|null;reps:number;};
export interface ReviewConfig {library:string;model:string;parameters:Record<string,unknown>;}
export interface ReviewItem {id:string;conceptId:string;title:string;front:string;back:string;sourceHash:string;revision:number;targetVersion:number;paused:boolean;createdAt:string;card:ReviewCard;config:ReviewConfig;}
export interface ReviewActivity {id:string;revision:number;day:string;timeZone:string;createdAt:string;readyAt?:string;status:"preparing"|"ready"|"revealed"|"rated"|"skipped"|"failed";items:ReviewItem[];front:string;back:string;criteria:{itemId:string;text:string}[];answer:string;scratchwork?:ScratchNote;attempted:boolean;revealedAt?:string;ratedAt?:string;ratings?:Record<string,number|null>;error?:string;model?:string;usage?:JobUsage;config:ReviewConfig;}
export interface ReviewEvent {id:string;activityId:string;itemId:string;targetVersion:number;at:string;recordedAt:string;rating:number|null;config:ReviewConfig;revlog:Record<string,unknown>|null;}
export interface ReviewStore {
 items:()=>ReviewItem[];active:()=>ReviewActivity|null;last:()=>ReviewActivity|null;activities:(day?:string)=>ReviewActivity[];activity:(id:string)=>ReviewActivity|null;events:(itemId:string)=>ReviewEvent[];
 settings:()=>ReviewSettings;saveSettings:(settings:ReviewSettings)=>ReviewSettings;
 saveItem:(item:ReviewItem,expectedRevision:number)=>void;
 reserve:(activity:ReviewActivity)=>ReviewActivity;update:(activity:ReviewActivity,expectedRevision:number)=>ReviewActivity;
 rate:(id:string,revision:number,ratings:Record<string,number|null>,now:string,apply:(item:ReviewItem,events:ReviewEvent[])=>{card:ReviewCard;logs:Map<string,Record<string,unknown>>})=>ReviewActivity;
}
export const reviewActivityProposal=z.object({front:z.string().trim().min(1).max(2500),back:z.string().trim().min(1).max(10000),criteria:z.array(z.object({itemId,text:z.string().trim().min(1).max(1000)}).strict()).min(3).max(4)}).strict();
export const reviewCommand=z.discriminatedUnion("action",[
 z.object({action:z.literal("enrol"),conceptId:z.string().regex(/^ac_[0-9a-f-]{36}$/),expectedRevision:z.number().int().nonnegative(),front:z.string().trim().min(1).max(2500),back:z.string().trim().min(1).max(12000),paused:z.boolean()}).strict(),
 z.object({action:z.literal("settings"),settings:reviewSettings}).strict(),
 z.object({action:z.literal("start"),id:uuid,itemIds:z.array(itemId).min(1).max(4),expectedModel:z.string().optional(),consent:z.boolean().optional()}).strict(),
 z.object({action:z.literal("draft"),id:uuid,revision:z.number().int().positive(),answer:z.string().max(20000)}).strict(),
 z.object({action:z.literal("drawing"),id:uuid,revision:z.number().int().positive(),expectedRevision:z.number().int().nonnegative(),scene:scratchScene}).strict(),
 z.object({action:z.literal("reveal"),id:uuid,revision:z.number().int().positive(),answer:z.string().max(20000),attempted:z.literal(true),image:z.string().max(14*1024*1024).optional(),drawingRevision:z.number().int().nonnegative().optional()}).strict(),
 z.object({action:z.literal("skip"),id:uuid,revision:z.number().int().positive()}).strict(),
 z.object({action:z.literal("rate"),id:uuid,revision:z.number().int().positive(),ratings:z.record(itemId,z.number().int().min(1).max(4).nullable())}).strict(),
]);
export type ReviewCommand=z.infer<typeof reviewCommand>;
export function studyDay(now:Date,timeZone:string){const p=new Intl.DateTimeFormat('en',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now),get=(type:string)=>p.find(p=>p.type===type)!.value;return `${get('year')}-${get('month')}-${get('day')}`;}
export function reviewSource(concept:AtlasSnapshot['concepts'][number]){return {title:concept.title,notes:concept.markdown??"",propositionIds:concept.propositionIds};}
/** Stable target schedules; temporary connected groups never become scheduler items. */
export function reviewDeck(atlas:AtlasSnapshot,items:ReviewItem[],now:Date,remaining:number){
 const known=new Set(atlas.concepts.map(c=>c.id)),due=items.filter(i=>!i.paused&&known.has(i.conceptId)&&Date.parse(i.card.dueAt)<=now.getTime()).sort((a,b)=>Date.parse(a.card.dueAt)-Date.parse(b.card.dueAt)||a.id.localeCompare(b.id));
 const links=[...drawingConnections(atlas),...atlas.relations.filter(r=>r.reviewStatus==='accepted')],adj=new Map<string,Set<string>>();
 for(const l of links){if(!adj.has(l.sourceId))adj.set(l.sourceId,new Set());if(!adj.has(l.targetId))adj.set(l.targetId,new Set());adj.get(l.sourceId)!.add(l.targetId);adj.get(l.targetId)!.add(l.sourceId);}
 const used=new Set<string>(),groups:ReviewItem[][]=[];
 for(const seed of due){if(used.has(seed.id))continue;const group=[seed],concepts=new Set([seed.conceptId]);let more=true;
  while(group.length<4&&more){more=false;const next=due.find(i=>!used.has(i.id)&&!group.includes(i)&&[...concepts].some(id=>adj.get(id)?.has(i.conceptId)));if(next){group.push(next);concepts.add(next.conceptId);more=true;}}
  if(group.length<3){used.add(seed.id);groups.push([seed]);}else{group.forEach(i=>used.add(i.id));groups.push(group);}
 }
 const selected:ReviewItem[][]=[];let seconds=0;for(const group of groups){const cost=group.length>1?180:45;if(seconds+cost>remaining||selected.length>=REVIEW_LIMIT)continue;selected.push(group);seconds+=cost;}
 return {groups:selected.map(g=>g.map(i=>i.id)),due:due.length,deferred:groups.length-selected.length,estimatedSeconds:seconds};
}
/** Estimated recall probability, not mastery. Unknown targets remain neutral. */
export function retentionColour(probability:number|null){
 if(probability===null||!Number.isFinite(probability))return '#88909b';
 const p=Math.max(0,Math.min(1,probability)),stops=[[224,112,91],[218,184,96],[85,156,181]],t=p<.9?p/.9:(p-.9)/.1,a=p<.9?stops[0]!:stops[1]!,b=p<.9?stops[1]!:stops[2]!;
 return '#'+a.map((v,i)=>Math.round(v+(b[i]!-v)*t).toString(16).padStart(2,'0')).join('');
}
export function reviewColour(item:ReviewItem|undefined,probability:number|null){return item?retentionColour(probability):'#606976';}
export function reviewEdgeColour(a:number|null,b:number|null){return retentionColour(a===null||b===null?null:(a+b)/2);}
export function reviewInterval(due:string,now:string){const seconds=Math.max(0,(Date.parse(due)-Date.parse(now))/1000);return seconds<60?'<1m':seconds<3600?`${Math.round(seconds/60)}m`:seconds<86400?`${Math.round(seconds/3600)}h`:seconds<30*86400?`${Math.round(seconds/86400)}d`:`${Math.round(seconds/(30*86400))}mo`;}
export function publicReviewActivity(a:ReviewActivity){const revealed=['revealed','rated'].includes(a.status);return {...a,items:a.items.map(i=>({id:i.id,conceptId:i.conceptId,title:i.title,revision:i.revision,targetVersion:i.targetVersion})),back:revealed?a.back:undefined,criteria:revealed?a.criteria:undefined,config:undefined};}

export interface ReviewSnapshot {
 intervals?:Record<string,string[]>;
 now:string;day:string;settings:ReviewSettings;model:string|null;used:number;remaining:number;refreshAt:string;
 items:{item:ReviewItem;retrievability:number|null;stale:boolean}[];deck:ReturnType<typeof reviewDeck>;
 active:ReturnType<typeof publicReviewActivity>|null;last:ReturnType<typeof publicReviewActivity>|null;
}
export function nextReviewChange(now:Date,timeZone:string,items:ReviewItem[]){let low=now.getTime(),high=low+27*3600000;const day=studyDay(now,timeZone);while(high-low>1000){const mid=Math.floor((high+low)/2);if(studyDay(new Date(mid),timeZone)===day)low=mid;else high=mid;}
 return new Date(Math.min(high,...items.filter(i=>!i.paused&&Date.parse(i.card.dueAt)>now.getTime()).map(i=>Date.parse(i.card.dueAt)))).toISOString();
}
