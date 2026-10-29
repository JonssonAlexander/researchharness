import {Resvg,renderAsync} from "@resvg/resvg-js";
import {AtlasError} from "../core/atlas.ts";
import {mapDetailRegions,wholeMapRegion,type MapImageSet} from "../core/map-images.ts";

/** Rasterize only native-exported SVG, never serve it or resolve external assets. */
export async function renderMapImages(svg:string,signal?:AbortSignal):Promise<MapImageSet> {
	if(Buffer.byteLength(svg)>32*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(svg))throw new AtlasError("Whole-map export exceeds supported limits.",422);
	svg=svg.replace(/^\s*<\?xml[\s\S]*?\?>/i,"");
	for(const ref of svg.matchAll(/(?:href|src)\s*=\s*["']([^"']*)["']/gi))
		if(!/^(?:#|data:image\/(?:png|jpeg);base64,)/i.test(ref[1]!))throw new AtlasError("Map export contains an external image reference.",422);
	for(const ref of svg.matchAll(/url\(([^)]*)\)/gi))
		if(!/^#[\w.-]+$/.test(ref[1]!.trim().replace(/^["']|["']$/g,"")))throw new AtlasError("Map export contains an external style reference.",422);
	// Rnote exports text as glyph outlines; do not rescan system fonts per view.
	const options={font:{loadSystemFonts:false},logLevel:"off" as const},source=new Resvg(svg,options),{width,height}=source;
	if(!Number.isFinite(width+height)||width<1||height<1||Math.max(width,height)>1000000||Math.max(width/height,height/width)>32)
		throw new AtlasError("Map dimensions exceed supported limits. Export a smaller source.",422);
	const result:MapImageSet={pages:[],layout:[]};let total=0;
	for(const [i,region] of [wholeMapRegion,...mapDetailRegions(width,height)].entries()) {
		signal?.throwIfAborted();
		const w=region.w*width,h=region.h*height,size=i?3072:2048;
		const view=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${region.x*width} ${region.y*height} ${w} ${h}">${svg}</svg>`;
		// The native binding stores per-task cancellation state on its signal.
		const rendered=await renderAsync(view,{...options,fitTo:{mode:w>=h?"width":"height",value:size}},signal?AbortSignal.any([signal]):undefined),bytes=rendered.asPng();
		if(bytes.length>10*1024*1024||(total+=bytes.length)>20*1024*1024)throw new AtlasError("Map images exceed the 20 MB interpretation limit.",422);
		result.pages.push(bytes);result.layout.push({kind:i?"detail":"overview",region,width:rendered.width,height:rendered.height});
	}
	return result;
}
