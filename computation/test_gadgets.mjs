#!/usr/bin/env node
/**
 * Checks the gadget library of computation/circuit.mjs one gadget at a time: each gadget
 * gets its arms run straight to the edge of a square sheet, and for every combination of
 * input values the local solver must find the expected outputs. With a Flat-Folder
 * checkout, every configuration is also checked for a global layer order.
 *
 * The paper's intersector (wire crossing) is the one gadget the local rules do not settle:
 * when wire P is TRUE they allow a second configuration with the wrong output, which only
 * the layer order rules out (the paper proves it in its lemma on the "problematic intersector
 * configuration"; Flat-Folder confirms it here). The adders do
 * not need it: a network of triangle twists is a piece of the honeycomb and never crosses
 * itself.
 *
 * Usage: node computation/test_gadgets.mjs [path/to/flat-folder]
 */
import path from "path";
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";
import { Circuit, rect } from "./circuit.mjs";
import { solvedPattern } from "./tikz.mjs";

const require = createRequire(import.meta.url);
const CL = require("../js/creaseLogic.js");
const here = path.dirname(fileURLToPath(import.meta.url));
let countStates = null;
if (process.argv[2]){
    const { loadFlatFolder } = await import(pathToFileURL(path.join(here, "flatfolder_check.mjs")).href);
    countStates = await loadFlatFolder(process.argv[2]);
}

const not = v => !v;
const CASES = [
    {type: "nor", inputs: {150: "A", 30: "B"}, outputs: {270: ["out", v => !(v.A || v.B)]}},
    {type: "nand", inputs: {150: "A", 30: "B"}, outputs: {270: ["out", v => !(v.A && v.B)]}},
    {type: "or", inputs: {150: "A", 30: "B"}, outputs: {270: ["out", v => v.A || v.B]}},
    {type: "and", inputs: {150: "A", 30: "B"}, outputs: {270: ["out", v => v.A && v.B]}},
    //a bare twist copies its input to the other two arms, negated
    {type: "twist", inputs: {150: "A"}, outputs: {30: ["o30", v => not(v.A)], 270: ["o270", v => not(v.A)]}},
    {type: "twist", rot: 60, inputs: {90: "A"}, outputs: {210: ["o210", v => not(v.A)], 330: ["o330", v => not(v.A)]}},
    {type: "hex", inputs: {90: "A"}, outputs: Object.fromEntries([30, 150, 210, 270, 330].map(d => [d, [`o${d}`, v => not(v.A)]]))},
    {type: "eater", inputs: {30: "A", 150: "B", 270: "C"}, outputs: {}},
    {type: "intersector", inputs: {210: "P", 270: "Q"}, outputs: {30: ["P'", v => v.P], 90: ["Q'", v => v.Q]}, needsLayerOrder: true},
];

let failures = 0;
for (const c of CASES){
    const circuit = new Circuit(c.type);
    const g = circuit.add(c.type, [0, 0], c.rot || 0, c.type);
    for (const [dir, name] of Object.entries(c.inputs)) circuit.toEdge(g, +dir, "input", name);
    for (const [dir, [name]] of Object.entries(c.outputs)) circuit.toEdge(g, +dir, "output", name);
    const fold = circuit.build(rect(-6, -6, 6, 6));
    const problem = CL.buildProblem(fold);
    const {wires} = CL.resolveWires(problem, fold["computation:wires"], 1e-6);
    const ins = wires.filter(w => w.role === "input");
    const fns = Object.fromEntries(Object.values(c.outputs));
    console.log(`\n${c.type}${c.rot ? ` (rotated ${c.rot})` : ""}: ${problem.variables.length} optional creases`);
    for (let bits = 0; bits < (1 << ins.length); bits++){
        const vals = {};
        ins.forEach((w, i) => vals[w.name] = !!(bits & (1 << (ins.length - 1 - i))));
        const r = CL.solve(problem, CL.pinsForInputs(ins, vals), {maxSolutions: 8});
        const configs = r.solutions.map(s => {
            const outs = Object.entries(fns).map(([name, fn]) => {
                const v = CL.wireValue(s, wires.find(w => w.name === name));
                return {name, v, ok: v === fn(vals)};
            });
            const states = countStates ? countStates(solvedPattern(fold, s)).states : null;
            return {outs, states};
        });
        //every configuration that really folds flat must be right, and exactly one must exist
        const flat = configs.filter(cf => cf.states === null || cf.states > 0n);
        let ok = flat.length === 1 && flat[0].outs.every(o => o.ok);
        if (!c.needsLayerOrder) ok = ok && configs.length === 1;
        else if (!countStates) ok = configs.some(cf => cf.outs.every(o => o.ok));
        if (!ok) failures++;
        const text = configs.map(cf => `[${cf.outs.map(o => `${o.name}=${o.v ? "T" : "F"}${o.ok ? "" : "!"}`).join(" ") || "-"}` +
            `${cf.states === null ? "" : ` | layer orders ${cf.states}`}]`).join(" ");
        console.log(`  ${ins.map(w => `${w.name}=${vals[w.name] ? "T" : "F"}`).join(" ")} -> ${configs.length} local configuration(s) ${text} ${ok ? "ok" : "FAIL"}`);
    }
}
console.log(failures ? `\n${failures} problem(s)` : "\nAll gadgets behave as expected.");
process.exit(failures ? 1 : 0);
