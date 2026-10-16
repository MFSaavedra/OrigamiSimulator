#!/usr/bin/env node
/**
 * Builds the adder examples from their honeycomb layouts (computation/layouts/, found by
 * computation/honeycomb_search.py):
 *   full_adder  one-bit full adder: S = A xor B xor Cin, Cout = majority(A, B, Cin)
 *   adder_2bit  two copies chained into a ripple-carry adder: (A1A0) + (B1B0) + Cin
 *
 * Every node of a layout becomes a Hull–Zakharevich gadget: a bare triangle twist
 * (fan-out with negation) or one of the paper's gates, rotated so that its output is on
 * the chosen arm. Neighboring gadgets are joined by straight pleats, and loose arms run to
 * the edge of a sheet that hugs the network. Writes assets/Computation/<name>.fold and
 * .svg, plus plain solved patterns in assets/Computation/solved/ (every input row for the
 * one-bit adder, two sample sums for the two-bit adder).
 *
 * Usage: node computation/generate_adder.mjs [outputDir]
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { fromLayout } from "./circuit.mjs";
import { toSvg, solvedPattern } from "./tikz.mjs";

const require = createRequire(import.meta.url);
const CL = require("../js/creaseLogic.js");
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] || path.join(here, "..", "assets", "Computation");
const solvedDir = path.join(outDir, "solved");
fs.mkdirSync(solvedDir, {recursive: true});

const ADDERS = [
    {file: "full_adder", bits: 1, title: "Full adder (Hull–Zakharevich gadgets)", solved: "all"},
    {file: "adder_2bit", bits: 2, title: "2-bit adder (Hull–Zakharevich gadgets)", solved: [[3, 1, 0], [2, 3, 1]]},
];

/** Truth table of an n-bit ripple-carry adder with the layout's input and output names. */
function adderRows(bits){
    const one = bits === 1;
    const rows = [];
    for (let A = 0; A < (1 << bits); A++) for (let B = 0; B < (1 << bits); B++) for (let Cin = 0; Cin < 2; Cin++){
        const sum = A + B + Cin;
        const inputs = {Cin: !!Cin}, outputs = {Cout: !!(sum >> bits & 1)};
        for (let k = 0; k < bits; k++){
            inputs[one ? "A" : `A${k}`] = !!(A >> k & 1);
            inputs[one ? "B" : `B${k}`] = !!(B >> k & 1);
            outputs[one ? "S" : `S${k}`] = !!(sum >> k & 1);
        }
        rows.push({inputs, outputs, A, B, Cin, sum});
    }
    return rows;
}

const letter = v => v ? "T" : "F";
for (const spec of ADDERS){
    const layout = JSON.parse(fs.readFileSync(path.join(here, "layouts", spec.file + ".json"), "utf8"));
    const rows = adderRows(spec.bits);
    const circuit = fromLayout(layout, spec.title);
    const what = spec.bits === 1 ?
        "One-bit full adder: S = A xor B xor Cin, Cout = majority(A, B, Cin)." :
        `${spec.bits}-bit ripple-carry adder: (A${spec.bits-1}..A0) + (B${spec.bits-1}..B0) + Cin = (Cout S${spec.bits-1}..S0), ` +
        "made of one-bit full adders whose Cout feeds the next Cin through a straight pleat.";
    const fold = circuit.build(circuit.boundary, {
        description: what + " A honeycomb of triangle twists from Hull & Zakharevich (arXiv:2309.07932), where some " +
            "twists carry the control folds of the paper's NOR, NAND, OR and AND gates. Layout found by " +
            "computation/honeycomb_search.py.",
        expected: rows.map(({inputs, outputs}) => ({inputs, outputs})),
    });
    fs.writeFileSync(path.join(outDir, spec.file + ".fold"), JSON.stringify(fold, null, 1));
    fs.writeFileSync(path.join(outDir, spec.file + ".svg"), toSvg(fold));
    const counts = {};
    for (const n of layout.nodes) counts[n.gadget] = (counts[n.gadget] || 0) + 1;
    console.log(`${spec.file}: ${layout.nodes.length} gadgets (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}), ` +
        `${fold.vertices_coords.length} vertices, ${fold.edges_vertices.length} edges ` +
        `(${fold.edges_optional.filter(Boolean).length} optional), ${fold.faces_vertices.length} faces`);

    const problem = CL.buildProblem(fold);
    const {wires, unmatched} = CL.resolveWires(problem, fold["computation:wires"], 1e-6);
    if (unmatched.length) throw new Error(`${spec.file}: unmatched wire probes: ${unmatched}`);
    const chosen = spec.solved === "all" ? rows :
        spec.solved.map(([A, B, Cin]) => rows.find(r => r.A === A && r.B === B && r.Cin === Cin));
    for (const row of chosen){
        const result = CL.solve(problem, CL.pinsForInputs(wires, row.inputs), {maxSolutions: 2});
        if (result.solutions.length !== 1) throw new Error(`${spec.file}: expected a unique configuration`);
        const s = result.solutions[0];
        for (const [name, want] of Object.entries(row.outputs)){
            if (CL.wireValue(s, wires.find(w => w.name === name)) !== want){
                throw new Error(`${spec.file}: ${name} is wrong for ${JSON.stringify(row.inputs)}`);
            }
        }
        let tag, title;
        if (spec.bits === 1){
            tag = letter(row.A) + letter(row.B) + letter(row.Cin);
            title = `Full adder, A=${letter(row.A)} B=${letter(row.B)} Cin=${letter(row.Cin)} ` +
                `(S=${letter(row.outputs.S)} Cout=${letter(row.outputs.Cout)})`;
        } else {
            tag = `${row.A}_${row.B}_${row.Cin}`;
            title = `${spec.bits}-bit adder, ${row.A} + ${row.B} + ${row.Cin} = ${row.sum}`;
        }
        const plain = solvedPattern(fold, s, {title, description: `Solved: only the creases that fold for these inputs. ${what}`});
        fs.writeFileSync(path.join(solvedDir, `${spec.file}_${tag}.fold`), JSON.stringify(plain, null, 1));
        fs.writeFileSync(path.join(solvedDir, `${spec.file}_${tag}.svg`), toSvg(plain));
    }
    console.log(`  ${chosen.length} solved pattern(s) in ${path.relative(process.cwd(), solvedDir) || solvedDir}`);
}
