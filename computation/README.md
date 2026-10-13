# Computation mode: crease patterns that compute

Hull and Zakharevich proved that flat origami is Turing complete
([arXiv:2309.07932](https://arxiv.org/abs/2309.07932)) using crease patterns with
**optional creases**: creases that may fold or stay flat. A wire is a pleat (a mandatory
mountain between two optional valleys) and its bit is which valley folds. Gadgets are
built so that Kawasaki's theorem, Maekawa's theorem and the Big-Little-Big lemma at
each vertex force the output valley once the input valleys are chosen.

Origami Simulator's physics cannot make that choice by itself: it needs every crease
labeled in advance, and it has no collision handling, so it never enforces the
non-self-intersection rules the gadgets rely on. This mode adds the missing discrete
step. When a pattern contains optional creases, a solver decides which of them must fold
for the chosen inputs, and the simulator then folds the decided pattern.

## Try it

Serve the repository and open it in a desktop browser:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/?model=Computation/nor.fold
```

or pick **Examples > Computation (logic gates)**. A **Computation** panel appears: toggle
the inputs, read the output, open the truth table, and switch to **Pattern** view to see
which optional creases were chosen (bold) and which stayed flat (dashed gray). Slide
**Fold Percent** to 100% to watch the decided pattern fold flat.

The `assets/Computation/solved/` folder has one plain crease pattern per input
combination (for example `nor_TF.svg` is the NOR gate with A = TRUE, B = FALSE). These
use only standard colors, so the unmodified app at
[origamisimulator.org](https://origamisimulator.org) and
[Flat-Folder](https://origamimagiro.github.io/flat-folder/) open them directly.

## How it works

`js/creaseLogic.js` (no dependencies, runs in the browser and in Node):

1. **Per-vertex tables.** For every interior vertex it enumerates the states of its
   incident optional creases (off, mountain, valley) and keeps those that fold flat
   locally: Kawasaki's theorem plus a valid mountain/valley assignment, checked by crimp
   reduction (which covers Maekawa and Big-Little-Big, including tied sector angles).
2. **Propagation.** Input wires pin some creases; generalized arc consistency over the
   vertex tables narrows every other crease. For all the included gates this alone
   decides every optional crease, so the gate evaluates like a circuit, with no search.
3. **Search.** If anything is left undecided, a small backtracking search enumerates the
   valid configurations (up to 64), which the panel lets you browse.

The decided pattern goes to the regular simulation: active optional creases become
mountains or valleys, inactive ones become flat facet creases.

Global layer ordering (paper not passing through itself across several vertices) is not
checked in the app. For the included gates it was verified offline with Flat-Folder:
every solved configuration has exactly one valid layer order.

## File format

**SVG.** Optional creases use three new stroke colors:

| crease | color |
|---|---|
| optional mountain | orange `#ff8000` |
| optional valley | cyan `#00ffff` |
| optional, either parity | purple `#8000ff` |

Wires are described by probe points lying on their optional creases, in a metadata
element with JSON:

```xml
<metadata id="computation">{"wires": [
  {"name": "A", "role": "input",  "true": [[129.7, 90]],  "false": [[95.1, 150]]},
  {"name": "A NOR B", "role": "output", "true": [[216.3, 240]], "false": [[147.0, 240]]}
]}</metadata>
```

A wire is TRUE when the creases under its `true` probes fold and those under its `false`
probes stay flat, and FALSE the other way around. Probes use the same coordinates as the
drawing, and they survive the importer's vertex merging and edge splitting.

**FOLD.** Optional creases keep their usual `edges_assignment` (`M`, `V`, or `U` for
either parity) and are flagged in an `edges_optional` boolean array. Wires go in
`"computation:wires"` with the same structure, in FOLD coordinates.

Angles within 1e-3 rad (about 0.06°) count as equal, which absorbs the float precision
of SVG imports. `CreaseLogic.buildProblem(fold, {angleTolerance})` takes a tighter value
for exact input.

## Scripts and tests

| command | what it does |
|---|---|
| `node computation/generate_gadgets.mjs` | rebuilds `assets/Computation/` from the gadgets' TikZ source in the paper (NOR, NAND, OR, AND, NOT) |
| `node computation/verify_gadgets.mjs [flat-folder]` | checks each gate's truth table with the solver; with a [Flat-Folder](https://github.com/origamimagiro/flat-folder) checkout, also checks that every solved configuration folds flat globally |
| `node computation/test_solver.mjs [flat-folder]` | solver unit tests; with Flat-Folder, cross-checks the single-vertex rule on 1,500 random vertices |
| `python3 computation/browser_test.py` | end-to-end test in headless Chromium (Playwright): flips every gate's inputs in the panel and checks the outputs, including the SVG import path |

Results at the time of writing:

| gate | configurations per input row | decided by propagation | Flat-Folder layer orders |
|---|---|---|---|
| NOR | 1 | 23 / 23 | 1 |
| NAND | 1 | 23 / 23 | 1 |
| OR | 1 | 19 / 19 | 1 |
| AND | 1 | 19 / 19 | 1 |
| NOT | 1 | 24 / 24 | 1 |

## Limits

- Only local (per-vertex) rules are enforced in the app; a pattern can pass them and
  still fail to fold flat globally. Use Flat-Folder (or `verify_gadgets.mjs`) when that
  matters.
- Vertices with very many optional creases are slow to tabulate (the table grows as
  3^k); the solver refuses vertices beyond about a million combinations.
- Intermediate fold percentages are still physics: layers can pass through each other,
  exactly as in the original app.
- The paper's full Rule 110 cell (its Figure 18) is a schematic of gadgets and wires, not
  a crease pattern, so it is not included; assembling it from the gadgets here would be
  the next step toward folding an actual cellular automaton step.
