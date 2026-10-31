"use client";
import {useEffect,useRef} from "react";

/** Held keys only: never intercept typing, and clear when the window loses focus. */
export function useNodeSizeShortcut(){
 const held=useRef<"small"|"normal"|"prominent"|null>(null);
 useEffect(()=>{
  const keys=new Map<string,"small"|"normal"|"prominent">();
  const clear=()=>{keys.clear();held.current=null;};
  const editable=(target:EventTarget|null)=>(target as HTMLElement|null)?.closest?.("input,textarea,select,[contenteditable]:not([contenteditable='false']),[role='textbox']");
  const down=(event:KeyboardEvent)=>{
   if(event.metaKey||event.ctrlKey||event.altKey||event.shiftKey||editable(event.target)){clear();return;}
   const size=event.key==="1"?"small":event.key==="2"?"normal":event.key==="3"?"prominent":null;
   if(size){keys.set(event.code||event.key,size);held.current=size;}
  };
  const up=(event:KeyboardEvent)=>{keys.delete(event.code||event.key);held.current=[...keys.values()].at(-1)??null;};
  const focus=(event:FocusEvent)=>{if(editable(event.target))clear();};
  document.addEventListener("keydown",down);document.addEventListener("keyup",up);document.addEventListener("focusin",focus);
  window.addEventListener("blur",clear);document.addEventListener("visibilitychange",clear);
  return ()=>{document.removeEventListener("keydown",down);document.removeEventListener("keyup",up);document.removeEventListener("focusin",focus);window.removeEventListener("blur",clear);document.removeEventListener("visibilitychange",clear);clear();};
 },[]);
 return held;
}
