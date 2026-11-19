import {createHash} from 'node:crypto';
import {z} from 'zod';
import {researchCommandSchema,researchTrailId,researchWorkspaceId,type ResearchCommand} from '../core/research-trails.ts';
import {AtlasError} from '../core/atlas.ts';
import {emit} from '../core/events.ts';
import {stores} from './stores.ts';
import {PATHS} from '../../config.ts';
import {requireSameOrigin} from './request-origin.ts';
import {readRequestBody} from './request-body.ts';
import {createResearchWorkspaceService} from './research-workspaces.ts';

const workspaceAction=z.object({kind:z.enum(['workspace-bind','workspace-create','workspace-rebind','workspace-open','workspace-repair']),approve:z.literal(true),requestId:z.string().uuid(),trailId:researchTrailId.optional(),workspaceId:researchWorkspaceId.optional(),expectedRevision:z.number().int().positive().optional(),path:z.string().min(1).max(4096).optional(),name:z.string().trim().min(1).max(80).optional(),label:z.string().trim().min(1).max(160).optional()}).strict();
// Separate stable receipts for each durable step of a retried owner action.
function stepId(id:string,step:string){const h=createHash('sha256').update(id+step).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
function checkOrigin(command:ResearchCommand){
 if(command.kind!=='create')return;
 const origin=command.origin;
 if((origin.kind==='chat'||origin.kind==='lesson')&&!origin.chatId)throw new AtlasError('Choose the source conversation.');
 if((origin.messageId||origin.lessonNodeId)&&!origin.chatId || (origin.kind==='manual'||origin.kind==='atlas')&&(origin.chatId||origin.messageId||origin.lessonNodeId) || origin.kind==='chat'&&origin.lessonNodeId)throw new AtlasError('Source references do not match the origin.');
 if(origin.chatId){
  const chat=stores.chatStore.getChat(origin.chatId);
  if(!chat||origin.messageId&&!chat.messages.some(m=>m.id===origin.messageId))throw new AtlasError('Source conversation or message is unavailable.',404);
  if(origin.kind==='lesson'){
   const lesson=stores.lessonStore.read(origin.chatId);
   if(!lesson||origin.lessonNodeId&&!lesson.plan.nodes.some(n=>n.id===origin.lessonNodeId))throw new AtlasError('Source lesson topic is unavailable.',404);
  }
 }
}
export async function researchTrailsResponse(request:Request){
 const headers={'Cache-Control':'private, no-store'};
 try{
  const store=stores.atlasStore.research;
  if(request.method==='GET'){
   const q=new URL(request.url).searchParams,trail=q.get('trailId');
   if(trail)return Response.json(store.detail(researchTrailId.parse(trail)),{headers});
   const snapshot=store.list(),concept=q.get('conceptId');
   return Response.json({...snapshot,trails:concept?snapshot.trails.filter(t=>t.linkedConceptIds.includes(concept)):snapshot.trails},{headers});
  }
  if(request.method!=='POST')throw new AtlasError('Method not allowed.',405);
  requireSameOrigin(request);
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json')throw new AtlasError('Expected JSON.',415);
  const body=JSON.parse((await readRequestBody(request,65536)).toString('utf8'));
  const workspaces=createResearchWorkspaceService(store,PATHS.data);
  let result:unknown;
  if(String(body.kind).startsWith('workspace-')){
   const c=workspaceAction.parse(body);
   if(c.kind==='workspace-open'){
    if(!c.workspaceId)throw new AtlasError('Choose a registered workspace.');
    await workspaces.open(c.workspaceId);return Response.json({ok:true},{headers});
   }
   if(c.kind==='workspace-rebind'){
    if(!c.workspaceId||!c.path||!c.expectedRevision)throw new AtlasError('Choose the workspace, new folder and current revision.');
    result=await workspaces.rebind({workspaceId:c.workspaceId,path:c.path,expectedRevision:c.expectedRevision,requestId:c.requestId});
   }else if(c.kind==='workspace-repair'){
    if(!c.workspaceId||!c.trailId)throw new AtlasError('Choose a workspace and trail.');
    result=await workspaces.provision({workspaceId:c.workspaceId,trailId:c.trailId,requestId:c.requestId});
   }else{
    if(!c.trailId||!c.expectedRevision)throw new AtlasError('Choose the trail and current revision.');
    const workspace=c.kind==='workspace-bind'
     ?await workspaces.bindExisting({path:c.path??'',label:c.label??'Research project',requestId:stepId(c.requestId,'workspace')})
     :await workspaces.create({name:c.name??'',label:c.label,requestId:stepId(c.requestId,'workspace')});
    store.save({kind:'bind',requestId:stepId(c.requestId,'bind'),trailId:c.trailId,workspaceId:workspace.id,expectedRevision:c.expectedRevision});
    result=await workspaces.provision({workspaceId:workspace.id,trailId:c.trailId,requestId:stepId(c.requestId,'provision')});
   }
  }else{
   const command=researchCommandSchema.parse(body);
   if(command.kind==='workspace')throw new AtlasError('Approve a folder through the workspace binding action.');
   checkOrigin(command);result=store.save(command);
   if(command.kind==='bind'&&command.workspaceId)await workspaces.provision({workspaceId:command.workspaceId,trailId:command.trailId,requestId:stepId(command.requestId,'provision')});
  }
  emit('research-trails-changed',{});
  return Response.json({result,...store.list()},{headers});
 }catch(error){
  // Failed provisioning may have durably recorded a recoverable pending binding.
  if(request.method==='POST')emit('research-trails-changed',{});
  return Response.json({error:error instanceof AtlasError?error.message:error instanceof z.ZodError?'Invalid research change.':error instanceof SyntaxError?'Invalid JSON.':error instanceof Error?error.message:'Research is unavailable.'},{status:error instanceof AtlasError?error.status:400,headers});
 }
}
