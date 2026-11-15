import {forceCollide,forceX,forceY,forceLink} from "d3-force";
import {createGraphSimulation,type LayoutNode} from "./layout.ts";
import {lessonRoute,lessonTopicKind,type LearningPlan,type LessonTopic} from "./learning-session.ts";
type MapPlan=Pick<LearningPlan,"nodes"|"connections">;
type Point={id:string;x:number;y:number};
export const LESSON_LABEL_WIDTH=220;
export const LESSON_LABEL_HEIGHT=100;
/** Legacy branches attach only when the saved associations identify one main parent. */
export function lessonParent(plan:MapPlan,node:LessonTopic):string|null{
 if(node.parentId)return node.parentId;
 if(lessonTopicKind(node)==="topic")return null;
 const main=new Set(lessonRoute(plan)),parents=new Set(plan.connections.flatMap(e=>e.from===node.id&&main.has(e.to)?[e.to]:e.to===node.id&&main.has(e.from)?[e.from]:[]));
 return parents.size===1?[...parents][0]!:null;
}
export function lessonRoot(plan:MapPlan,id:string|null):string|null{
 const seen=new Set<string>();let node=plan.nodes.find(n=>n.id===id);
 while(node&&!seen.has(node.id)){seen.add(node.id);const parent=lessonParent(plan,node);if(!parent)return node.id;node=plan.nodes.find(n=>n.id===parent);}
 return null;
}
/** Expand only saved local context; no guessed connections or progress changes. */
export function lessonVisibleTopicIds(plan:MapPlan,branch:string|null,all=false,current:string|null=null){
 const ids=new Set(plan.nodes.filter(n=>all||!lessonParent(plan,n)||branch&&lessonRoot(plan,n.id)===branch).map(n=>n.id));
 if(current){ids.add(current);for(const e of plan.connections){if(e.from===current)ids.add(e.to);if(e.to===current)ids.add(e.from);}}
 for(const id of [...ids]){let node=plan.nodes.find(n=>n.id===id);const seen=new Set<string>();while(node&&!seen.has(node.id)){seen.add(node.id);const parent=lessonParent(plan,node);if(!parent)break;ids.add(parent);node=plan.nodes.find(n=>n.id===parent);}}
 return ids;
}
export function lessonMapLayers(plan:MapPlan){
 const order=lessonRoute(plan),route=order.slice(1).map((to,i)=>({from:order[i]!,to}));
 const branches=plan.nodes.flatMap(n=>{const parent=lessonParent(plan,n);return parent?[{from:parent,to:n.id}]:[];});
 const key=(e:{from:string;to:string})=>[e.from,e.to].sort().join(":");
 const primary=new Set([...route,...branches].map(key));
 return {order,route,branches,associations:plan.connections.filter(e=>!primary.has(key(e)))};
}
/** Never cut a mathematical label or replace its identifying words with an ellipsis. */
export function lessonMapTitle(title:string){return title;}
export function lessonLabelSize(node:LessonTopic){
 const width=lessonTopicKind(node)==="topic"?240:220;
 return {width,height:24+Math.ceil((node.question||node.title).length/25)*19+(node.question&&node.question!==node.title?25:0)+(node.formula?42:0)};
}
/** Resolve actual label rectangles, with a stable direction for coincident points. */
function clearLabels(nodes:Point[],plan:MapPlan,pinned=new Set<string>()){
 const sizes=new Map(plan.nodes.map(n=>[n.id,lessonLabelSize(n)]));
 for(let pass=0;pass<100;pass++){
  let overlap=false;
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
   const a=nodes[i]!,b=nodes[j]!,sa=sizes.get(a.id)!,sb=sizes.get(b.id)!,dx=b.x-a.x,dy=b.y-a.y;
   const ox=(sa.width+sb.width)/2+20-Math.abs(dx),oy=Math.max(sa.height,sb.height)+24-Math.abs(dy);
   if(ox<=0||oy<=0||pinned.has(a.id)&&pinned.has(b.id))continue;overlap=true;
   const ma=pinned.has(a.id)?0:pinned.has(b.id)?1:.5,mb=1-ma;
   if(ox<oy){const move=(ox+.1)*(dx>=0?1:-1);a.x-=move*ma;b.x+=move*mb;}else{const move=(oy+.1)*(dy>=0?1:-1);a.y-=move*ma;b.y+=move*mb;}
  }
  if(!overlap)break;
 }
 return nodes;
}
/** Stage positions are seeds only; springs, repulsion and weak local gravity form the map. */
export function layoutLessonMap(plan:MapPlan):Point[]{
 const roots=plan.nodes.filter(n=>!lessonParent(plan,n)),groups=roots.map(root=>({root,children:plan.nodes.filter(n=>n.id!==root.id&&lessonRoot(plan,n.id)===root.id)}));
 const sections:{name:string;groups:typeof groups}[]=[];
 for(const group of groups){const name=group.root.section??group.root.id,last=sections.at(-1);if(last?.name===name)last.groups.push(group);else sections.push({name,groups:[group]});}
 const placed:Point[]=[];let x=0;
 for(const section of sections){let y=0,maxChildren=0;
  for(const {root,children} of section.groups){
   const rows=Math.ceil(children.length/2),height=Math.max(220,rows*155+100),cy=y+height/2;
   placed.push({id:root.id,x,y:cy});
   children.forEach((n,j)=>placed.push({id:n.id,x:x+300+(j%2)*260,y:cy+(Math.floor(j/2)-(rows-1)/2)*155}));
   y+=height+80;maxChildren=Math.max(maxChildren,children.length);
  }
  x+=maxChildren?920:420;
 }
 const rootById=new Map(roots.map(n=>[n.id,n])),centres=new Map<string,{x:number;y:number;count:number}>();
 const stage=(id:string)=>{const root=rootById.get(lessonRoot(plan,id)??id);return root?.section??root?.id??id;};
 for(const p of placed){const name=stage(p.id),c=centres.get(name)??{x:0,y:0,count:0};c.x+=p.x;c.y+=p.y;c.count++;centres.set(name,c);}
 for(const c of centres.values()){c.x/=c.count;c.y/=c.count;}
 const nodes:LayoutNode[]=placed.map(p=>({...p})),layers=lessonMapLayers(plan);
 const links=[...layers.route.map(e=>({...e,distance:320,strength:.07})),...layers.branches.map(e=>({...e,distance:220,strength:.14})),...layers.associations.map(e=>({...e,distance:400,strength:.015}))];
 const sim=createGraphSimulation(nodes,[],{chargeStrength:-900,gravity:{x:0,y:0,strength:0}});
 sim.force("relationships",forceLink<LayoutNode,{source:string|LayoutNode;target:string|LayoutNode;distance:number;strength:number}>(links.map(e=>({source:e.from,target:e.to,distance:e.distance,strength:e.strength}))).id(n=>n.id).distance(e=>e.distance).strength(e=>e.strength));
 sim.force("stageX",forceX<LayoutNode>(n=>centres.get(stage(n.id))!.x).strength(.008));
 sim.force("stageY",forceY<LayoutNode>(n=>centres.get(stage(n.id))!.y).strength(.008));
 sim.force("labels",forceCollide<LayoutNode>(n=>lessonLabelSize(plan.nodes.find(p=>p.id===n.id)!).width*.52).iterations(2));
 sim.tick(240);sim.stop();
 return clearLabels(nodes.map(n=>({id:n.id,x:n.x!,y:n.y!})),plan);
}
export interface LessonMapMotion {
 readonly active:boolean;
 move:(id:string,target:{x:number;y:number})=>void;
 release:()=>void;
 cancel:()=>void;
 step:()=>boolean;
 positions:()=>Point[];
}
/** The same D3 force engine as Atlas, warm-started and bounded to the dragged neighbourhood. */
export function createLessonMotion(plan:MapPlan,points:Point[]):LessonMapMotion{
 const nodes:LayoutNode[]=points.map(p=>({...p,fx:p.x,fy:p.y})),byId=new Map(nodes.map(n=>[n.id,n]));
 const anchors=new Map(points.map(p=>[p.id,{x:p.x,y:p.y}])),sizes=new Map(plan.nodes.map(n=>[n.id,lessonLabelSize(n)]));
 const {route,branches,associations}=lessonMapLayers(plan),links=[...route,...branches,...associations].map(e=>({...e,distance:Math.max(140,Math.hypot(byId.get(e.from)!.x!-byId.get(e.to)!.x!,byId.get(e.from)!.y!-byId.get(e.to)!.y!))}));
 const sim=createGraphSimulation(nodes,[],{chargeStrength:-90,gravity:{x:0,y:0,strength:0},velocityDecay:.55,alphaDecay:.09});
 sim.force("springs",forceLink<LayoutNode,{source:string|LayoutNode;target:string|LayoutNode;distance:number}>(links.map(e=>({source:e.from,target:e.to,distance:e.distance}))).id(n=>n.id).distance(e=>e.distance).strength(.1));
 sim.force("anchorX",forceX<LayoutNode>(n=>anchors.get(n.id)!.x).strength(.045));sim.force("anchorY",forceY<LayoutNode>(n=>anchors.get(n.id)!.y).strength(.045));
 sim.force("labels",forceCollide<LayoutNode>(n=>sizes.get(n.id)!.width*.5).strength(.6));
 let active=false,drag:string|null=null,snapshot:Point[]|null=null;
 const positions=()=>nodes.map(n=>({id:n.id,x:n.x!,y:n.y!}));
 return {get active(){return active;},positions,
  move:(id,target)=>{
   const node=byId.get(id);if(!node)return;
   if(drag!==id){snapshot=positions();drag=id;}
   const previous=anchors.get(id)!,dx=target.x-previous.x,dy=target.y-previous.y,head=lessonRoot(plan,id)===id;
   for(const n of nodes){
    const family=head&&lessonRoot(plan,n.id)===id,near=Math.hypot(n.x!-target.x,n.y!-target.y)<650;
    if(n.id===id){n.x=n.fx=target.x;n.y=n.fy=target.y;anchors.set(id,{...target});}
    else if(family||near){n.fx=null;n.fy=null;if(family){const a=anchors.get(n.id)!;anchors.set(n.id,{x:a.x+dx,y:a.y+dy});}}
    else{n.fx=n.x;n.fy=n.y;}
   }
   active=true;sim.alpha(Math.max(sim.alpha(),.45)).alphaTarget(.15);
  },
  release:()=>{if(drag){const n=byId.get(drag)!;n.fx=null;n.fy=null;}drag=null;snapshot=null;sim.alphaTarget(0);},
  cancel:()=>{if(snapshot)for(const p of snapshot){const n=byId.get(p.id)!;n.x=n.fx=p.x;n.y=n.fy=p.y;n.vx=n.vy=0;anchors.set(p.id,{x:p.x,y:p.y});}drag=null;snapshot=null;active=false;sim.alpha(0).alphaTarget(0);},
  step:()=>{if(!active)return false;sim.tick(2);if(!drag&&sim.alpha()<.008){active=false;for(const n of nodes){n.fx=n.x;n.fy=n.y;anchors.set(n.id,{x:n.x!,y:n.y!});}}return active;}
 };
}
