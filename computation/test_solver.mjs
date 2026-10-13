#!/usr/bin/env node
/**
 * Tests for js/creaseLogic.js.
 *
 *   node computation/test_solver.mjs [path/to/flat-folder]
 *
 * Without the Flat-Folder path, runs the solver's own unit tests. With it, also
 * cross-checks the single-vertex rule against Flat-Folder on random vertices
 * (including many with tied sector angles, where crimp ordering is subtle).
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";
import { computeFaces } from "./tikz.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CL = require("../js/creaseLogic.js");
const M = CL.MOUNTAIN, V = CL.VALLEY;
const deg = d => d*Math.PI/180;

let passed = 0, failed = 0;
function check(name, cond){
    if (cond) passed++;
    else { failed++; console.log("FAIL:", name); }
}
const vertex = (spec) => spec.map(([a, mv]) => ({angle: deg(a), mv}));

// --- single-vertex rules ---
check("empty vertex is flat", CL.isVertexFlatFoldable([]));
check("straight valley line", CL.isVertexFlatFoldable(vertex([[0, V], [180, V]])));
check("straight line needs equal parity", !CL.isVertexFlatFoldable(vertex([[0, M], [180, V]])));
check("bent line violates Kawasaki", !CL.isVertexFlatFoldable(vertex([[0, V], [170, V]])));
check("odd degree", !CL.isVertexFlatFoldable(vertex([[0, V], [120, V], [240, V]])));
check("map fold 3-1", CL.isVertexFlatFoldable(vertex([[0, M], [90, V], [180, M], [270, M]])));
check("Maekawa 2-2 fails", !CL.isVertexFlatFoldable(vertex([[0, M], [90, V], [180, M], [270, V]])));
check("Maekawa 4-0 fails", !CL.isVertexFlatFoldable(vertex([[0, V], [90, V], [180, V], [270, V]])));
// Big-Little-Big: the 30 degree sector must be bounded by opposite creases
check("Hull-Zakharevich impossible vertex (BLB)",
    !CL.isVertexFlatFoldable(vertex([[60, M], [120, V], [150, V], [270, V]])));
check("BLB satisfied", CL.isVertexFlatFoldable(vertex([[30, V], [60, M], [120, V], [270, V]])));
// Bern-Hayes clause vertex: two equal small sectors bounded by three creases
const clause = [[0, null], [30, null], [60, null], [210, null]];
let clauseValid = 0;
for (let m=0;m<16;m++){
    const spec = clause.map(([a], i) => [a, (m >> i) & 1 ? V : M]);
    if (CL.isVertexFlatFoldable(vertex(spec))) clauseValid++;
}
check("clause vertex admits exactly 6 assignments", clauseValid === 6);

// --- solver on the NOR gate ---
const nor = JSON.parse(fs.readFileSync(path.join(here, "..", "assets", "Computation", "nor.fold"), "utf8"));
const problem = CL.buildProblem(nor);
const {wires} = CL.resolveWires(problem, nor["computation:wires"], 1e-6);
const [A, B, OUT] = wires;
const free = CL.solve(problem, [], {maxSolutions: 100});
check("free NOR has one configuration per input row", free.solutions.length === 4 && !free.truncated);
const rows = new Set(free.solutions.map(s => [A, B, OUT].map(w => CL.wireValue(s, w)).join(",")));
check("free NOR configurations realize its truth table",
    rows.size === 4 && rows.has("false,false,true") && rows.has("true,false,false") &&
    rows.has("false,true,false") && rows.has("true,true,false"));
const wrongOutput = CL.pinsForInputs(wires, {A: false, B: false}).concat([[OUT.trueEdges[0], CL.BIT[CL.OFF]]]);
check("forcing the wrong NOR output is a conflict", CL.solve(problem, wrongOutput).status === "conflict");
const backward = CL.solve(problem, CL.pinsForInputs([{...OUT, role: "input"}], {[OUT.name]: true}), {maxSolutions: 10});
check("output TRUE runs backward to A=B=FALSE",
    backward.solutions.length === 1 && CL.wireValue(backward.solutions[0], A) === false &&
    CL.wireValue(backward.solutions[0], B) === false);
const resolved = CL.applySolution(nor, CL.solve(problem, CL.pinsForInputs(wires, {A: true, B: false})).solutions[0]);
check("applySolution leaves only standard assignments",
    resolved.edges_assignment.every(a => ["B", "M", "V", "F"].includes(a)) && !("edges_optional" in resolved));

// --- cross-check against Flat-Folder ---
const flatFolderDir = process.argv[2];
if (flatFolderDir){
    const { loadFlatFolder } = await import(pathToFileURL(path.join(here, "flatfolder_check.mjs")).href);
    const countStates = await loadFlatFolder(flatFolderDir);
    let seed = 12345;
    const rand = () => (seed = (seed*1103515245 + 12345) % 2147483648)/2147483648;
    function randomSplit(total, parts, grid){
        //positive parts summing to total; on a grid of `grid` units when given (creates ties)
        if (grid){
            const units = Math.round(total/grid);
            const cuts = new Set();
            while (cuts.size < parts - 1) cuts.add(1 + Math.floor(rand()*(units - 1)));
            const c = [0, ...[...cuts].sort((a, b) => a - b), units];
            return c.slice(1).map((x, i) => (x - c[i])*grid);
        }
        const w = Array.from({length: parts}, () => 0.2 + rand());
        const s = w.reduce((a, b) => a + b, 0);
        return w.map(x => x*total/s);
    }
    function vertexPattern(angles, labels){
        //rays from the origin to a near-circular boundary: the single-vertex rule is
        //about a small disk around the vertex, and a square sheet would truncate some
        //sectors enough to dodge collisions that a disk cannot (e.g. Big-Little-Big)
        const pts = [[0, 0]], edges = [], assign = [];
        const boundary = angles.map((a, i) => ({p: [Math.cos(a), Math.sin(a)], a, ray: i}));
        for (let j=0;j<72;j++){
            const a = j*2*Math.PI/72;
            if (!angles.some(b => Math.abs(b - a) < 1e-3)) boundary.push({p: [Math.cos(a), Math.sin(a)], a, ray: -1});
        }
        boundary.sort((u, v) => u.a - v.a);
        boundary.forEach(b => { b.id = pts.length; pts.push(b.p); });
        boundary.forEach((b, i) => {
            const c = boundary[(i+1)%boundary.length];
            edges.push([Math.min(b.id, c.id), Math.max(b.id, c.id)]); assign.push("B");
            if (b.ray >= 0){ edges.push([0, b.id]); assign.push(labels[b.ray] === M ? "M" : "V"); }
        });
        return {vertices_coords: pts, edges_vertices: edges, edges_assignment: assign,
            faces_vertices: computeFaces(pts, edges)};
    }
    let agree = 0, disagree = 0, foldable = 0, tried = 0;
    for (let trial=0; trial<1500; trial++){
        const k = 2 + Math.floor(rand()*3);//4, 6 or 8 creases
        const grid = trial % 2 ? deg(15) : null;
        const odd = randomSplit(Math.PI, k, grid), even = randomSplit(Math.PI, k, grid);
        const sectors = [];
        for (let i=0;i<k;i++){ sectors.push(odd[i], even[i]); }
        if (Math.min(...sectors) < deg(4)) continue;
        const start = rand()*2*Math.PI;
        const angles = [];
        let a = start;
        for (const s of sectors){ angles.push(a % (2*Math.PI)); a += s; }
        const labels = angles.map(() => rand() < 0.5 ? M : V);
        //bias toward Maekawa-satisfying assignments so both outcomes are well covered
        if (rand() < 0.7){
            const target = rand() < 0.5 ? M : V;
            const nTarget = k + 1;
            const idx = angles.map((_, i) => i).sort(() => rand() - 0.5);
            idx.forEach((i, j) => { labels[i] = j < nTarget ? target : (target === M ? V : M); });
        }
        //continuous random angles are exact, so test the algorithm with a tight tolerance;
        //grid cases have exact ties and use the default tolerance
        const mine = CL.isVertexFlatFoldable(angles.map((ang, i) => ({angle: ang, mv: labels[i]})), grid ? undefined : 1e-9);
        let theirs;
        try { theirs = countStates(vertexPattern(angles, labels)).states > 0n; }
        catch (e){ continue; }
        tried++;
        if (theirs) foldable++;
        if (mine === theirs) agree++;
        else {
            disagree++;
            if (disagree <= 5) console.log("disagreement:", {sectors: sectors.map(s => +(s*180/Math.PI).toFixed(3)), labels, mine, theirs});
        }
    }
    console.log(`single-vertex cross-check: ${agree}/${tried} agree with Flat-Folder (${foldable} foldable, ${tried - foldable} not)`);
    check("single-vertex rule matches Flat-Folder", disagree === 0 && tried > 200);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
