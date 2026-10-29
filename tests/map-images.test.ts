import assert from 'node:assert/strict';
import test from 'node:test';
import {Resvg} from '@resvg/resvg-js';
import {mapDetailRegions,mapImageLabel} from '../src/core/map-images.ts';
import {renderMapImages} from '../src/server/map-images.ts';
import {validateMindmapPng} from '../src/server/rnote.ts';

 test('detail regions cover the entire canvas and overlap by 20 percent in either orientation',()=>{
 for(const [width,height] of [[200,100],[100,200],[100,100]]) {
  const regions=mapDetailRegions(width!,height!);assert(regions.length<=6);
  for(let y=0;y<=100;y++)for(let x=0;x<=100;x++)assert(regions.some(r=>x/100>=r.x-1e-9&&x/100<=r.x+r.w+1e-9&&y/100>=r.y-1e-9&&y/100<=r.y+r.h+1e-9));
  const a=regions[0]!,b=regions[1]!;assert(Math.abs(a.x+a.w-b.x-a.w*0.2)<1e-9);
 }
});

test('overview and overlapping detail pixels preserve a boundary-crossing mark in the same canvas coordinates',async()=>{
 const svg='<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="blue"/><rect x="98" y="48" width="4" height="4" fill="red"/></svg>';
 const result=await renderMapImages(svg,new AbortController().signal);assert.equal(result.pages.length,7);assert.equal(result.layout[0]?.kind,'overview');
 assert.equal(mapImageLabel(result.layout[0],0),'Whole map');let witnessed=0;
 for(const [i,l] of result.layout.entries()) {
  validateMindmapPng(result.pages[i]!);assert(Math.max(l.width,l.height)<=3072);
  if(.5<l.region.x||.5>l.region.x+l.region.w||.5<l.region.y||.5>l.region.y+l.region.h)continue;
  const x=(.5-l.region.x)/l.region.w*l.width,y=(.5-l.region.y)/l.region.h*l.height;
  const data=Buffer.from(result.pages[i]!).toString('base64');
  const pixel=new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="${x} ${y} 1 1"><image width="${l.width}" height="${l.height}" href="data:image/png;base64,${data}"/></svg>`,{font:{loadSystemFonts:false}}).render().pixels;
  assert(pixel[0]!>200&&pixel[2]!<20);witnessed++;
 }
 assert.equal(witnessed,3); // overview plus the two overlapping detail rows
});

test('rendering refuses external assets, document entities, extreme dimensions and cancellation',async()=>{
 for(const svg of ['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="file:///private/source.png"/></svg>','<!DOCTYPE svg><svg/>','<svg xmlns="http://www.w3.org/2000/svg" width="1000001" height="10"/>'])await assert.rejects(()=>renderMapImages(svg));
 const controller=new AbortController();controller.abort();await assert.rejects(()=>renderMapImages('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>',controller.signal));
});
