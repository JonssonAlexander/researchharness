"use client";
import {useEffect,useRef} from 'react';

type Surface='chat'|'reading'|'scratchpad'|'review';
type State='interaction'|'waiting'|'hidden'|'idle';
const RECENT_MS=10_000,MAX_INTERVAL_MS=30_000;
const uuid=()=>typeof crypto!=='undefined'&&'randomUUID'in crypto?crypto.randomUUID().replaceAll('-',''):`${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
export function activityStateAt(now:number,lastInput:number,waiting:boolean,hidden:boolean):State{
 return hidden?'hidden':waiting?'waiting':now-lastInput<RECENT_MS?'interaction':'idle';
}
export function interactionExpiryCut(start:number,now:number,lastInput:number):number|null{
 const expiry=lastInput+RECENT_MS;
 return expiry>start&&expiry<now?expiry:null;
}

/** Content-free, short-lived activity intervals for an active lesson/review tab. */
export function useLearningActivity(id:string|null,waiting:boolean,surface:Surface){
 const waitingRef=useRef(waiting);waitingRef.current=waiting;
 const tabIdRef=useRef<string|null>(null),sequenceRef=useRef(0);
 const advanceRef=useRef<()=>void>(()=>{});
 useEffect(()=>{
  if(!id)return;
  const tabId=tabIdRef.current??(tabIdRef.current=uuid());let lastInput=Number.NEGATIVE_INFINITY,closed=false;
  let state=activityStateAt(performance.now(),Number.NEGATIVE_INFINITY,waitingRef.current,document.visibilityState==='hidden');
  let started=performance.now(),startedAt=Date.now();
  const post=(s:State,end:number)=>{
   const duration=Math.max(1,Math.round(end-started)),finish=startedAt+duration;
   const interval={id:String(++sequenceRef.current),tabId,start:startedAt,end:finish,state:s,surface};
   const body=JSON.stringify({action:'activity',interval});
   const send=(keepalive:boolean)=>fetch(`/api/chats/${encodeURIComponent(id)}/learning`,{method:'POST',headers:{'Content-Type':'application/json'},body,keepalive}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);}).catch(error=>{console.warn('[learning activity] interval was not accepted',error);if(!closed)setTimeout(()=>{if(closed)return;void fetch(`/api/chats/${encodeURIComponent(id)}/learning`,{method:'POST',headers:{'Content-Type':'application/json'},body}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);}).catch(retryError=>console.warn('[learning activity] retry was not accepted',retryError));},250);});
   void send(closed);
  };
  const advance=(now=performance.now())=>{
   const expiry=state==='interaction'?interactionExpiryCut(started,now,lastInput):null;
   if(state==='interaction'&&expiry!==null){
    const elapsed=expiry-started;post('interaction',expiry);state='idle';started=expiry;startedAt+=Math.round(elapsed);
   }
   const desired=activityStateAt(now,lastInput,waitingRef.current,document.visibilityState==='hidden');
   if(desired!==state){
    if(now-started>MAX_INTERVAL_MS){post(state,started+MAX_INTERVAL_MS);startedAt=Date.now();}
    else{post(state,now);startedAt+=Math.round(now-started);}
    state=desired;started=now;
   }else if(now-started>=MAX_INTERVAL_MS){post(state,started+MAX_INTERVAL_MS);started=now;startedAt=Date.now();}
  };
  advanceRef.current=()=>advance();
  const activity=()=>{const now=performance.now();advance(now);lastInput=now;advance(now);};
  const visibility=()=>advance();
  const tick=window.setInterval(()=>advance(),1000);
  const inputOptions={capture:true,passive:true} as const;
  document.addEventListener('pointerdown',activity,inputOptions);
  document.addEventListener('keydown',activity,inputOptions);
  document.addEventListener('scroll',activity,inputOptions);
  document.addEventListener('visibilitychange',visibility);
  const pagehide=()=>{closed=true;const now=performance.now();advance(now);if(now-started>0.5)post(state,now);};
  window.addEventListener('pagehide',pagehide);
  return()=>{
   advanceRef.current=()=>{};
   window.clearInterval(tick);document.removeEventListener('pointerdown',activity,true);document.removeEventListener('keydown',activity,true);document.removeEventListener('scroll',activity,true);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',pagehide);
   if(!closed){closed=true;const now=performance.now();advance(now);if(now-started>0.5)post(state,now);}
  };
 },[id,surface]);
 useEffect(()=>{advanceRef.current();},[id,waiting]);
}
