#!/usr/bin/env node
/**
 * Generates the logic-gate examples in assets/Computation/ from the TikZ source of
 * Thomas C. Hull and Inna Zakharevich, "Flat origami is Turing complete"
 * (arXiv:2309.07932, figures "NOR gate", "NAND gate", "OR gate", "AND gate", "NOT gate").
 * The \draw commands below are copied verbatim from the paper's LaTeX source.
 *
 * Besides the gate patterns (with optional creases, for computation mode), it writes
 * solved/<gate>_<inputs>.svg and .fold for every input combination: plain crease
 * patterns with only the creases that fold, which the unmodified Origami Simulator
 * (origamisimulator.org) and Flat-Folder can open directly.
 *
 * Usage: node computation/generate_gadgets.mjs [outputDir]
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { parseCreases, buildArrangement, toFold, toSvg, solvedPattern } from "./tikz.mjs";

const require = createRequire(import.meta.url);
const CL = require("../js/creaseLogic.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] || path.join(here, "..", "assets", "Computation");

// The six optional valley lines of the central twist, shared by all two-input gates.
const TWIST_VALLEYS = String.raw`
\draw[valley_opt] (30:1) -- +(0,-4)
                  (30:1) -- +(150:4)
                  (150:1) -- +(30:4)
                  (150:1) -- +(0,-4)
                  (0,-1) -- +(30:4)
                  (0,-1) -- +(150:4);`;

const TRIANGLE_TWIST_MOUNTAINS = String.raw`
\draw[mountain] (30:1) -- (30:3.5)
                (150:1) -- (150:3.5)
                (0,-1) -- (0,-3.5)
                (30:1) -- (150:1) -- (0,-1) -- cycle;`;

const STAR_MOUNTAINS = String.raw`
\draw[mountain] (30:0) -- (30:3.5)
                (150:0) -- (150:3.5)
                (0,0) -- (0,-3.5);`;

const NOR_TIKZ = TRIANGLE_TWIST_MOUNTAINS + TWIST_VALLEYS + String.raw`
\draw[valley_opt] (0,0) -- (30:1)
                  (0,0) -- (150:1)
                  (0,0) -- (0,-1)
                  (60:{sqrt(3)/3}) -- (0,1)
                  (0,0) -- (120:{sqrt(3)/3})
                  (0,0) -- (-120:{sqrt(3)/3})
                  (-{sqrt(3)/3},0) -- (-150:1);
\draw[mountain_opt] (120:{sqrt(3)/3}) -- (0,1)
                    (0,0) -- (60:{sqrt(3)/3})
                    (0,0) -- ({-sqrt(3)/3},0)
                    (-150:1) -- (-120:{sqrt(3)/3})
                    ;`;

const NAND_TIKZ = TRIANGLE_TWIST_MOUNTAINS + TWIST_VALLEYS + String.raw`
\draw[valley_opt] (0,0) -- (30:1)
                  (0,0) -- (150:1)
                  (0,0) -- (0,-1)
                  (120:{sqrt(3)/3}) -- (0,1)
                  (0,0) -- (60:{sqrt(3)/3})
                  (0,0) -- (-60:{sqrt(3)/3})
                  ({sqrt(3)/3},0) -- (-30:1);
\draw[mountain_opt] (60:{sqrt(3)/3}) -- (0,1)
                    (0,0) -- (120:{sqrt(3)/3})
                    (0,0) -- ({sqrt(3)/3},0)
                    (-30:1) -- (-60:{sqrt(3)/3})
                    ;`;

const OR_TIKZ = STAR_MOUNTAINS + TWIST_VALLEYS + String.raw`
\draw [valley_opt] (0,0) -- (0,1)
                   (0,0) -- (-30:1)
                   (30:0.5) -- (-30:1)
                   (30:2) -- (-30:1)
                   (0,0) -- (-150:1);
\draw[mountain_opt] (150:1) -- (-150:1)
                    (30:1) -- (-30:1)
                    (30:0.5) -- (0,1)
                    (30:2) -- (0,1)
                    (-30:1) -- (0,-1);`;

const AND_TIKZ = STAR_MOUNTAINS + TWIST_VALLEYS + String.raw`
\draw [valley_opt] (0,0) -- (0,1)
                   (0,0) -- (-30:1)
                   (150:0.5) -- (-150:1)
                   (150:2) -- (-150:1)
                   (0,0) -- (-150:1);
\draw[mountain_opt] (30:1) -- (-30:1)
                    (-150:1) -- (0,-1)
                    (-150:1) -- (150:1)
                    (150:0.5) -- (0,1)
                    (150:2) -- (0,1);`;

const NOT_TIKZ = String.raw`
  \draw [mountain] (0,1) -- (0,3) (0,-1) -- (0,-3);
  \draw [mountain] (-3,.5) -- (-.5,.5) (-.5,-.5) -- (-3,-.5) (3,.5) -- (.5,.5) (.5,-.5) -- (3,.-.5);
  \draw [mountain] (0,1) -- (-.5,.5) -- (-.5,-.5) -- (0,-1) -- (.5,-.5) -- (.5,.5) -- cycle;
  \draw [valley] (-3,1) -- (-1,1) (1,1) -- (3,1) (-3,-1) -- (-1,-1) (1,-1) -- (3,-1);
  \draw [valley_opt] (1,3) -- (1,1) (1,-1) -- (1,-3) (-1,3) -- (-1,1) (-1,-1) -- (-1,-3) (-1,1) -- (1,1) (-1,-1) -- (1,-1);
  \draw [valley_opt] (.5,.5) -- (1.5,-.5) (.5,-.5) -- (1.5,.5) (-.5,.5) -- (-1.5,-.5) (-.5,-.5) -- (-1.5,.5);
  \draw [valley_opt] (.5,.5) -- (1,1) (.5,-.5) -- (1,-1) (-.5,.5) -- (-1,1) (-.5,-.5) -- (-1,-1);
  \draw [mountain_opt] (1,1) -- (1.5,.5) (1,-1) -- (1.5,-.5) (-1,1) -- (-1.5,.5) (-1,-1) -- (-1.5,-.5);`;

const polar = (deg, r) => [r*Math.cos(deg*Math.PI/180), r*Math.sin(deg*Math.PI/180)];
const along = (p, deg, t) => { const d = polar(deg, t); return [p[0]+d[0], p[1]+d[1]]; };

// Paper boundary for the two-input gates: a regular hexagon whose sides facing 30, 150
// and 270 degrees cut the three wires perpendicularly at distance 3.5 from the center,
// where the paper's figure ends them.
const C30 = Math.cos(Math.PI/6);
const HEXAGON = [0, 60, 120, 180, 240, 300].map(a => polar(a, 3.5/C30));

// Wire values follow the paper's convention (its proofs fix which valley means TRUE):
// a wire is TRUE when the valley on the side opposite its TRUE label is active.
const Xp = polar(30, 1), Yp = polar(150, 1), B0 = [0, -1];
const TWO_INPUT_WIRES = [
    {name: "A", role: "input", true: [along(Xp, 150, 2.5)], false: [along(B0, 150, 2.5)]},
    {name: "B", role: "input", true: [along(B0, 30, 2.5)], false: [along(Yp, 30, 2.5)]},
];
const outputWire = name => ({name, role: "output", true: [[C30, -2]], false: [[-C30, -2]]});

const truthTable = (fn) => [[false, false], [false, true], [true, false], [true, true]]
    .map(([a, b]) => ({inputs: {A: a, B: b}, output: fn(a, b)}));

const GADGETS = [
    {
        file: "nor",
        title: "NOR gate (Hull–Zakharevich)",
        description: "Flat-origami NOR gate from Hull & Zakharevich, Flat origami is Turing complete (arXiv:2309.07932), Figure 4. Inputs A (upper left) and B (upper right) flow toward the central triangle twist; the output wire leaves downward.",
        tikz: NOR_TIKZ,
        boundary: HEXAGON,
        wires: [...TWO_INPUT_WIRES, outputWire("A NOR B")],
        expected: truthTable((a, b) => !(a || b)),
    },
    {
        file: "nand",
        title: "NAND gate (Hull–Zakharevich)",
        description: "Flat-origami NAND gate from Hull & Zakharevich (arXiv:2309.07932), Figure 5: the mirror image of the NOR gate.",
        tikz: NAND_TIKZ,
        boundary: HEXAGON,
        wires: [...TWO_INPUT_WIRES, outputWire("A NAND B")],
        expected: truthTable((a, b) => !(a && b)),
    },
    {
        file: "or",
        title: "OR gate (Hull–Zakharevich)",
        description: "Flat-origami OR gate from Hull & Zakharevich (arXiv:2309.07932), Figure 7.",
        tikz: OR_TIKZ,
        boundary: HEXAGON,
        wires: [...TWO_INPUT_WIRES, outputWire("A OR B")],
        expected: truthTable((a, b) => a || b),
    },
    {
        file: "and",
        title: "AND gate (Hull–Zakharevich)",
        description: "Flat-origami AND gate from Hull & Zakharevich (arXiv:2309.07932), Figure 8: the mirror image of the OR gate.",
        tikz: AND_TIKZ,
        boundary: HEXAGON,
        wires: [...TWO_INPUT_WIRES, outputWire("A AND B")],
        expected: truthTable((a, b) => a && b),
    },
    {
        file: "not",
        title: "NOT gate (Hull–Zakharevich)",
        description: "Flat-origami NOT gate from Hull & Zakharevich (arXiv:2309.07932), Figure 9. The horizontal pleats are the auxiliary pleat the gate needs.",
        tikz: NOT_TIKZ,
        boundary: [[-3, -3], [3, -3], [3, 3], [-3, 3]],
        wires: [
            {name: "A", role: "input", true: [[1, 2]], false: [[-1, 2]]},
            {name: "NOT A", role: "output", true: [[1, -2]], false: [[-1, -2]]},
        ],
        expected: [false, true].map(a => ({inputs: {A: a}, output: !a})),
    },
];

const solvedDir = path.join(outDir, "solved");
fs.mkdirSync(solvedDir, {recursive: true});
const letter = v => v ? "T" : "F";
for (const g of GADGETS){
    const pieces = parseCreases(g.tikz);
    const arrangement = buildArrangement(pieces, g.boundary);
    const fold = toFold(arrangement, g);
    fs.writeFileSync(path.join(outDir, g.file + ".fold"), JSON.stringify(fold, null, 1));
    fs.writeFileSync(path.join(outDir, g.file + ".svg"), toSvg(fold));
    const optional = fold.edges_optional.filter(Boolean).length;
    console.log(`${g.file}: ${pieces.length} TikZ segments -> ${fold.vertices_coords.length} vertices, ` +
        `${fold.edges_vertices.length} edges (${optional} optional), ${fold.faces_vertices.length} faces`);

    //one plain, already-decided pattern per input combination
    const problem = CL.buildProblem(fold);
    const {wires} = CL.resolveWires(problem, fold["computation:wires"], 1e-6);
    const output = wires.find(w => w.role === "output");
    for (const row of g.expected){
        const result = CL.solve(problem, CL.pinsForInputs(wires, row.inputs), {maxSolutions: 2});
        if (result.solutions.length !== 1) throw new Error(`${g.file}: expected a unique configuration`);
        const states = result.solutions[0];
        const value = CL.wireValue(states, output);
        const inputText = Object.entries(row.inputs).map(([k, v]) => `${k}=${letter(v)}`).join(", ");
        const name = `${g.file}_${Object.values(row.inputs).map(letter).join("")}`;
        const solved = solvedPattern(fold, states, {
            title: `${g.title}: ${inputText} -> ${output.name} = ${letter(value)}`,
            description: `Solved crease pattern (only the creases that fold) for ${inputText}; ` +
                `the output wire ${output.name} carries ${value ? "TRUE" : "FALSE"}. ` + g.description,
        });
        fs.writeFileSync(path.join(solvedDir, name + ".fold"), JSON.stringify(solved, null, 1));
        fs.writeFileSync(path.join(solvedDir, name + ".svg"), toSvg(solved));
    }
}
