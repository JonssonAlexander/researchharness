import {createHash,randomUUID} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";
import {AtlasError,type AtlasSnapshot} from "../core/atlas.ts";
import {mapReviewInput,integrationChoices,planMapIntegration,planMapConnectionRepair,type MapReview,type MapReviewStore,type MapIntegration} from "../core/map-review.ts";
import {mapDraft,validateMapDraft} from "../core/map-draft.ts";
import type {MapProposalStore} from "../core/map-proposals.ts";
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function mintId(integration:string,key:string){const h=hash([integration,key]);return `${key.startsWith("map_")?"mc":key.startsWith("edge_")?"ar":"ac"}_${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;}
type Database=<T>(run:(db:DatabaseSync)=>T)=>T;
export function createMapReviewStore(database:Database,proposals:MapProposalStore,snapshot:(db:DatabaseSync)=>AtlasSnapshot,writeNote:(id:string,text:string)=>string|null,verifyOriginal:(revision:string)=>void):MapReviewStore {
	function proposal(id:string){const p=proposals.read(id);if(!p?.draft||!p.digest||p.status!=="prepared")throw new AtlasError("A prepared second-pass draft is required.",409);return p;}
	function read(db:DatabaseSync,id:string):MapReview {
		const p=proposal(id),row=db.prepare("SELECT proposalId,revision,record FROM map_reviews WHERE proposalId=? ORDER BY revision DESC LIMIT 1").get(id);
		const record=row?JSON.parse(String(row.record)) as MapReview:{schemaVersion:1 as const,proposalId:id,revision:0,draft:p.draft!,digest:hash([p.digest,0,p.draft])};
		if(row&&(record.proposalId!==row.proposalId||record.revision!==row.revision))throw new AtlasError("Broken review identity.",409);
		if(record.schemaVersion!==1)throw new AtlasError("This review needs a newer app.",409);
		mapDraft.parse(record.draft);
		if(record.digest!==hash([p.digest,record.revision,record.draft]))throw new AtlasError("Saved draft changed outside Atlas.",409);
		const receipt=db.prepare("SELECT id,record FROM map_integrations WHERE proposalId=? AND status='committed' AND json_extract(record,'$.repairOf') IS NULL").get(id);
		return {...record,...(receipt?{integration:{id:String(receipt.id),committedAt:(JSON.parse(String(receipt.record)) as MapIntegration).committedAt!}}:{})};
	}
	function integration(db:DatabaseSync,id:string):MapIntegration {
		const row=db.prepare("SELECT * FROM map_integrations WHERE id=?").get(id);if(!row)throw new AtlasError("Integration is missing.",404);
		const record=JSON.parse(String(row.record)) as MapIntegration;
		if(record.id!==row.id||record.proposalId!==row.proposalId||record.status!==row.status)throw new AtlasError("Broken integration identity.",409);
		if(![1,2].includes(record.schemaVersion))throw new AtlasError("This integration needs a newer app.",409);
		const {digest,status:_status,committedAt:_time,...content}=record;void _status;void _time;
		if(digest!==hash({...content,status:"prepared"}))throw new AtlasError("Integration content changed outside Atlas.",409);
		return record;
	}
	return {
		read:id=>database(db=>read(db,id)),
		save(input){const value=mapReviewInput.parse(input);return database(db=>{
			db.exec("BEGIN IMMEDIATE");try{
				const old=read(db,value.proposalId),p=proposal(value.proposalId);
				if(old.integration)throw new AtlasError("This draft was integrated. Keep its approved record unchanged.",409);
				if(old.revision!==value.expectedRevision)throw new AtlasError("Draft changed in another window. Reload before saving.",409);
				const parent=proposals.read(p.refinement!.parentId)!;
				const error=validateMapDraft(value.draft,parent.findings!,p.context,p.images.length);if(error)throw new AtlasError(error);
				const revision=old.revision+1,record={schemaVersion:1 as const,proposalId:p.id,revision,draft:value.draft,digest:hash([p.digest,revision,value.draft])};
				db.prepare("INSERT INTO map_reviews VALUES (?,?,?)").run(p.id,revision,JSON.stringify(record));db.exec("COMMIT");return record;
			}catch(error){db.exec("ROLLBACK");throw error;}
		});},
		prepare(id,expectedRevision,rawChoices,expectedBase){return database(db=>{
			db.exec("BEGIN IMMEDIATE");try {
				if(Number(db.prepare("SELECT count(*) AS n FROM map_integrations WHERE proposalId=?").get(id)!.n)>=100)throw new AtlasError("This draft has reached its integration-preview limit.",409);
				const review=read(db,id);if(review.integration)throw new AtlasError("This draft is already integrated.",409);
				if(review.revision!==expectedRevision)throw new AtlasError("Save and reload the current draft before preparing integration.",409);
				const atlas=snapshot(db);if(expectedBase!==undefined&&atlas.layoutRevision!==expectedBase)throw new AtlasError("Atlas changed while reviewing identities. Reopen integration.",409);
				const choices=integrationChoices.parse(rawChoices),integrationId=`mi_${randomUUID()}`;
				const mint=(key:string)=>mintId(integrationId,key);
				const plan=planMapIntegration(proposal(id),review,atlas,choices,integrationId,mint),record={...plan,digest:hash(plan)};
				db.prepare("INSERT INTO map_integrations VALUES (?,?,?,?)").run(integrationId,id,"prepared",JSON.stringify(record));db.exec("COMMIT");return record;
			}catch(error){db.exec("ROLLBACK");throw error;}
		});},
		prepareConnections(id,expectedBase){return database(db=>{
			db.exec("BEGIN IMMEDIATE");try{
				const review=read(db,id);if(!review.integration)throw new AtlasError("Integrate the concepts before restoring connections.",409);
				if(Number(db.prepare("SELECT count(*) AS n FROM map_integrations WHERE proposalId=?").get(id)!.n)>=100)throw new AtlasError("This draft has reached its integration-preview limit.",409);
				const atlas=snapshot(db);if(atlas.layoutRevision!==expectedBase)throw new AtlasError("Atlas changed. Reopen the connection preview.",409);
				const token=`mi_${randomUUID()}`,plan=planMapConnectionRepair(proposal(id),review,integration(db,review.integration.id),atlas,token,key=>mintId(token,key));
				const record={...plan,digest:hash(plan)};db.prepare("INSERT INTO map_integrations VALUES (?,?,?,?)").run(token,id,"prepared",JSON.stringify(record));db.exec("COMMIT");return record;
			}catch(error){db.exec("ROLLBACK");throw error;}
		});},
		commit(id,digest){return database(db=>{
			db.exec("BEGIN IMMEDIATE");try {
				const record=integration(db,id),stored=record.digest;
				if(stored!==digest)throw new AtlasError("Integration approval does not match its content.",409);
				if(record.status==="committed"){db.exec("COMMIT");return record;}
				if(record.repairOf&&!record.mapConnections?.length)throw new AtlasError("No missing connections to restore.");
				const review=read(db,record.proposalId),current=snapshot(db),p=proposal(record.proposalId);
				verifyOriginal(p.sourceRevision);for(const image of p.images)proposals.image(image);
				if((record.repairOf?review.integration?.id!==record.repairOf:!!review.integration)||review.revision!==record.reviewRevision||current.layoutRevision!==record.baseRevision)throw new AtlasError("Atlas or draft changed. Prepare a new integration preview.",409);
				// Reserved IDs are deterministic within the durable prepared operation.
				const rebuilt=record.repairOf?planMapConnectionRepair(p,review,integration(db,record.repairOf),current,id,key=>mintId(id,key)):planMapIntegration(p,review,current,record.choices,id,key=>mintId(id,key));
				if(hash(rebuilt)!==stored)throw new AtlasError("Integration preview is stale. Prepare it again.",409);
				for(const n of record.concepts){
					const old=current.concepts.find(c=>c.id===n.id),marker=`<!-- atlas-source:${record.sourceRevision}:${n.key} -->`;
					if(old?.markdown?.includes(marker))throw new AtlasError(`This source concept was already integrated into ${n.title}. Review a correction in its existing notes rather than adding it again.`,409);
					const markdown=`${old?.markdown??""}\n\n${marker}\n${n.markdown}`;
					if(markdown.length>16000)throw new AtlasError(`Notes for ${n.title} exceed the limit. Shorten them before integration.`);
					const note=writeNote(n.id,markdown);
					if(old)db.prepare("UPDATE concepts SET markdownPath=?,revision=revision+1 WHERE id=?").run(note,n.id);
					else {db.prepare("INSERT INTO concepts VALUES (?,?,?,?,?,?,?,?)").run(n.id,n.title,"[]",record.choices.subjectId,1,n.x,n.y,note);
						if(record.choices.subjectId)db.prepare("INSERT INTO concept_subjects VALUES (?,?)").run(n.id,record.choices.subjectId);}
					db.prepare("INSERT INTO map_concept_reviews VALUES (?,?,?,?)").run(id,n.id,record.sourceRevision,JSON.stringify(n.reasons));
				}
				for(const r of record.relations){const now=new Date().toISOString(),contentHash=hash({...r,expectedRevision:1});
					db.prepare("INSERT INTO relations VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(r.id,r.sourceId,r.targetId,r.relationType,r.conditions,r.claimStatus,r.reviewStatus,JSON.stringify(r.evidence),1,now,now,contentHash);
					db.prepare("INSERT INTO relation_revisions VALUES (?,?,?)").run(r.id,1,JSON.stringify({...r,expectedRevision:1,createdAt:now,updatedAt:now,contentHash}));}
				for(const c of record.mapConnections??[])db.prepare("INSERT INTO map_connections VALUES (?,?,?,?,?,?,?,?)").run(c.id,c.proposalId,c.connectionKey,c.sourceRevision,c.sourceId,c.targetId,JSON.stringify(c),hash(c));
				if(!record.repairOf){const capture=db.prepare("SELECT record FROM mindmap_captures WHERE id=?").get(record.sourceRevision)!;
				const source=JSON.parse(String(capture.record));source.conceptIds=[...new Set([...source.conceptIds,...record.concepts.map(n=>n.id)])];
				db.prepare("UPDATE mindmap_captures SET record=? WHERE id=?").run(JSON.stringify(source),record.sourceRevision);}
				const committed={...record,status:"committed" as const,committedAt:new Date().toISOString()};
				db.prepare("UPDATE map_integrations SET status='committed',record=? WHERE id=?").run(JSON.stringify(committed),id);
				db.exec("UPDATE atlas_layout_version SET revision=revision+1; COMMIT");return committed;
			}catch(error){db.exec("ROLLBACK");throw error;}
		});},
	};
}
