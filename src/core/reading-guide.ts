import {z} from 'zod';
import {passageRect} from './maths-companion.ts';
const text=(max:number)=>z.string().trim().min(1).max(max);
export const guideProposal=z.object({page:z.number().int().min(1).max(500),quote:text(1600),title:text(120),establishes:text(600),importance:text(600),topicId:z.string().max(60).optional()}).strict();
export const guideHighlight=guideProposal.extend({id:z.string().regex(/^rg_[a-f0-9]{64}$/),location:z.enum(['exact','page-only']),rects:z.array(passageRect).max(100),createdAt:z.string().datetime(),padIds:z.array(z.string()).default([]),attemptIds:z.array(z.string()).default([])});
export interface ReadingGuideService {
 list:()=>unknown;
 read:(sourceId:string,page:number)=>Promise<unknown>;
 route:(sourceId:string,route:ReadingRoute)=>unknown;
 add:(sourceId:string,items:z.infer<typeof guideProposal>[],signal?:AbortSignal)=>Promise<unknown>;
}

export const readingRoute=z.object({
 problem:text(360),answer:text(480),intuition:text(480),
 stops:z.array(z.object({highlightId:z.string().regex(/^rg_[a-f0-9]{64}$/),title:text(90),kind:z.enum(['result','setup','mechanism','consequence']),statement:text(480),intuition:text(480),detail:z.string().max(1600).optional()}).strict()).min(4).max(6),
}).strict().superRefine((route,ctx)=>{
 if(route.stops[0]?.kind!=='result'||new Set(route.stops.map(s=>s.highlightId)).size!==route.stops.length||!['setup','mechanism','consequence'].every(kind=>route.stops.some(s=>s.kind===kind)))ctx.addIssue({code:'custom',message:'Start with a main result, then include setup, mechanism and consequences with distinct passage IDs.'});
});
export type ReadingRoute=z.infer<typeof readingRoute>;

export const readingGuide=z.object({lens:z.literal('conceptual-overview'),objective:text(4000),enabled:z.boolean(),route:readingRoute.optional(),items:z.array(guideHighlight).max(32)}).strict();
export type GuideHighlight=z.infer<typeof guideHighlight>;
