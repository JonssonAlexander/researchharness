import test from "node:test";
import assert from "node:assert/strict";
import {layoutLessonMap,lessonMapTitle,LESSON_LABEL_WIDTH,LESSON_LABEL_HEIGHT} from "../src/core/lesson-map-layout.ts";
const titles=['Payoff: source expression and interpretation','Tower property and intermediate computation','Conditional expected payoff and state dependence','Monte Carlo estimation from a prescribed state','Variance reduction'];
test('lesson layout reserves label space instead of clustering long topic labels',()=>{
 const nodes=titles.map((title,i)=>({id:`topic_${i}`,title,conceptId:null,tangent:false})),connections=nodes.slice(1).map(n=>({from:'topic_0',to:n.id})),plan={nodes,connections},before=JSON.stringify(plan),placed=layoutLessonMap(plan);
 for(let i=0;i<placed.length;i++)for(let j=i+1;j<placed.length;j++){const a=placed[i]!,b=placed[j]!;assert(Math.abs(a.x-b.x)>=LESSON_LABEL_WIDTH||Math.abs(a.y-b.y)>=LESSON_LABEL_HEIGHT,'Label rectangles overlap');}
 assert.deepEqual(layoutLessonMap(plan),placed);assert.equal(JSON.stringify(plan),before);
 assert.equal(lessonMapTitle('Monte Carlo estimation from a prescribed state'),'Monte Carlo estimation from a…');assert.equal(lessonMapTitle('Brownian motion'),'Brownian motion');assert.equal(lessonMapTitle('A mathematical title with $\\mathbb{E}[X_t]$'), 'A mathematical title with $\\mathbb{E}[X_t]$');
});
