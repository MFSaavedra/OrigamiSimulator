# CLAUDE.md

This repository is a fork of Amanda Ghassaei's Origami Simulator
(upstream: `amandaghassaei/OrigamiSimulator`) with a **computation mode**. Crease patterns
may contain optional creases, which can fold or stay flat, as in Hull and Zakharevich,
"Flat origami is Turing complete" (arXiv:2309.07932). The app works out which optional
creases must fold for the inputs chosen in a Computation panel, then simulates the result.
The examples are the paper's NOR, NAND, OR, AND and NOT gates, a one-bit full adder and a
two-bit ripple-carry adder.

User-facing documentation lives in `computation/README.md`. This file holds working notes.

## Layout

- `index.html`, `js/`, `css/`: the app. It is a static site with no build step: plain
  scripts and globals, jQuery, underscore, three.js r87.
- `js/creaseLogic.js`: the solver. It is a UMD module (`window.CreaseLogic` in the browser,
  `require` in Node). For each vertex it builds a table of locally flat-foldable states
  (Kawasaki plus crimp reduction, which covers Maekawa and Big-Little-Big), then runs arc
  consistency and backtracking. API: `buildProblem`, `solve`, `resolveWires`,
  `pinsForInputs`, `wireValue`, `applySolution`.
- `js/computation.js`: the Computation panel (inputs, outputs, truth table, solution
  browsing). It turns each imported pattern into a 2D FOLD with `edges_optional`, runs the
  solver, and gives the Pattern view its crease styles and wire labels. It is created in
  `js/main.js` as `globals.computation = initComputation(globals)`.
- `js/pattern.js`: the upstream file, with hooks added for the optional-crease SVG colors,
  `<metadata id="computation">`, the Pattern view styling and `setResolvedFold`, which
  takes the decided pattern back for simulation. It also resets `foldData` between imports,
  so FOLD fields such as `edges_optional` do not leak into the next pattern.
- `assets/Computation/`: the examples (`.fold` and `.svg`). `solved/` holds plain patterns
  for single input rows, in standard colors only, for the unmodified app.
- `computation/`: Node and Python tools (below). `computation/layouts/` holds the adder
  layouts produced by the search.

## Running

- Serve the repository root with `python3 -m http.server 8000` and open
  `http://localhost:8000/`.
- `?model=Computation/full_adder.fold` works only for files in the Examples menu, because
  `main.js` clicks the matching `.demo` element. Load other files with File > Import,
  or with `window.postMessage({op: 'importFold', fold}, '*')` or
  `{op: 'importSVG', svg, filename}`.

## Tests

Flat-Folder (https://github.com/origamimagiro/flat-folder) is the offline check of global
layer order. Clone it next to this repository:
`git clone https://github.com/origamimagiro/flat-folder ../flat-folder`.
`computation/flatfolder_check.mjs` runs its pipeline headlessly. The path argument is
optional: without it the Node scripts skip the layer-order checks. Everything was last run
with Node 22 and Python 3.13.

| command | checks | time |
|---|---|---|
| `node computation/test_solver.mjs ../flat-folder` | solver unit tests, and 1,500 random single vertices against Flat-Folder; ends with `1497/1497 agree` and `17 passed, 0 failed` | 1 min |
| `node computation/test_gadgets.mjs ../flat-folder` | each gadget of the circuit library on its own; ends with `All gadgets behave as expected.` | 1 s |
| `node computation/verify_gadgets.mjs ../flat-folder` | every example: truth table, one configuration per row, one Flat-Folder layer order per configuration; ends with `All examples behave as expected.` | 7 s |
| `python3 computation/browser_test.py [shots_dir]` | end to end in headless Chromium through Playwright, including SVG and FOLD imports and both adders; ends with `All browser checks passed.` | 4 min |

The browser test serves the repository itself on a free port and saves screenshots to
`computation/screenshots/` (ignored by git) unless given another directory. It needs
`pip install playwright` and a Chromium: run `python3 -m playwright install chromium`,
unless `PLAYWRIGHT_BROWSERS_PATH` already points at one (Claude Code cloud containers
provide `/opt/pw-browsers`; do not run `playwright install` there). It launches Chromium
with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` to get WebGL.
The app requests Lato and flat-ui font files that the repository has never contained; the
test ignores those 404s. Run all four after changing `js/creaseLogic.js`,
`js/computation.js`, `js/pattern.js` or anything in `computation/`.

## Regenerating assets

- `node computation/generate_gadgets.mjs` rebuilds the gates. The paper's TikZ `\draw`
  commands are copied verbatim into the script.
- `node computation/generate_adder.mjs` rebuilds the adders from `computation/layouts/`.
- Both write to `assets/Computation/` (or to the directory given as the first argument),
  including `solved/`, and reproduce the committed files byte for byte.
- `python3 computation/honeycomb_search.py full-adder > computation/layouts/full_adder.json`
  searches for the full adder layout. It needs `pip install ortools shapely` and logs each
  candidate to stderr. On two cores it finishes in under a minute and reproduces the
  committed layout byte for byte.
- `python3 computation/honeycomb_search.py chain 2 < computation/layouts/full_adder.json > computation/layouts/adder_2bit.json`
  chains two copies into the 2-bit adder.
- After changing a layout, run `generate_adder.mjs` and then the tests. `verify_gadgets.mjs`
  checks every `.fold` file in `assets/Computation/`, so it picks up new examples.

## Conventions

- Lattice points are `(k*sqrt(3)/2, m + k/2)`. Lattice lines run at 30, 90 and 150 degrees,
  `sqrt(3)/2` apart. A wire is three consecutive lattice lines: a mandatory mountain between
  two optional valleys. Its bit is which of the two valleys folds.
- TRUE means the valley on the left of the direction of travel folds. Rotations keep this
  reading, and `place` in `circuit.mjs` takes multiples of 60 degrees, which also keep the
  lattice. Mirroring swaps left and right and turns NOR into NAND, so gadgets are never
  mirrored.
- FOLD files carry `edges_optional` (a boolean per edge) and `"computation:wires"`:
  `[{name, role: "input"|"output", true: [[x, y], ...], false: [[x, y], ...]}]`. These
  are probe points on the two valley lines, which survive vertex merging and edge
  splitting. They also carry `"computation:expected"`, whose rows are `{inputs, output}`
  for gates and `{inputs, outputs}` for circuits. `toFold` in `tikz.mjs` flips y, so the
  paper's y-up figures read the right way up in the app.
- SVG files mark optional creases by stroke color: optional mountain `#ff8000`, optional
  valley `#00ffff`, either parity `#8000ff`. The wires are JSON inside
  `<metadata id="computation">`.
- Two angles count as equal within 1e-3 rad, to absorb the float noise of SVG imports.
- In `honeycomb_search.py`, each arm is read outward, as a signal leaving its node would
  see it. A bare twist then makes all three arms equal, and a wire makes its two ends
  opposite. The gate gadgets compute AND (`nor`), OR (`nand`), NAND (`or`) and NOR (`and`)
  of their two input arms. Requiring an acyclic flow makes each input row decide every
  wire.
- `circuit.mjs` snaps interior crease vertices with `snapToLattice`, which rounds the
  lattice coordinates k and m to multiples of 1/24. Without the snapping, float noise of
  about 1e-7 bends straight creases slightly and Flat-Folder fails with "Cannot read
  properties of undefined". Points on the paper's edge are not snapped. A new gadget must
  have its crease vertices on this lattice, or snapping will break it. The paper draws the
  intersector on a lattice whose lines run at 0, 60 and 120 degrees, so the library wraps
  it in `turned(90, ...)`.
- `chain_layout` shifts each copy of the full adder along the line leaving its Cout arm, so
  that one straight pleat carries the carry into the next copy's Cin.
- Gadget creases reach radius 2 (`GADGET_RADIUS = 2.01`), and arms of one gadget cross
  each other inside it by design. A loose arm's probes sit halfway between that radius and
  the paper's edge.
- The adders' sheets follow the network. `paper_outline` buffers the nodes and wires by 3
  units with shapely and fills holes, so loose arms reach the edge before they can cross.

## Known limits and gotchas

- The app checks only local (per-vertex) rules. Global layer order is checked offline with
  Flat-Folder, and every configuration in `assets/Computation` passes.
- The paper's intersector (its crossing of wires P and Q) is ambiguous under local rules.
  When P is TRUE they also allow a configuration in which P leaves FALSE, and only the
  layer order rules it out (`test_gadgets.mjs` prints both). The adders do not use it: a
  network of triangle twists is a piece of the honeycomb, so its wires never cross.
- CP-SAT is very slow when the search may place inputs and outputs anywhere (it returned
  UNKNOWN after minutes). Restrict roles to parts of the layout, as `full_adder_search`
  does. Keep the redundant gate-count constraint (gates = edges + inputs - nodes, in
  `solve_graph`): it makes the search much faster.
- Large patterns settle slowly under headless SwiftShader: a solved full adder takes about
  150 s to reach 0.0002% error. A real GPU should be much faster.
- The panel's truth table handles up to 6 inputs. It switches to 1 and 0 when it has more
  than 4 columns.
- When stopping a background job with `pkill -f`, write the pattern as `'[h]oneycomb_search'`.
  A plain pattern also matches the shell that runs `pkill` and kills it.

## Not done yet

- A tidier full adder, with the inputs on one side and the outputs on the other. In the
  current one A enters at the top, B on the upper left and Cin at the lower right, and S
  and Cout leave on the left.
- Longer adders. `honeycomb_search.py chain 4` has not been tried. A new adder also needs
  an entry in `ADDERS` in `generate_adder.mjs` and one in the Examples menu in
  `index.html`. A 4-bit adder has 9 inputs, so the panel would hide its truth-table button
  (`MAX_TRUTH_TABLE_INPUTS = 6` in `js/computation.js`).
- A global flat-foldability check in the app itself, for example by running Flat-Folder's
  solver on each local solution.
- The paper's Rule 110 cell (Figure 18, labeled `fig:ori110` in the LaTeX source at
  https://arxiv.org/e-print/2309.07932, whose `HZ.sty` defines the gadget macros). It is
  drawn at the gadget level, with labeled hexagons for the gates and 40 intersectors, so
  it is not a crease pattern yet. A honeycomb network like the adders' would avoid the
  intersectors; where wires must cross, three XORs make a planar crossover.

## Git

`origin` is the fork `MFSaavedra/OrigamiSimulator` and `upstream` is
`amandaghassaei/OrigamiSimulator`. The fork's `main` is upstream commit `903ef27` plus the
computation-mode commits. Push to `origin` only, never to `upstream`.
