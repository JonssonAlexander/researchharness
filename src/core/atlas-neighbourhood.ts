import type {AtlasSnapshot} from "./atlas.ts";
import {drawingConnections} from "./atlas-drawing.ts";
export function atlasConceptLessons(atlas:AtlasSnapshot,id:string){
 const claims=new Set(atlas.concepts.find(c=>c.id===id)?.propositionIds??[]);
 return (atlas.lessonMaps??[]).filter(m=>m.conceptIds.includes(id)||m.scratchwork?.some(n=>n.conceptIds.includes(id))||m.derivations.some(d=>d.propositionIds.some(p=>claims.has(p))));
}
export type AtlasMapScope={kind:"concept"|"subject";id:string};
/** A temporary view over existing identities and edges, never an inferred proof. */
export function atlasNeighbourhood(atlas:AtlasSnapshot,scope:AtlasMapScope){
 const concepts=new Map(atlas.concepts.map(c=>[c.id,c]));
 const subject=scope.kind==="subject"?atlas.subjects.find(s=>s.id===scope.id):undefined;
 const root=scope.kind==="concept"?concepts.get(scope.id):undefined;
 const links=[...drawingConnections(atlas).map(c=>({id:c.id,from:c.sourceId,to:c.targetId,kind:"drawing" as const,label:c.label})),...atlas.relations.filter(r=>r.reviewStatus==="accepted").map(r=>({id:r.id,from:r.sourceId,to:r.targetId,kind:"typed" as const,label:r.relationType}))].filter(e=>concepts.has(e.from)&&concepts.has(e.to));
 const subjects=new Set(subject?[subject.id]:[]);
 for(let i=0;i<atlas.subjects.length;i++)for(const s of atlas.subjects)if(s.parentId&&subjects.has(s.parentId))subjects.add(s.id);
 const primary=new Set(subject?atlas.concepts.filter(c=>c.subjectIds.some(id=>subjects.has(id))).map(c=>c.id):root?[root.id]:[]);
 const outside=new Map<string,number>();
 if(root)for(const e of links){const id=e.from===root.id?e.to:e.to===root.id?e.from:null;if(!id)continue;
  if(!root.preferredSubjectId||concepts.get(id)?.preferredSubjectId===root.preferredSubjectId)primary.add(id);else outside.set(id,(outside.get(id)??0)+1);
 }
 if(subject)for(const e of links){if(primary.has(e.from)&&!primary.has(e.to))outside.set(e.to,(outside.get(e.to)??0)+1);if(primary.has(e.to)&&!primary.has(e.from))outside.set(e.from,(outside.get(e.from)??0)+1);}
 const totalPrimary=primary.size;
 const kept=[...primary].sort((a,b)=>a===root?.id?-1:b===root?.id?1:a.localeCompare(b)).slice(0,120);
 primary.clear();kept.forEach(id=>primary.add(id));
 const boundary=[...outside].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,12).map(([id])=>id);
 const included=new Set([...primary,...boundary]);
 const lessonIds=new Set((scope.kind==="concept"?[scope.id]:[...primary]).flatMap(id=>atlasConceptLessons(atlas,id).map(m=>m.id)));
 return {title:subject?.title??root?.title??"Map unavailable",rootId:root?.id??atlas.concepts.find(c=>primary.has(c.id)&&c.title===subject?.title)?.id,omittedPrimary:totalPrimary-primary.size,primaryIds:[...primary],boundaryIds:boundary,omittedBoundary:Math.max(0,outside.size-boundary.length),nodes:atlas.concepts.filter(c=>included.has(c.id)),links:links.filter(e=>included.has(e.from)&&included.has(e.to)),lessons:(atlas.lessonMaps??[]).filter(m=>lessonIds.has(m.id))};
}
