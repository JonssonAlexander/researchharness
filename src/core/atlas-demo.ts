import { AtlasError, type AtlasCommand, type AtlasSnapshot } from "./atlas.ts";

/** Reserved fixture namespace. Names and aliases never determine cleanup scope. */
export const isAtlasDemoId = (id: string) =>
	/^(ac|as|ar)_dea00000-[0-9a-f]{4}-4000-8000-[0-9a-f]{12}$/.test(id);
export function createAtlasDemo(batch: string): AtlasCommand[] {
	if (!/^[0-9a-f]{12}$/.test(batch)) throw new AtlasError("Invalid demo batch.");
	const id = (prefix: string, index: number) =>
		`${prefix}_dea00000-${index.toString(16).padStart(4, "0")}-4000-8000-${batch}`;
	const subjects = ["Probability", "Analysis", "Computation"];
	const titles = [
		"Random variables",
		"Brownian motion",
		"Martingales",
		"Quadratic variation",
		"Itô integral",
		"Infinitesimal generator",
		"Heat equation",
		"Finite differences",
		"Monte Carlo",
	];
	const homes = [0, 0, 0, 0, 0, 1, 1, 2, 2];
	const commands: AtlasCommand[] = subjects.map((title, i) => ({
		kind: "subject",
		id: id("as", i),
		expectedRevision: 0,
		title,
		color: ["#60a5fa", "#c084fc", "#fbbf24"][i]!,
		parentId: null,
	}));
	titles.forEach((title, i) =>
		commands.push({
			kind: "concept",
			id: id("ac", i),
			expectedRevision: 0,
			title,
			aliases: [],
			markdown: `# ${title}\n\n**Demo data — illustrative, unverified.**\n\nTry the concept links and **Find a connection**. These notes are a layout fixture, not a mathematical reference.\n\nEdit or remove this concept freely.`,
			subjectIds: i === 5 ? [id("as", 0), id("as", 1)] : [id("as", homes[i]!)],
			preferredSubjectId: id("as", homes[i]!),
			propositionIds: [],
		}),
	);
	const subjectPositions = [
		[-250, -90],
		[170, -90],
		[170, 210],
	];
	const conceptPositions = [
		[-380, -200],
		[-250, -110],
		[-110, -200],
		[-340, 30],
		[-160, 30],
		[110, -100],
		[280, -100],
		[110, 210],
		[280, 210],
	];
	subjectPositions.forEach(([x, y], i) =>
		commands.push({ kind: "subject-position", id: id("as", i), expectedRevision: 1, x: x!, y: y! }),
	);
	conceptPositions.forEach(([x, y], i) =>
		commands.push({ kind: "concept-position", id: id("ac", i), expectedRevision: 1, x: x!, y: y! }),
	);
	const edges = [
		[0, 1],
		[1, 3],
		[3, 4],
		[1, 2],
		[4, 5],
		[5, 6],
		[6, 7],
		[1, 8],
		[7, 8],
	];
	edges.forEach(([from, to], i) =>
		commands.push({
			kind: "relation",
			id: id("ar", i),
			expectedRevision: 0,
			sourceId: id("ac", from!),
			targetId: id("ac", to!),
			relationType: i === 8 ? "analogy" : i < 4 ? "prerequisite" : "application",
			conditions: "Demo connection for testing the UI; not a validated mathematical claim.",
			claimStatus: "hypothesis",
			reviewStatus: "accepted",
			evidence: [
				{
					citation: "Demo fixture — placeholder citation, not mathematical evidence",
					locator: "Layout and query test",
				},
			],
		}),
	);
	return commands;
}

/** Refuse shared dependencies before removing anything. Each save also checks live references. */
export function removeAtlasDemo(snapshot: AtlasSnapshot): AtlasCommand[] {
	const demoConcepts = new Set(snapshot.concepts.filter((c) => isAtlasDemoId(c.id)).map((c) => c.id));
	const demoSubjects = new Set(snapshot.subjects.filter((s) => isAtlasDemoId(s.id)).map((s) => s.id));
	if (
		snapshot.relations.some(
			(r) => !isAtlasDemoId(r.id) && (demoConcepts.has(r.sourceId) || demoConcepts.has(r.targetId)),
		) ||
		snapshot.concepts.some((c) => !isAtlasDemoId(c.id) && c.subjectIds.some((id) => demoSubjects.has(id))) ||
		snapshot.subjects.some((s) => !isAtlasDemoId(s.id) && s.parentId && demoSubjects.has(s.parentId))
	)
		throw new AtlasError("Demo items are linked to your own work. Remove those links or memberships first.");
	// Demo subjects are flat. Refuse new child relationships rather than guess how to rearrange them.
	if (snapshot.subjects.some((s) => isAtlasDemoId(s.id) && s.parentId && demoSubjects.has(s.parentId)))
		throw new AtlasError("Move demo child subjects to no parent before clearing the demo.");
	return [
		...snapshot.relations
			.filter((r) => isAtlasDemoId(r.id))
			.map((r) => ({ kind: "relation-delete" as const, id: r.id, expectedRevision: r.revision })),
		...snapshot.concepts
			.filter((c) => isAtlasDemoId(c.id))
			.map((c) => ({ kind: "concept-delete" as const, id: c.id, expectedRevision: c.revision })),
		...snapshot.subjects
			.filter((s) => isAtlasDemoId(s.id))
			.map((s) => ({ kind: "subject-delete" as const, id: s.id, expectedRevision: s.revision })),
	];
}
