# Focused concept and subject maps

31 October 2026; R01–R04, R08–R09, R14, R16.

Click an Atlas concept to open its own focused map. Subject-map buttons in Atlas
open a subject and its descendant subjects. The inspector retains an Open map
entry, and subject names inside a focused map navigate to those subject maps.
Clicking a local node inspects it; Open map drills into that concept. Back returns
to the previous scope, and Back to Atlas closes the temporary view. The original
Atlas camera and persisted positions are not rewritten by this navigation.

The pure `atlasNeighbourhood` projection uses stable concept identities and actual
ordinary drawing connections plus accepted typed relations. Concept scope contains
its immediate neighbours, with neighbours from other home subjects separated as
foundations. Subject scope includes memberships (also secondary memberships) and
descendants, plus directly connected external concepts. Missing/dangling nodes,
removed drawing overrides and nonaccepted typed relations are excluded. There are
no synthetic parent-to-child mathematical claims or inferred proof edges.

Maps display up to 120 primary concepts and 12 direct external references,
prioritizing external concepts with more links into the subject. Omitted counts are
shown. The full Atlas remains available; this is a bounded overview, not semantic
search, a lesson-progress classifier or an exhaustive cross-disciplinary query.
The local canvas reuses GraphCanvasRenderer and label-aware lesson layout, with
temporary positions and readable labels. Drag Atlas concepts or lesson topics to arrange the focused view. The lesson
springs let nearby points shift and settle. Positions survive lesson toggles
while the view is open. Region shading covers the selected Atlas concept, its immediate
Atlas neighbours and their Atlas links. Floating labels identify the selected
concept and each visible lesson, using the current chat title when available.
Lesson branches stay outside the shaded region.
Use the main Atlas controls to edit saved layout or links.

The sidebar links saved integrated lesson maps and their source conversations.
Explicit concept references and shared canonical proposition IDs both locate the
source lesson, so organizing an existing claim under another concept retains its
lesson access. Linked maps branch out from the selected concept. They start from
the lesson view’s family-aware layout and spread from both sides of the selected
concept. The lesson view’s repulsion and weak springs leave room for branches to
settle around it. Labels show saved questions and
formulas. Shared topics show details when their visible lessons agree. The sidebar
can hide or show any lesson. Exact, case-sensitive topic titles share one point
in this view, including a title that matches the selected concept. Shared topics
and links stay visible while any of their lessons are on. Solid lines show saved
teaching order. Dotted lines show associations and the temporary links to the
selected concept. Select a topic to highlight its source lessons in the sidebar.
The overlay and toggles are temporary. Each source map, equation and proof remains
available through its lesson. Derivations open the canonical argument browser. Notes and connection lists are
collapsed by default. No model or provider call occurs during navigation.

No storage schema or migration changes. Focus, inspection and navigation history
are temporary React state; subject membership, notes, concepts and ordinary links
continue through existing revision-checked Atlas commands. Owner-requested subject
organization can reuse canonical claim IDs without minting new propositions or
rewriting the source lesson/approval receipt. A concept may appear in several
subject views while retaining one global identity and preferred home.

Validation covers source-preserving scopes, descendants and actual boundary links,
removed links, missing roots, claim-based source-lesson lookup, and interactive
inspect → drill → back navigation without data writes. Existing Atlas UI checks,
typecheck and targeted lint are also run. No live model call is needed.
