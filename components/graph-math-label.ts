import katex from "katex";
import {readContentSpans} from "@/src/core";
/** Text nodes for prose, trusted KaTeX output for TeX; no imported HTML. */
export function graphMathLabel(text:string):HTMLElement|undefined {
	if(!/[\\$]/.test(text))return;
	const spans=readContentSpans(text);if(!spans.some(s=>s.kind==="math"))return;
	const el=document.createElement("span");el.setAttribute("aria-hidden","true");
	for(const span of spans){if(span.kind!=="math")el.append(document.createTextNode(span.raw));else {
		const math=document.createElement("span");
		math.innerHTML=katex.renderToString(span.body,{displayMode:false,throwOnError:false,trust:false,strict:"ignore",maxExpand:1000,output:"htmlAndMathml"});el.append(math);
	}}
	return el;
}
