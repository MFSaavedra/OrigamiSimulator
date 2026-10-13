#!/usr/bin/env node
/**
 * Checks the gate examples in assets/Computation/:
 *  1. For every input combination, CreaseLogic decides the optional creases and the
 *     output wire must match the gate's truth table.
 *  2. Optionally (pass the path to a Flat-Folder checkout), every solved crease
 *     pattern is handed to Flat-Folder, which searches for a global layer order:
 *     a state count above zero means the configuration really folds flat without the
 *     paper passing through itself.
 *
 * Usage: node computation/verify_gadgets.mjs [path/to/flat-folder]
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";
import { solvedPattern } from "./tikz.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CL = require("../js/creaseLogic.js");
const assets = path.join(here, "..", "assets", "Computation");
const flatFolderDir = process.argv[2];

let flatFolder = null;
if (flatFolderDir){
    const { loadFlatFolder } = await import(pathToFileURL(path.join(here, "flatfolder_check.mjs")).href);
    const countStates = await loadFlatFolder(flatFolderDir);
    flatFolder = async (fold) => {
        try {
            const r = countStates(fold);
            return {states: r.states.toString(), error: r.error};
        } catch (e){
            return {states: "error", error: e.message};
        }
    };
}

const files = fs.readdirSync(assets).filter(f => f.endsWith(".fold")).sort();
let failures = 0;
for (const file of files){
    const fold = JSON.parse(fs.readFileSync(path.join(assets, file), "utf8"));
    const problem = CL.buildProblem(fold);
    const {wires, unmatched} = CL.resolveWires(problem, fold["computation:wires"], 1e-6);
    console.log(`\n${fold.file_title}  [${file}]`);
    console.log(`  ${problem.variables.length} optional creases, ${problem.constraints.length} constrained vertices`);
    if (unmatched.length){ console.log(`  unmatched wire probes: ${unmatched.join(", ")}`); failures++; continue; }
    if (problem.infeasibleVertices.length){ console.log(`  infeasible vertices: ${problem.infeasibleVertices}`); failures++; continue; }
    const output = wires.find(w => w.role === "output");
    for (const row of fold["computation:expected"]){
        const pins = CL.pinsForInputs(wires, row.inputs);
        const result = CL.solve(problem, pins, {maxSolutions: 64});
        const values = result.solutions.map(s => CL.wireValue(s, output));
        const distinct = [...new Set(values)];
        const ok = result.status === "ok" && distinct.length === 1 && distinct[0] === row.output;
        if (!ok) failures++;
        const inputs = Object.entries(row.inputs).map(([k, v]) => `${k}=${v ? "T" : "F"}`).join(" ");
        let line = `  ${inputs} -> ${output.name} = ${distinct.map(v => v === null ? "?" : (v ? "T" : "F")).join("/")}` +
            ` (expected ${row.output ? "T" : "F"}) ${ok ? "ok" : "MISMATCH"}` +
            ` | ${result.solutions.length}${result.truncated ? "+" : ""} configuration(s),` +
            ` ${result.forced}/${result.variables} creases decided by propagation, ${result.nodes} search nodes`;
        if (flatFolder){
            const counts = [];
            for (const s of result.solutions){
                const r = await flatFolder(solvedPattern(fold, s));
                counts.push(r.states);
            }
            const flat = counts.filter(c => c !== "0" && c !== "error").length;
            line += ` | Flat-Folder: ${flat}/${counts.length} fold flat (layer orders: ${counts.join(",")})`;
            if (flat < counts.length){ failures++; line += " NOT ALL FOLD FLAT"; }
        }
        console.log(line);
    }
}
console.log(failures ? `\n${failures} problem(s) found` : "\nAll gates behave as expected.");
process.exit(failures ? 1 : 0);
