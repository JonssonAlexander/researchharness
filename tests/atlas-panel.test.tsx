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
 globalThis.fetch=async(_input,init)=>{if(!init?.body)return Response.json(String(_input).includes("config")?{model:"fake:auditor"}:{reviews:[]});const body=JSON.parse(String(init.body));requests.push(body);return Response.json(body.action==='prepare'?plan:fail?{error:'Atlas changed. Prepare a new preview.'}:{...plan,status:'committed'},{status:body.action==='commit'&&fail?409:200});};
 const ui=await mount(()=> <DraftIntegration review={review} atlas={{...snapshot,concepts:[],layoutRevision:3}} onPrepared={p=>prepared.push(p)} onCommitted={()=>done++}/>);
 const click=async(name:string)=>{await act(async()=>{[...ui.document.querySelectorAll('button')].find(b=>b.textContent===name)!.dispatchEvent(new window.Event('click',{bubbles:true}));});};
 try{
  assert(!ui.document.body.textContent.includes('Approve and integrate'));
  await act(async()=>{const subjectSelect=[...ui.document.querySelectorAll('select')].find(s=>s.textContent?.includes('Choose a subject'))!;Object.defineProperty(subjectSelect,"value",{configurable:true,value:a});subjectSelect.dispatchEvent(new window.Event('change',{bubbles:true}));});
  await click('Preview integration');assert.equal(requests[0]!.baseRevision,3);assert.deepEqual(requests[0]!.choices,{identities:{draft_a:'new',draft_b:'new'},subjectId:a,connections:[],mapConnections:['edge_qv']});assert.deepEqual(prepared.at(-1),plan);
  await click('Approve and integrate');assert.deepEqual(requests[1],{action:'commit',id:plan.id,digest:plan.digest,approve:true});assert.equal(done,0);assert(ui.document.body.textContent.includes('Atlas changed.'));
  assert(!ui.document.body.textContent.includes('Approve and integrate'));
  fail=false;await click('Preview integration');await click('Approve and integrate');assert.equal(done,1);
 }finally{await ui.close();globalThis.fetch=oldFetch;}
});

test('connection repair previews saved identities and requires exact approval without creating nodes',async()=>{
 const {MapConnectionRepair}=await import('../components/map-draft-editor.tsx'),{draftFixture}=await import('./fixtures/map-draft.ts');
 const review={schemaVersion:1 as const,proposalId:'mp_00000000-0000-4000-8000-000000000022',revision:1,draft:draftFixture,digest:'a'.repeat(64),integration:{id:'mi_00000000-0000-4000-8000-000000000001',committedAt:'2026-10-29T12:00:00Z'}};
 const plan={id:'mi_00000000-0000-4000-8000-000000000002',digest:'b'.repeat(64),concepts:[],relations:[],mapConnections:[{id:'mc_00000000-0000-4000-8000-000000000002',sourceId:id,targetId:'ac_00000000-0000-4000-8000-000000000002',label:'Drawn connection',uncertainty:'Meaning unclear'}],skippedConnections:[]};
 const requests:Record<string,unknown>[]=[],prepared:unknown[]=[];let done=0;const oldFetch=globalThis.fetch;
 globalThis.fetch=async(_input,init)=>{const body=JSON.parse(String(init?.body));requests.push(body);return Response.json(body.action==='prepare-connections'?plan:{...plan,status:'committed'});};
 const ui=await mount(()=> <MapConnectionRepair review={review} atlas={{...snapshot,layoutRevision:5}} onPrepared={p=>prepared.push(p)} onCommitted={()=>done++} onCancel={()=>{}}/>);
 const click=async(name:string)=>{await act(async()=>{[...ui.document.querySelectorAll('button')].find(b=>b.textContent===name)!.dispatchEvent(new window.Event('click',{bubbles:true}));});};
 try{assert(!ui.document.body.textContent.includes('Approve and restore connections'));await click('Preview missing connections');assert.deepEqual(requests[0],{action:'prepare-connections',proposalId:review.proposalId,baseRevision:5});assert.deepEqual(prepared.at(-1),plan);assert(ui.document.body.textContent.includes('0 new nodes'));assert(ui.document.body.textContent.includes('Meaning unclear'));assert.equal(done,0);await click('Approve and restore connections');assert.deepEqual(requests[1],{action:'commit',id:plan.id,digest:plan.digest,approve:true});assert.equal(done,1);}finally{await ui.close();globalThis.fetch=oldFetch;}
});

test('map grid toggle, map highlighting, centering and subject assignment stay explicit',async()=>{
 const {AtlasMindmaps}=await import('../components/atlas-mindmaps.tsx'),mapId='mm_00000000-0000-4000-8000-000000000011',revisionId='mr_00000000-0000-4000-8000-000000000011';
 const map={id:mapId,title:'Study map',revision:1,archived:false,currentRevision:revisionId,captures:[{schemaVersion:1 as const,id:revisionId,mapId,hash:'a'.repeat(64),previewHash:null,filename:'map.rnote',capturedAt:'2026-10-29T12:00:00Z',conceptIds:[id],validation:'unverified' as const,previewKind:'none' as const,notice:null}]},focus:unknown[]=[],grid:boolean[]=[],saved:AtlasCommand[]=[];
 const ui=await mount(()=> <AtlasMindmaps snapshot={{...snapshot,mindmaps:[map]}} selectedId={null} refresh={async()=>{}} save={async c=>{saved.push(c);}} onMapFocus={(...args)=>focus.push(args)} onGridChange={v=>grid.push(v)}/>);
 const click=async(name:string)=>act(async()=>{[...ui.document.querySelectorAll('button')].find(b=>b.textContent===name)!.dispatchEvent(new window.Event('click',{bubbles:true}));});
 try{
  await click('Grid');assert.deepEqual(grid,[true]);assert(ui.document.querySelector('.xl\\:grid-cols-3'));
  await click('Study map');await click('Center map');assert.deepEqual(focus,[[mapId,undefined],[mapId,true]]);assert.equal(saved.length,0);
  await click('Assign subject');await act(async()=>{const select=[...ui.document.querySelectorAll('select')].find(s=>s.textContent?.includes('Choose a subject'))!;Object.defineProperty(select,'value',{configurable:true,value:a});select.dispatchEvent(new window.Event('change',{bubbles:true}));});
  assert.equal(saved.length,0);await click('Approve subject assignment');assert.deepEqual(saved,[{kind:'map-subject',id:mapId,expectedRevision:1,subjectId:a}]);
 }finally{await ui.close();}
});

test('arrangement previews do not save positions until approved and cancel restores the view',async()=>{
 const {AtlasArrange}=await import('../components/atlas-arrange.tsx'),proposals:unknown[]=[],saved:AtlasCommand[]=[];
 const ui=await mount(()=> <AtlasArrange atlas={{...snapshot,layoutRevision:8}} mapId={null} conceptId={id} save={async c=>{saved.push(c);}} onPreview={p=>proposals.push(p)}/>);
 const click=async(name:string)=>act(async()=>{[...ui.document.querySelectorAll('button')].find(b=>b.textContent===name)!.dispatchEvent(new window.Event('click',{bubbles:true}));});
 try{await click('Preview arrangement');assert.equal(saved.length,0);assert(Array.isArray(proposals.at(-1)));await click('Cancel');assert.equal(proposals.at(-1),null);assert.equal(saved.length,0);await click('Preview arrangement');await click('Save arrangement');assert.equal(saved[0]!.kind,'layout');assert.equal(saved[0]!.expectedRevision,8);}finally{await ui.close();}
});

test('saved AI review remains readable when its configured model is unavailable',async()=>{
 const {SyncRunner}=await import('../components/atlas-sync-review.tsx'),old=globalThis.fetch,seen:unknown[]=[];
 const review={schemaVersion:1,id:'sr_00000000-0000-4000-8000-000000000022',kind:'map',sourceId:'mp_00000000-0000-4000-8000-000000000022',subjectId:null,status:'prepared',model:'fake:auditor',findings:{identities:[],concepts:[],connections:[],observations:[]}};
 globalThis.fetch=async input=>String(input).includes('config=1')?Response.json({error:'Configure a model first.'},{status:503}):Response.json({reviews:[review]});
 const ui=await mount(()=> <SyncRunner kind='map' sourceId={review.sourceId} subjectId={null} onReview={r=>seen.push(r)}/>);
 try{assert.deepEqual(seen,[review]);assert(ui.document.body.textContent.includes('prepared'));assert(ui.document.body.textContent.includes('Configure a model first.'));assert([...ui.document.querySelectorAll('button')].find(b=>b.textContent==='Refresh AI review')!.disabled);}finally{await ui.close();globalThis.fetch=old;}
});

test('possible existing identities require a real choice rather than silently excluding their lines',async()=>{
 const {DraftIntegration}=await import('../components/map-draft-editor.tsx'),{draftFixture}=await import('./fixtures/map-draft.ts'),old=globalThis.fetch;
 globalThis.fetch=async input=>Response.json(String(input).includes('config')?{model:'fake:auditor'}:{reviews:[]});
 const ui=await mount(()=> <DraftIntegration review={{schemaVersion:1,proposalId:'mp_00000000-0000-4000-8000-000000000022',revision:0,draft:draftFixture,digest:'a'.repeat(64)}} atlas={snapshot} onPrepared={()=>{}} onCommitted={()=>{}}/>);
 try{assert(ui.document.body.textContent.includes('must not silently drop their connections'));assert([...ui.document.querySelectorAll('button')].find(b=>b.textContent==='Preview integration')!.disabled);assert(ui.document.querySelector('option[value="pending"]'));}finally{await ui.close();globalThis.fetch=old;}
});

test('ordinary connection editor preserves drafts on stale save and requires confirmed removal',async()=>{
 const {AtlasLinkEditor}=await import('../components/atlas-link-editor.tsx');
 const other={...snapshot.concepts[0]!,id:'ac_00000000-0000-4000-8000-000000000009',title:'Generator'};
 const link={id:'dl_00000000-0000-4000-8000-000000000001',sourceId:id,targetId:other.id,label:'Explore',direction:'unclear' as const,notes:'',replaces:null,removed:false};
 const commands:AtlasCommand[]=[];let stale=true;
 const ui=await mount(()=> <AtlasLinkEditor snapshot={{...snapshot,concepts:[...snapshot.concepts,other],drawingLinks:[link],layoutRevision:7}} sourceId={id} targetId={other.id} save={async c=>{commands.push(c);if(stale)throw new Error('Atlas changed. Reload before editing this line.');}} onClose={()=>{}}/>);
 const click=async(text:string)=>act(async()=>{[...ui.document.querySelectorAll('button')].find(b=>b.textContent===text)!.click();});
 try{
  await click('Edit ordinary line');await act(async()=>{ui.document.querySelector('form')!.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));});
  assert(ui.document.body.textContent.includes('Atlas changed.'));assert(ui.document.querySelector('form'));
  stale=false;await click('Remove line');assert.equal(commands.length,1);await click('Confirm removal');
  assert.equal(commands.length,2);assert.equal(commands[1]!.kind,'drawing-link');assert.equal((commands[1] as {removed:boolean}).removed,true);assert.equal(commands[1]!.expectedRevision,7);
 }finally{await ui.close();}
});

test('saved view updates include emphasis and use the current view revision',async()=>{
 const {AtlasViews}=await import('../components/atlas-views.tsx');
 const view={id:'av_00000000-0000-4000-8000-000000000001',title:'Stochastic calculus',query:'',camera:{x:0,y:0,k:1},revision:3};const commands:AtlasCommand[]=[];
 const ui=await mount(()=> <AtlasViews views={[view]} save={async c=>{commands.push(c);}} actions={{canSave:true,activeId:view.id,capture:()=>({camera:view.camera,query:'',emphasis:{[id]:'prominent'}}),restore:()=>{}}}/>);
 try{await act(async()=>{[...ui.document.querySelectorAll('button')].find(b=>b.textContent==='Update current view')!.click();});assert.deepEqual(commands,[{kind:'view',id:view.id,title:view.title,expectedRevision:3,camera:view.camera,query:'',emphasis:{[id]:'prominent'}}]);}finally{await ui.close();}
});

test('held node-size shortcuts map 1/2/3, preserve typing, and clear on release or focus loss',async()=>{
 const {useNodeSizeShortcut}=await import('../components/use-node-size-shortcut.ts');
 let held!:ReturnType<typeof useNodeSizeShortcut>;
 function Harness(){held=useNodeSizeShortcut();return <input/>;}
 const ui=await mount(()=> <Harness/>);
 const key=async(type:string,value:string,target:EventTarget=ui.document,extra:Record<string,unknown>={})=>act(async()=>{const event=new window.Event(type,{bubbles:true});Object.assign(event,{key:value,code:`Digit${value}`,...extra});target.dispatchEvent(event);});
 try{
  for(const [number,size] of [['1','small'],['2','normal'],['3','prominent']]){await key('keydown',number!);assert.equal(held.current,size);await key('keyup',number!);assert.equal(held.current,null);}
  await key('keydown','3',ui.document.querySelector('input')!);assert.equal(held.current,null);
  await key('keydown','3',ui.document,{metaKey:true});assert.equal(held.current,null);
  await key('keydown','1');await key('keydown','3');await key('keyup','3');assert.equal(held.current,'small');
  await act(async()=>{window.dispatchEvent(new window.Event('blur'));});assert.equal(held.current,null);
 }finally{await ui.close();}
});

test('concept derivations show precise joint premises and pass the chosen canonical step to learning',async()=>{
 const {ConceptDerivations}=await import('../components/concept-derivations.tsx');
 const nodes=[['n_a','Independent increments'],['n_b','Moment bounds'],['n_c','Quadratic variation']].map(([id,name])=>({id:id!,name:name!,statement:`Precise ${name}`,aliases:[],provenance:[],createdAt:'2026-10-30T00:00:00Z'}));
 const graph={nodes,propositions:nodes,chains:[{id:'arg_joint',premises:['n_a','n_b'],conclusion:'n_c',provenance:[],createdAt:'2026-10-30T00:00:00Z'}],edges:[],logicalEdges:[],impLinks:[],sessions:{},fileSources:{},nodeSessions:{},clusters:[]};
 const concept={...snapshot.concepts[0]!,propositionIds:['n_c']};const calls:{context:unknown;prompt:string}[]=[];
 const ui=await mount(()=> <ConceptDerivations concept={concept} graph={graph} save={async()=>{throw new Error('No writes expected');}} onClose={()=>{}} onLearn={(context,prompt)=>calls.push({context,prompt})}/>);
 try{assert(ui.document.body.textContent.includes('Precise Independent increments'));assert(ui.document.body.textContent.includes('Precise Moment bounds'));await act(async()=>{[...ui.document.querySelectorAll('button')].find(b=>b.textContent==='Learn this step')!.click();});assert.deepEqual(calls[0]!.context,{conceptIds:[id],goal:'derive',derivation:{rootId:'n_c',targetId:'n_c',chainId:'arg_joint'}});assert(calls[0]!.prompt.includes('all its premises jointly'));}finally{await ui.close();}
});

test('empty derivations do not fabricate claims and linking preserves notes and uses the concept revision',async()=>{
 const {ConceptDerivations}=await import('../components/concept-derivations.tsx');
 const node={id:'n_claim',name:'Precise result',statement:'A self-contained statement.',aliases:[],provenance:[],createdAt:'2026-10-30T00:00:00Z'},graph={nodes:[node],propositions:[node],chains:[],edges:[],logicalEdges:[],impLinks:[],sessions:{},fileSources:{},nodeSessions:{},clusters:[]};
 const concept={...snapshot.concepts[0]!,propositionIds:[],markdown:'Owner notes'};const commands:AtlasCommand[]=[];
 const ui=await mount(()=> <ConceptDerivations concept={concept} graph={graph} save={async c=>{commands.push(c);throw new Error('This item changed. Reload it before saving.');}} onClose={()=>{}}/>);
 try{assert(ui.document.body.textContent.includes('No canonical claims are linked'));await act(async()=>{const select=ui.document.querySelector('[aria-label="Existing claim"]')!;Object.defineProperty(select,'value',{configurable:true,value:'n_claim'});select.dispatchEvent(new window.Event('change',{bubbles:true}));});await act(async()=>{[...ui.document.querySelectorAll('button')].find(b=>b.textContent==='Link claim to concept')!.click();});assert.equal(commands[0]!.kind,'concept');assert.equal(commands[0]!.expectedRevision,concept.revision);assert(!('markdown' in commands[0]!));assert.deepEqual((commands[0] as {propositionIds:string[]}).propositionIds,['n_claim']);assert(ui.document.querySelector('[role="alert"]')!.textContent.includes('changed'));assert.equal((ui.document.querySelector('[aria-label="Existing claim"]') as HTMLSelectElement).value,'n_claim');}finally{await ui.close();}
});

test('lesson workspace pins Start/Finish and returns to the same retained lesson map',async()=>{
 const {LessonWorkspace}=await import('../components/lesson-workspace.tsx'),{initialLesson}=await import('../src/core/learning-session.ts');
 const originalFetch=globalThis.fetch,plan=initialLesson('Understand stochastic calculus');plan.derivations=[{id:'proof',nodeId:'topic_0',title:'Quadratic variation',start:'Standard Brownian motion.',finish:'Quadratic sums converge in L².',status:'working'}];plan.activeDerivationId='proof';
 let value:import('../src/core/learning-session.ts').LearningSession={schemaVersion:1,revision:1,status:'active',plan};const requests:unknown[]=[];
 globalThis.fetch=async(_url,init)=>{if(init?.body){const body=JSON.parse(String(init.body));requests.push(body);value={schemaVersion:1,revision:value.revision+1,status:body.status,plan:body.plan};}return Response.json({lesson:value});};
 function Harness(){const [lesson,setLesson]=React.useState(value);return <ServerEventsProvider connect={()=>({close(){},onOpen(){},onEvent(){}})}><LessonWorkspace chatId="chat_fixture" lesson={lesson} onChange={setLesson} busy={false}/></ServerEventsProvider>;}
 const ui=await mount(()=> <Harness/>);
 try{assert(ui.document.body.textContent.includes('Standard Brownian motion.'));assert(ui.document.body.textContent.includes('Quadratic sums converge in L².'));await act(async()=>{[...ui.document.querySelectorAll('button')].find(b=>b.textContent==='Return to lesson')!.click();});assert.equal(value.plan.activeDerivationId,null);assert.equal(value.plan.derivations.length,1);assert.equal(value.plan.objective,plan.objective);assert.equal((requests[0] as {expectedRevision:number}).expectedRevision,1);await act(async()=>{[...ui.document.querySelectorAll('button')].find(b=>b.textContent==='Finish lesson')!.click();});assert.equal(value.status,'finished');assert.equal(value.plan.derivations[0]!.status,'working');}finally{await ui.close();globalThis.fetch=originalFetch;}
});

test('lesson review shows full arguments and gaps separately from the conceptual map',async()=>{
 const {LessonProposal}=await import('../components/lesson-integration.tsx'),{initialLesson}=await import('../src/core/learning-session.ts');
 const {lessonSummary}=await import('../src/core/lesson-integration.ts');
 const {projectAtlas}=await import('../src/core/atlas.ts');
 const draft=lessonSummary.parse({overview:'Conceptual picture',map:initialLesson('Learn a result'),concepts:[],propositions:[{key:'a',name:'Assumption',statement:'A precise assumption.',existingId:null,identityRationale:'',origin:'session',evidence:['message_a'],uncertainty:''},{key:'b',name:'Conclusion',statement:'A precise conclusion.',existingId:null,identityRationale:'',origin:'ai-explanation',evidence:[],uncertainty:'Conditions need checking'}],arguments:[{key:'step',premises:['a'],conclusion:'b',rationale:'Full mathematical explanation retained here.',origin:'ai-explanation',evidence:[],status:'gap',uncertainty:'Missing step'}],derivations:[{key:'proof',title:'Result',topicId:'topic_0',start:'Start with the hypothesis.',finish:'Prove the conclusion.',root:'b',propositions:['a','b'],arguments:['step'],concepts:[],include:true,gaps:['An unresolved implication'],assistance:'AI hint'}]});
 const review={id:'lr_00000000-0000-4000-8000-000000000001',createdAt:'2026-10-30',draft,decisions:{},context:{propositions:[],concepts:[]}} as unknown as import('../src/core/lesson-integration.ts').LessonReview;
 const ui=await mount(()=> <LessonProposal review={review} atlas={snapshot} graph={null} initialProofKey="proof"/>);
 try{const text=ui.document.body.textContent!;assert(text.includes('Lesson map'));assert(text.includes('In Atlas'));assert(text.includes('Start with the hypothesis.'));assert(text.includes('Prove the conclusion.'));assert(text.includes('Full mathematical explanation retained here.'));assert(text.includes('GAP'));assert(text.includes('AI hint'));assert(ui.document.querySelector('select[aria-label="Choose step"]'));assert([...ui.document.querySelectorAll('details')].some(el=>el.querySelector('summary')?.textContent?.includes('Sources & assistance')&&!el.hasAttribute('open')));assert(!text.includes('Resolve identity'));assert(!text.includes('Include this derivation'));}finally{await ui.close();}
 const withProof={...snapshot,lessonMaps:[{id:review.id,chatId:'chat_fixture',title:'Lesson',conceptIds:[id],newPropositionIds:['n_hidden'],map:draft.map,derivations:[{key:'proof',title:'Result',rootId:'n_hidden',conceptIds:[id],propositionIds:['n_hidden'],argumentIds:[],gaps:['Unproved'],assistance:'AI hint',reviewFlags:['AI explanation']}]}]};
 const projected=projectAtlas(withProof);assert.equal(projected.nodes.find(n=>n.id===id)!.derivationCount,1);assert.equal(projected.nodes.find(n=>n.id===id)!.badgeColor,'#e6b35a');assert(!projected.nodes.some(n=>n.id==='n_hidden'));
});


test('inspecting a lesson topic is read-only; Continue here changes focus once and requests teaching',async()=>{
 const {LessonWorkspace}=await import('../components/lesson-workspace.tsx'),{initialLesson}=await import('../src/core/learning-session.ts');
 const originalFetch=globalThis.fetch,plan=initialLesson('Our objective');
 plan.nodes.push({id:'next',title:'Next topic',conceptId:null,tangent:false});
 plan.derivations=[{id:'proof',nodeId:'topic_0',title:'Retained proof',start:'Premise',finish:'Result',status:'working'}];plan.activeDerivationId='proof';
 let value:import('../src/core/learning-session.ts').LearningSession={schemaVersion:1,revision:1,status:'active',plan};
 const writes:unknown[]=[],continued:string[]=[];let refuse=true;
 globalThis.fetch=async(_url,init)=>{if(init?.body){if(refuse)return Response.json({error:'Lesson changed. Reload before saving.'},{status:409});const body=JSON.parse(String(init.body));writes.push(body);value={...value,revision:value.revision+1,status:body.status,plan:body.plan};}return Response.json({lesson:value});};
 function Harness(){const [lesson,setLesson]=React.useState(value);return <ServerEventsProvider connect={()=>({close(){},onOpen(){},onEvent(){}})}><LessonWorkspace chatId="chat_inspect" lesson={lesson} onChange={setLesson} busy={false} onContinue={title=>continued.push(title)}/></ServerEventsProvider>;}
 const ui=await mount(()=> <Harness/>);
 try{
  await act(async()=>{[...ui.document.querySelectorAll('button')].find(b=>b.textContent==='Next topic')!.click();});
  assert.equal(writes.length,0);assert.equal(value.plan.currentNodeId,'topic_0');assert.equal(value.plan.activeDerivationId,'proof');
  await act(async()=>{[...ui.document.querySelectorAll('button')].find(b=>b.textContent==='Continue here')!.click();});
  assert.equal(writes.length,0);assert.deepEqual(continued,[]);assert.equal(value.plan.currentNodeId,'topic_0');
  refuse=false;await act(async()=>{[...ui.document.querySelectorAll('button')].find(b=>b.textContent==='Continue here')!.click();});
  assert.equal(writes.length,1);assert.equal(value.plan.currentNodeId,'next');assert.equal(value.plan.activeDerivationId,null);
  assert.equal(value.plan.derivations[0]!.status,'working');assert.deepEqual(continued,['Next topic']);
  assert(ui.document.body.textContent.includes('awaiting your finish'));
 }finally{await ui.close();globalThis.fetch=originalFetch;}
});


test('focused maps inspect existing concepts, drill into neighbours and return without writing',async()=>{
 const {AtlasNeighbourhood}=await import('../components/atlas-neighbourhood.tsx');
 const first=snapshot.concepts[0]!,other={...first,id:'ac_00000000-0000-4000-8000-000000000099',title:'Neighbour topic',propositionIds:[]};
 const atlas={...snapshot,concepts:[first,other],relations:[],drawingLinks:[{id:'dl_00000000-0000-4000-8000-000000000099',sourceId:first.id,targetId:other.id,label:'Association',direction:'unclear' as const,notes:'',replaces:null,removed:false}]};
 const inspected:string[]=[];let closed=false;
 const ui=await mount(()=> <AtlasNeighbourhood atlas={atlas} scope={{kind:'concept',id:first.id}} onClose={()=>{closed=true;}} onInspect={id=>inspected.push(id)} onDerivations={()=>{}} onLesson={()=>{}}/>);
 try{
  const click=async(label:string)=>act(async()=>{[...ui.document.querySelectorAll('button')].find(b=>b.textContent===label)!.click();});
  await click('Neighbour topic');await click('Open map');
  assert(ui.document.querySelector('section[role="dialog"]')!.getAttribute('aria-label')!.includes('Neighbour topic'));
  await click('Notes & edit');assert.deepEqual(inspected,[other.id]);await click('← Back');
  assert(ui.document.querySelector('section[role="dialog"]')!.getAttribute('aria-label')!.includes(first.title));
  await click('Back to Atlas');assert.equal(closed,true);
 }finally{await ui.close();}
});


test('shared derivation navigation explores another result without writing or dispatching an invalid learning target',async()=>{
 const {ConceptDerivations}=await import('../components/concept-derivations.tsx');
 const nodes=['foundation','first','second'].map(id=>({id:`n_${id}`,name:id,statement:`Precise ${id}`,aliases:[],provenance:[],createdAt:'2026-10-31'}));
 const graph={nodes,propositions:nodes,chains:['first','second'].map(id=>({id:`arg_${id}`,premises:['n_foundation'],conclusion:`n_${id}`,provenance:[],createdAt:'2026-10-31'})),edges:[],logicalEdges:[],impLinks:[],sessions:{},fileSources:{},nodeSessions:{},clusters:[]};
 let writes=0,calls=0;const concept={...snapshot.concepts[0]!,propositionIds:['n_first']};
 const ui=await mount(()=> <ConceptDerivations concept={concept} graph={graph} save={async()=>{writes++;}} onClose={()=>{}} onLearn={()=>{calls++;}}/>);
 try{
  assert(!ui.document.body.textContent.includes('Linked claim'));
  assert(ui.document.body.textContent.includes('3 shared claims'));
  assert(![...ui.document.querySelectorAll('button')].some(b=>b.textContent==='Show all'));
  await act(async()=>{[...ui.document.querySelectorAll('button')].find(b=>b.textContent==='first')!.click();});
  await act(async()=>{[...ui.document.querySelectorAll('button')].find(b=>b.textContent==='Show all')!.click();});
  assert(![...ui.document.querySelectorAll('button')].some(b=>b.textContent==='Show all'));
  await act(async()=>{[...ui.document.querySelectorAll('button')].find(b=>b.textContent==='second')!.click();});
  assert(ui.document.querySelector('article')!.textContent.includes('Precise second'));
  assert(![...ui.document.querySelectorAll('button')].some(b=>b.textContent==='Learn this step'));
  await act(async()=>{[...ui.document.querySelectorAll('button')].find(b=>b.textContent==='first')!.click();});
  assert([...ui.document.querySelectorAll('button')].some(b=>b.textContent==='Learn this step'));
  assert.equal(writes,0);assert.equal(calls,0);
 }finally{await ui.close();}
});

test('lesson review keeps two proposed proofs in one map and selects results without a derivation dropdown',async()=>{
 const {LessonProposal}=await import('../components/lesson-integration.tsx'),{initialLesson}=await import('../src/core/learning-session.ts');
 const {lessonSummary}=await import('../src/core/lesson-integration.ts');
 const draft=lessonSummary.parse({overview:'Two results',map:initialLesson('Shared foundations'),concepts:[],propositions:['a','b','c'].map(key=>({key,name:key,statement:`Statement ${key}`,existingId:null,identityRationale:'',origin:'session',evidence:[],uncertainty:''})),arguments:['b','c'].map(key=>({key:`step_${key}`,premises:['a'],conclusion:key,rationale:`Why ${key} follows`,origin:'session',evidence:[],status:key==='c'?'gap':'inference',uncertainty:''})),derivations:['b','c'].map(key=>({key:`proof_${key}`,title:`Result ${key}`,topicId:'topic_0',start:`Start ${key}`,finish:`Finish ${key}`,root:key,propositions:['a',key],arguments:[`step_${key}`],concepts:[],include:true,gaps:key==='c'?['Needs an argument']:[],assistance:''}))});
 const review={id:'lr_00000000-0000-4000-8000-000000000001',createdAt:'2026-10-31',draft,decisions:{},context:{propositions:[],concepts:[]}} as unknown as import('../src/core/lesson-integration.ts').LessonReview;
 const ui=await mount(()=> <LessonProposal review={review} atlas={snapshot} graph={null} initialProofKey="proof_b"/>);
 try{
  assert(!ui.document.querySelector('select[aria-label="Choose derivation"]'));
  assert(ui.document.body.textContent.includes('3 claims · 1 arguments'));
  await act(async()=>{[...ui.document.querySelectorAll('button')].find(b=>b.textContent==='Result c')!.click();});
  assert(ui.document.body.textContent.includes('Start c'));assert(ui.document.body.textContent.includes('Finish c'));
  assert(ui.document.body.textContent.includes('Why c follows'));assert(ui.document.body.textContent.includes('GAP'));
  assert(ui.document.body.textContent.includes('3 claims · 1 arguments'));
 }finally{await ui.close();}
});

test('lesson context picker selects and removes several concepts without changing graph data',async()=>{
 const {AtlasLessonPicker}=await import('../components/atlas-lesson-picker.tsx');
 const nextId='ac_00000000-0000-4000-8000-000000000002',data={...snapshot,concepts:[...snapshot.concepts,{...snapshot.concepts[0]!,id:nextId,title:'Quadratic variation'}]},oldFetch=globalThis.fetch,calls:{url:string;method:string}[]=[];
 globalThis.fetch=async(url,options)=>{calls.push({url:String(url),method:options?.method??'GET'});return Response.json(data);};
 let selection:import('../src/core/atlas-sync.ts').LearningContext|undefined;
 function Harness(){const [context,setContext]=React.useState<typeof selection>();return <AtlasLessonPicker context={context} onChange={value=>{selection=value;setContext(value);}}/>;}
 const connect=()=>({close(){},onOpen(){},onEvent(){}}),ui=await mount(()=><ServerEventsProvider connect={connect}><Harness/></ServerEventsProvider>);
 try{
  await act(async()=>{});
  const checks=[...ui.document.querySelectorAll('input[type="checkbox"]')];assert.equal(checks.length,2);
  for(const check of checks)await act(async()=>{check.dispatchEvent(new window.Event('click',{bubbles:true}));});
  assert.deepEqual(selection?.conceptIds,[id,nextId]);assert.equal(selection?.goal,'explain');
  const remove=ui.document.querySelector('button[aria-label="Remove Brownian motion"]')!;await act(async()=>{remove.dispatchEvent(new window.Event('click',{bubbles:true}));});assert.deepEqual(selection?.conceptIds,[nextId]);
  const clear=[...ui.document.querySelectorAll('button')].find(n=>n.textContent==='Clear')!;await act(async()=>{clear.dispatchEvent(new window.Event('click',{bubbles:true}));});assert.equal(selection,undefined);assert(calls.every(c=>c.url==='/api/atlas'&&c.method==='GET'));
 }finally{await ui.close();globalThis.fetch=oldFetch;}
});

test('separate Review reveals a reference only after an attempt and applies an Anki rating without Atlas writes',async()=>{
 const {AtlasReview}=await import('../components/atlas-review.tsx'),{DEFAULT_REVIEW_SETTINGS,REVIEW_VERSION}=await import('../src/core/retrieval.ts');
 const now=new Date().toISOString(),item={id:'ri_00000000-0000-4000-8000-000000000001',conceptId:id,title:'Brownian motion',front:'State the basic idea.',back:'A hidden reference answer.',sourceHash:'hash',revision:1,targetVersion:1,paused:false,createdAt:now,card:{dueAt:now,lastReviewAt:null,reps:0},config:{...REVIEW_VERSION,parameters:{}}};
 let activity={id:'ra_00000000-0000-4000-8000-000000000001',revision:1,day:'2026-10-31',timeZone:'Europe/Stockholm',createdAt:now,status:'ready',items:[{id:item.id,conceptId:id,title:item.title,revision:1,targetVersion:1}],front:item.front,answer:'',attempted:false} as Record<string,unknown>;
 let active:Record<string,unknown>|null=activity,last:Record<string,unknown>|null=null;const calls:Record<string,unknown>[]=[],old=globalThis.fetch;
 const state=()=>({now,refreshAt:new Date(Date.now()+3600000).toISOString(),day:'2026-10-31',settings:DEFAULT_REVIEW_SETTINGS,items:[{item,retrievability:null,stale:false}],model:null,used:1,remaining:5,deck:{groups:[],due:1,deferred:0,estimatedSeconds:0},active,last});
 globalThis.fetch=async(url,init)=>{if(String(url).includes('drawing='))return Response.json({draft:null});if(!init?.body)return Response.json(state());const command=JSON.parse(String(init.body));calls.push(command);if(command.action==='reveal'){activity={...activity,revision:2,status:'revealed',attempted:true,back:item.back};active=activity;}if(command.action==='rate'){activity={...activity,revision:3,status:'rated',ratings:command.ratings};active=null;last=activity;}return Response.json({result:activity,snapshot:state()});};
 const ui=await mount(()=><ServerEventsProvider connect={()=>({close(){},onOpen(){},onEvent(){}})}><AtlasReview atlas={snapshot} onClose={()=>{}}/></ServerEventsProvider>);
 try{
  await act(async()=>{});assert(!ui.document.body.textContent.includes(item.back));assert([...ui.document.querySelectorAll('button')].some(b=>b.textContent==='Scratchpad'));
  const reveal=[...ui.document.querySelectorAll('button')].find(b=>b.textContent==='I tried · show answer')!;assert(reveal);await act(async()=>{reveal.dispatchEvent(new window.Event('click',{bubbles:true}));});assert(ui.document.body.textContent.includes(item.back));
  const good=[...ui.document.querySelectorAll('button')].find(b=>b.textContent==='Good')!;await act(async()=>{good.dispatchEvent(new window.Event('click',{bubbles:true}));});
  assert.deepEqual(calls.map(c=>c.action),['reveal','rate']);assert.deepEqual(calls[1]!.ratings,{[item.id]:3});assert(ui.document.body.textContent.includes('Today'));
 }finally{await ui.close();globalThis.fetch=old;}
});

test('Daily review advances through cards automatically and displays FSRS intervals',async()=>{
 const {AtlasReview}=await import('../components/atlas-review.tsx'),{DEFAULT_REVIEW_SETTINGS,REVIEW_VERSION}=await import('../src/core/retrieval.ts');
 const now=new Date().toISOString(),items=[1,2].map(n=>({id:`ri_00000000-0000-4000-8000-00000000000${n}`,conceptId:id,title:`Concept ${n}`,front:`Recall ${n}`,back:`Reference ${n}`,sourceHash:'hash',revision:1,targetVersion:1,paused:false,createdAt:now,card:{dueAt:now,lastReviewAt:null,reps:0},config:{...REVIEW_VERSION,parameters:{}}}));
 let active:Record<string,unknown>|null=null,last:Record<string,unknown>|null=null,started=0;const calls:string[]=[],old=globalThis.fetch;
 const state=()=>({now,refreshAt:new Date(Date.now()+3600000).toISOString(),day:'2026-11-01',settings:DEFAULT_REVIEW_SETTINGS,items:items.map(item=>({item,retrievability:null,stale:false})),model:null,used:started,remaining:6-started,deck:{groups:items.slice(started).map(i=>[i.id]),due:2-started,deferred:0,estimatedSeconds:90},active,last,intervals:Object.fromEntries(items.map(i=>[i.id,[1,2,3,4].map(n=>new Date(Date.parse(now)+n*86400000).toISOString())]))});
 globalThis.fetch=async(url,init)=>{if(String(url).includes('drawing='))return Response.json({draft:null});if(!init?.body)return Response.json(state());const c=JSON.parse(String(init.body));calls.push(c.action);if(c.action==='start'){const item=items.find(i=>i.id===c.itemIds[0])!;started++;active={id:c.id,revision:1,status:'ready',items:[item],front:item.front,answer:'',attempted:false};}if(c.action==='reveal')active={...active,revision:2,status:'revealed',back:items[started-1]!.back};if(c.action==='rate'){last={...active,status:'rated',revision:3};active=null;}return Response.json({result:active??last,snapshot:state()});};
 const ui=await mount(()=><ServerEventsProvider connect={()=>({close(){},onOpen(){},onEvent(){}})}><AtlasReview atlas={snapshot} onClose={()=>{}}/></ServerEventsProvider>);
 const press=async(label:string)=>{await act(async()=>{const b=[...ui.document.querySelectorAll('button')].find(b=>b.textContent?.startsWith(label));assert(b,label);b.dispatchEvent(new window.Event('click',{bubbles:true}));});};
 try{await act(async()=>{});await press('Daily review');assert(ui.document.body.textContent.includes('Recall 1'));await press('I tried');assert(ui.document.body.textContent.includes('Good3d'));await press('Good');assert(ui.document.body.textContent.includes('Recall 2'));await press('I tried');await press('Good');assert.deepEqual(calls,['start','reveal','rate','start','reveal','rate']);assert(ui.document.body.textContent.includes('Nothing due'));}finally{await ui.close();globalThis.fetch=old;}
});

test('lesson source control uploads the chosen file without dispatching a teaching turn',async()=>{
 const {LessonSources}=await import('../components/lesson-sources.tsx');const old=globalThis.fetch,calls:{url:string;method:string}[]=[],source={id:'ls_'+'a'.repeat(64),name:'paper.tex'},files:typeof source[]=[];let attached=0;
 globalThis.fetch=async(url,init)=>{calls.push({url:String(url),method:init?.method??'GET'});if(init?.method==='POST'){assert(init.body instanceof File);files.push(source);return Response.json({source});}return Response.json({sources:files});};
 const ui=await mount(()=><ServerEventsProvider connect={()=>({close(){},onOpen(){},onEvent(){}})}><LessonSources chatId="lesson" onAttached={()=>attached++}/></ServerEventsProvider>);
 try{await act(async()=>{});const input=ui.document.querySelector('input[type="file"]')!;Object.defineProperty(input,'files',{configurable:true,value:[new File(['Assume independence.'],'paper.tex',{type:'text/plain'})]});await act(async()=>{input.dispatchEvent(new window.Event('change',{bubbles:true}));});assert.equal(attached,1);assert(ui.document.body.textContent.includes('paper.tex'));assert.equal(calls.filter(c=>c.method==='POST').length,1);assert(calls.every(c=>c.url.includes('/sources')));}finally{await ui.close();globalThis.fetch=old;}
});
