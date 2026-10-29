import {z} from "zod";
import {AtlasError,type AtlasStore} from "../core/atlas.ts";
import {mindmapRevisionId} from "../core/mindmaps.ts";
import {mapReadingFindings,validateMapFindings,type MapProposal,type ProposalView} from "../core/map-proposals.ts";
import {mapDraft,validateMapDraft} from "../core/map-draft.ts";
import {refineMap} from "../agent/subagents/map-refinement.ts";
import {wholeMapRegion,mapImageLayout} from "../core/map-images.ts";
import {accumulateJobUsage,piUsageToStep,type JobUsage} from "../core/contracts.ts";
import {resolveSlot} from "../core/settings-resolution.ts";
import {emit} from "../core/events.ts";
import {piEngineForSpec,type PiEngine} from "../agent/models.ts";
import {interpretMap} from "../agent/subagents/map-interpretation.ts";
import {stores} from "./stores.ts";
import {exportRnoteImages,validateMindmapPng} from "./rnote.ts";
import {readSourceBody} from "./mindmaps.ts";
import {jobCost} from "./pricing.ts";

const command=z.object({id:z.string().regex(/^mp_[0-9a-f-]{36}$/),sourceRevision:mindmapRevisionId,expectedModel:z.string().max(240),consent:z.literal(true),reprocess:z.boolean().optional(),parentId:z.string().regex(/^mp_[0-9a-f-]{36}$/).optional()}).strict();
function configuredEngine() {
	const spec=resolveSlot(stores.settingsStore.readSettings()?.models?.vision);
	if(!spec)throw new AtlasError("Choose a vision model in Settings → Models before interpreting a map.",503);
	const engine=piEngineForSpec(spec,false);
	if(!engine.model.input.includes("image"))throw new AtlasError("The selected vision model does not accept images. Choose an image-capable model.",422);
	return engine;
}
export function createMapProposalService(store:AtlasStore,engineFor:()=>PiEngine=configuredEngine,interpret=interpretMap,exportImages=exportRnoteImages,modelDeadline=()=>AbortSignal.timeout(300000),refine=refineMap) {
	const view=(p:MapProposal|null):ProposalView|null=>p?{...p,estimatedCost:jobCost({usage:p.usage as JobUsage|undefined})}:null;
	return {
		read:(revision:string,id?:string)=>{
			mindmapRevisionId.parse(revision);
			const latest=view(id?store.proposals.read(id):store.proposals.latest(revision));
			if(latest&&latest.sourceRevision!==revision)throw new AtlasError("Attempt belongs to another source revision.",404);
			return latest?{...latest,attempts:store.proposals.history(revision).map(p=>({id:p.id,status:p.status,model:p.model,kind:p.refinement?"refinement" as const:"reading" as const,calls:p.usage?.steps??null,estimatedCost:jobCost({usage:p.usage as JobUsage|undefined})}))}:null;
		},
		model:()=>{const engine=engineFor();return `${engine.model.provider}:${engine.model.id}`;},
		async generate(raw:unknown,signal:AbortSignal) {
			const input=command.safeParse(raw);if(!input.success)throw new AtlasError("Invalid interpretation request.");
			const c=input.data,prior=store.proposals.read(c.id);
			if(prior){if(prior.sourceRevision!==c.sourceRevision||prior.refinement?.parentId!==c.parentId)throw new AtlasError("Proposal token belongs to another source or refinement.",409);return view(prior);}
			const saved=store.read(),map=saved.mindmaps?.find(m=>m.captures.some(r=>r.id===c.sourceRevision));
			const capture=map?.captures.find(r=>r.id===c.sourceRevision);
			if(!map||!capture||map.archived)throw new AtlasError("This source was removed or archived.",409);
			const parent=c.parentId?store.proposals.read(c.parentId):null;
			if(c.parentId&&(!parent||parent.status!=="prepared"||parent.refinement||!parent.findings||!parent.digest||parent.sourceRevision!==c.sourceRevision||parent.sourceHash!==capture.hash))
				throw new AtlasError("Choose an intact prepared first reading of this source before refining.",409);
			const prepared=store.proposals.history(c.sourceRevision).findLast(p=>p.status==="prepared"&&p.refinement?.parentId===c.parentId);
			if(prepared&&!c.reprocess)return view(prepared);
			const engine=engineFor(),model=`${engine.model.provider}:${engine.model.id}`;
			if(model!==c.expectedModel)throw new AtlasError("The vision model changed. Reopen review to confirm the destination.",409);
			if(!engine.model.input.includes("image"))throw new AtlasError("An image-capable model is required.",422);
			if(signal.aborted)throw new AtlasError("Interpretation cancelled.",499);
			const at=new Date().toISOString();
			let record:MapProposal={schemaVersion:parent?3:2,...(parent?{refinement:{parentId:parent.id,parentDigest:parent.digest!},draft:null}:{}),id:c.id,sourceRevision:c.sourceRevision,sourceHash:capture.hash,
				baseRevision:saved.layoutRevision??0,context:capture.conceptIds.flatMap(id=>{
					const n=saved.concepts.find(n=>n.id===id);return n?[{id:n.id,title:n.title,aliases:n.aliases.slice(0,10),revision:n.revision}]:[];
				}).slice(0,40),model,status:"running",images:[],imageLayout:[],findings:null,digest:null,createdAt:at,updatedAt:at,error:null};
			if(!store.proposals.begin(record))return view(store.proposals.read(c.id));
			const persist=()=>{record.updatedAt=new Date().toISOString();store.proposals.update(record);emit("atlas-changed",{});};
			let deadline:AbortSignal|undefined;
			try {
				const original=store.mindmaps.asset(c.sourceRevision,"original").bytes;
				const manual=capture.previewKind==="manual-png"?store.mindmaps.asset(c.sourceRevision,"preview").bytes:null;
				if(manual)validateMindmapPng(manual);
				const retained=parent?.imageLayout?.length?{pages:parent.images.map(h=>store.proposals.image(h)),layout:parent.imageLayout}:null;
				const {pages,layout}=retained??(manual?{pages:[manual],layout:[{kind:"manual" as const,region:wholeMapRegion,width:Buffer.from(manual).readUInt32BE(16),height:Buffer.from(manual).readUInt32BE(20)}]}:await exportImages(original,signal));
				if(!pages.length||pages.length>8||pages.reduce((n,p)=>n+p.length,0)>20*1024*1024)throw new AtlasError("Interpretation supports up to 8 pages and 20 MB of PNG images.",422);
				if(layout.length!==pages.length)throw new AtlasError("Source images are missing their map positions.",422);
				layout.forEach(l=>mapImageLayout.parse(l));
				pages.forEach((p,i)=>{validateMindmapPng(p);const b=Buffer.from(p);
					if(layout[i]!.width!==b.readUInt32BE(16)||layout[i]!.height!==b.readUInt32BE(20))throw new AtlasError("Source image dimensions do not match their layout.",422);
				});record.images=pages.map(p=>store.proposals.retainImage(p));record.imageLayout=layout;persist();
				signal.throwIfAborted();deadline=modelDeadline();
				const bounded=AbortSignal.any([signal,deadline]);
				const onUsage=(usage:Parameters<typeof piUsageToStep>[0])=>{
					record.usage=accumulateJobUsage(record.usage as JobUsage|undefined,model,piUsageToStep(usage));persist();
				};
				if(parent){
					const draft=mapDraft.parse(await refine(engine,pages,record.context,parent,bounded,onUsage,layout));
					bounded.throwIfAborted();const problem=validateMapDraft(draft,parent.findings!,record.context,pages.length);if(problem)throw new Error(problem);
					record={...record,status:"prepared",draft};
				}else{
					const findings=mapReadingFindings.parse(await interpret(engine,pages,record.context,bounded,onUsage,layout));
					bounded.throwIfAborted();const problem=validateMapFindings(findings,record.context,pages.length);if(problem)throw new Error(problem);
					record={...record,status:"prepared",findings};
				}persist();
			} catch(error) {
				record={...record,status:signal.aborted?"cancelled":"failed",error:signal.aborted?"Interpretation was cancelled. Source files are unchanged; provider usage may be incomplete.":deadline?.aborted?
					"The model response timed out after 5 minutes, after page preparation. Source files and captured pages are preserved. Provider usage may be incomplete; retry only starts a new attempt.":error instanceof AtlasError?error.message:
					record.images.length?"The model did not return a valid proposal. Check the selected provider before retrying; usage may be incomplete.":"Readable source pages could not be prepared. Check the original or import a full PNG exported from Rnote."};persist();
			}
			return view(store.proposals.read(c.id));
		},
	};
}
export async function mapProposalResponse(request:Request):Promise<Response> {
	try {
		const service=createMapProposalService(stores.atlasStore),query=new URL(request.url).searchParams;
		if(request.method==="POST") {
			if(request.headers.get("content-type")?.split(";")[0]!=="application/json")throw new AtlasError("Expected JSON.",415);
			const raw=(await readSourceBody(request,4096)).toString("utf8");
			return Response.json(await service.generate(JSON.parse(raw),request.signal));
		}
		if(query.get("config")==="1")return Response.json({model:service.model()},{headers:{"Cache-Control":"no-store"}});
		if(query.has("page")) {
			const id=z.string().regex(/^mp_[0-9a-f-]{36}$/).parse(query.get("id")),page=z.coerce.number().int().min(0).max(7).parse(query.get("page"));
			const p=stores.atlasStore.proposals.read(id),hash=p?.images[page];if(!hash)throw new AtlasError("Source page unavailable.",404);
			return new Response(Buffer.from(stores.atlasStore.proposals.image(hash)),{headers:{"Content-Type":"image/png","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox"}});
		}
		return Response.json(service.read(query.get("revision")??"",query.get("id")??undefined),{headers:{"Cache-Control":"no-store"}});
	}catch(error){return Response.json({error:error instanceof AtlasError?error.message:"Interpretation is unavailable. Check the vision model configuration."},{status:error instanceof AtlasError?error.status:400});}
}
