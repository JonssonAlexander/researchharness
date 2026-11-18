import {createResearchIntegrationStore} from './research-integration.ts';
import type { DatabaseSync } from 'node:sqlite';
import { AtlasError } from '../core/atlas.ts';
import { researchCommandSchema, researchTrailId, researchWorkspaceSchema, researchTrailSchema, researchNodeSchema, type ResearchStore, type ResearchTrail, type ResearchNode, type ResearchWorkspace } from '../core/research-trails.ts';

type Database = <T>(run:(db:DatabaseSync)=>T)=>T;
type StoredTrail = Omit<ResearchTrail,'missingConceptIds'|'linkedConceptIds'>;
type StoredNode = Omit<ResearchNode,'missingConceptIds'>;

export function createResearchStore(database:Database):ResearchStore {
 const parse = <T>(table:string,raw:unknown):T => {
  try {
   const schema = table==='research_trails' ? researchTrailSchema : table==='research_nodes' ? researchNodeSchema : researchWorkspaceSchema;
   return schema.parse(JSON.parse(String(raw))) as T;
  } catch { throw new AtlasError('Invalid research record; no changes were made.',500); }
 };
 const get = <T>(db:DatabaseSync,table:string,id:string):T|null => {
  const row = db.prepare(`SELECT record FROM ${table} WHERE id=?`).get(id);
  return row ? parse<T>(table,row.record) : null;
 };
 const all = <T>(db:DatabaseSync,table:string):T[] => db.prepare(`SELECT record FROM ${table} ORDER BY id`).all().map(r=>parse<T>(table,r.record));
 const missing = (db:DatabaseSync,ids:string[]) => ids.filter(id=>!db.prepare('SELECT 1 FROM concepts WHERE id=?').get(id));
 const trailView = (db:DatabaseSync,trail:StoredTrail):ResearchTrail => {
  const linked = db.prepare("SELECT DISTINCT json_each.value AS id FROM research_nodes, json_each(research_nodes.record, '$.relatedConceptIds') WHERE research_nodes.trailId=?").all(trail.id).map(row=>String(row.id));
  return {...trail,missingConceptIds:missing(db,trail.anchorConceptIds),linkedConceptIds:[...new Set([...trail.anchorConceptIds,...linked])]};
 };
 const nodeView = (db:DatabaseSync,node:StoredNode):ResearchNode => ({...node,missingConceptIds:missing(db,node.relatedConceptIds)});
 const required = <T>(value:T|null,label:string):T => {if(!value) throw new AtlasError(`${label} not found.`,404); return value;};
 const checkRevision = (actual:number,expected:number) => {if(actual!==expected) throw new AtlasError('Research record changed. Reload before editing.',409);};
 const checkLinks = (db:DatabaseSync,ids:string[],old:string[]=[]) => {if(missing(db,ids.filter(id=>!old.includes(id))).length) throw new AtlasError('A linked concept no longer exists.',409);};
 const put = (db:DatabaseSync,table:string,id:string,record:unknown) => db.prepare(`UPDATE ${table} SET record=? WHERE id=?`).run(JSON.stringify(record),id);
 const nodesFor = (db:DatabaseSync,trailId:string):StoredNode[] => db.prepare('SELECT record FROM research_nodes WHERE trailId=? ORDER BY id').all(trailId).map(r=>parse<StoredNode>('research_nodes',r.record));
 const lineage = (nodes:StoredNode[],id:string,parentId:string|null,rootId:string) => {
  if(id===rootId && parentId!==null || id!==rootId && parentId===null) throw new AtlasError('A trail must have exactly one root.',400);
  const parents=new Map(nodes.map(n=>[n.id,n.parentNodeId])); parents.set(id,parentId);
  for(const node of nodes.concat(nodes.some(n=>n.id===id)?[]:[{id} as StoredNode])) {
   let current:string|null=node.id; const seen=new Set<string>();
   while(current!==null) {if(seen.has(current)) throw new AtlasError('Research branches cannot form cycles.',400); seen.add(current); if(seen.size>32) throw new AtlasError('Research branch depth limit reached.',400); if(!parents.has(current)) throw new AtlasError('Parent must belong to the same trail.',400); current=parents.get(current)!;}
  }
 };
 return {
  integration:createResearchIntegrationStore(database),
  list:()=>database(db=>({trails:all<StoredTrail>(db,'research_trails').map(t=>trailView(db,t)),workspaces:all<ResearchWorkspace>(db,'research_workspaces')})),
  detail:(id)=>database(db=>{researchTrailId.parse(id);const trail=required(get<StoredTrail>(db,'research_trails',id),'Trail');return {trail:trailView(db,trail),nodes:nodesFor(db,id).map(n=>nodeView(db,n)),workspace:trail.workspaceId?get<ResearchWorkspace>(db,'research_workspaces',trail.workspaceId):null};}),
  save:(input)=>database(db=>{
   const c=researchCommandSchema.parse(input); db.exec('BEGIN IMMEDIATE');
   try {
    if('requestId' in c) {const receipt=db.prepare('SELECT command,result FROM research_mutation_receipts WHERE id=?').get(c.requestId); if(receipt) {if(receipt.command!==JSON.stringify(c)) throw new AtlasError('Request ID was already used for a different operation.',409);db.exec('COMMIT');return JSON.parse(String(receipt.result));}}
    const now=new Date().toISOString(); let result:{trailId?:string;workspaceId?:string}={};
    if(c.kind==='create') {
     if(Number(db.prepare('SELECT count(*) AS count FROM research_trails').get()!.count)>=1000) throw new AtlasError('Research trail limit reached.',400);
     if(get(db,'research_trails',c.id)||get(db,'research_nodes',c.rootNodeId)) throw new AtlasError('Research ID already exists.',409);
     checkLinks(db,c.anchorConceptIds);
     const trail:StoredTrail={id:c.id,title:c.title,rootNodeId:c.rootNodeId,status:'active',workspaceId:null,primaryConceptId:c.primaryConceptId,anchorConceptIds:c.anchorConceptIds,origin:c.origin,revision:1,createdAt:now,updatedAt:now,archivedAt:null};
     const node:StoredNode={id:c.rootNodeId,trailId:c.id,parentNodeId:null,kind:'question',title:c.question,body:'',relatedConceptIds:[],revision:1,createdAt:now,updatedAt:now};
     db.prepare('INSERT INTO research_trails VALUES (?,?)').run(c.id,JSON.stringify(trail));db.prepare('INSERT INTO research_nodes VALUES (?,?,?)').run(node.id,c.id,JSON.stringify(node));result={trailId:c.id};
    } else if(c.kind==='edit-trail') {
     const t=required(get<StoredTrail>(db,'research_trails',c.id),'Trail');checkRevision(t.revision,c.expectedRevision);checkLinks(db,c.anchorConceptIds,t.anchorConceptIds);
     put(db,'research_trails',c.id,{...t,title:c.title,status:c.status,anchorConceptIds:c.anchorConceptIds,primaryConceptId:c.primaryConceptId,archivedAt:c.archived?(t.archivedAt??now):null,revision:t.revision+1,updatedAt:now});result={trailId:c.id};
    } else if(c.kind==='add-node') {
     const t=required(get<StoredTrail>(db,'research_trails',c.trailId),'Trail'); if(get(db,'research_nodes',c.id)) throw new AtlasError('Research ID already exists.',409);const nodes=nodesFor(db,t.id);if(nodes.length>=500) throw new AtlasError('Research node limit reached.',400);checkLinks(db,c.relatedConceptIds);lineage(nodes,c.id,c.parentNodeId,t.rootNodeId);
     const node:StoredNode={id:c.id,trailId:c.trailId,parentNodeId:c.parentNodeId,kind:c.nodeKind,title:c.title,body:c.body,relatedConceptIds:c.relatedConceptIds,revision:1,createdAt:now,updatedAt:now};db.prepare('INSERT INTO research_nodes VALUES (?,?,?)').run(c.id,c.trailId,JSON.stringify(node));result={trailId:c.trailId};
    } else if(c.kind==='edit-node') {
     const n=required(get<StoredNode>(db,'research_nodes',c.id),'Node');checkRevision(n.revision,c.expectedRevision);const t=required(get<StoredTrail>(db,'research_trails',n.trailId),'Trail');if(n.id===t.rootNodeId && c.nodeKind!=='question') throw new AtlasError('The root must remain a question.',400);checkLinks(db,c.relatedConceptIds,n.relatedConceptIds);lineage(nodesFor(db,t.id),n.id,c.parentNodeId,t.rootNodeId);put(db,'research_nodes',n.id,{...n,parentNodeId:c.parentNodeId,kind:c.nodeKind,title:c.title,body:c.body,relatedConceptIds:c.relatedConceptIds,revision:n.revision+1,updatedAt:now});result={trailId:t.id};
    } else if(c.kind==='workspace') {
     const w=get<ResearchWorkspace>(db,'research_workspaces',c.id);if(!w && Number(db.prepare('SELECT count(*) AS count FROM research_workspaces').get()!.count)>=200) throw new AtlasError('Research workspace limit reached.',400);checkRevision(w?.revision??0,c.expectedRevision);const record:ResearchWorkspace={id:c.id,label:c.label,localRoot:c.localRoot,provision:c.provision,revision:(w?.revision??0)+1,createdAt:w?.createdAt??now,updatedAt:now};if(w) put(db,'research_workspaces',c.id,record);else db.prepare('INSERT INTO research_workspaces VALUES (?,?)').run(c.id,JSON.stringify(record));result={workspaceId:c.id};
    } else {
     const t=required(get<StoredTrail>(db,'research_trails',c.trailId),'Trail');checkRevision(t.revision,c.expectedRevision);if(c.workspaceId) required(get(db,'research_workspaces',c.workspaceId),'Workspace');put(db,'research_trails',t.id,{...t,workspaceId:c.workspaceId,revision:t.revision+1,updatedAt:now});result={trailId:t.id,workspaceId:c.workspaceId??undefined};
    }
    if('requestId' in c) db.prepare('INSERT INTO research_mutation_receipts VALUES (?,?,?)').run(c.requestId,JSON.stringify(c),JSON.stringify(result));db.exec('COMMIT');return result;
   } catch(error) {db.exec('ROLLBACK');throw error;}
  }),
 };
}
