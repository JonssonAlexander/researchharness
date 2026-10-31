# Concept-to-derivation navigation

30 October 2026; R01, R04–R05, R08–R09, R14–R17.

Select an Atlas concept → **Derivations**. The shared surface opens with that
concept’s linked claims highlighted inside the canonical derivation map. Other concept
nodes stay in the main Atlas; opening/closing this view does not move them or save
formal layout positions. The view reuses the existing Canvas renderer, D3 layout,
KaTeX labels and normal theme shell. Claim lists remain usable if Canvas fails.

Canonical `n_` propositions and `arg_` arguments are read from the existing graph
snapshot. Backward traversal includes every joint premise of a retained argument,
all retained alternative arguments and earlier premises, with cycle detection.
One premise is drawn as a plain arrow; multiple premises enter a shared implication
junction, matching upstream's grammar. This is a presentation projection, never a
second proposition/argument store. At 150 claims or 80 arguments, whole additional
arguments are omitted with a visible limit message. Broken references are omitted;
missing concept links remain visible as unavailable, without identity guessing.

Select a claim to inspect its precise statement, choose among recorded arguments,
read the full joint premises and follow their session/file sources. The upstream
ledger records dependencies and provenance, not a separately persisted proof text
or formal certificate. The UI labels these as recorded source assertions and
points to the original argument; a missing argument does not mean a claim is false
or has no proof. Personal understanding remains separate.

**Link an existing claim** searches existing names/statements/aliases and requires
an explicit claim choice plus **Link claim to concept**. It adds only the selected
stable reference through the existing revision-checked concept save. Notes,
positions and all canonical records stay unchanged. It never links by name alone.
Imported concept notes/map lines are not automatically promoted to formal claims.
An empty Library has an honest empty state and a **Start a derivation lesson**
action; this slice does not seed or synthesize canonical mathematical data.

**Learn this step** carries a new optional `derivation` field in the existing
Atlas learning context: linked root claim, selected target claim and optional
argument ID. Before chat creation the server verifies that the root belongs to
the concept and the target/argument is reachable in the same bounded canonical
slice. The learning marker contains the exact selected argument and every one of
its premises, with joint conjunction semantics; unrelated concept claims are not
substituted. Previous practice picks are cleared/ignored for a derivation target.
Normal context attachment now reads canonical merged node/argument
records rather than raw append lines. Native history/model routing and explicit
lesson review are preserved. No automatic mastery or mathematical promotion.

No new schema, database, endpoint, package or provider call was added. The optional
context field uses existing JSON session-context storage; older contexts retain
their shape. This is navigation and targeted teaching, **not** the complete
reviewed lesson-to-canonical-proposition/argument synchronization workflow.

Focused validation covers joint-premise projection, alternative arguments, cycles,
missing references, whole-argument limits, canonical target validation, exact
learning-marker context, rejected stale sessions, empty states and revision-checked
reference linking without overwriting notes. No live model call or owner-data
seeding is part of verification. Interactive Canvas/real mathematical workflow
sign-off remains a separate gate.


## Shared derivation space (31 October)

The primary linked-claim dropdown is replaced by one shared canonical map. Entry
concepts prioritize their complete backward slice, then adjoining arguments and
other recorded proof families fill the bounded space (150 claims / 80 arguments).
Exact canonical IDs appear once, even when used by several lessons or conclusions.
Similar names or use of a similar technique never merge identities or create
inference arrows. Missing references and whole arguments beyond the limits remain
omitted with an explicit truncation message.

The shared map places terminal results on an inner ring, with earlier premises
progressively farther out. Each result has an angular petal with a quiet colour.
Shared prerequisites retain one canonical position in a single assigned petal, and
joint-premise junctions remain explicit in the edge geometry. The existing D3
engine resolves label spacing around these radial targets. Colours distinguish
visual petals, not mathematical subjects, truth or mastery.
Selecting a claim highlights its backward arguments while neighbours remain dimly
visible. Background click / Show all clears the highlight. Focus changes do not
rebuild the renderer, reset the camera, save placements or call an agent. Fit map
frames the shared space. Sources and the accessible claim list remain disclosed.

Precise Learn this step targets retain the existing server validation: a claim
outside the entry concept’s linked backward slices can be inspected but is not
silently attached to that concept or dispatched as an invalid learning target.
Explicit Link an existing claim remains available. Claim/argument identity and
learning-target validation have not changed.

Lesson-review Derivations also draws all proposed claims and inference arguments
in one map. Result buttons focus the appropriate Start/Finish and editable proof;
shared draft keys appear once. Gaps stay in the explanation panel, never inference
arrows. Unapproved drafts remain isolated from canonical records; visual co-location
never commits or merges them. Source lesson files, approval receipts and provenance
are retained. No schema migration, new endpoint, ledger writes or model calls.

Focused tests cover common prerequisites, separate same-name claims, disconnected
families, deterministic non-overlapping regions, complete-argument limits, safe
learning navigation and multi-proof lesson review including gaps. Browser/pen and
large-library performance sign-off remain separate from these checks.


### Organic map and junction repair

Shared proof families settle deterministically with the upstream force engine
and label collision spacing. The earlier free-force/shelf layout is superseded
by the result-centred flower described below. The main Atlas and
legacy ranked-layout helper remain unchanged. Soft component tints and thin edges
follow the upstream visual style; the shared map opens without dimming neighbours.
Selecting a result uses subtle focus rather than enlarged dots and heavy strokes.

A renderer bug previously repainted invisible `arg_` conjunction junctions as
unlabelled dots during highlighting. Both normal and subtle highlight passes now
exclude them from node discs. Junction edges and all joint premises remain intact;
no canonical nodes, arguments or empty-looking records are deleted. Regression
checks exercise the renderer draw pass to ensure highlights never resurrect these
discs and subtle focus retains the configured thin line width.


### Result-centred flower

Terminal claims (recorded conclusions with no outgoing inference) sit near the
centre. Reverse inference depth, using the existing SCC-safe depth helper, places
prerequisites on successively outer rings; junctions still count as inference
geometry. Each result traces its ancestors into a petal, and shared ancestors keep
one assigned petal. Sectors are proportional to their visible claim counts,
with a minimum width and an explicit gutter between neighbouring slices. A bounded force settle resolves label collisions
around these anchors, then radial and angular projection preserve depth and keep every member inside
its assigned slice. Layer ordering follows inner neighbours to reduce crossings.

Disconnected claims with no recorded inference sit on the outer rim. Cyclic
components without a terminal result use a deterministic visual anchor; it does
not designate a new theorem or certify the cycle as proof. No edges, identities,
source records or Atlas positions change. Selection continues to highlight an
argument without moving its nodes. The reference contains more proof families
than the current Library; no synthetic branches are added to imitate its density.


### Bounded slices and carried-premise links

The previous circular-mean placement let shared nodes spill between petals and
created long diagonal fans. Sectors now have hard angular boundaries, use direct
node counts instead of square-root weighting, and order each outer layer by its
inner neighbours. Shared nodes retain a single identity and assigned slice.
Cross-slice references are quiet in the overview and brighten when their argument
is selected. All premise links restores full-strength links.

The default compact diagram folds a repeated premise chord when that same
premise already reaches another premise through earlier recorded steps. This is
explicit presentation compression, **not logical transitive reduction**: scope,
learning targets and the ledger retain every joint premise. Cyclic reachability
never justifies folding mutually dependent premises. Junctions remain junctions
even with one visible input. A labelled All premise links control restores the
complete diagram; complete joint sets remain in the step panel. Restoring links
uses the same compact-layout coordinates.

Read-only inspection of the owner's three examples found repeated setup/context
premises in the PDE, hedge and tower-property arguments. On the captured 44-claim,
23-argument Library, the compact projection folds 16 of 73 displayed segments:
five repeated premise links into Remaining-accrual backward equation, two into
Intermediate-time conditional payoff identity, and one into Matched spot hedge
quantities, plus repeated links in earlier steps/other results. These counts are
snapshot-specific. No mathematical premise, canonical record or source receipt
was removed or certified as unnecessary.
