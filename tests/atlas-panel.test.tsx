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
			attempts.map((a) => a.id),
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
		assert.equal(attempts[1]!.id, first.id);
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
