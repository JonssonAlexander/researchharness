import type {AtlasSnapshot} from "./atlas.ts";
import type {LessonArtifact} from "./lesson-integration.ts";
import {layoutLessonMap,lessonLabelSize,lessonMapLayers,settleLessonLayout} from "./lesson-map-layout.ts";
import type {LessonTopic} from "./learning-session.ts";
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

type MapPoint = {id:string;x:number;y:number};

/** View-local title merging. The saved topic IDs and lesson maps stay separate. */
export function layoutAtlasLessonBranches(
 root:MapPoint & {title:string},
 atlasPoints:readonly (MapPoint & {title:string})[],
 lessons:readonly LessonArtifact[],
){
 const topics=new Map<string,MapPoint & {title:string;lessonIds:string[];labels:{lessonId:string;topic:LessonTopic}[]}>();
 const edges=new Map<string,{from:string;to:string;routeIds:string[];mapIds:string[];branch:boolean}>();
 const laneTops=[0,0];
 const lanes=lessons.map((lesson,index)=>{
  const side=index%2;
  const laneTop=laneTops[side]!;
  const seeds=layoutLessonMap(lesson.map);
  const nodes=new Map(lesson.map.nodes.map(n=>[n.id,n]));
  const top=Math.min(...seeds.map(p=>p.y));
  const bottom=Math.max(...seeds.map(p=>p.y+lessonLabelSize(nodes.get(p.id)!).height));
  const lane={lesson,seeds,side,top:laneTop-top,left:Math.min(...seeds.map(p=>p.x))};
  if(seeds.length)laneTops[side]=laneTop+bottom-top+100;
  return lane;
 });
 for(const {lesson,seeds,side,top,left} of lanes){
  const totalHeight=Math.max(0,laneTops[side]!-100);
  const direction=side===0?1:-1;
  const plan=lesson.map;
  const layers=lessonMapLayers(plan);
  const seedsById=new Map(seeds.map(p=>[p.id,p]));
  const ids=new Map<string,string>();
  for(const topic of plan.nodes){
   if(topic.title===root.title){ids.set(topic.id,root.id);continue;}
   let point=topics.get(topic.title);
   if(!point){
    const p=seedsById.get(topic.id)!;
    point={x:root.x+direction*(330+p.x-left),y:root.y+p.y+top-totalHeight/2,id:`lesson-topic:${topic.title}`,title:topic.title,lessonIds:[],labels:[]};
    topics.set(topic.title,point);
   }
   if(!point.lessonIds.includes(lesson.id))point.lessonIds.push(lesson.id);
   point.labels.push({lessonId:lesson.id,topic});
   ids.set(topic.id,point.id);
  }
  const neighbours=new Map<string,Set<string>>();
  function link(from:string,to:string,kind:"route"|"branch"|"association"){
   if(from===to)return;
   const key=JSON.stringify([from,to].sort());
   const edge=edges.get(key)??{from,to,routeIds:[],mapIds:[],branch:false};
   edge.branch ||= kind==="branch";
   const members=kind==="route"?edge.routeIds:edge.mapIds;
   if(!members.includes(lesson.id))members.push(lesson.id);
   edges.set(key,edge);
   if(!neighbours.has(from))neighbours.set(from,new Set());
   if(!neighbours.has(to))neighbours.set(to,new Set());
   neighbours.get(from)!.add(to);
   neighbours.get(to)!.add(from);
  }
  for(const [links,kind] of [[layers.route,"route"],[layers.branches,"branch"],[layers.associations,"association"]] as const){
   for(const {from,to} of links){
    const a=ids.get(from),b=ids.get(to);
    if(a&&b)link(a,b,kind);
   }
  }
  const seen=new Set<string>();
  function visit(id:string){
   const stack=[id];
   for(let next=stack.pop();next!==undefined;next=stack.pop()){
    if(seen.has(next))continue;
    seen.add(next);
    for(const neighbour of neighbours.get(next)??[])stack.push(neighbour);
   }
  }
  visit(root.id);
  const preferred=plan.nodes.filter(n=>n.conceptId===root.id).map(n=>n.id);
  for(const topicId of [...preferred,...layers.order,...ids.keys()]){
   const id=ids.get(topicId);
   if(!id||seen.has(id))continue;
   visit(id);
   link(root.id,id,"branch");
  }
 }
 const lessonTopics=[...topics.values()];
 if(!lessonTopics.length)return {topics:lessonTopics,edges:[]};
 const atlasNodes=atlasPoints.map(({id,title})=>({id,title,conceptId:null,tangent:false}));
 const points=[...atlasPoints,...lessonTopics];
 const settled=settleLessonLayout(points,[...atlasNodes,...lessonTopics.map(p=>({...p.labels[0]!.topic,id:p.id}))],{
  route:[...edges.values()].filter(e=>e.routeIds.length),
  branches:[...edges.values()].filter(e=>!e.routeIds.length&&e.branch),
  associations:[...edges.values()].filter(e=>!e.routeIds.length&&!e.branch),
 },new Map(points.map(p=>[p.id,p])),new Set(atlasPoints.map(p=>p.id)));
 const coordinates=new Map(settled.map(p=>[p.id,p]));
 return {topics:lessonTopics.map(p=>({...p,...coordinates.get(p.id)!})),edges:[...edges.values()]};
}
