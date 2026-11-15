import test from "node:test";
import assert from "node:assert/strict";
import {layoutLessonMap,lessonMapTitle,LESSON_LABEL_WIDTH,LESSON_LABEL_HEIGHT,lessonLabelSize,lessonParent,createLessonMotion,lessonVisibleTopicIds} from "../src/core/lesson-map-layout.ts";
const titles=['Payoff: source expression and interpretation','Tower property and intermediate computation','Conditional expected payoff and state dependence','Monte Carlo estimation from a prescribed state','Variance reduction'];
test('lesson layout reserves label space instead of clustering long topic labels',()=>{
 const nodes=titles.map((title,i)=>({id:`topic_${i}`,title,conceptId:null,tangent:false})),connections=nodes.slice(1).map(n=>({from:'topic_0',to:n.id})),plan={nodes,connections},before=JSON.stringify(plan),placed=layoutLessonMap(plan);
 for(let i=0;i<placed.length;i++)for(let j=i+1;j<placed.length;j++){const a=placed[i]!,b=placed[j]!;assert(Math.abs(a.x-b.x)>=LESSON_LABEL_WIDTH||Math.abs(a.y-b.y)>=LESSON_LABEL_HEIGHT,'Label rectangles overlap');}
 assert.deepEqual(layoutLessonMap(plan),placed);assert.equal(JSON.stringify(plan),before);
 assert.equal(lessonMapTitle('Monte Carlo estimation from a prescribed state'),'Monte Carlo estimation from a prescribed state');assert.equal(lessonMapTitle('Brownian motion'),'Brownian motion');assert.equal(lessonMapTitle('A mathematical title with $\\mathbb{E}[X_t]$'), 'A mathematical title with $\\mathbb{E}[X_t]$');
});

test('a dense lesson gets two-dimensional spacing without changing its connections',()=>{
 const nodes=Array.from({length:9},(_,i)=>({id:`topic_${i}`,title:`Topic ${i}`,section:`Stage ${Math.floor(i/3)}`,conceptId:null,tangent:false}));
 const pairs=[[0,1],[1,2],[2,3],[3,4],[2,4],[4,5],[5,6],[6,7],[7,8],[2,5],[2,6],[4,6],[7,4],[7,5],[6,8],[2,8],[3,8]];
 const plan={nodes,connections:pairs.map(([a,b])=>({from:`topic_${a}`,to:`topic_${b}`}))},before=JSON.stringify(plan),placed=layoutLessonMap(plan);
 const width=Math.max(...placed.map(p=>p.x))-Math.min(...placed.map(p=>p.x)),height=Math.max(...placed.map(p=>p.y))-Math.min(...placed.map(p=>p.y));
 assert(width/height>.5&&width/height<3,'Dense map collapsed into a strip');assert(Math.abs(placed[0]!.x-placed[1]!.x)>10,'Stage nodes remained pinned to a column');
 for(let i=0;i<placed.length;i++)for(let j=i+1;j<placed.length;j++)assert(Math.abs(placed[i]!.x-placed[j]!.x)>=LESSON_LABEL_WIDTH||Math.abs(placed[i]!.y-placed[j]!.y)>=LESSON_LABEL_HEIGHT);
 assert.equal(JSON.stringify(plan),before);
});

const familyPlan=()=>{
 const counts=[0,2,2,2,3,4,6,2,3],nodes:import('../src/core/learning-session.ts').LessonTopic[]=counts.map((_,i)=>({id:`head_${i}`,title:`Covariance topic ${i}`,section:`Stage ${Math.floor(i/3)}`,kind:'topic',conceptId:null,tangent:false})),connections:{from:string;to:string}[]=[];
 for(const [i,count] of counts.entries())for(let j=0;j<count;j++){
  const id=`detail_${i}_${j}`;nodes.push({id,title:j%2?'A complete mathematical label without a missing ending':'Directional variance',kind:'detail',parentId:`head_${i}`,formula:'u^\\top\\Sigma u=\\operatorname{Var}(u^\\top x)',tangent:true,conceptId:null});connections.push({from:`head_${i}`,to:id});
 }
 return {nodes,connections};
};
test('the expanded 33-node map follows logical stages without a clock or distant two-column tail',()=>{
 const plan=familyPlan(),before=JSON.stringify(plan),placed=layoutLessonMap(plan),byId=new Map(placed.map(p=>[p.id,p]));assert.equal(placed.length,33);
 for(const node of plan.nodes){const parent=lessonParent(plan,node);if(parent){const p=byId.get(parent)!,n=byId.get(node.id)!;assert(Math.hypot(p.x-n.x,p.y-n.y)<850,`Branch ${node.id} escaped its family`);}}
 const width=Math.max(...placed.map(p=>p.x))-Math.min(...placed.map(p=>p.x)),height=Math.max(...placed.map(p=>p.y))-Math.min(...placed.map(p=>p.y));assert(width/height>.6&&width/height<2.5);assert(byId.get('head_0')!.x<byId.get('head_3')!.x&&byId.get('head_3')!.x<byId.get('head_6')!.x);
 for(let i=0;i<placed.length;i++)for(let j=i+1;j<placed.length;j++){const a=placed[i]!,b=placed[j]!,sa=lessonLabelSize(plan.nodes.find(n=>n.id===a.id)!),sb=lessonLabelSize(plan.nodes.find(n=>n.id===b.id)!);assert(Math.abs(a.x-b.x)>=(sa.width+sb.width)/2||Math.abs(a.y-b.y)>=Math.max(sa.height,sb.height));}
 assert.equal(JSON.stringify(plan),before);assert.deepEqual(layoutLessonMap(plan),placed);
});
test('live springs move a branch during dragging, settle after release and leave distant families pinned',()=>{
 const plan=familyPlan(),positions=layoutLessonMap(plan),id='head_6',old=positions.find(p=>p.id===id)!,target={x:old.x+100,y:old.y+60},before=JSON.stringify(positions),motion=createLessonMotion(plan,positions);
 motion.move(id,target);assert(motion.active);for(let i=0;i<12;i++)motion.step();
 const during=motion.positions();assert.deepEqual(during.find(p=>p.id===id),{id,...target});assert.equal(JSON.stringify(positions),before);
 const child=positions.find(p=>p.id==='detail_6_0')!,after=during.find(p=>p.id===child.id)!;assert(Math.hypot(after.x-child.x,after.y-child.y)>10,'Branch remained rigid until release');
 for(const p of positions)if(Math.hypot(p.x-target.x,p.y-target.y)>850&&!p.id.startsWith('detail_6'))assert.deepEqual(during.find(n=>n.id===p.id),p);
 motion.release();for(let i=0;i<150&&motion.active;i++)motion.step();assert(!motion.active);
 const settled=motion.positions();motion.move(id,{x:target.x+80,y:target.y});motion.step();motion.cancel();assert.deepEqual(motion.positions(),settled);assert(!motion.active);
});
test('nearby context uses actual links and includes parents without changing lesson state',()=>{
 const plan=familyPlan(),before=JSON.stringify(plan),visible=lessonVisibleTopicIds(plan,'head_6',false,'detail_6_0');assert(visible.has('head_6')&&visible.has('detail_6_0')&&visible.has('detail_6_5'));assert(!visible.has('detail_8_0'));assert(lessonVisibleTopicIds(plan,null,true).size===33);assert.equal(JSON.stringify(plan),before);
});
