import {z} from "zod";

export const mapRegion=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),w:z.number().positive().max(1),h:z.number().positive().max(1)})
	.strict().refine(r=>r.x+r.w<=1.001&&r.y+r.h<=1.001,"Region exceeds image");
export const mapImageLayout=z.object({kind:z.enum(["overview","detail","manual"]),region:mapRegion,
	width:z.number().int().positive().max(8192),height:z.number().int().positive().max(8192)}).strict();
export type MapImageLayout=z.infer<typeof mapImageLayout>;
export interface MapImageSet {pages:Uint8Array[];layout:MapImageLayout[]}
export const wholeMapRegion={x:0,y:0,w:1,h:1};

/** Cover the canvas in row order with 20% overlap, independent of paper pages. */
export function mapDetailRegions(width:number,height:number) {
	const cols=width>height*1.5?3:2,rows=height>width*1.5?3:2;
	const w=1/(cols-(cols-1)*0.2),h=1/(rows-(rows-1)*0.2);
	return Array.from({length:cols*rows},(_,i)=>({x:(i%cols)*w*0.8,y:Math.floor(i/cols)*h*0.8,w,h}));
}
export function mapImageLabel(layout:MapImageLayout|undefined,index:number) {
	return layout?.kind==="overview"?"Whole map":layout?.kind==="detail"?`Detail ${index}`:layout?.kind==="manual"?"Source image":`Page ${index+1}`;
}
