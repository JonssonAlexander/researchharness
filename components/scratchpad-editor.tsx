"use client";
import {useRef,useState} from "react";
import {PencilIcon} from "lucide-react";
import {Excalidraw,exportToBlob,serializeAsJSON,getSceneVersion} from "@excalidraw/excalidraw";
import type {AppState,BinaryFiles,ExcalidrawImperativeAPI} from "@excalidraw/excalidraw/types";
import type {ExcalidrawElement} from "@excalidraw/excalidraw/element/types";
import type {ScratchScene} from "@/src/core";
import "@excalidraw/excalidraw/index.css";
export interface ScratchEditorHandle {snapshot:()=>ScratchScene;load:(scene:ScratchScene)=>void;image:(scene:ScratchScene)=>Promise<Blob|null>;}
function snapshot(elements:readonly ExcalidrawElement[],state:AppState,files:BinaryFiles):ScratchScene{
 const scene=JSON.parse(serializeAsJSON(elements,state,files,"local"));return {...scene,elements,files,appState:{...scene.appState,scrollX:state.scrollX,scrollY:state.scrollY,zoom:state.zoom}} as ScratchScene;
}
const pencils=[{name:"Black",color:"#1b1b1f"},{name:"Blue",color:"#1971c2"},{name:"Red",color:"#e03131"}];
const pencilState=(scene:ScratchScene)=>({...scene.appState,currentItemStrokeWidth:1,currentItemStrokeColor:typeof scene.appState.currentItemStrokeColor==="string"?scene.appState.currentItemStrokeColor:pencils[0]!.color,activeTool:{type:"freedraw" as const,customType:null,lastActiveTool:null,locked:true}});
export default function ScratchpadEditor({initial,onChange,onReady,disabled}:{initial:ScratchScene;onChange:(scene:ScratchScene)=>void;onReady:(handle:ScratchEditorHandle)=>void;disabled:boolean}){
 const fingerprint=useRef(""),api=useRef<ExcalidrawImperativeAPI|null>(null);
 const [data]=useState(()=>({...initial,appState:pencilState(initial)})),[selected,setSelected]=useState<string|null>(String(data.appState.currentItemStrokeColor));
 function pencil(color:string){if(disabled||!api.current)return;api.current.updateScene({appState:{currentItemStrokeColor:color,currentItemStrokeWidth:1,selectedElementIds:{},selectedGroupIds:{},openMenu:null}});api.current.setActiveTool({type:"freedraw",locked:true});setSelected(color);}
 return <div className="relative h-full w-full"><Excalidraw initialData={data as unknown as Parameters<typeof Excalidraw>[0]["initialData"]} viewModeEnabled={disabled} handleKeyboardGlobally={false} autoFocus={false} detectScroll theme="light" validateEmbeddable={()=>false} UIOptions={{canvasActions:{saveToActiveFile:false,loadScene:!disabled,export:false,saveAsImage:false,toggleTheme:false},tools:{image:true}}} excalidrawAPI={value=>{
  api.current=value;
  onReady({snapshot:()=>snapshot(value.getSceneElementsIncludingDeleted(),value.getAppState(),value.getFiles()),load:scene=>{value.addFiles(Object.values(scene.files) as BinaryFiles[string][]);value.updateScene({elements:scene.elements as unknown as ExcalidrawElement[],appState:{...value.getAppState(),...pencilState(scene)}});},image:async scene=>{const elements=(scene.elements as unknown as ExcalidrawElement[]).filter(e=>!e.isDeleted);if(!elements.length)return null;return exportToBlob({elements,appState:{...scene.appState,exportBackground:true,viewBackgroundColor:"#ffffff",exportWithDarkMode:false,exportEmbedScene:false,exportScale:2},files:scene.files as BinaryFiles,mimeType:"image/png",maxWidthOrHeight:4096,exportPadding:24});}});
 }} onChange={(elements,state,files)=>{
  setSelected(state.activeTool.type==="freedraw"&&state.currentItemStrokeWidth===1?state.currentItemStrokeColor:null);
  const next=JSON.stringify([getSceneVersion(elements),state.scrollX,state.scrollY,state.zoom.value,state.activeTool.type,state.currentItemStrokeColor,state.currentItemStrokeWidth,Object.keys(files)]);if(next!==fingerprint.current){fingerprint.current=next;onChange(snapshot(elements,state,files));}
 }}/ >{!disabled&&<div role="group" aria-label="Quick pencil colours" className="absolute bottom-[4.5rem] left-1/2 z-10 flex -translate-x-1/2 gap-1 rounded-full border border-slate-200 bg-white/95 p-1 shadow-sm" onPointerDown={e=>e.stopPropagation()}>{pencils.map(p=><button key={p.color} type="button" aria-label={`${p.name} pencil`} title={`${p.name} · thin pencil`} aria-pressed={selected===p.color} className="flex size-8 items-center justify-center rounded-full hover:bg-slate-100 aria-pressed:bg-slate-100 aria-pressed:ring-1 aria-pressed:ring-slate-400" style={{color:p.color,touchAction:"manipulation"}} onClick={()=>pencil(p.color)}><PencilIcon className="size-4"/></button>)}</div>}</div>;
}
