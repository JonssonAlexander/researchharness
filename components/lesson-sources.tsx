"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {PaperclipIcon,XIcon} from 'lucide-react';
import {LESSON_DOCUMENT_LIMIT,type LessonDocument} from '@/src/core';
import {useServerEvent,useServerResync} from './server-events';
const accept='.pdf,.txt,.md,.markdown,.tex,.csv,.json';
export async function uploadLessonDocuments(chatId:string,files:File[]){
 for(const file of files){const r=await fetch(`/api/chats/${chatId}/sources?name=${encodeURIComponent(file.name)}`,{method:'POST',body:file});const v=await r.json();if(!r.ok)throw new Error(v.error??'Source upload failed.');}
}
/** One attachment control, shared by the opening composer and an active lesson. */
export function LessonSources({chatId,files=[],onFiles,disabled=false,onUploading,onAttached}:{chatId?:string;files?:File[];onFiles?:(files:File[])=>void;disabled?:boolean;onUploading?:(busy:boolean)=>void;onAttached?:()=>void}){
 const input=useRef<HTMLInputElement>(null),[sources,setSources]=useState<LessonDocument[]>([]),[uploading,setUploading]=useState(false),[error,setError]=useState('');
 const refresh=useCallback(async()=>{if(!chatId)return;const r=await fetch(`/api/chats/${chatId}/sources`,{cache:'no-store'});const v=await r.json();if(!r.ok)throw new Error(v.error);setSources(v.sources);},[chatId]);
 useEffect(()=>{if(chatId)void refresh().catch(e=>setError(e.message));},[chatId,refresh]);
 useServerEvent('lesson-changed',event=>{if(event.chatId===chatId)void refresh().catch(e=>setError(e.message));});useServerResync(()=>{void refresh().catch(e=>setError(e.message));});
 async function choose(selected:File[]){setError('');if(selected.some(f=>!f.size||f.size>LESSON_DOCUMENT_LIMIT)){setError('Choose nonempty files of up to 25 MB each.');return;}if(selected.length+files.length+sources.length>8){setError('Use up to eight sources per lesson.');return;}
  if(!chatId){onFiles?.([...files,...selected]);return;}
  setUploading(true);onUploading?.(true);try{await uploadLessonDocuments(chatId,selected);await refresh();onAttached?.();}catch(e){setError((e as Error).message);}finally{setUploading(false);onUploading?.(false);}
 }
 return <div className="min-w-0 flex-1 text-xs"><div className="flex flex-wrap items-center gap-1.5"><button type="button" aria-label={uploading?"Adding source":"Add source"} title={uploading?"Adding source…":"Add source"} className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-card/90 text-muted-foreground hover:text-foreground disabled:opacity-50" disabled={disabled||uploading} onClick={()=>input.current?.click()}><PaperclipIcon className={`size-3.5 ${uploading?'animate-pulse':''}`}/></button><input ref={input} type="file" aria-label="Attach lesson sources" className="hidden" accept={accept} multiple onChange={e=>{const picked=Array.from(e.target.files??[]);e.target.value='';void choose(picked);}}/>{files.map((f,i)=><span key={`${f.name}:${i}`} className="inline-flex max-w-40 items-center gap-1 rounded border bg-card px-1.5 py-0.5"><span className="truncate">{f.name}</span><button type="button" aria-label={`Remove ${f.name}`} disabled={disabled} onClick={()=>onFiles?.(files.filter((_,n)=>n!==i))}><XIcon className="size-3"/></button></span>)}{sources.map(d=><a key={d.id} className="max-w-40 truncate rounded border bg-card px-1.5 py-0.5 underline" title={d.name} href={`/api/chats/${chatId}/sources?asset=${d.id}`}>{d.name}</a>)}</div>{error&&<p role="alert" className="text-destructive">{error}</p>}</div>;
}
