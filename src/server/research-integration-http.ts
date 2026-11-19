import {z} from 'zod';
import {AtlasError} from '../core/atlas.ts';
import {researchTrailId} from '../core/research-trails.ts';
import {researchApplySchema} from '../core/research-integration.ts';
import {emit} from '../core/events.ts';
import {stores} from './stores.ts';
import {PATHS} from '../../config.ts';
import {requireSameOrigin} from './request-origin.ts';
import {readRequestBody} from './request-body.ts';
import {createResearchIntegrationService} from './research-integration.ts';

const action=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('prepare'),trailId:researchTrailId}).strict(),
 researchApplySchema.extend({kind:z.literal('apply')}),
 z.object({kind:z.literal('inspect'),reviewId:z.string().uuid(),sourceId:z.string().min(1).max(100),artifactIndex:z.number().int().min(0).max(29).optional(),approve:z.literal(true)}).strict(),
]);
export async function researchIntegrationResponse(request:Request){
 const headers={'Cache-Control':'private, no-store'};
 try{
  const store=stores.atlasStore.research,service=createResearchIntegrationService(store,PATHS.data);
  if(request.method==='GET'){
   const q=new URL(request.url).searchParams;
   if(q.has('reviewId'))return Response.json(store.integration.review(z.string().uuid().parse(q.get('reviewId'))),{headers});
   const trailId=researchTrailId.parse(q.get('trailId')),detail=store.detail(trailId),before=q.has('before')?z.string().uuid().parse(q.get('before')):undefined;
   const evidence=store.integration.evidence(trailId,before),page=evidence.slice(0,20);
   return Response.json({reviews:store.integration.reviews(trailId),evidence:page,evidenceNext:evidence.length>20?page.at(-1)!.id:null,checkpoint:detail.workspace?store.integration.checkpoint(trailId,detail.workspace.id):null},{headers});
  }
  if(request.method!=='POST')throw new AtlasError('Method not allowed.',405);
  requireSameOrigin(request);
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json')throw new AtlasError('Expected JSON.',415);
  const c=action.parse(JSON.parse((await readRequestBody(request,512*1024)).toString('utf8')));
  let result:unknown;
  if(c.kind==='prepare')result=service.prepare(c.trailId);
  else if(c.kind==='inspect')result=service.inspect(c);
  else {const {kind:_,...input}=c;result=service.apply(input);emit('research-trails-changed',{});}
  return Response.json(result,{headers});
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Invalid research review request.':e instanceof SyntaxError?'Invalid JSON.':e instanceof Error?e.message:'Research review failed.'},{status:e instanceof AtlasError?e.status:400,headers});}
}
