import {createHash,randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {AtlasError} from '../core/atlas.ts';
import {preparedResearchSchema,researchApplySchema,researchCheckpointSchema,researchEvidenceSchema,type PreparedResearch,type ResearchIntegrationStore,type ResearchCheckpoint,type ResearchEvidence,type ResearchReceipt} from '../core/research-integration.ts';
import {researchTrailId,researchWorkspaceId,researchTrailSchema,researchNodeSchema,researchWorkspaceSchema} from '../core/research-trails.ts';

type Database=<T>(run:(db:DatabaseSync)=>T)=>T;
export function createResearchIntegrationStore(database:Database):ResearchIntegrationStore {
 const readReview=(db:DatabaseSync,id:string):PreparedResearch=>{
  const row=db.prepare('SELECT record,status FROM research_import_reviews WHERE id=?').get(id);
  if(!row)throw new AtlasError('Research review not found.',404);
  return preparedResearchSchema.parse({...JSON.parse(String(row.record)),status:row.status});
 };
 const checkpoint=(db:DatabaseSync,trailId:string,workspaceId:string):ResearchCheckpoint|null=>{
  researchTrailId.parse(trailId);researchWorkspaceId.parse(workspaceId);
  const row=db.prepare('SELECT record FROM research_import_checkpoints WHERE trailId=? AND workspaceId=?').get(trailId,workspaceId);
  return row?researchCheckpointSchema.parse(JSON.parse(String(row.record))):null;
 };
 return {
  checkpoint:(trailId,workspaceId)=>database(db=>checkpoint(db,trailId,workspaceId)),
  reviews:trailId=>database(db=>{researchTrailId.parse(trailId);return db.prepare('SELECT id,status,record FROM research_import_reviews WHERE trailId=? ORDER BY rowid DESC LIMIT 20').all(trailId).map(row=>{const r=preparedResearchSchema.parse(JSON.parse(String(row.record)));return {id:r.id,digest:r.digest,status:row.status as PreparedResearch['status'],createdAt:r.createdAt};});}),
  review:id=>database(db=>readReview(db,id)),
  evidence:(trailId,before)=>database(db=>{researchTrailId.parse(trailId);if(before&&!db.prepare('SELECT 1 FROM research_evidence WHERE id=? AND trailId=?').get(before,trailId))throw new AtlasError('Evidence page unavailable.',404);return db.prepare('SELECT record FROM research_evidence WHERE trailId=? AND (? IS NULL OR rowid<(SELECT rowid FROM research_evidence WHERE id=? AND trailId=?)) ORDER BY rowid DESC LIMIT 21').all(trailId,before??null,before??null,trailId).map(r=>researchEvidenceSchema.parse(JSON.parse(String(r.record))));}),
  prepare:input=>database(db=>{
   const r=preparedResearchSchema.parse(input),{digest,...content}=r;
   if(r.status!=='prepared'||createHash('sha256').update(JSON.stringify(content)).digest('hex')!==digest)throw new AtlasError('Invalid research snapshot.');
   const existing=db.prepare('SELECT record FROM research_import_reviews WHERE id=?').get(r.id);
   if(existing){if(String(existing.record)!==JSON.stringify(r))throw new AtlasError('Review identity already used.',409);return readReview(db,r.id);}
   db.prepare('INSERT INTO research_import_reviews(id,trailId,record,status) VALUES (?,?,?,?)').run(r.id,r.trailId,JSON.stringify(r),'prepared');return r;
  }),
  apply:input=>database(db=>{
   const c=researchApplySchema.parse(input);db.exec('BEGIN IMMEDIATE');
   try {
    const row=db.prepare('SELECT command,receipt FROM research_import_reviews WHERE id=?').get(c.reviewId);
    if(!row)throw new AtlasError('Research review not found.',404);
    if(row.receipt){if(row.command!==JSON.stringify(c))throw new AtlasError('Review already acknowledged with different decisions.',409);db.exec('COMMIT');return JSON.parse(String(row.receipt)) as ResearchReceipt;}
    const r=readReview(db,c.reviewId);
    if(r.digest!==c.digest)throw new AtlasError('Review digest changed. Refresh.',409);
    const trailRow=db.prepare('SELECT record FROM research_trails WHERE id=?').get(r.trailId);
    const workspaceRow=db.prepare('SELECT record FROM research_workspaces WHERE id=?').get(r.workspaceId);
    if(!trailRow||!workspaceRow)throw new AtlasError('Trail or workspace unavailable.',409);
    const t=researchTrailSchema.parse(JSON.parse(String(trailRow.record))),w=researchWorkspaceSchema.parse(JSON.parse(String(workspaceRow.record)));
    const nodes=db.prepare('SELECT record FROM research_nodes WHERE trailId=? ORDER BY id').all(t.id).map(n=>researchNodeSchema.parse(JSON.parse(String(n.record))));
    const base=r.base;
    if(t.revision!==base.trailRevision||w.revision!==base.workspaceRevision||t.workspaceId!==w.id||w.provision!=='ready'||JSON.stringify(nodes.map(n=>({id:n.id,revision:n.revision})))!==JSON.stringify([...base.nodes].sort((a,b)=>a.id.localeCompare(b.id)))||checkpoint(db,t.id,w.id)?.receipt!== (base.checkpointReceipt??undefined))throw new AtlasError('Research changed during review. Refresh project changes.',409);
    const ids=new Set(c.decisions.map(d=>d.sourceId));
    if(ids.size!==c.decisions.length||c.decisions.some(d=>!r.sources.some(s=>s.id===d.sourceId)))throw new AtlasError('Review contains unknown or duplicate sources.');
    if(!c.dismiss&&(c.decisions.length!==r.sources.length||!c.decisions.some(d=>d.included)))throw new AtlasError('Choose findings to attach, or dismiss these changes.');
    const now=new Date().toISOString(),evidenceIds:string[]=[];
    if(!c.dismiss)for(const d of c.decisions.filter(d=>d.included)){
     let nodeId=d.nodeId;
     if(nodeId){if(!nodes.some(n=>n.id===nodeId))throw new AtlasError('Evidence target must belong to this trail.');}
     else {
      const parents=new Map(nodes.map(n=>[n.id,n.parentNodeId]));let parent:string|null=d.parentNodeId,depth=1;
      if(!parents.has(d.parentNodeId))throw new AtlasError('Branch parent must belong to this trail.');
      while(parent!==null){depth++;parent=parents.get(parent)??null;if(depth>32)throw new AtlasError('Research branch depth limit reached.');}
      if(nodes.length>=500)throw new AtlasError('Research node limit reached.');
      nodeId=`rn_${randomUUID()}`;const node={id:nodeId,trailId:t.id,parentNodeId:d.parentNodeId,kind:'note' as const,title:d.title,body:d.interpretation,relatedConceptIds:[],revision:1,createdAt:now,updatedAt:now};
      db.prepare('INSERT INTO research_nodes VALUES (?,?,?)').run(nodeId,t.id,JSON.stringify(node));nodes.push(node);
     }
     const evidence:ResearchEvidence={id:randomUUID(),nodeId,sourceId:d.sourceId,reviewId:r.id,title:d.title,interpretation:d.interpretation,uncertainty:d.uncertainty,source:r.sources.find(s=>s.id===d.sourceId)!,createdAt:now};
     db.prepare('INSERT INTO research_evidence VALUES (?,?,?,?)').run(evidence.id,t.id,nodeId,JSON.stringify(evidence));evidenceIds.push(evidence.id);
    }
    const old=checkpoint(db,t.id,w.id);
    const next:ResearchCheckpoint={trailId:t.id,workspaceId:w.id,fileHashes:{...old?.fileHashes,...r.fileHashes},runHashes:{...old?.runHashes,...r.runHashes},git:r.git,runCursor:r.runCursor??0,receipt:r.id,updatedAt:now};
    db.prepare('INSERT INTO research_import_checkpoints VALUES (?,?,?) ON CONFLICT(trailId,workspaceId) DO UPDATE SET record=excluded.record').run(t.id,w.id,JSON.stringify(next));
    db.prepare('UPDATE research_trails SET record=? WHERE id=?').run(JSON.stringify({...t,revision:t.revision+1,updatedAt:now}),t.id);
    const receipt:ResearchReceipt={reviewId:r.id,status:c.dismiss?'dismissed':'applied',evidenceIds};
    db.prepare('UPDATE research_import_reviews SET status=?,command=?,receipt=? WHERE id=?').run(receipt.status,JSON.stringify(c),JSON.stringify(receipt),r.id);
    db.exec('COMMIT');return receipt;
   }catch(e){db.exec('ROLLBACK');throw e;}
  }),
 };
}
