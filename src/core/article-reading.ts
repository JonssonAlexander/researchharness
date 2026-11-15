import {readingGuide} from './reading-guide.ts';
import {z} from "zod";
import {passageRect} from "./maths-companion.ts";
import {scratchTarget,type ScratchTarget} from "./scratchpad.ts";
export const articleId=z.string().regex(/^(ls|rs)_[a-f0-9]{64}$/);
export const readingHash=z.string().regex(/^[a-f0-9]{64}$/);
export const readingComment=z.object({id:z.string().regex(/^rc_[0-9a-f-]{36}$/),page:z.number().int().min(1).max(500),rects:z.array(passageRect).min(1).max(100),quote:z.string().max(8000),text:z.string().max(8000),lessonTargetId:z.string().max(100).optional(),padIds:z.array(z.string().max(100)).max(100).default([]),attemptIds:z.array(z.string().regex(/^sa_[0-9a-f-]{36}$/)).max(100).default([]),handwritingId:z.string().regex(/^sa_[0-9a-f-]{36}$/).optional()}).strict().superRefine((c,ctx)=>{if(c.rects.some(r=>r.x+r.width>1.001||r.y+r.height>1.001))ctx.addIssue({code:'custom',message:'Select a region inside the page.'});});
export type ReadingComment=z.infer<typeof readingComment>;
export interface ReadingArticle {id:string;hash:string;title:string;pages:number;kind:"lesson"|"research";}
export const readingWorkspace=z.object({version:z.literal(1),revision:z.number().int().nonnegative(),sourceId:articleId,hash:readingHash,title:z.string().trim().min(1).max(300).optional(),page:z.number().int().min(1).max(500),zoom:z.number().min(.5).max(3),split:z.number().min(25).max(75),guide:readingGuide.optional(),comments:z.array(readingComment).max(500),pads:z.array(z.object({target:scratchTarget,commentId:z.string().optional(),requestHash:z.string().optional()})).max(500)}).strict();
export type ReadingWorkspace=z.infer<typeof readingWorkspace>;
export function articleCanvasTarget(a:ReadingArticle):ScratchTarget{return {id:`reading_${a.hash}`,title:a.title.slice(0,160),start:`Reading notes for “${a.title}”. Source ${a.id}. Source material and handwritten associations are not proof.`,finish:"Explore and understand this article."};}
export function initialReading(a:ReadingArticle):ReadingWorkspace{return {version:1,revision:0,sourceId:a.id,hash:a.hash,page:1,zoom:1,split:50,comments:[],pads:[{target:articleCanvasTarget(a)}]};}
export function readingContext(a:ReadingArticle,c?:ReadingComment){return `Article: “${a.title}” (${a.id})${c?`, PDF page ${c.page}. Learner-selected source region; not a verified transcription.\nSelected text: ${c.quote||"Boxed mathematics; inspect the explicitly submitted excerpt, or ask for the missing text."}\nReading note: ${c.text}`:". Saved handwritten reading map."}`;}
