import type {MapDraft} from "../../src/core/map-draft.ts";

export const draftEvidence={page:0,quote:"Brownian motion",region:{x:.1,y:.1,w:.2,h:.2}};
const support={origin:"source" as const,evidence:[draftEvidence],rationale:"",assumptions:"",uncertainty:""};
export const draftFixture:MapDraft={overview:"A draft connecting Brownian motion and quadratic variation.",concepts:[
	{key:"draft_a",title:"Brownian motion",existingId:null,sourceKeys:["draft_a"],...support,notes:[{...support,text:"The drawing names Brownian motion."},
		{...support,origin:"explanation",evidence:[],text:"A mathematical background explanation.",rationale:"Background supplied by the model.",assumptions:"Standard Brownian motion."}]},
	{key:"draft_b",title:"Quadratic variation",existingId:null,sourceKeys:["draft_b"],...support,origin:"reconstruction",rationale:"Proposed reading from the neighbouring formula.",uncertainty:"Confirm the notation.",notes:[
		{...support,origin:"reconstruction",text:"Proposed reading: $[B]_t=t$.",rationale:"The formula fits Brownian quadratic variation.",assumptions:"Standard Brownian motion; specify partition and convergence mode.",uncertainty:"Convergence mode is not legible."}]},
],connections:[{key:"edge_qv",source:"draft_a",target:"draft_b",direction:"forward",relationType:null,label:"Quadratic variation",...support,origin:"reconstruction",rationale:"Proposed connection between the visible labels.",uncertainty:"Confirm the arrow endpoint."}],questions:["Check the convergence mode."]};
