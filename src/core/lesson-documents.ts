import {z} from 'zod';
export const LESSON_DOCUMENT_LIMIT=25*1024*1024;
export const lessonDocument=z.object({version:z.literal(1),id:z.string().regex(/^ls_[a-f0-9]{64}$/),name:z.string().min(1).max(180),hash:z.string().regex(/^[a-f0-9]{64}$/),kind:z.enum(['pdf','text']),size:z.number().int().positive().max(LESSON_DOCUMENT_LIMIT),pages:z.number().int().positive().nullable(),createdAt:z.string().datetime()}).strict();
export type LessonDocument=z.infer<typeof lessonDocument>;
export interface LessonDocumentStore {list:(chat:string)=>LessonDocument[];put:(chat:string,name:string,bytes:Uint8Array,kind:'pdf'|'text',pages:number|null)=>LessonDocument;asset:(chat:string,id:string)=>{document:LessonDocument;path:string;bytes:Uint8Array};}
export interface LessonDocumentReader {list:()=>LessonDocument[];read:(id:string,offset:number,page:number)=>Promise<unknown>;page:(id:string,page:number)=>Promise<{text:string;images?:{data:string;mimeType:string}[]}>;}
