/**
 * Builds crease patterns for whole circuits out of the Hull–Zakharevich gadgets
 * (arXiv:2309.07932): logic gates, triangle and hexagon twists (fan-out with
 * negation), and wires (pleats) that connect gadget arms in a straight line.
 *
 * Everything lives on the triangular lattice with points (k*sqrt(3)/2, m + k/2) and
 * lines in the 30, 90 and 150 degree directions. A wire is three consecutive parallel
 * lattice lines: a mandatory mountain between two optional valleys.
 *
 * A gadget is described in its own frame by fixed creases ("segments") and by arms.
 * Each arm points away from the gadget and consists of three rays: the mountain and
 * the two valleys, given by their start points. Placing a gadget rotates it by a
 * multiple of 60 degrees about a lattice point, which keeps the TRUE/FALSE convention:
 * looking along the direction a signal travels, the valley on the left means TRUE.
 */
import { buildArrangement, toFold } from "./tikz.mjs";

export const S = Math.sqrt(3)/2;           //lattice line spacing
const R3 = Math.sqrt(3)/3;
export const polar = (deg, r) => [r*Math.cos(deg*Math.PI/180), r*Math.sin(deg*Math.PI/180)];
const add = (a, b) => [a[0]+b[0], a[1]+b[1]];
const sub = (a, b) => [a[0]-b[0], a[1]-b[1]];
const scale = (a, k) => [a[0]*k, a[1]*k];
const dot = (a, b) => a[0]*b[0] + a[1]*b[1];
const cross = (a, b) => a[0]*b[1] - a[1]*b[0];
const norm = a => Math.hypot(a[0], a[1]);
const unit = deg => polar(deg, 1);
const O = [0, 0];

/** Lattice point (k, m) -> plane. */
export const lattice = (k, m) => [k*S, m + k/2];

// ---------- gadget library (local frames) ----------

const seg = (p, q, mv, mandatory = false) => ({p, q, mv, mandatory});
const M = (p, q) => seg(p, q, "M", true);
const oM = (p, q) => seg(p, q, "M");
const oV = (p, q) => seg(p, q, "V");

/** Arm along direction `dir` (degrees): mountain ray from `m`, valley rays from `v1`, `v2`. */
const arm = (dir, m, v1, v2, mountainMandatory = true) => ({dir, m, valleys: [v1, v2], mountainMandatory});

function triangleTwist(extra = []){
    const K30 = polar(30, 1), K150 = polar(150, 1), K270 = polar(270, 1);
    return {
        segments: [M(K30, K150), M(K150, K270), M(K270, K30), ...extra],
        arms: {
            30: arm(30, K30, K150, K270),
            150: arm(150, K150, K30, K270),
            270: arm(270, K270, K30, K150),
        },
    };
}

function starCore(extra = []){
    //OR/AND core: three mountains meet at the center; valleys start at the twist corners
    const K30 = polar(30, 1), K150 = polar(150, 1), K270 = polar(270, 1);
    return {
        segments: extra,
        arms: {
            30: arm(30, O, K150, K270),
            150: arm(150, O, K30, K270),
            270: arm(270, O, K30, K150),
        },
    };
}

/** A gadget definition turned counterclockwise by `deg` degrees (used to fit the lattice). */
function turned(deg, g){
    const r = p => {
        const cs = Math.cos(deg*Math.PI/180), sn = Math.sin(deg*Math.PI/180);
        return [cs*p[0] - sn*p[1], sn*p[0] + cs*p[1]];
    };
    const arms = {};
    for (const a of Object.values(g.arms)){
        const dir = ((a.dir + deg) % 360 + 360) % 360;
        arms[dir] = {...a, dir, m: r(a.m), valleys: a.valleys.map(r)};
    }
    return {segments: g.segments.map(s => ({...s, p: r(s.p), q: r(s.q)})), arms};
}

export const GADGETS = {
    //bare triangle twist, pointing down; every arm carries the same value read outward
    twist: () => triangleTwist(),
    //Figure 2 (NOR) and its mirror image (NAND): inputs on arms 150 (A) and 30 (B), output on 270
    nor: () => triangleTwist([
        oV(O, polar(30, 1)), oV(O, polar(150, 1)), oV(O, polar(270, 1)),
        oV(polar(60, R3), [0, 1]), oV(O, polar(120, R3)), oV(O, polar(-120, R3)),
        oV([-R3, 0], polar(-150, 1)),
        oM(polar(120, R3), [0, 1]), oM(O, polar(60, R3)), oM(O, [-R3, 0]),
        oM(polar(-150, 1), polar(-120, R3)),
    ]),
    nand: () => triangleTwist([
        oV(O, polar(30, 1)), oV(O, polar(150, 1)), oV(O, polar(270, 1)),
        oV(polar(120, R3), [0, 1]), oV(O, polar(60, R3)), oV(O, polar(-60, R3)),
        oV([R3, 0], polar(-30, 1)),
        oM(polar(60, R3), [0, 1]), oM(O, polar(120, R3)), oM(O, [R3, 0]),
        oM(polar(-30, 1), polar(-60, R3)),
    ]),
    or: () => starCore([
        oV(O, [0, 1]), oV(O, polar(-30, 1)), oV(polar(30, 0.5), polar(-30, 1)),
        oV(polar(30, 2), polar(-30, 1)), oV(O, polar(-150, 1)),
        oM(polar(150, 1), polar(-150, 1)), oM(polar(30, 1), polar(-30, 1)),
        oM(polar(30, 0.5), [0, 1]), oM(polar(30, 2), [0, 1]), oM(polar(-30, 1), [0, -1]),
    ]),
    and: () => starCore([
        oV(O, [0, 1]), oV(O, polar(-30, 1)), oV(polar(150, 0.5), polar(-150, 1)),
        oV(polar(150, 2), polar(-150, 1)), oV(O, polar(-150, 1)),
        oM(polar(30, 1), polar(-30, 1)), oM(polar(-150, 1), [0, -1]),
        oM(polar(-150, 1), polar(150, 1)), oM(polar(150, 0.5), [0, 1]), oM(polar(150, 2), [0, 1]),
    ]),
    //Figure 17: accepts every combination of its three wires
    eater: () => triangleTwist([
        oV(O, polar(30, 1)), oV(O, polar(150, 1)), oV(O, polar(270, 1)),
        oV(O, [0, 0.5]), oV(O, polar(-150, 0.5)), oV(O, polar(-30, 0.5)),
        oM([0, 0.5], [0, 1]), oM(polar(-150, 0.5), polar(-150, 1)), oM(polar(-30, 0.5), polar(-30, 1)),
    ]),
    //Figure 15: hexagonal twist; all six arms carry the same value read outward
    hex: () => {
        const H = d => polar(d, 1);
        const dirs = [30, 90, 150, 210, 270, 330];
        const segments = dirs.map(d => M(H(d), H(d + 60)));
        const arms = {};
        for (const d of dirs) arms[d] = arm(d, H(d), H(d - 60), H(d + 60));
        return {segments, arms};
    },
    //pi/3 intersector (the paper's first intersector figure), turned by 90 degrees so that its
    //wires lie on this lattice: wire 1 runs along 210/30 through the center, wire 2 along
    //270/90 and leaves one lattice line further left than it entered.
    intersector: () => turned(90, {
        segments: [
            oM(polar(120, 2), add(polar(120, 2), polar(-120, 1))),
            oM(polar(60, 1), polar(120, 1)),
            oV(polar(120, 1), add(polar(120, 1), polar(-120, 1))),
            oM(O, polar(-120, 1)),
            oV(polar(120, 1), add(polar(120, 1), [-1, 0])),
            oM(O, [-1, 0]),
            oM(polar(120, 1), add(polar(120, 1), polar(60, 1))),
            oV(O, polar(60, 1)),
            oV(polar(-120, 1), polar(-60, 1)),
            oM(polar(-60, 1), [1, 0]),
        ],
        arms: {
            120: arm(120, O, polar(60, 1), [-1, 0]),
            300: arm(300, O, polar(60, 1), [-1, 0]),
            180: arm(180, [-1, 0], add([-1, 0], polar(120, 1)), polar(-120, 1)),
            0: arm(0, polar(60, 1), O, polar(120, 2)),
        },
    }),
};

// ---------- placement ----------

function rotate(p, deg){
    const c = Math.cos(deg*Math.PI/180), s = Math.sin(deg*Math.PI/180);
    return [c*p[0] - s*p[1], s*p[0] + c*p[1]];
}
const normDeg = d => ((Math.round(d) % 360) + 360) % 360;

/**
 * A placed gadget. `at` is a point of the plane (use lattice(k, m)), `rot` a multiple
 * of 60 degrees (counterclockwise).
 */
export function place(type, at, rot = 0, label = type){
    if (!GADGETS[type]) throw new Error(`unknown gadget ${type}`);
    if (normDeg(rot) % 60) throw new Error("rotations must be multiples of 60 degrees");
    const g = GADGETS[type]();
    const T = p => add(rotate(p, rot), at);
    const arms = {};
    for (const [key, a] of Object.entries(g.arms)){
        const dir = normDeg(a.dir + rot);
        arms[dir] = {dir, m: T(a.m), valleys: a.valleys.map(T), mountainMandatory: a.mountainMandatory, localKey: key};
    }
    return {
        type, label, at, rot,
        segments: g.segments.map(s => ({...s, p: T(s.p), q: T(s.q)})),
        arms,
        wired: new Set(),
    };
}

// ---------- circuit ----------

/**
 * Collects placed gadgets and wires, then produces a FOLD crease pattern.
 */
export class Circuit {
    constructor(title){
        this.title = title;
        this.nodes = [];
        this.wires = [];
    }
    add(type, at, rot = 0, label){
        const node = place(type, at, rot, label || `${type}${this.nodes.length}`);
        this.nodes.push(node);
        return node;
    }
    arm(node, dir){
        const a = node.arms[normDeg(dir)];
        if (!a) throw new Error(`${node.label} has no arm at ${dir} degrees (has ${Object.keys(node.arms)})`);
        return a;
    }
    /** Wire from an arm of one gadget to the facing arm of another (signal travels a -> b). */
    connect(nodeA, dirA, nodeB, dirB, name){
        const a = this.arm(nodeA, dirA), b = this.arm(nodeB, dirB);
        if (normDeg(a.dir - b.dir) !== 180) throw new Error(`arms ${nodeA.label}:${dirA} and ${nodeB.label}:${dirB} do not face each other`);
        const d = unit(a.dir);
        if (Math.abs(cross(sub(b.m, a.m), d)) > 1e-6) {
            throw new Error(`arms ${nodeA.label}:${dirA} and ${nodeB.label}:${dirB} are not on one line (offset ${cross(sub(b.m, a.m), d).toFixed(4)})`);
        }
        if (dot(sub(b.m, a.m), d) <= 0) throw new Error(`arm ${nodeB.label}:${dirB} is behind ${nodeA.label}:${dirA}`);
        this.use(nodeA, a); this.use(nodeB, b);
        this.wires.push({kind: "link", from: {node: nodeA, arm: a}, to: {node: nodeB, arm: b}, name});
    }
    /**
     * Wire from an arm out to the paper's edge. role: "input" (signal enters), "output",
     * or "junk". `inverted` swaps which valley reads as TRUE.
     */
    toEdge(node, dir, role = "junk", name, inverted = false){
        const a = this.arm(node, dir);
        this.use(node, a);
        this.wires.push({kind: "edge", from: {node, arm: a}, role, name, inverted});
    }
    use(node, a){
        if (node.wired.has(a.dir)) throw new Error(`${node.label}:${a.dir} is wired twice`);
        node.wired.add(a.dir);
    }

    /** Line pieces of every wire, clipped to the boundary polygon. */
    wirePieces(boundary){
        const pieces = [];
        for (const w of this.wires){
            const a = w.from.arm;
            const d = unit(a.dir);
            const lines = [{p: a.m, mv: "M", mandatory: a.mountainMandatory}, ...a.valleys.map(p => ({p, mv: "V", mandatory: false}))];
            for (const line of lines){
                let q;
                if (w.kind === "link"){
                    const b = w.to.arm;
                    const others = line.mv === "M" ? [b.m] : b.valleys;
                    q = others.find(o => Math.abs(cross(sub(o, line.p), d)) < 1e-6);
                    if (!q) throw new Error(`wire ${wireName(w)}: no matching ${line.mv} line at ${w.to.node.label}`);
                    if (dot(sub(q, line.p), d) <= 1e-9) throw new Error(`wire ${wireName(w)}: gadgets overlap`);
                } else {
                    q = rayExit(line.p, d, boundary);
                }
                pieces.push({p: line.p, q, mv: line.mv, mandatory: line.mandatory, wire: w});
            }
        }
        return pieces;
    }

    /** Wire probes (points on the TRUE and FALSE valleys) for inputs and outputs. */
    probes(boundary){
        const out = [];
        for (const w of this.wires){
            if (w.kind !== "edge" || (w.role !== "input" && w.role !== "output")) continue;
            const a = w.from.arm;
            const d = unit(a.dir);
            const travel = w.role === "input" ? scale(d, -1) : d;
            //probe each valley between the gadget's own creases (within GADGET_RADIUS of its
            //center) and the paper's edge
            const center = w.from.node.at;
            const probeOn = v => {
                const exit = rayExit(v, d, boundary);
                const tExit = dot(sub(exit, center), d);
                if (tExit < GADGET_RADIUS + 0.2) throw new Error(`${w.name}: the paper's edge is too close to ${w.from.node.label}`);
                const t = (GADGET_RADIUS + tExit)/2;
                return add(v, scale(d, t - dot(sub(v, center), d)));
            };
            const leftSide = a.valleys.map(v => cross(travel, sub(v, a.m)) > 0);
            if (leftSide[0] === leftSide[1]) throw new Error("arm valleys on the same side");
            const leftValley = leftSide[0] ? a.valleys[0] : a.valleys[1];
            const rightValley = leftSide[0] ? a.valleys[1] : a.valleys[0];
            const [tv, fv] = w.inverted ? [rightValley, leftValley] : [leftValley, rightValley];
            out.push({name: w.name, role: w.role, true: [probeOn(tv)], false: [probeOn(fv)]});
        }
        return out;
    }

    /** Check that no two wires cross and no wire runs through another gadget. */
    checkCrossings(boundary){
        const pieces = this.wirePieces(boundary);
        const problems = [];
        for (let i=0;i<pieces.length;i++){
            for (let j=i+1;j<pieces.length;j++){
                const a = pieces[i], b = pieces[j];
                if (a.wire === b.wire) continue;
                const x = properIntersection(a.p, a.q, b.p, b.q);
                if (!x) continue;
                //arms of one gadget cross each other next to it by design (points X, Y, Z of the twists)
                const shared = wireNodes(a.wire).filter(n => wireNodes(b.wire).includes(n));
                if (shared.some(n => norm(sub(x, n.at)) < GADGET_RADIUS)) continue;
                problems.push(`${wireName(a.wire)} crosses ${wireName(b.wire)} at (${x.map(v => v.toFixed(2))})`);
            }
        }
        //wires through foreign gadget creases
        for (const p of pieces){
            for (const node of this.nodes){
                if (node === p.wire.from.node || (p.wire.to && node === p.wire.to.node)) continue;
                for (const s of node.segments){
                    const x = properIntersection(p.p, p.q, s.p, s.q);
                    if (x){ problems.push(`${wireName(p.wire)} runs through ${node.label}`); break; }
                }
            }
        }
        return [...new Set(problems)];
    }

    build(boundary, info = {}){
        for (const node of this.nodes){
            for (const dir of Object.keys(node.arms)){
                if (!node.wired.has(+dir)) throw new Error(`${node.label}: arm ${dir} is not wired`);
            }
        }
        const problems = this.checkCrossings(boundary);
        if (problems.length) throw new Error("layout problems:\n  " + problems.join("\n  "));
        const pieces = [];
        for (const node of this.nodes) pieces.push(...node.segments);
        pieces.push(...this.wirePieces(boundary));
        //snap interior vertices to the lattice; points on the paper's edge stay where the wires meet it
        const onBoundary = p => boundary.some((a, i) => {
            const b = boundary[(i + 1) % boundary.length];
            const e = sub(b, a), w = sub(p, a), L = norm(e);
            const t = dot(w, e)/(L*L);
            return t > -1e-9 && t < 1 + 1e-9 && Math.abs(cross(e, w))/L < 1e-7;
        });
        const snap = p => onBoundary(p) ? p : snapToLattice(p);
        const arrangement = buildArrangement(pieces.map(({p, q, mv, mandatory}) => ({p, q, mv, mandatory})), boundary, 1e-6, snap);
        return toFold(arrangement, {
            title: this.title,
            wires: this.probes(boundary),
            ...info,
        });
    }
}

const GADGET_RADIUS = 2.01;
const wireNodes = w => w.to ? [w.from.node, w.to.node] : [w.from.node];
const wireName = w => w.name ||`${w.from.node.label}:${w.from.arm.dir}` + (w.to ? `->${w.to.node.label}:${w.to.arm.dir}` : "->edge");

function properIntersection(p1, p2, q1, q2){
    const d1 = sub(p2, p1), d2 = sub(q2, q1);
    const denom = cross(d1, d2);
    if (Math.abs(denom) < 1e-12) return null;
    const w = sub(q1, p1);
    const t = cross(w, d2)/denom, u = cross(w, d1)/denom;
    const eps = 1e-6;
    if (t > eps && t < 1 - eps && u > eps && u < 1 - eps) return add(p1, scale(d1, t));
    return null;
}

/** Where the ray p + t d (t > 0) leaves the convex polygon. */
export function rayExit(p, d, polygon){
    let best = Infinity;
    for (let i=0;i<polygon.length;i++){
        const a = polygon[i], b = polygon[(i+1) % polygon.length];
        const e = sub(b, a);
        const denom = cross(d, e);
        if (Math.abs(denom) < 1e-12) continue;
        const w = sub(a, p);
        const t = cross(w, e)/denom, u = cross(w, d)/denom;
        if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
    }
    if (!isFinite(best)) throw new Error(`ray from (${p}) does not reach the boundary`);
    return add(p, scale(d, best));
}

/** Axis-aligned rectangle boundary [x0, y0, x1, y1] as a polygon (counterclockwise). */
/**
 * Rectangle boundary (counterclockwise) with corners moved outward onto lattice-friendly
 * coordinates (x a multiple of sqrt(3)/2, y an integer), so that every wire meets it at a
 * point of the refined lattice.
 */
export const rect = (x0, y0, x1, y1) => {
    const X0 = Math.floor(x0/S + 1e-9)*S, X1 = Math.ceil(x1/S - 1e-9)*S;
    const Y0 = Math.floor(y0 + 1e-9), Y1 = Math.ceil(y1 - 1e-9);
    return [[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1]];
};

/**
 * Every crease vertex of these gadgets lies on the triangular lattice refined 24 times
 * (in lattice coordinates k, m with x = k*sqrt(3)/2, y = m + k/2). Snapping to it
 * removes float noise from line intersections.
 */
const SNAP = 24;
export function snapToLattice(p){
    const k = Math.round(SNAP*p[0]/S)/SNAP;
    const m = Math.round(SNAP*(p[1] - k/2))/SNAP;
    return [k*S, m + k/2];
}

/**
 * Circuit from a honeycomb layout found by honeycomb_search.py: every node is a twist or
 * a gate (rotated so that its output is on the chosen arm), neighbors are joined by
 * wires, and loose arms run to a rectangular sheet with `margin` around the network.
 */
export function fromLayout(layout, title, margin = 4){
    const c = new Circuit(title);
    const placed = layout.nodes.map((n, i) => {
        let rot;
        if (n.gadget === "twist") rot = n.kind === "down" ? 0 : 60;
        else rot = normDeg(n.output_arm - 270);
        return c.add(n.gadget, snapToLattice(n.pos), rot, `${n.gadget}${i}`);
    });
    layout.nodes.forEach((n, i) => {
        n.arms.forEach((d, a) => {
            const j = n.neighbors[a];
            if (j !== null && j > i) c.connect(placed[i], d, placed[j], d + 180);
        });
    });
    for (const t of layout.terminals){
        const role = t.role === "junk" ? "junk" : (layout.inputs.includes(t.role) ? "input" : "output");
        c.toEdge(placed[t.node], t.arm, role, role === "junk" ? undefined : t.role, t.inverted);
    }
    if (layout.boundary){
        c.boundary = layout.boundary.map(p => [p[0], p[1]]);
    } else if (layout.box){
        c.boundary = rect(...layout.box);
    } else {
        const xs = layout.nodes.map(n => n.pos[0]), ys = layout.nodes.map(n => n.pos[1]);
        c.boundary = rect(Math.min(...xs) - margin, Math.min(...ys) - margin, Math.max(...xs) + margin, Math.max(...ys) + margin);
    }
    return c;
}
