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
fixed temporary positions, readable labels and no subject density glow. Local
navigation neither moves nor copies global concepts. Main Atlas dragging and link
editing remain available through Notes & edit / the existing Atlas controls.

The sidebar links saved integrated lesson maps and their source conversations.
Explicit concept references and shared canonical proposition IDs both locate the
source lesson, so organizing an existing claim under another concept retains its
lesson access. Derivations open the existing canonical argument browser; proofs
are not expanded into the conceptual Atlas. Notes and connection lists are
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
