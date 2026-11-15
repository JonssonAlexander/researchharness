"use client";
import {useCallback,useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import type {ReadingArticle} from '@/src/core';
import {useServerEvent,useServerResync} from './server-events';
const button='rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-40';
type Entry=ReadingArticle&{chatId:string;sessionTitle:string;updatedAt:string};
function Library({onClose}:{onClose:()=>void}){
 const [articles,setArticles]=useState<Entry[]>([]),[query,setQuery]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const load=useCallback(()=>{void fetch('/api/articles',{cache:'no-store'}).then(async r=>{const v=await r.json();if(!r.ok)throw new Error(v.error??'Library unavailable.');setArticles(v.articles);}).catch(e=>setError(e.message)).finally(()=>setLoading(false));},[]);
 useEffect(load,[load]);useServerEvent('reading-changed',load);useServerResync(load);
 const filtered=articles.filter(a=>`${a.title} ${a.sessionTitle}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 return <section role="dialog" aria-modal="true" aria-label="PDF library" className="fixed inset-4 z-[70] mx-auto flex max-w-3xl flex-col overflow-hidden rounded-xl border bg-background shadow-xl">
  <header className="flex items-center gap-3 border-b p-3"><h2 className="flex-1 text-sm">PDF library</h2><button className={button} onClick={onClose}>Close</button></header>
  <div className="p-3"><input autoFocus aria-label="Search PDFs" placeholder="Search articles or lessons…" value={query} onChange={e=>setQuery(e.target.value)} className="w-full rounded border bg-background px-3 py-2 text-sm"/></div>
  {error&&<p role="alert" className="px-3 text-xs text-destructive">{error}</p>}
  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 pt-0">{filtered.map(a=><a key={`${a.chatId}:${a.hash}`} href={`/chat/${encodeURIComponent(a.chatId)}?article=${a.id}`} className="block rounded-lg border p-3 hover:bg-accent"><div className="text-sm font-medium">{a.title}</div><div className="mt-1 text-xs text-muted-foreground">{a.sessionTitle} · {a.pages} pages</div></a>)}{!filtered.length&&<p className="text-sm text-muted-foreground">{loading?'Loading saved PDFs…':query?'No matching PDFs.':'Saved lesson and research PDFs appear here.'}</p>}</div>
 </section>;
}
export function ArticleLibraryEntry({beforeOpen}:{beforeOpen?:()=>Promise<void>}){
 const [open,setOpen]=useState(false),[error,setError]=useState('');
 return <><button className={button} onClick={()=>{void Promise.resolve(beforeOpen?.()).then(()=>setOpen(true)).catch(e=>setError(e.message));}}>PDF library</button>{error&&<span role="alert" className="text-xs text-destructive">{error}</span>}{open&&createPortal(<Library onClose={()=>setOpen(false)}/>,document.body)}</>;
}
