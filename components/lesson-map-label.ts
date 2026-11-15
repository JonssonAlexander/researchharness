import {lessonTopicKind,type LessonTopic} from "@/src/core";
import {graphMathLabel} from "./graph-math-label";
/** Complete visible title + one saved equation; prose and formulas stay separate. */
export function lessonMapLabel(node:LessonTopic,children=0,current=false):HTMLElement{
 const label=document.createElement('div');label.dataset.lessonNode=node.id;label.style.fontSize='14px';
 if(current){const here=document.createElement('div');here.textContent='You are here';here.style.color='#9dd8ff';here.style.fontSize='.76em';label.append(here);}
 const heading=node.question||node.title,title=document.createElement('div');title.style.fontWeight=lessonTopicKind(node)==='topic'?'600':'400';title.append(graphMathLabel(heading)??document.createTextNode(heading));label.append(title);
 if(node.question&&node.question!==node.title){const name=document.createElement('div');name.textContent=node.title;name.style.fontSize='.82em';name.style.opacity='.75';name.style.marginTop='4px';label.append(name);}
 if(node.formula){
  const row=document.createElement('div'),math=document.createElement('span');row.dataset.equation='true';row.style.marginTop='5px';row.style.fontSize='.92em';math.style.display='inline-block';math.style.transformOrigin='top center';
  const value=node.formula.trim(),text=/^(\\\(|\\\[|\$)/.test(value)?value:`\\(${value}\\)`;math.append(graphMathLabel(text)??document.createTextNode(value));row.append(math);label.append(row);
 }
 if(children){const hint=document.createElement('div');hint.textContent=`${children} supporting ${children===1?'idea':'ideas'}`;hint.style.fontSize='.76em';hint.style.opacity='.65';hint.style.marginTop='3px';label.append(hint);}
 return label;
}
/** Fit the full equation, never cut it or guess new line breaks in mathematics. */
export function fitLessonFormula(label:HTMLElement,width:number){
 const row=label.querySelector<HTMLElement>('[data-equation]'),math=row?.firstElementChild as HTMLElement|undefined;if(!row||!math)return;
 const box=math.getBoundingClientRect(),scale=Math.min(1,(width-8)/Math.max(1,box.width));
 if(scale<1){math.style.transform=`scale(${scale})`;row.style.height=`${box.height*scale}px`;}
}
