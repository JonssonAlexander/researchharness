import {z} from "zod";
import {AtlasError} from "../core/atlas.ts";
import {mapReviewInput,integrationChoices} from "../core/map-review.ts";
import {emit} from "../core/events.ts";
import {stores} from "./stores.ts";
const command=z.discriminatedUnion("action",[
	mapReviewInput.extend({action:z.literal("save")}),
	z.object({action:z.literal("prepare"),proposalId:z.string(),expectedRevision:z.number().int().nonnegative(),choices:integrationChoices,baseRevision:z.number().int().nonnegative()}).strict(),
	z.object({action:z.literal("commit"),id:z.string().regex(/^mi_[0-9a-f-]{36}$/),digest:z.string().regex(/^[a-f0-9]{64}$/),approve:z.literal(true)}).strict(),
]);
export async function mapReviewResponse(request:Request):Promise<Response>{
	try {
		const store=stores.atlasStore.reviews;
		if(request.method==="GET")return Response.json(store.read(new URL(request.url).searchParams.get("id")??""),{headers:{"Cache-Control":"no-store"}});
		if(request.headers.get("content-type")?.split(";")[0]!=="application/json")return Response.json({error:"Expected JSON."},{status:415});
		const reader=request.body?.getReader();if(!reader)throw new AtlasError("Expected review content.");
		const chunks:Uint8Array[]=[];let size=0;
		try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>512000){await reader.cancel();throw new AtlasError("Review is too large.",413);}chunks.push(value);}}finally{reader.releaseLock();}
		const result=command.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));if(!result.success)throw new AtlasError(result.error.issues[0]?.message??"Invalid review.");
		const c=result.data;
		const value=c.action==="save"?store.save({proposalId:c.proposalId,expectedRevision:c.expectedRevision,draft:c.draft}):c.action==="prepare"?store.prepare(c.proposalId,c.expectedRevision,c.choices,c.baseRevision):store.commit(c.id,c.digest);
		emit("atlas-changed",{});return Response.json(value);
	}catch(error){return Response.json({error:error instanceof AtlasError?error.message:"Map review could not be saved. Local edits remain in this view."},{status:error instanceof AtlasError?error.status:400});}
}
