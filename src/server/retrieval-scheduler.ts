import {DefaultScheduler,type DefaultSchedulerCard,type Grade} from "ts-fsrs";
import {AtlasError} from "../core/atlas.ts";
import {REVIEW_VERSION,type ReviewCard,type ReviewConfig,type ReviewEvent,type ReviewItem} from "../core/retrieval.ts";
const cache=new Map<string,Promise<DefaultScheduler>>();
export const serial=<T>(v:unknown):T=>JSON.parse(JSON.stringify(v)) as T;
export function reviewScheduler(config?:ReviewConfig,retention=.9){
 if(config&&(config.model!==REVIEW_VERSION.model||config.library!==REVIEW_VERSION.library))throw new AtlasError('This scheduler history needs an explicit version migration.',409);
 const parameters=config?.parameters??{desiredRetention:retention,enableFuzz:false},key=JSON.stringify(parameters);const desired=parameters.desiredRetention;const desiredRetention=typeof desired==='number'?desired:desired&&typeof desired==='object'?Number((desired as Record<string,unknown>)['3']):retention;if(!cache.has(key))cache.set(key,DefaultScheduler({version:'FSRS-7',...parameters,desiredRetention}));return cache.get(key)!;
}
export const schedulerConfig=(s:DefaultScheduler):ReviewConfig=>({...REVIEW_VERSION,parameters:serial(s.config)});
export const cardInput=(c:ReviewCard)=>({...c,dueAt:new Date(c.dueAt),lastReviewAt:c.lastReviewAt?new Date(c.lastReviewAt):null}) as DefaultSchedulerCard;
export async function prepareReplay(items:ReviewItem[],events:ReviewEvent[]){
 const configs=[...items.map(i=>i.config),...events.map(e=>e.config)],schedulers=new Map<string,DefaultScheduler>();
 for(const c of configs){const key=JSON.stringify(c);if(!schedulers.has(key))schedulers.set(key,await reviewScheduler(c));}
 return (item:ReviewItem,history:ReviewEvent[])=>{
  let card=schedulers.get(JSON.stringify(item.config))!.newCard({cardId:item.id,now:new Date(item.createdAt)});const logs=new Map<string,Record<string,unknown>>();
  for(const event of history){if(event.rating===null)continue;const scheduler=schedulers.get(JSON.stringify(event.config));if(!scheduler)throw new AtlasError('Review configuration changed during scheduling. Reload.',409);const result=scheduler.review({card,grade:event.rating as Grade,now:new Date(event.at)});card=result.card;logs.set(event.id,serial(result.revlog));}
  return {card:serial<ReviewCard>(card),logs};
 };
}
