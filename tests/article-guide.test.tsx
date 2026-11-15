import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ArticleGuide} from '../components/article-guide';
import type {ReadingWorkspace} from '../src/core';
test('reading explanation is a separate structured pane with short route navigation and optional discussion',()=>{
 const kinds=['result','setup','mechanism','consequence'] as const,items=kinds.map((kind,i)=>({id:`rg_${String(i).repeat(64)}`,page:i+1,title:kind,quote:'Verified source words.',establishes:'Previous annotation.',importance:'Previous note.',location:'page-only' as const,rects:[],createdAt:new Date().toISOString(),padIds:[],attemptIds:[]}));
 const guide:ReadingWorkspace['guide']={lens:'conceptual-overview',objective:'Full lesson objective kept out of the reading pane.',enabled:true,items,route:{problem:'What can limited samples tell us?',answer:'Use structure.',intuition:'Share information.',stops:items.map((h,i)=>({highlightId:h.id,title:h.title,kind:kinds[i]!,statement:'The central result.',intuition:'Why the result makes sense.',detail:'Technical assumptions.'}))}};
 const noop=()=>{},html=renderToStaticMarkup(<ArticleGuide guide={guide} activeId={items[0]!.id} busy={false} question="" onQuestion={noop} onSelect={noop} onBuild={noop} onAsk={noop} onQuick={noop} exchanges={[]} pads={[]} onReopen={noop} onMessage={noop} onVisibility={noop}/>);
 assert.match(html,/Guided reading/);assert.match(html,/Reading route navigation/);assert.match(html,/Next/);assert.match(html,/The central result/);assert.match(html,/Why the result makes sense/);assert.match(html,/Technical assumptions/);assert(!html.includes('role="dialog"'));assert(!html.includes('<textarea'));assert(!html.includes(guide.objective));assert(!html.includes('Previous annotation.'));
});
