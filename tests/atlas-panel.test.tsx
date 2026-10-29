import React, { act } from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { renderToStaticMarkup } from "react-dom/server";
import { AtlasQuery } from "../components/atlas-query.tsx";
import { AtlasRelations } from "../components/atlas-relations.tsx";
import { AtlasPanel, useAtlas } from "../components/atlas-panel.tsx";
import type { AtlasCommand, AtlasSnapshot } from "../src/core/atlas.ts";
import { ServerEventsProvider } from "../components/server-events.tsx";

const id = "ac_00000000-0000-4000-8000-000000000001";
const a = "as_00000000-0000-4000-8000-000000000001",
	b = "as_00000000-0000-4000-8000-000000000002";
const snapshot: AtlasSnapshot = {
	relations: [],
	subjects: [a, b].map((id, i) => ({
		id,
		title: i ? "Analysis" : "Probability",
		parentId: null,
		color: "#65a3dc",
		revision: 1,
		x: i * 360,
		y: 0,
	})),
	concepts: [
		{
			id,
			title: "Brownian motion",
			aliases: ["Wiener process"],
			subjectIds: [a, b],
			preferredSubjectId: a,
			propositionIds: ["n_missing"],
			revision: 1,
			x: 0,
			y: 0,
		},
	],
};
async function mount(render: () => React.ReactNode) {
	const dom = parseHTML("<html><body><div id='root'></div></body></html>");
	const previous = new Map<string, PropertyDescriptor | undefined>();
	for (const [key, value] of Object.entries({
		React,
		window: dom.window,
		document: dom.document,
		IS_REACT_ACT_ENVIRONMENT: true,
	})) {
		previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
	const { createRoot } = await import("react-dom/client");
	const root = createRoot(dom.document.getElementById("root")!);
	await act(async () => {
		root.render(render());
	});
	return {
		document: dom.document,
		async close() {
			await act(async () => {
				root.unmount();
			});
			for (const [key, value] of previous) {
				if (value) Object.defineProperty(globalThis, key, value);
				else delete (globalThis as Record<string, unknown>)[key];
			}
		},
	};
}

test("concept inspection shows both memberships, one list entry, and an honest missing-proposition state", () => {
	Object.assign(globalThis, { React });
	const html = renderToStaticMarkup(
		<AtlasPanel
			atlas={{ snapshot, error: null, refresh: async () => {}, save: async () => {} }}
			selectedId={id}
			onSelect={() => {}}
			onClose={() => {}}
			propositions={[]}
		/>,
	);
	const { document } = parseHTML(html);
	const text = document.querySelector("aside")!.textContent!;
	assert(text.includes("Probability · home"));
	assert(text.includes("Analysis"));
	assert(text.includes("Unavailable proposition"));
	assert.equal(
		[...document.querySelectorAll("button")].filter((b) => b.textContent === "Brownian motion").length,
		1,
	);
});

test("a rejected save keeps the editable concept and reuses its identity on retry", async () => {
	const attempts: AtlasCommand[] = [];
	const ui = await mount(() => (
		<AtlasPanel
			atlas={{
				snapshot,
				error: null,
				refresh: async () => {},
				save: async (value) => {
					attempts.push(value);
					throw new Error("This item changed. Reload it before saving.");
				},
			}}
			selectedId={id}
			onSelect={() => {}}
			onClose={() => {}}
			propositions={[]}
		/>
	));
	try {
		const edit = [...ui.document.querySelectorAll("button")].find((b) => b.textContent === "Edit concept")!;
		await act(async () => {
			edit.dispatchEvent(new window.Event("click", { bubbles: true }));
		});
		for (let i = 0; i < 2; i++)
			await act(async () => {
				ui.document
					.querySelector("form")!
					.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
			});
		assert.equal(ui.document.querySelector("input[required]")!.getAttribute("value"), "Brownian motion");
		assert(ui.document.querySelector('[role="alert"]')?.textContent?.includes("Reload"));
		assert.deepEqual(
			attempts.map((a) => "id" in a ? a.id : null),
			[id, id],
		);
	} finally {
		await ui.close();
	}
});

test("out-of-order refetches cannot replace a newer Atlas snapshot", async () => {
	const originalFetch = globalThis.fetch;
	const requests: ((value: Response) => void)[] = [];
	globalThis.fetch = () =>
		new Promise<Response>((resolve) => {
			requests.push(resolve);
		});
	let atlas!: ReturnType<typeof useAtlas>;
	function Harness() {
		atlas = useAtlas();
		return null;
	}
	const connect = () => ({ close() {}, onOpen() {}, onEvent() {} });
	const ui = await mount(() => (
		<ServerEventsProvider connect={connect}>
			<Harness />
		</ServerEventsProvider>
	));
	try {
		const older = atlas.refresh();
		const newer = atlas.refresh();
		await act(async () => {
			requests[2]!(Response.json(snapshot));
			await newer;
		});
		await act(async () => {
			requests[1]!(Response.json({ concepts: [], subjects: [], relations: [] }));
			await older;
			requests[0]!(Response.json({ concepts: [], subjects: [], relations: [] }));
		});
		assert.equal(atlas.snapshot.concepts[0]!.id, id);
	} finally {
		await ui.close();
		globalThis.fetch = originalFetch;
	}
});

test("subject delete shows dependencies and only sends a confirmed empty-subject removal", async () => {
	const attempts: AtlasCommand[] = [];
	const ui = await mount(() => (
		<AtlasPanel
			atlas={{
				snapshot,
				error: null,
				refresh: async () => {},
				save: async (c) => {
					attempts.push(c);
				},
			}}
			selectedId={null}
			onSelect={() => {}}
			onClose={() => {}}
			propositions={[]}
		/>
	));
	const click = async (label: string) => {
		const el = [...ui.document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
		assert(el, label);
		await act(async () => {
			el.click();
		});
	};
	try {
		await click("● Probability");
		await click("Delete subject");
		assert(ui.document.body.textContent!.includes("Move concept first: Brownian motion"));
		const blocked = [...ui.document.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === "Confirm delete",
		)!;
		assert(blocked.hasAttribute("disabled"));
		assert.equal(attempts.length, 0);
		await click("Cancel");
		await click("New subject");
		await click("Cancel");
	} finally {
		await ui.close();
	}
	const empty = { ...snapshot, concepts: [] };
	const ui2 = await mount(() => (
		<AtlasPanel
			atlas={{
				snapshot: empty,
				error: null,
				refresh: async () => {},
				save: async (c) => {
					attempts.push(c);
				},
			}}
			selectedId={null}
			onSelect={() => {}}
			onClose={() => {}}
			propositions={[]}
		/>
	));
	try {
		const press = async (text: string) => {
			await act(async () => {
				[...ui2.document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!.click();
			});
		};
		await press("● Probability");
		await press("Delete subject");
		assert.equal(attempts.length, 0);
		await press("Confirm delete");
		assert.deepEqual(attempts, [{ kind: "subject-delete", id: a, expectedRevision: 1 }]);
	} finally {
		await ui2.close();
	}
});

test("concept notes render as Markdown with an edit field", async () => {
	Object.assign(globalThis, { React });
	const withNotes = {
		...snapshot,
		concepts: [{ ...snapshot.concepts[0]!, markdown: "**Independent note**" }],
	};
	const html = renderToStaticMarkup(
		<AtlasPanel
			atlas={{ snapshot: withNotes, error: null, refresh: async () => {}, save: async () => {} }}
			selectedId={id}
			onSelect={() => {}}
			onClose={() => {}}
			propositions={[]}
		/>,
	);
	const { document } = parseHTML(html);
	assert.equal(document.querySelector("strong")!.textContent, "Independent note");
	const saved: AtlasCommand[] = [];
	const ui = await mount(() => (
		<AtlasPanel
			atlas={{
				snapshot: withNotes,
				error: null,
				refresh: async () => {},
				save: async (c) => {
					saved.push(c);
				},
			}}
			selectedId={id}
			onSelect={() => {}}
			onClose={() => {}}
			propositions={[]}
		/>
	));
	try {
		await act(async () => {
			[...ui.document.querySelectorAll("button")].find((b) => b.textContent === "Edit concept")!.click();
		});
		assert(ui.document.querySelector("textarea"));
		await act(async () => {
			ui.document
				.querySelector("form")!
				.dispatchEvent(new ui.document.defaultView!.Event("submit", { bubbles: true, cancelable: true }));
		});
		assert.equal(saved[0]!.kind === "concept" && saved[0]!.markdown, "**Independent note**");
	} finally {
		await ui.close();
	}
});

test("new links are proposed hypotheses and a rejected save retains the draft identity", async () => {
	const other = {
		...snapshot.concepts[0]!,
		id: "ac_00000000-0000-4000-8000-000000000002",
		title: "Continuity",
	};
	const data = { ...snapshot, concepts: [...snapshot.concepts, other] };
	const attempts: AtlasCommand[] = [];
	const ui = await mount(() => (
		<AtlasRelations
			conceptId={id}
			snapshot={data}
			onSelect={() => {}}
			save={async (c) => {
				attempts.push(c);
				throw new Error("Stale link");
			}}
		/>
	));
	const click = async (label: string) => {
		await act(async () => {
			[...ui.document.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
		});
	};
	try {
		await click("New link");
		await click("Save link");
		assert(ui.document.body.textContent!.includes("Stale link"));
		assert(ui.document.querySelector("select"));
		await click("Save link");
		const first = attempts[0]!;
		assert.equal(first.kind, "relation");
		if (first.kind !== "relation") throw new Error("Expected relation");
		assert.equal(first.reviewStatus, "proposed");
		assert.equal(first.claimStatus, "hypothesis");
		assert.equal(first.sourceId, id);
		assert.equal(first.targetId, other.id);
		assert.deepEqual(first.evidence, []);
		assert.equal(("id" in attempts[1]! ? attempts[1]!.id : null), first.id);
	} finally {
		await ui.close();
	}
});

test("link inspection shows direction, conditions, citations and disputed claim status", () => {
	Object.assign(globalThis, { React });
	const other = {
		...snapshot.concepts[0]!,
		id: "ac_00000000-0000-4000-8000-000000000002",
		title: "Continuity",
	};
	const data: AtlasSnapshot = {
		...snapshot,
		concepts: [...snapshot.concepts, other],
		relations: [
			{
				id: "ar_00000000-0000-4000-8000-000000000001",
				revision: 1,
				sourceId: id,
				targetId: other.id,
				relationType: "application",
				conditions: "For bounded time intervals",
				claimStatus: "numerical-observation",
				reviewStatus: "disputed",
				evidence: [{ citation: "Experiment notebook", locator: "Run 3" }],
				createdAt: "2026-10-28T00:00:00Z",
				updatedAt: "2026-10-28T00:00:00Z",
				contentHash: "fixture",
			},
		],
	};
	const html = renderToStaticMarkup(
		<AtlasRelations conceptId={id} snapshot={data} save={async () => {}} onSelect={() => {}} />,
	);
	const { document } = parseHTML(html);
	const text = document.querySelector("section")!.textContent!;
	for (const value of [
		"Brownian motion",
		"→",
		"Continuity",
		"application",
		"disputed",
		"numerical observation",
		"For bounded time intervals",
		"Experiment notebook",
		"Run 3",
	])
		assert(text.includes(value), value);
	assert(!html.includes("<a "));
});

test("query shows sourced steps, focuses temporarily and drops stale results after retraction", async () => {
	const other = {
		...snapshot.concepts[0]!,
		id: "ac_00000000-0000-4000-8000-000000000002",
		title: "Continuity",
	};
	const data: AtlasSnapshot = {
		...snapshot,
		concepts: [...snapshot.concepts, other],
		relations: [
			{
				id: "ar_00000000-0000-4000-8000-000000000001",
				sourceId: id,
				targetId: other.id,
				relationType: "application",
				conditions: "Bounded time",
				claimStatus: "numerical-observation",
				reviewStatus: "accepted",
				evidence: [{ citation: "Notebook", locator: "Run 3" }],
				revision: 1,
				createdAt: "2026-10-28T00:00:00Z",
				updatedAt: "2026-10-28T00:00:00Z",
				contentHash: "fixture",
			},
		],
	};
	const focus: unknown[] = [];
	const onFocus = (value: unknown) => {
		focus.push(value);
	};
	let update: (s: AtlasSnapshot) => void = () => {};
	function Harness() {
		const [value, setValue] = React.useState(data);
		update = setValue;
		return <AtlasQuery snapshot={value} selectedId={id} onSelect={() => {}} onFocus={onFocus} />;
	}
	const ui = await mount(() => <Harness />);
	try {
		const target = ui.document.querySelectorAll("select")[1]!;
		await act(async () => {
			for (const option of target.querySelectorAll("option")) option.selected = option.value === other.id;
			target.dispatchEvent(new ui.document.defaultView!.Event("change", { bubbles: true }));
		});
		await act(async () => {
			ui.document
				.querySelector("form")!
				.dispatchEvent(new ui.document.defaultView!.Event("submit", { bubbles: true, cancelable: true }));
		});
		const text = ui.document.body.textContent!;
		for (const value of ["Bounded time", "numerical observation", "Notebook", "Run 3"])
			assert(text.includes(value), value);
		await act(async () => {
			[...ui.document.querySelectorAll("button")]
				.find((b) => b.textContent === "Show path in graph")!
				.click();
		});
		assert.deepEqual(focus.at(-1), { conceptIds: [id, other.id], relationIds: [data.relations[0]!.id] });
		await act(async () => {
			update({ ...data, relations: [{ ...data.relations[0]!, reviewStatus: "retracted" }] });
		});
		assert(ui.document.body.textContent!.includes("No supported path found"));
		assert.equal(focus.at(-1), null);
		assert(!ui.document.body.textContent!.includes("Run 3"));
	} finally {
		await ui.close();
	}
	assert.equal(focus.at(-1), null);
});

test("concept removal requires confirmation and sends only the displayed identity and revision", async () => {
	const saved: AtlasCommand[] = [];
	const selected: (string | null)[] = [];
	const ui = await mount(() => (
		<AtlasPanel
			atlas={{
				snapshot,
				error: null,
				refresh: async () => {},
				save: async (c) => {
					saved.push(c);
				},
			}}
			selectedId={id}
			onSelect={(v) => {
				selected.push(v);
			}}
			onClose={() => {}}
			propositions={[]}
		/>
	));
	const press = async (label: string) => {
		await act(async () => {
			[...ui.document.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
		});
	};
	try {
		await press("Edit concept");
		await press("Delete concept");
		assert.equal(saved.length, 0);
		assert(ui.document.body.textContent!.includes("Propositions stay"));
		await press("Confirm delete concept");
		assert.deepEqual(saved, [{ kind: "concept-delete", id, expectedRevision: 1 }]);
		assert.deepEqual(selected, [null]);
	} finally {
		await ui.close();
	}
});

test("link removal requires confirmation and preserves the draft after a rejected delete", async () => {
	const attempts: AtlasCommand[] = [];
	const relation = {
		id: "ar_00000000-0000-4000-8000-000000000001",
		sourceId: id,
		targetId: "ac_00000000-0000-4000-8000-000000000002",
		relationType: "analogy" as const,
		conditions: "",
		claimStatus: "hypothesis" as const,
		reviewStatus: "proposed" as const,
		evidence: [],
		revision: 2,
		createdAt: "2026-10-28T00:00:00Z",
		updatedAt: "2026-10-28T00:00:00Z",
		contentHash: "fixture",
	};
	const ui = await mount(() => (
		<AtlasRelations
			conceptId={id}
			snapshot={{ ...snapshot, relations: [relation] }}
			onSelect={() => {}}
			save={async (c) => {
				attempts.push(c);
				throw new Error("Stale delete");
			}}
		/>
	));
	const press = async (text: string) => {
		await act(async () => {
			[...ui.document.querySelectorAll("button")].find((b) => b.textContent === text)!.click();
		});
	};
	try {
		await press("Edit link");
		await press("Delete link");
		assert.equal(attempts.length, 0);
		await press("Confirm delete link");
		assert.deepEqual(attempts, [{ kind: "relation-delete", id: relation.id, expectedRevision: 2 }]);
		assert(ui.document.body.textContent!.includes("Stale delete"));
		assert(ui.document.querySelector("select"));
	} finally {
		await ui.close();
	}
});

test("subject controls arrange locally and send explicit revision-checked locks", async () => {
 const commands: AtlasCommand[] = [], arranged: (string|null)[] = [];
 const ui=await mount(()=> <AtlasPanel atlas={{snapshot,error:null,refresh:async()=>{},save:async c=>{commands.push(c);}}}
  selectedId={null} onSelect={()=>{}} onClose={()=>{}} propositions={[]} onRelax={id=>arranged.push(id)} />);
 try {
  const arrange=ui.document.querySelector('[aria-label="Arrange Probability"]')!;
  await act(async()=>{arrange.dispatchEvent(new window.Event('click',{bubbles:true}));});
  assert.deepEqual(arranged,[a]); assert.deepEqual(commands,[]);
  await act(async()=>{ui.document.querySelector('[aria-label="Lock Probability"]')!.dispatchEvent(new window.Event('click',{bubbles:true}));});
  assert.deepEqual(commands,[{kind:'subject-lock',id:a,expectedRevision:1,locked:true}]);
 } finally {await ui.close();}
});

test("saved views restore without writes and require confirmed removal", async () => {
 const {AtlasViews}=await import('../components/atlas-views.tsx');
 const commands:AtlasCommand[]=[],restored:string[]=[];
 const view={id:'av_00000000-0000-4000-8000-000000000001',title:'Probability',query:'Brownian',camera:{x:5,y:6,k:2},revision:1};
 const ui=await mount(()=> <AtlasViews views={[view]} save={async c=>{commands.push(c);}}
  actions={{canSave:true,capture:()=>({camera:view.camera,query:view.query}),restore:v=>restored.push(v.id)}} />);
 async function click(text:string) {await act(async()=>{
  const b=[...ui.document.querySelectorAll('button')].find(b=>b.textContent===text)!;
  b.dispatchEvent(new window.Event('click',{bubbles:true}));
 });}
 try {
  await click('Probability');assert.deepEqual(restored,[view.id]);assert.deepEqual(commands,[]);
  await click('Remove');assert.equal(commands.length,0);
  await click('Confirm removal');assert.deepEqual(commands,[{kind:'view-delete',id:view.id,expectedRevision:1}]);
 } finally {await ui.close();}
});

test("mind map inspection shows revision-bound sources and preserves history when archiving is rejected", async () => {
 const {AtlasMindmaps}=await import('../components/atlas-mindmaps.tsx');
 const mapId='mm_00000000-0000-4000-8000-000000000001',revisionId='mr_00000000-0000-4000-8000-000000000001';
 const map={id:mapId,title:'Brownian notes',revision:1,archived:false,currentRevision:revisionId,captures:[{
  schemaVersion:1 as const,id:revisionId,mapId,hash:'a'.repeat(64),previewHash:'b'.repeat(64),filename:'brownian.rnote',capturedAt:'2026-10-28T12:00:00Z',
  conceptIds:[id],validation:'unverified' as const,previewKind:'manual-png' as const,notice:'Owner-supplied export',
 }]};
 const attempts:unknown[]=[],oldFetch=globalThis.fetch;
 globalThis.fetch=async(_url,options)=>{attempts.push(JSON.parse(String(options?.body)));return Response.json({error:'Reload before archiving'},{status:409});};
 const ui=await mount(()=> <AtlasMindmaps snapshot={{...snapshot,mindmaps:[map]}} selectedId={id} refresh={async()=>{}} />);
 try {
  assert(ui.document.querySelector('img')?.getAttribute('src')?.includes(revisionId));
  assert(ui.document.querySelector('a[href*="kind=original"]'));
  assert(ui.document.body.textContent.includes('Interpret / review'));
  const click=async(text:string)=>{await act(async()=>{
   [...ui.document.querySelectorAll('button')].find(b=>b.textContent===text)!.dispatchEvent(new window.Event('click',{bubbles:true}));
  });};
  await click('Archive map');assert.equal(attempts.length,0);await click('Confirm archive');
  assert.deepEqual(attempts,[{id:mapId,expectedRevision:1,archived:true}]);
  assert(ui.document.querySelector('[role="alert"]')?.textContent?.includes('Reload'));
  assert(ui.document.querySelector('a[href*="kind=original"]'));
 } finally {await ui.close();globalThis.fetch=oldFetch;}
});

test('proposal review keeps drawing beside evidence, exposes uncertainty and offers no graph-write action', async()=>{
 const {ProposalReviewBody}=await import('../components/map-proposal-review.tsx');
 const source='mr_00000000-0000-4000-8000-000000000001';
 const capture={schemaVersion:1 as const,id:source,mapId:'mm_00000000-0000-4000-8000-000000000001',hash:'a'.repeat(64),previewHash:'b'.repeat(64),filename:'a.rnote',capturedAt:'2026-10-29T12:00:00Z',conceptIds:[],validation:'rnote-cli' as const,previewKind:'rnote-thumbnail' as const,notice:null};
 const evidence={page:0,quote:'Brownian motion',region:{x:0.1,y:0.1,w:0.3,h:0.2}};
 const proposal={schemaVersion:1 as const,id:'mp_00000000-0000-4000-8000-000000000001',sourceRevision:source,sourceHash:capture.hash,baseRevision:1,context:[],model:'fake:vision',status:'prepared' as const,images:['c'.repeat(64)],digest:'d'.repeat(64),createdAt:'2026-10-29T12:00:00Z',updatedAt:'2026-10-29T12:00:00Z',error:null,estimatedCost:null,
  findings:{transcription:'Brownian motion',concepts:[{key:'draft_a',title:'Brownian motion',aliases:[],existingId:null,notes:'Visible label',evidence,uncertainty:'Domain assumption unclear'}],relations:[],questions:['Which filtration?']}};
 const chosen:unknown[]=[];
 const ui=await mount(()=> <ProposalReviewBody proposal={proposal} capture={capture} snapshot={{...snapshot,layoutRevision:1}} model='fake:vision' loaded busy={false} error={null}
  page={0} evidence={evidence} onPage={()=>{}} onEvidence={e=>chosen.push(e)} onGenerate={()=>{throw Error('must not dispatch on read');}} onCancel={()=>{}} />);
 try {
  assert(ui.document.querySelector('[aria-label="Saved source drawing"] img'));
  assert(ui.document.body.textContent.includes('Domain assumption unclear'));
  assert(ui.document.body.textContent.includes('Which filtration?'));
  assert(ui.document.body.textContent.includes('Review only'));
  assert(![...ui.document.querySelectorAll('button')].some(b=>/Accept|Approve|Apply|Interpret revision/.test(b.textContent??'')));
  await act(async()=>{[...ui.document.querySelectorAll('button')].find(b=>b.textContent?.includes('Page 1'))!.dispatchEvent(new window.Event('click',{bubbles:true}));});
  assert.deepEqual(chosen,[evidence]);
 }finally{await ui.close();}
 const failed=await mount(()=> <ProposalReviewBody proposal={{...proposal,status:'failed',images:[],findings:null,error:'Export timed out',model:'chatgpt:test'}} capture={capture} snapshot={snapshot} model='chatgpt:test' loaded busy={false} error={null}
  page={0} evidence={null} onPage={()=>{}} onEvidence={()=>{}} onGenerate={()=>{}} onCancel={()=>{}} />);
 try {
  assert(failed.document.body.textContent.includes('Model not called'));
  assert(!failed.document.body.textContent.includes('Counts toward plan usage'));
  assert(!failed.document.body.textContent.includes('Usage not reported'));
 }finally{await failed.close();}
 const drawn={...proposal,schemaVersion:2 as const,images:['c'.repeat(64),'e'.repeat(64)],imageLayout:[{kind:'overview' as const,region:{x:0,y:0,w:1,h:1},width:100,height:100},{kind:'detail' as const,region:{x:0.4,y:0,w:0.6,h:1},width:100,height:100}],findings:{...proposal.findings,concepts:[...proposal.findings.concepts,{...proposal.findings.concepts[0]!,key:'draft_b',title:'Quadratic variation'}],depictions:[{source:'draft_a',target:'draft_b',direction:'unclear' as const,label:'',evidence:{...evidence,page:1},additionalEvidence:[evidence],uncertainty:'Arrow endpoint unclear'}]}};
 const selected:unknown[]=[];
 const modern=await mount(()=> <ProposalReviewBody proposal={drawn} capture={capture} snapshot={snapshot} model='fake:vision' loaded busy={false} error={null}
  page={1} evidence={null} onPage={()=>{}} onEvidence={e=>selected.push(e)} onGenerate={()=>{}} onCancel={()=>{}} />);
 try {
  assert(modern.document.body.textContent.includes('Drawn connections'));assert(modern.document.body.textContent.includes('direction unclear'));
  const links=[...modern.document.querySelectorAll('button')];assert(links.some(b=>b.textContent?.includes('Whole map ·')));
  await act(async()=>{links.find(b=>b.textContent?.includes('Detail 1 ·'))!.dispatchEvent(new window.Event('click',{bubbles:true}));});
  assert.equal((selected.at(-1) as typeof evidence).page,1);
 }finally{await modern.close();}
});

test('refined draft starts with the whole-map overview and exposes provenance, notes and source evidence without graph writes',async()=>{
 const {MapDraftPreview}=await import('../components/map-draft-preview.tsx');
 const {draftFixture}=await import('./fixtures/map-draft.ts');const selected:unknown[]=[];
 const proposal={schemaVersion:3 as const,id:'mp_00000000-0000-4000-8000-000000000022',sourceRevision:'mr_00000000-0000-4000-8000-000000000022',sourceHash:'a'.repeat(64),baseRevision:0,context:[],model:'fake:vision',status:'prepared' as const,images:['b'.repeat(64)],imageLayout:[{kind:'manual' as const,region:{x:0,y:0,w:1,h:1},width:1,height:1}],findings:null,draft:draftFixture,refinement:{parentId:'mp_00000000-0000-4000-8000-000000000001',parentDigest:'c'.repeat(64)},digest:'d'.repeat(64),createdAt:'2026-10-29T12:00:00Z',updatedAt:'2026-10-29T12:00:00Z',error:null,estimatedCost:null};
 const before=JSON.stringify(proposal),ui=await mount(()=> <MapDraftPreview proposal={proposal} onEvidence={e=>selected.push(e)}/>);
 try{
  assert(ui.document.querySelector('[aria-label="Isolated proposed mind map"]'));
  assert(ui.document.body.textContent.includes('Draft overview · model synthesis'));
  assert(ui.document.body.textContent.includes('Check the convergence mode.'));
  await act(async()=>{[...ui.document.querySelectorAll('button')].find(b=>b.textContent==='Brownian motion')!.dispatchEvent(new window.Event('click',{bubbles:true}));});
  assert(ui.document.body.textContent.includes('The drawing names Brownian motion.'));
  assert(ui.document.body.textContent.includes('Added explanation'));
  assert(ui.document.body.textContent.includes('Background supplied by the model.'));
  await act(async()=>{[...ui.document.querySelectorAll('button')].find(b=>b.textContent?.includes('Source image ·'))!.dispatchEvent(new window.Event('click',{bubbles:true}));});
  assert.equal(selected.length,1);assert.equal(JSON.stringify(proposal),before);
  assert(![...ui.document.querySelectorAll('button')].some(b=>/Accept|Approve|Apply/.test(b.textContent??'')));
 }finally{await ui.close();}
});

test('graph labels render TeX without treating prose or TeX links as imported HTML',async()=>{
 const {graphMathLabel}=await import('../components/graph-math-label.ts');
 const ui=await mount(()=> <div/>);
 try{
  const label=graphMathLabel('Angle \\(\\pi\\) and $x^2$ <img src=x onerror=bad()>')!;
  assert.equal(label.querySelectorAll('.katex').length,2);
  assert.equal(label.querySelector('img'),null);
  assert(label.textContent?.includes('π'));
  const untrusted=graphMathLabel('$\\href{javascript:alert(1)}{click}$')!;
  assert.equal(untrusted.querySelector('a'),null);
  assert.equal(graphMathLabel('Brownian motion'),undefined);
 }finally{await ui.close();}
});

test('integration UI sends explicit identities and exact approval, exposing failures without pretending success',async()=>{
 const {DraftIntegration}=await import('../components/map-draft-editor.tsx');const {draftFixture}=await import('./fixtures/map-draft.ts');
 const review={schemaVersion:1 as const,proposalId:'mp_00000000-0000-4000-8000-000000000022',revision:2,draft:draftFixture,digest:'a'.repeat(64)};
 const plan={id:'mi_00000000-0000-4000-8000-000000000022',proposalId:review.proposalId,reviewRevision:2,digest:'b'.repeat(64),baseRevision:3,concepts:[],relations:[],reusedRelations:[],status:'prepared'};
 const requests:Record<string,unknown>[]=[],prepared:unknown[]=[];let done=0,fail=true;const oldFetch=globalThis.fetch;
 globalThis.fetch=async(_input,init)=>{const body=JSON.parse(String(init?.body));requests.push(body);return Response.json(body.action==='prepare'?plan:fail?{error:'Atlas changed. Prepare a new preview.'}:{...plan,status:'committed'},{status:body.action==='commit'&&fail?409:200});};
 const ui=await mount(()=> <DraftIntegration review={review} atlas={{...snapshot,concepts:[],layoutRevision:3}} onPrepared={p=>prepared.push(p)} onCommitted={()=>done++}/>);
 const click=async(name:string)=>{await act(async()=>{[...ui.document.querySelectorAll('button')].find(b=>b.textContent===name)!.dispatchEvent(new window.Event('click',{bubbles:true}));});};
 try{
  assert(!ui.document.body.textContent.includes('Approve and integrate'));
  await click('Preview integration');assert.equal(requests[0]!.baseRevision,3);assert.deepEqual(requests[0]!.choices,{identities:{draft_a:'new',draft_b:'new'},subjectId:null,connections:[]});assert.deepEqual(prepared.at(-1),plan);
  await click('Approve and integrate');assert.deepEqual(requests[1],{action:'commit',id:plan.id,digest:plan.digest,approve:true});assert.equal(done,0);assert(ui.document.body.textContent.includes('Atlas changed.'));
  fail=false;await click('Approve and integrate');assert.equal(done,1);
 }finally{await ui.close();globalThis.fetch=oldFetch;}
});
