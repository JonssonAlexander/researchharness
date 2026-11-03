import {challengeScratchLesson} from "./problems.ts";
import {z} from "zod";
import type {AgentMessage} from "@earendil-works/pi-agent-core";
import {AtlasError} from "../core/atlas.ts";
import {scratchKey,attemptId,scratchScene,scratchTarget,practiceScratchTarget,lessonScratchTarget,scratchAttemptMessage,scratchDelivery,resolveScratchpadImages} from "../core/scratchpad.ts";
import {stores} from "./stores.ts";
import {readSourceBody} from "./mindmaps.ts";
export function scratchMessage(chatId:string,id:string){const a=stores.scratchpadStore.attempt(chatId,id);if(!a)throw new AtlasError("Saved attempt not found.",404);return scratchAttemptMessage(a);}
export function scratchImages(chatId:string,messages:readonly AgentMessage[],vision:boolean){return resolveScratchpadImages(messages,id=>{
 if(!vision)throw new AtlasError("Choose an image-capable model to read this drawing. Your work is saved.",409);
 const image=stores.scratchpadStore.image(chatId,id);return {type:"image",mimeType:"image/png",data:Buffer.from(image).toString("base64")};
});}
const save=z.object({expectedRevision:z.number().int().nonnegative(),target:scratchTarget,scene:scratchScene,text:z.string().max(20000)}).strict();
export async function scratchpadResponse(request:Request,chatId:string):Promise<Response>{try{
 const chat=stores.chatStore.getChat(chatId),lesson=stores.lessonStore.read(chatId)??challengeScratchLesson(chatId);if(!chat||!lesson&&chat.kind!=="practice")throw new AtlasError("Open a learning or practice session to use its scratchpad.",404);
 const targetFor=(pad?:string)=>{const target=chat.kind==="practice"&&pad?.startsWith("practice-")?practiceScratchTarget(chat.messages,pad):lesson?lessonScratchTarget(lesson,pad):practiceScratchTarget(chat.messages,pad);if(!target)throw new AtlasError("Practice problem not found.",404);return target;};
 const q=new URL(request.url).searchParams;
 if(request.method==="GET"){
  if(q.has("image")){const bytes=stores.scratchpadStore.image(chatId,attemptId.parse(q.get("image")));return new Response(Buffer.from(bytes),{headers:{"Content-Type":"image/png","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});}
  if(q.has("attempt")){const attempt=stores.scratchpadStore.attempt(chatId,attemptId.parse(q.get("attempt")));if(!attempt)throw new AtlasError("Attempt not found.",404);return Response.json({attempt,delivery:scratchDelivery(chat.messages,attempt.id)},{headers:{"Cache-Control":"no-store"}});}
  const target=targetFor(),padId=scratchKey.parse(q.get("pad")??target.id),draft=stores.scratchpadStore.read(chatId,padId),attempts=stores.scratchpadStore.list(chatId,padId).map(a=>({id:a.id,number:a.number,createdAt:a.createdAt,target:a.draft.target,revision:a.draft.revision,hasImage:!!a.imageHash,delivery:scratchDelivery(chat.messages,a.id)}));return Response.json({target,padId,draft,attempts},{headers:{"Cache-Control":"no-store"}});
 }
 if(!request.headers.get("content-type")?.startsWith("application/json"))throw new AtlasError("Expected JSON.",415);
 const body=JSON.parse((await readSourceBody(request,24*1024*1024)).toString("utf8"));
 const padId=scratchKey.parse(body.padId),target=targetFor(padId);
 if(request.method==="PUT"){
  const input=save.parse(body.draft);if(padId!==target.id||JSON.stringify(input.target)!==JSON.stringify(target))throw new AtlasError("The lesson target changed. Reopen the scratchpad; your local work is retained.",409);
  return Response.json({draft:stores.scratchpadStore.save(chatId,padId,input.expectedRevision,input)});
 }
 const capture=z.object({padId:scratchKey,id:attemptId,expectedRevision:z.number().int().positive(),image:z.string().max(14*1024*1024).nullable()}).strict().parse(body);
 if(capture.image&&!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(capture.image))throw new AtlasError("Export a PNG image of the attempt.");
 const image=capture.image?Buffer.from(capture.image.slice(capture.image.indexOf(',')+1),"base64"):null;
 const a=stores.scratchpadStore.capture(chatId,padId,capture.id,capture.expectedRevision,image);return Response.json({attempt:a,delivery:scratchDelivery(chat.messages,a.id)});
 }catch(e){return Response.json({error:e instanceof AtlasError?e.message:e instanceof z.ZodError?"The drawing format or size is unsupported. Your local work is retained.":"Scratchpad could not be saved. Keep this window open and retry."},{status:e instanceof AtlasError?e.status:400});}}

/** Review-bound local attachments remain readable even after the source chat is removed. */
export async function scratchworkResponse(request:Request):Promise<Response>{try{
 const q=new URL(request.url).searchParams,reviewId=z.string().regex(/^lr_[0-9a-f-]{36}$/).parse(q.get("review")),id=z.string().regex(/^sw_[0-9a-f]{64}$/).parse(q.get("id"));
 const review=stores.atlasStore.lessonReviews.read(reviewId),note=review?.source.scratchwork?.find(n=>n.id===id);
 if(!review||!note||!["prepared","applying","committed"].includes(review.status))throw new AtlasError("Scratchwork attachment not found.",404);
 const entry=stores.scratchpadStore.retained(id);if(!entry||entry.note.sceneHash!==note.sceneHash||entry.note.imageHash!==note.imageHash)throw new AtlasError("Saved scratchwork is missing or changed.",409);
 const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
 if(q.get("format")==="image")return new Response(Buffer.from(stores.scratchpadStore.retainedImage(id)),{headers:{...headers,"Content-Type":"image/png"}});
 if(q.get("format")==="scene")return new Response(JSON.stringify(entry.draft.scene),{headers:{...headers,"Content-Type":"application/json","Content-Disposition":`attachment; filename="scratchwork-${id.slice(3,15)}.excalidraw"`}});
 return Response.json({draft:entry.draft},{headers});
 }catch(e){return Response.json({error:e instanceof AtlasError?e.message:"Scratchwork is unavailable. The attachment reference is retained."},{status:e instanceof AtlasError?e.status:400});}}
