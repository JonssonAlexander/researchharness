"use client";
import {useRef} from "react";
import {Excalidraw,exportToBlob,serializeAsJSON,getSceneVersion} from "@excalidraw/excalidraw";
import type {AppState,BinaryFiles} from "@excalidraw/excalidraw/types";
import type {ExcalidrawElement} from "@excalidraw/excalidraw/element/types";
import type {ScratchScene} from "@/src/core";
import "@excalidraw/excalidraw/index.css";
export interface ScratchEditorHandle {snapshot:()=>ScratchScene;load:(scene:ScratchScene)=>void;image:(scene:ScratchScene)=>Promise<Blob|null>;}
function snapshot(elements:readonly ExcalidrawElement[],state:AppState,files:BinaryFiles):ScratchScene{
 const scene=JSON.parse(serializeAsJSON(elements,state,files,"local"));return {...scene,elements,files,appState:{...scene.appState,scrollX:state.scrollX,scrollY:state.scrollY,zoom:state.zoom}} as ScratchScene;
}
export default function ScratchpadEditor({initial,onChange,onReady,disabled}:{initial:ScratchScene;onChange:(scene:ScratchScene)=>void;onReady:(handle:ScratchEditorHandle)=>void;disabled:boolean}){
 const fingerprint=useRef("");
 return <Excalidraw initialData={initial as unknown as Parameters<typeof Excalidraw>[0]["initialData"]} viewModeEnabled={disabled} handleKeyboardGlobally={false} autoFocus={false} detectScroll theme="light" validateEmbeddable={()=>false} UIOptions={{canvasActions:{saveToActiveFile:false,loadScene:!disabled,export:false,saveAsImage:false,toggleTheme:false},tools:{image:true}}} excalidrawAPI={value=>{
  onReady({snapshot:()=>snapshot(value.getSceneElementsIncludingDeleted(),value.getAppState(),value.getFiles()),load:scene=>{value.addFiles(Object.values(scene.files) as BinaryFiles[string][]);value.updateScene({elements:scene.elements as unknown as ExcalidrawElement[],appState:{...value.getAppState(),...scene.appState}});},image:async scene=>{const elements=(scene.elements as unknown as ExcalidrawElement[]).filter(e=>!e.isDeleted);if(!elements.length)return null;return exportToBlob({elements,appState:{...scene.appState,exportBackground:true,viewBackgroundColor:"#ffffff",exportWithDarkMode:false,exportEmbedScene:false,exportScale:2},files:scene.files as BinaryFiles,mimeType:"image/png",maxWidthOrHeight:4096,exportPadding:24});}});
 }} onChange={(elements,state,files)=>{
  const next=JSON.stringify([getSceneVersion(elements),state.scrollX,state.scrollY,state.zoom.value,state.activeTool.type,state.currentItemStrokeColor,state.currentItemStrokeWidth,Object.keys(files)]);if(next!==fingerprint.current){fingerprint.current=next;onChange(snapshot(elements,state,files));}
 }}/ >;
}
