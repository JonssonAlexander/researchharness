import {incrementalLayout} from "./layout.ts";
import type {LearningPlan} from "./learning-session.ts";
export const LESSON_LABEL_WIDTH=100;
export const LESSON_LABEL_HEIGHT=64;
/** Short display handles only; saved topic names and math remain untouched. */
export function lessonMapTitle(title:string):string {
 if(title.length<=32||/[\\$]/.test(title))return title;
 const prefix=title.slice(0,32),space=prefix.lastIndexOf(" ");return `${prefix.slice(0,space>12?space:32)}…`;
}
/** Reuse upstream layout, then reserve a rectangle for each dot and its label. */
export function layoutLessonMap(plan:Pick<LearningPlan,"nodes"|"connections">){
 const positions=incrementalLayout(plan.nodes,plan.connections,new Map(),{ticks:100}),nodes=plan.nodes.map(n=>({id:n.id,...positions.get(n.id)!}));
 for(let pass=0;pass<150;pass++){
  let overlap=false;
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
   const a=nodes[i]!,b=nodes[j]!,dx=b.x-a.x,dy=b.y-a.y,ox=LESSON_LABEL_WIDTH+16-Math.abs(dx),oy=LESSON_LABEL_HEIGHT+16-Math.abs(dy);
   if(ox<=0||oy<=0)continue;overlap=true;
   if(ox<oy){const shift=(ox/2+.1)*(dx>=0?1:-1);a.x-=shift;b.x+=shift;}else{const shift=(oy/2+.1)*(dy>=0?1:-1);a.y-=shift;b.y+=shift;}
  }
  if(!overlap)break;
 }
 return nodes;
}
