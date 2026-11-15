"use client";
import {useState} from 'react';
import type {ReadingWorkspace,ScratchTarget} from '@/src/core';
import {MessageResponse} from './ai-elements/message';
const button='rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-40';
const labels={result:'Main result',setup:'Setup',mechanism:'Why it works',consequence:'What it means'};
export function ArticleGuide({guide,activeId,busy,question,onQuestion,onSelect,onBuild,onAsk,onQuick,exchanges,pads,onReopen,onMessage,onVisibility}:{
 guide:ReadingWorkspace['guide'];activeId:string|null;busy:boolean;question:string;onQuestion:(s:string)=>void;onSelect:(id:string)=>void;onBuild:()=>void;onAsk:()=>void;onQuick:()=>void;exchanges:{id:string;question:string;answer:string|null;submitted:boolean}[];pads:ScratchTarget[];onReopen:(t:ScratchTarget)=>void;onMessage:(id:string)=>void;onVisibility:(enabled:boolean)=>void;
}){
 const [discuss,setDiscuss]=useState(false),route=guide?.route,stop=route?.stops.find(s=>s.highlightId===activeId)??(!activeId?route?.stops[0]:undefined),item=guide?.items.find(i=>i.id===(stop?.highlightId??activeId)),index=stop?route!.stops.indexOf(stop):-1;
 return <section aria-label="Guided reading" className="flex h-full min-h-0 flex-col">
  <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
   {!route?<><h2 className="text-lg font-medium">Find the thread of the paper</h2><p className="text-sm text-muted-foreground">Start with the main answer, then read the setup, the idea behind it and its consequences.</p><button className={button} disabled={busy} onClick={onBuild}>{busy?'Preparing your reading route…':'Build reading route'}</button></>:<>
    <p className="text-sm text-muted-foreground">{route.problem}</p>
    <details className="text-sm"><summary className="cursor-pointer text-xs text-muted-foreground">The big picture</summary><div className="mt-2 space-y-3"><MessageResponse>{route.answer}</MessageResponse><MessageResponse>{route.intuition}</MessageResponse></div></details>
   </>}
   {item&&<article aria-label="Current reading stop" className="space-y-4">
    <div><p className="mb-1 text-xs text-violet-400">{stop?labels[stop.kind]:'Further reading'} · PDF p. {item.page}{item.location==='page-only'?' · page reference':''}</p><h2 className="text-xl font-medium leading-snug">{stop?.title??item.title}</h2></div>
    <div className="text-sm"><MessageResponse>{stop?.statement??item.establishes}</MessageResponse></div>
    <div className="border-l-2 border-violet-500/50 pl-3 text-sm"><MessageResponse>{stop?.intuition??item.importance}</MessageResponse></div>
    {stop?.detail&&<details className="text-sm"><summary className="cursor-pointer text-xs text-muted-foreground">Assumptions and detail</summary><div className="mt-2"><MessageResponse>{stop.detail}</MessageResponse></div></details>}
    {item.location==='page-only'&&<p className="text-xs text-muted-foreground">The passage could not be located precisely. Read the referenced page; no position has been guessed.</p>}
   </article>}
   {route&&<><nav aria-label="Reading route navigation" className="flex items-center justify-between gap-2 border-y py-3"><button className={button} disabled={busy||index<=0} onClick={()=>{setDiscuss(false);onSelect(route.stops[index-1]!.highlightId);}}>← Back</button><span className="text-xs text-muted-foreground">{index>=0?`${index+1} / ${route.stops.length}`:'Further reading'}</span><button className={button} disabled={busy||index>=route.stops.length-1} onClick={()=>{setDiscuss(false);onSelect(route.stops[index+1]!.highlightId);}}>{index===route.stops.length-1?'End of overview':'Next →'}</button></nav><ol aria-label="Reading route" className="space-y-1">{route.stops.map((s,i)=><li key={s.highlightId}><button aria-current={s===stop?'step':undefined} className={`w-full rounded px-2 py-1.5 text-left text-xs ${s===stop?'bg-violet-500/15 text-violet-300':'text-muted-foreground hover:bg-accent'}`} onClick={()=>{setDiscuss(false);onSelect(s.highlightId);}}><span className="mr-2 opacity-60">{i+1}</span>{s.title}</button></li>)}</ol></>}
   {item&&<><div className="flex flex-wrap gap-2"><button className={button} onClick={()=>setDiscuss(!discuss)}>Discuss this</button><button className={button} disabled={busy} onClick={onQuick}>Scratchpad</button></div>{discuss&&<div className="space-y-2"><textarea aria-label="Question about reading stop" className="min-h-20 w-full rounded border bg-background p-2 text-sm" value={question} onChange={e=>onQuestion(e.target.value)} placeholder="Ask about the result or your reasoning…"/><button className={button} disabled={busy||!question.trim()} onClick={onAsk}>Ask in chat</button></div>}</>}
   {guide&&<details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Further passages and options</summary><div className="mt-3 space-y-3"><label className="flex gap-2"><input type="checkbox" checked={guide.enabled} disabled={busy} onChange={e=>onVisibility(e.target.checked)}/> Show highlights</label>{guide.items.filter(i=>!route?.stops.some(s=>s.highlightId===i.id)).map(i=><button key={i.id} className={`${button} block w-full text-left`} onClick={()=>onSelect(i.id)}>p. {i.page} · {i.title}</button>)}<button className={button} disabled={busy} onClick={onBuild}>{route?'Rebuild reading route':'Build reading route'}</button>{pads.filter(p=>p.title.startsWith('Article derivation')).map(p=><button key={p.id} className={button} onClick={()=>onReopen(p)}>Reopen scratchwork</button>)}{exchanges.filter(e=>e.submitted).map(e=><details key={e.id}><summary>Previous discussion</summary><MessageResponse>{e.answer??e.question}</MessageResponse><button className={button} onClick={()=>onMessage(e.id)}>Open in chat</button></details>)}</div></details>}
   <p className="text-[10px] text-muted-foreground">AI reading guide · your notes and drawings stay separate.</p>
  </div>
 </section>;
}
