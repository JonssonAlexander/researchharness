import {createHash,randomUUID} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";
import {AtlasError} from "../core/atlas.ts";
import {proposalRecord,type MapProposal,type MapProposalStore} from "../core/map-proposals.ts";

type Database=<T>(run:(db:DatabaseSync)=>T)=>T;
const globalOwner=globalThis as typeof globalThis & {__atlasProposalOwner?:string};
const owner=globalOwner.__atlasProposalOwner??=randomUUID();
export function mapProposalDigest(p:MapProposal) {
	const content:unknown[]=[p.sourceRevision,p.sourceHash,p.baseRevision,p.context,p.model,p.images,p.findings];
	if(p.schemaVersion===2)content.push(p.imageLayout);
	return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}
export function createMapProposalStore(database:Database,files:Pick<MapProposalStore,"retainImage"|"image">):MapProposalStore {
	function parse(db:DatabaseSync,row:Record<string,unknown>|undefined):MapProposal|null {
		if(!row)return null;
		const raw=JSON.parse(String(row.record));
		if(raw.schemaVersion>2)throw new AtlasError("This proposal needs a newer app.",409);
		let p=proposalRecord.parse(raw);
		if(p.id!==row.id||p.sourceRevision!==row.sourceRevision||p.status!==row.status)throw new AtlasError("Broken proposal identity.",500);
		if(p.status==="prepared"&&(!p.findings||p.digest!==mapProposalDigest(p)))throw new AtlasError("Proposal content changed outside Atlas.",409);
		if(p.status==="running"&&row.owner!==owner) {
			p={...p,status:"failed",updatedAt:new Date().toISOString(),error:"Interpretation was interrupted by an app restart. It was not retried; provider usage may be incomplete."};
			db.prepare("UPDATE map_proposals SET status=?,record=? WHERE id=?").run(p.status,JSON.stringify(p),p.id);
		}
		return p;
	}
	return {
		...files,
		read:id=>database(db=>parse(db,db.prepare("SELECT * FROM map_proposals WHERE id=?").get(id))),
		history:id=>database(db=>db.prepare("SELECT * FROM map_proposals WHERE sourceRevision=? ORDER BY rowid").all(id).map(row=>parse(db,row)!)),
		latest:id=>database(db=>parse(db,db.prepare("SELECT * FROM map_proposals WHERE sourceRevision=? ORDER BY rowid DESC LIMIT 1").get(id))),
		begin(input) {
			const p=proposalRecord.parse(input);
			return database(db=>{
				db.exec("BEGIN IMMEDIATE");
				try {
					if(p.status!=="running"||p.findings||p.images.length)throw new AtlasError("Start with an empty running proposal.");
					const source=db.prepare("SELECT record FROM mindmap_captures WHERE id=?").get(p.sourceRevision);
					if(!source||JSON.parse(String(source.record)).hash!==p.sourceHash)throw new AtlasError("Source revision changed.",409);
					const old=parse(db,db.prepare("SELECT * FROM map_proposals WHERE id=?").get(p.id));
					if(old) {if(old.sourceRevision!==p.sourceRevision)throw new AtlasError("Proposal token belongs to a different revision.",409);db.exec("COMMIT");return false;}
					if(Number(db.prepare("SELECT revision FROM atlas_layout_version").get()!.revision)!==p.baseRevision)
						throw new AtlasError("Atlas changed before interpretation. Reopen the review.",409);
					if(Number(db.prepare("SELECT count(*) AS n FROM map_proposals WHERE sourceRevision=?").get(p.sourceRevision)!.n)>=20)
						throw new AtlasError("This revision already has 20 attempts. Keep these records and import a new source revision before retrying.",409);
					const running=parse(db,db.prepare("SELECT * FROM map_proposals WHERE sourceRevision=? AND status='running'").get(p.sourceRevision));
					if(running?.status==="running")throw new AtlasError("This revision is already being interpreted.",409);
					db.prepare("INSERT INTO map_proposals VALUES (?,?,?,?,?)").run(p.id,p.sourceRevision,p.status,owner,JSON.stringify(p));
					db.exec("COMMIT");return true;
				}catch(error){db.exec("ROLLBACK");throw error;}
			});
		},
		update(input) {
			const p=proposalRecord.parse(input);
			if(p.status==="prepared") {
				if(!p.findings||!p.images.length)throw new AtlasError("Proposal has no findings or source pages.");
				p.digest=mapProposalDigest(p);
			}
			database(db=>{
				const row=db.prepare("SELECT * FROM map_proposals WHERE id=?").get(p.id),old=parse(db,row);
				if(!old || JSON.stringify([old.schemaVersion,old.sourceRevision,old.sourceHash,old.baseRevision,old.context,old.model,old.createdAt])!==
					JSON.stringify([p.schemaVersion,p.sourceRevision,p.sourceHash,p.baseRevision,p.context,p.model,p.createdAt]))
					throw new AtlasError("Proposal source or base changed.",409);
				const result=db.prepare("UPDATE map_proposals SET status=?,record=? WHERE id=? AND owner=? AND status='running'")
					.run(p.status,JSON.stringify(p),p.id,owner);
				if(!result.changes)throw new AtlasError("Proposal is no longer running.",409);
			});
		},
	};
}
