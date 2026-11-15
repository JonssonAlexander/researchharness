import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {lessonMapLabel} from '../components/lesson-map-label.ts';
test('complete mathematical titles and saved formulas render visibly without ellipses or imported HTML',()=>{
 const before=globalThis.document;globalThis.document=parseHTML('<html><body></body></html>').document;
 try{
  const title='Whole-pattern strength within a time step',label=lessonMapLabel({id:'block',title,kind:'detail',parentId:'parent',formula:'\\operatorname{Cov}(z_t,z_s)=B_{ts}A',tangent:true,conceptId:null});
  assert.equal(label.firstElementChild!.textContent,title);assert(!label.textContent.includes('…'));assert(label.querySelector('[data-equation] .katex'));assert(label.textContent.includes('Cov'));
  const mathTitle=lessonMapLabel({id:'a',title:'Covariance $B\\otimes A$',tangent:false,conceptId:null},3);assert(mathTitle.querySelector('.katex'));assert(mathTitle.textContent.includes('3 supporting ideas'));
  const escaped=lessonMapLabel({id:'x',title:'<script>not HTML</script>',tangent:false,conceptId:null});assert(!escaped.querySelector('script'));assert(escaped.textContent.includes('<script>'));
 }finally{globalThis.document=before;}
});

test('main questions, mathematical names, formulas and current location are visible together',()=>{
 const before=globalThis.document;globalThis.document=parseHTML('<html><body></body></html>').document;
 try{const label=lessonMapLabel({id:'risk',kind:'topic',title:'Estimation risk',question:'How accurate is our estimate?',formula:'\\mathbb E[L]',tangent:false,conceptId:null},3,true);assert(label.textContent.includes('How accurate is our estimate?'));assert(label.textContent.includes('Estimation risk'));assert(label.textContent.includes('You are here'));assert(label.querySelector('.katex'));}finally{globalThis.document=before;}
});
