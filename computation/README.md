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

or pick **Examples > Computation**. A **Computation** panel appears: toggle
the inputs, read the output, open the truth table, and switch to **Pattern** view to see
which optional creases were chosen (bold) and which stayed flat (dashed gray). Slide
**Fold Percent** to 100% to watch the decided pattern fold flat.

The `assets/Computation/solved/` folder has one plain crease pattern per input
combination (for example `nor_TF.svg` is the NOR gate with A = TRUE, B = FALSE, and
`full_adder_TFT.svg` is the full adder with A = TRUE, B = FALSE, Cin = TRUE), plus two
sums for the 2-bit adder (`adder_2bit_3_1_0.svg` is 3 + 1 + 0). These use only standard
colors, so the unmodified app at [origamisimulator.org](https://origamisimulator.org) and
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

## Adders

**Examples > Computation > Full Adder** computes the sum bit S = A xor B xor Cin and the
carry Cout = majority(A, B, Cin). **2-bit Adder** chains two of them, so that
(A1 A0) + (B1 B0) + Cin = (Cout S1 S0). Both are assembled from the paper's gadgets.

- **Only triangle twists.** The bare triangle twist is a fan-out: it copies its input to its
  other two arms, negated. The four gates are triangle twists with control folds. All
  have three arms 120 degrees apart and wires are straight pleats, so a network of them is
  a piece of the honeycomb lattice and no wire ever crosses another. That avoids the
  paper's crossing gadget (the intersector), which is the one gadget the local rules do not
  settle: when its first wire is TRUE they also allow a configuration with the wrong
  output, which only the global layer order rules out (`test_gadgets.mjs` shows it).
- **Reading values outward.** Read every arm as a signal leaving its twist would. Then a
  bare twist makes its three arms equal, a wire makes its two ends opposite, and the NOR,
  NAND, OR and AND gadgets compute AND, OR, NAND and NOR of their two inputs.
- **Search.** `honeycomb_search.py` places two flowers of three hexagons (each the size of
  a half adder) and one extra gate on the honeycomb, and asks the CP-SAT solver
  (OR-tools) to label every node (twist, or gate with its output arm and function) and
  every loose arm (input, output, or junk wire running off the paper). Requiring an
  acyclic flow of information makes every input row decide every wire.
- **Creases.** `generate_adder.mjs` (with `circuit.mjs`) places each gadget, rotated so its
  output is on the chosen arm, joins neighbors with pleats, and gives the sheet an outline
  that hugs the network, so loose arms leave through the nearby edge instead of running
  into each other.
- **Chaining.** The 2-bit adder is two copies of the full adder. The second is shifted along
  the line leaving the first one's Cout, so one long pleat carries the carry into Cin.
  `honeycomb_search.py chain N` builds longer ones the same way.

The inputs and outputs do not all sit on one side: in the full adder, A enters at the top,
B on the upper left and Cin at the lower right, and S and Cout leave on the left. The
Computation panel lists them by name, and the Pattern view prints each wire's value next
to it.

| circuit | gadgets | creases (optional) | input rows | configurations per row | decided by propagation | Flat-Folder layer orders |
|---|---|---|---|---|---|---|
| full adder | 27 (9 gates, 18 twists) | 612 (341) | 8 | 1 | 341 / 341 | 1 |
| 2-bit adder | 54 (18 gates, 36 twists) | 1211 (680) | 32 | 1 | 680 / 680 | 1 |

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
| `node computation/verify_gadgets.mjs [flat-folder]` | checks the truth table of every example (gates and adders) with the solver; with a [Flat-Folder](https://github.com/origamimagiro/flat-folder) checkout, also checks that every solved configuration folds flat globally |
| `node computation/test_solver.mjs [flat-folder]` | solver unit tests; with Flat-Folder, cross-checks the single-vertex rule on 1,500 random vertices |
| `node computation/generate_adder.mjs` | rebuilds the adders (`full_adder`, `adder_2bit`) and their solved patterns from `computation/layouts/` |
| `python3 computation/honeycomb_search.py full-adder` | searches a full adder layout (needs `pip install ortools shapely`); `chain 2 < full_adder.json` makes the 2-bit layout |
| `node computation/test_gadgets.mjs [flat-folder]` | checks each gadget of the circuit library on its own: gates, twists, the hexagonal twist, the eater, and the intersector |
| `python3 computation/browser_test.py` | end-to-end test in headless Chromium (Playwright): flips every gate's and adder's inputs in the panel and checks the outputs, including the SVG import path |

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
  a crease pattern, so it is not included. The honeycomb approach used for the adders is a
  natural way to assemble it.
- The adders' sheets are not rectangles: their outline follows the network so that loose
  arms do not have to cross on their way to the edge.
