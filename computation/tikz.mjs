/**
 * Turns the TikZ crease drawings from Hull and Zakharevich's paper into
 * planar crease patterns (FOLD and SVG) for Origami Simulator.
 *
 * Supports the subset of TikZ used in the gadget figures: \draw[style] paths with
 * cartesian (x,y) and polar (angle:radius) coordinates, relative +(...) and
 * ++(...) coordinates, "-- cycle", and arithmetic expressions with sqrt.
 * Expressions are evaluated by a small parser, never by eval.
 */

const STYLE_TYPES = {
    mountain: {mandatory: true, mv: "M"},
    valley: {mandatory: true, mv: "V"},
    mountain_opt: {mandatory: false, mv: "M"},
    valley_opt: {mandatory: false, mv: "V"},
};

// ---------- arithmetic ----------

export function evaluate(expr){
    const src = expr.replace(/\{/g, "(").replace(/\}/g, ")");
    const tokens = [];
    const re = /\s*(\d+\.?\d*|\.\d+|\.(?!\d)|[A-Za-z]+|[-+*/()])/y;
    let m;
    re.lastIndex = 0;
    while (re.lastIndex < src.length){
        const start = re.lastIndex;
        m = re.exec(src);
        if (!m){
            if (/^\s*$/.test(src.slice(start))) break;
            throw new Error(`Cannot parse expression "${expr}"`);
        }
        tokens.push(m[1]);
    }
    let i = 0;
    const peek = () => tokens[i];
    const next = () => tokens[i++];
    function factor(){
        const t = next();
        if (t === "-") return -factor();
        if (t === "+") return factor();
        if (t === "("){
            const v = sum();
            if (next() !== ")") throw new Error(`Unbalanced parentheses in "${expr}"`);
            return v;
        }
        if (t === "sqrt"){
            if (next() !== "(") throw new Error(`sqrt needs parentheses in "${expr}"`);
            const v = sum();
            if (next() !== ")") throw new Error(`Unbalanced parentheses in "${expr}"`);
            return Math.sqrt(v);
        }
        if (t === ".") return 0;
        if (t !== undefined && /^[\d.]/.test(t)) return parseFloat(t);
        throw new Error(`Unexpected token "${t}" in "${expr}"`);
    }
    function product(){
        let v = factor();
        while (peek() === "*" || peek() === "/"){
            const op = next();
            const w = factor();
            v = op === "*" ? v*w : v/w;
        }
        return v;
    }
    function sum(){
        let v = product();
        while (peek() === "+" || peek() === "-"){
            const op = next();
            const w = product();
            v = op === "+" ? v + w : v - w;
        }
        return v;
    }
    const value = sum();
    if (i !== tokens.length) throw new Error(`Trailing tokens in "${expr}"`);
    return value;
}

function splitTopLevel(content, separator){
    let depth = 0;
    for (let i=0;i<content.length;i++){
        const c = content[i];
        if (c === "(" || c === "{") depth++;
        else if (c === ")" || c === "}") depth--;
        else if (c === separator && depth === 0) return [content.slice(0, i), content.slice(i+1)];
    }
    return null;
}

export function parseCoordinate(content){
    const polar = splitTopLevel(content, ":");
    if (polar){
        const angle = evaluate(polar[0])*Math.PI/180;
        const r = evaluate(polar[1]);
        return [r*Math.cos(angle), r*Math.sin(angle)];
    }
    const cart = splitTopLevel(content, ",");
    if (!cart) throw new Error(`Cannot parse coordinate "(${content})"`);
    return [evaluate(cart[0]), evaluate(cart[1])];
}

// ---------- paths ----------

function readBalanced(s, start){
    //s[start] === "("; returns [content, indexAfterClosingParen]
    let depth = 0;
    for (let i=start;i<s.length;i++){
        const c = s[i];
        if (c === "(" || c === "{") depth++;
        else if (c === ")" || c === "}"){
            depth--;
            if (depth === 0) return [s.slice(start+1, i), i+1];
        }
    }
    throw new Error("Unbalanced parentheses in TikZ path");
}

function parsePath(path){
    const segments = [];
    let current = null, ref = null, subStart = null, pendingLine = false;
    let i = 0;
    while (i < path.length){
        const c = path[i];
        if (/\s/.test(c)){ i++; continue; }
        if (path.startsWith("--", i)){ pendingLine = true; i += 2; continue; }
        if (path.startsWith("cycle", i)){
            if (pendingLine && current && subStart) segments.push([current, subStart]);
            current = subStart;
            pendingLine = false;
            i += 5;
            continue;
        }
        let relative = 0;
        if (path.startsWith("++", i)){ relative = 2; i += 2; }
        else if (c === "+"){ relative = 1; i += 1; }
        while (/\s/.test(path[i])) i++;
        if (path[i] !== "(") throw new Error(`Unexpected TikZ token near "${path.slice(i, i+20)}"`);
        const [content, after] = readBalanced(path, i);
        i = after;
        const v = parseCoordinate(content);
        let p;
        if (relative === 0){ p = v; ref = p; }
        else if (relative === 1){ p = [ref[0]+v[0], ref[1]+v[1]]; }
        else { p = [current[0]+v[0], current[1]+v[1]]; ref = p; }
        if (pendingLine) segments.push([current, p]);
        else subStart = p;
        current = p;
        pendingLine = false;
    }
    return segments;
}

/** Extract creases from \draw[style] commands; other TikZ is ignored. */
export function parseCreases(tikz){
    const src = tikz.split("\n").map(line => line.replace(/(^|[^\\])%.*$/, "$1")).join("\n");
    const pieces = [];
    const re = /\\draw\s*\[([^\]]*)\]([^;]*);/g;
    let m;
    while ((m = re.exec(src))){
        const style = m[1].trim();
        const type = STYLE_TYPES[style];
        if (!type) continue;
        for (const [p, q] of parsePath(m[2])){
            pieces.push({p, q, mandatory: type.mandatory, mv: type.mv});
        }
    }
    return pieces;
}

// ---------- planar arrangement ----------

const sub = (a, b) => [a[0]-b[0], a[1]-b[1]];
const cross = (a, b) => a[0]*b[1] - a[1]*b[0];
const dot = (a, b) => a[0]*b[0] + a[1]*b[1];
const norm = a => Math.hypot(a[0], a[1]);

class PointSet {
    constructor(tol, snap){ this.tol = tol; this.points = []; this.snap = snap; }
    id(p){
        if (this.snap) p = this.snap(p);
        for (let i=0;i<this.points.length;i++){
            const q = this.points[i];
            if (Math.abs(q[0]-p[0]) < this.tol && Math.abs(q[1]-p[1]) < this.tol) return i;
        }
        this.points.push([p[0], p[1]]);
        return this.points.length - 1;
    }
}

/**
 * Split crease pieces at all crossings and T-junctions, merge overlaps, add the
 * paper boundary, and return a planar graph.
 * pieces: [{p, q, mandatory, mv}], boundary: polygon [[x,y], ...]
 * snap (optional): maps every vertex to its exact position, e.g. the nearest point of a
 * fine lattice, so that float noise in intersections cannot bend straight creases.
 */
export function buildArrangement(pieces, boundary, tol = 1e-6, snap = null){
    const n = pieces.length;
    const cuts = pieces.map(() => [0, 1]);
    for (let i=0;i<n;i++){
        const a = pieces[i], da = sub(a.q, a.p), la = norm(da);
        for (let j=i+1;j<n;j++){
            const b = pieces[j], db = sub(b.q, b.p), lb = norm(db);
            const denom = cross(da, db);
            const w = sub(b.p, a.p);
            if (Math.abs(denom) > 1e-12*la*lb){
                const t = cross(w, db)/denom;
                const u = cross(w, da)/denom;
                if (t > -tol/la && t < 1+tol/la && u > -tol/lb && u < 1+tol/lb){
                    cuts[i].push(Math.min(1, Math.max(0, t)));
                    cuts[j].push(Math.min(1, Math.max(0, u)));
                }
            } else if (Math.abs(cross(w, da))/la < tol){
                //collinear: endpoints of each piece that fall inside the other
                for (const p of [b.p, b.q]){
                    const t = dot(sub(p, a.p), da)/(la*la);
                    if (t > -tol/la && t < 1+tol/la) cuts[i].push(Math.min(1, Math.max(0, t)));
                }
                for (const p of [a.p, a.q]){
                    const u = dot(sub(p, b.p), db)/(lb*lb);
                    if (u > -tol/lb && u < 1+tol/lb) cuts[j].push(Math.min(1, Math.max(0, u)));
                }
            }
        }
    }
    const points = new PointSet(tol*10, snap);
    for (const c of boundary) points.id(c);
    const edgeMap = new Map();
    for (let i=0;i<n;i++){
        const a = pieces[i], da = sub(a.q, a.p);
        const ts = cuts[i].sort((x, y) => x - y);
        const ids = [];
        for (const t of ts){
            const id = points.id([a.p[0] + t*da[0], a.p[1] + t*da[1]]);
            if (ids[ids.length-1] !== id) ids.push(id);
        }
        for (let k=0;k+1<ids.length;k++){
            const [u, v] = ids[k] < ids[k+1] ? [ids[k], ids[k+1]] : [ids[k+1], ids[k]];
            const key = `${u},${v}`;
            const e = edgeMap.get(key) || {u, v, mandatory: false, mvMask: 0};
            e.mandatory = e.mandatory || a.mandatory;
            e.mvMask |= (a.mv === "M" ? 1 : 2);
            edgeMap.set(key, e);
        }
    }
    //boundary: split each side at every point lying on it
    const creaseEdges = [...edgeMap.values()];
    const boundaryEdges = [];
    for (let s=0;s<boundary.length;s++){
        const A = boundary[s], B = boundary[(s+1)%boundary.length];
        const d = sub(B, A), len = norm(d);
        const onSide = [];
        points.points.forEach((p, id) => {
            const t = dot(sub(p, A), d)/(len*len);
            const dist = Math.abs(cross(sub(p, A), d))/len;
            if (dist < tol*10 && t > -tol && t < 1+tol) onSide.push([t, id]);
        });
        onSide.sort((x, y) => x[0] - y[0]);
        for (let k=0;k+1<onSide.length;k++){
            const u = onSide[k][1], v = onSide[k+1][1];
            if (u === v) continue;
            const key = u < v ? `${u},${v}` : `${v},${u}`;
            if (edgeMap.has(key)) throw new Error(`Crease runs along the boundary at ${key}`);
            boundaryEdges.push(u < v ? [u, v] : [v, u]);
        }
    }
    //sanity: every crease end must meet another crease or the boundary
    const degree = points.points.map(() => 0);
    const boundaryVertex = points.points.map(() => false);
    for (const [u, v] of boundaryEdges){ boundaryVertex[u] = boundaryVertex[v] = true; }
    for (const e of creaseEdges){ degree[e.u]++; degree[e.v]++; }
    degree.forEach((d, id) => {
        if (d === 1 && !boundaryVertex[id]){
            throw new Error(`Crease ends inside the paper at (${points.points[id].map(x => x.toFixed(4))})`);
        }
    });
    //drop points that ended up unused
    const used = points.points.map(() => false);
    for (const e of creaseEdges){ used[e.u] = used[e.v] = true; }
    for (const [u, v] of boundaryEdges){ used[u] = used[v] = true; }
    const remap = [];
    const vertices = [];
    points.points.forEach((p, id) => {
        if (used[id]){ remap[id] = vertices.length; vertices.push(p); }
    });
    const edges = [];
    for (const [u, v] of boundaryEdges){
        edges.push({vertices: [remap[u], remap[v]], boundary: true});
    }
    for (const e of creaseEdges){
        edges.push({
            vertices: [remap[e.u], remap[e.v]],
            boundary: false,
            mandatory: e.mandatory,
            assignment: e.mvMask === 1 ? "M" : (e.mvMask === 2 ? "V" : "U"),
        });
    }
    return {vertices, edges};
}

/** Faces of a planar straight-line graph, counterclockwise, outer face removed. */
export function computeFaces(vertices, edgesVertices){
    const nbrs = vertices.map(() => []);
    for (const [u, v] of edgesVertices){
        nbrs[u].push(v);
        nbrs[v].push(u);
    }
    const angle = (from, to) => Math.atan2(vertices[to][1]-vertices[from][1], vertices[to][0]-vertices[from][0]);
    nbrs.forEach((list, v) => list.sort((a, b) => angle(v, a) - angle(v, b)));
    const visited = new Set();
    const faces = [];
    for (const [u0, v0] of edgesVertices){
        for (const [a0, b0] of [[u0, v0], [v0, u0]]){
            if (visited.has(`${a0},${b0}`)) continue;
            const face = [];
            let a = a0, b = b0;
            for (let guard=0; guard<10000; guard++){
                visited.add(`${a},${b}`);
                face.push(a);
                const list = nbrs[b];
                const idx = list.indexOf(a);
                const c = list[(idx - 1 + list.length) % list.length];
                a = b; b = c;
                if (a === a0 && b === b0) break;
            }
            faces.push(face);
        }
    }
    const area = f => {
        let s = 0;
        for (let i=0;i<f.length;i++){
            const p = vertices[f[i]], q = vertices[f[(i+1)%f.length]];
            s += p[0]*q[1] - q[0]*p[1];
        }
        return s/2;
    };
    return faces.filter(f => area(f) > 1e-12);
}

// ---------- output ----------

const SVG_COLORS = {
    B: "#000000",
    M: "#ff0000",
    V: "#0000ff",
    OM: "#ff8000",
    OV: "#00ffff",
    OU: "#8000ff",
};

/**
 * Build a FOLD object (y axis flipped so the pattern reads like the paper's figure
 * in Origami Simulator's top-down pattern view).
 */
export function toFold(arrangement, info){
    const flip = p => [p[0], -p[1]];
    const vertices = arrangement.vertices.map(flip);
    const edges_vertices = arrangement.edges.map(e => e.vertices.slice().sort((a, b) => a - b));
    const edges_assignment = arrangement.edges.map(e => e.boundary ? "B" : e.assignment);
    const edges_optional = arrangement.edges.map(e => !e.boundary && !e.mandatory);
    const edges_foldAngle = edges_assignment.map(a => a === "M" ? -180 : (a === "V" ? 180 : null));
    const faces_vertices = computeFaces(vertices, edges_vertices);
    const wires = (info.wires || []).map(w => ({
        name: w.name,
        role: w.role,
        true: w.true.map(flip),
        false: w.false.map(flip),
    }));
    return {
        file_spec: 1.1,
        file_creator: "OrigamiSimulator computation tools (computation/generate_gadgets.mjs)",
        file_title: info.title,
        file_description: info.description,
        frame_classes: ["creasePattern"],
        frame_unit: "unit",
        vertices_coords: vertices,
        edges_vertices,
        edges_assignment,
        edges_foldAngle,
        edges_optional,
        faces_vertices,
        "computation:wires": wires,
        "computation:expected": info.expected || null,
    };
}

/**
 * The crease pattern of one solution: only creases that fold (states 1 = mountain,
 * 2 = valley), plus the boundary. Straight runs split by a vertex whose other creases
 * stayed flat are merged back into single edges (Flat-Folder's constraint builder
 * assumes no two collinear edges share both faces, and it reads more cleanly).
 */
export function solvedPattern(fold, states, info = {}){
    const V = fold.vertices_coords;
    const E = [], A = [];
    fold.edges_vertices.forEach((e, i) => {
        const a = fold.edges_assignment[i] === "B" ? "B" :
            (states[i] === 1 ? "M" : (states[i] === 2 ? "V" : null));
        if (a){ E.push(e.slice()); A.push(a); }
    });
    for (let changed = true; changed;){
        changed = false;
        const incident = V.map(() => []);
        E.forEach((e, i) => { incident[e[0]].push(i); incident[e[1]].push(i); });
        for (let v=0; v<V.length && !changed; v++){
            if (incident[v].length !== 2) continue;
            const [i, j] = incident[v];
            if (A[i] !== A[j]) continue;
            const a = E[i][0] === v ? E[i][1] : E[i][0];
            const b = E[j][0] === v ? E[j][1] : E[j][0];
            const d1 = sub(V[a], V[v]), d2 = sub(V[b], V[v]);
            if (Math.abs(cross(d1, d2)) > 1e-9*norm(d1)*norm(d2) || dot(d1, d2) > 0) continue;
            E[i] = [a, b];
            E.splice(j, 1);
            A.splice(j, 1);
            changed = true;
        }
    }
    const used = new Map();
    const vertices = [];
    for (const e of E){
        for (const v of e){
            if (!used.has(v)){ used.set(v, vertices.length); vertices.push(V[v]); }
        }
    }
    const edges_vertices = E.map(e => e.map(v => used.get(v)).sort((a, b) => a - b));
    const out = {
        file_spec: 1.1,
        file_creator: "OrigamiSimulator computation tools (computation/generate_gadgets.mjs)",
        frame_classes: ["creasePattern"],
        vertices_coords: vertices,
        edges_vertices,
        edges_assignment: A,
        edges_foldAngle: A.map(a => a === "M" ? -180 : (a === "V" ? 180 : null)),
        faces_vertices: computeFaces(vertices, edges_vertices),
    };
    if (info.title) out.file_title = info.title;
    if (info.description) out.file_description = info.description;
    return out;
}

const escapeXml = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function toSvg(fold, scale = 40, margin = 20){
    const xs = fold.vertices_coords.map(p => p[0]);
    const ys = fold.vertices_coords.map(p => p[1]);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const W = (Math.max(...xs) - minX)*scale + 2*margin;
    const H = (Math.max(...ys) - minY)*scale + 2*margin;
    const tx = p => [+(margin + (p[0]-minX)*scale).toFixed(4), +(margin + (p[1]-minY)*scale).toFixed(4)];
    const lines = [];
    const optional = fold.edges_optional || [];
    fold.edges_vertices.forEach(([u, v], i) => {
        const a = fold.edges_assignment[i];
        const key = a === "B" ? "B" : (optional[i] ? "O" + a : a);
        const [x1, y1] = tx(fold.vertices_coords[u]);
        const [x2, y2] = tx(fold.vertices_coords[v]);
        const dash = (a === "V" || key === "OV") ? ' stroke-dasharray="6,4"' : "";
        lines.push(`  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${SVG_COLORS[key]}" stroke-width="2"${dash}/>`);
    });
    const header = [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}">`,
    ];
    if (fold.file_title) header.push(`  <title>${escapeXml(fold.file_title)}</title>`);
    if (fold.file_description) header.push(`  <desc>${escapeXml(fold.file_description)}</desc>`);
    if (fold["computation:wires"]){
        const wires = fold["computation:wires"].map(w => ({
            name: w.name, role: w.role, true: w.true.map(tx), false: w.false.map(tx),
        }));
        const meta = JSON.stringify({wires, expected: fold["computation:expected"]});
        header.push(`  <metadata id="computation">${escapeXml(meta)}</metadata>`);
    }
    return [...header, ...lines, `</svg>`, ``].join("\n");
}
