/**
 * CreaseLogic: a discrete solver for crease patterns with optional creases.
 *
 * Origami Simulator's physics folds a crease pattern whose every crease is already
 * labeled. CreaseLogic answers the question that comes before that: given a pattern
 * where some creases are optional (they may fold or stay flat, in the sense of
 * Hull and Zakharevich, "Flat origami is Turing complete"), which of them must fold,
 * and with which mountain/valley parity, so that every interior vertex can fold flat?
 *
 * Each interior vertex is checked locally:
 *   - Kawasaki's theorem (alternating sector angles sum to pi), and
 *   - a valid single-vertex mountain/valley assignment, tested by crimp reduction,
 *     which subsumes Maekawa's theorem and the Big-Little-Big lemma.
 * Global layer ordering (paper not passing through itself across several vertices)
 * is not checked here; solved patterns can be verified separately with a layer-order
 * solver such as Flat-Folder.
 *
 * Crease states: 0 = off (flat), 1 = mountain, 2 = valley.
 * Edge domains are bitmasks over those states (bit 1 = off, bit 2 = M, bit 4 = V).
 *
 * Works in the browser (window.CreaseLogic) and in Node (module.exports).
 */
(function(root, factory){
    var api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.CreaseLogic = api;
})(typeof self !== "undefined" ? self : this, function(){

    var OFF = 0, MOUNTAIN = 1, VALLEY = 2;
    var BIT = [1, 2, 4];
    var STATE_OF_MASK = {1: OFF, 2: MOUNTAIN, 4: VALLEY};
    var TWO_PI = 2*Math.PI;
    //Angles closer than this (radians) count as equal. SVG imports arrive as rounded
    //float32 coordinates and hand-drawn files are coarser still, so the default is
    //lenient (about 0.06 degrees); pass a tighter angleTolerance for exact input.
    var DEFAULT_ANGLE_TOLERANCE = 1e-3;
    var MAX_VERTEX_COMBOS = 1 << 20;

    function popcount(mask){
        var c = 0;
        while (mask){ c += mask & 1; mask >>= 1; }
        return c;
    }

    function normalizeAngle(a){
        a %= TWO_PI;
        if (a < 0) a += TWO_PI;
        return a;
    }

    /**
     * Single-vertex flat-foldability.
     * creases: array of {angle: radians, mv: MOUNTAIN|VALLEY}
     * tol: angle tolerance in radians (defaults to DEFAULT_ANGLE_TOLERANCE)
     */
    function isVertexFlatFoldable(creases, tol){
        if (tol === undefined || tol === null) tol = DEFAULT_ANGLE_TOLERANCE;
        var n = creases.length;
        if (n === 0) return true;
        if (n % 2 === 1) return false;
        var sorted = creases.slice().sort(function(a, b){ return a.angle - b.angle; });
        var sectors = [];
        var labels = [];
        for (var i=0;i<n;i++){
            var next = sorted[(i+1)%n].angle + (i === n-1 ? TWO_PI : 0);
            var s = next - sorted[i].angle;
            if (s < tol) return false;//two creases leave the vertex in the same direction
            sectors.push(s);
            labels.push(sorted[i].mv);
        }
        //Kawasaki: alternating sector angles sum to pi
        var even = 0;
        for (var i=0;i<n;i+=2) even += sectors[i];
        if (Math.abs(even - Math.PI) > tol) return false;
        //Crimp reduction: a sector no larger than both neighbors whose bounding creases
        //have opposite parity can always be crimped; the vertex folds flat iff the
        //crimped vertex does. Ends with two creases of equal parity.
        while (labels.length > 2){
            var m = labels.length;
            var crimped = false;
            for (var i=0;i<m;i++){
                var prev = (i-1+m)%m;
                var nxt = (i+1)%m;
                if (labels[i] === labels[nxt]) continue;
                if (sectors[i] > sectors[prev] + tol) continue;
                if (sectors[i] > sectors[nxt] + tol) continue;
                var merged = sectors[prev] - sectors[i] + sectors[nxt];
                var newSectors = [], newLabels = [];
                for (var j=0;j<m;j++){
                    if (j === i || j === nxt) continue;
                    newLabels.push(labels[j]);
                    newSectors.push(j === prev ? merged : sectors[j]);
                }
                sectors = newSectors;
                labels = newLabels;
                crimped = true;
                break;
            }
            if (!crimped) return false;
        }
        //Kawasaki makes the last two sectors equal, up to twice its residual
        return labels[0] === labels[1] && Math.abs(sectors[0] - sectors[1]) <= 2*tol + 1e-12;
    }

    /**
     * Domain bitmask for an edge from its FOLD assignment and optional flag.
     * Returns 0 for edges that are not creases (boundary, cut, facet, free hinge).
     */
    function domainForEdge(assignment, optional){
        var a = assignment;
        if (a === "OM"){ a = "M"; optional = true; }
        else if (a === "OV"){ a = "V"; optional = true; }
        else if (a === "OU"){ a = "U"; optional = true; }
        var mask = 0;
        if (a === "M") mask = BIT[MOUNTAIN];
        else if (a === "V") mask = BIT[VALLEY];
        else if (a === "U" && optional) mask = BIT[MOUNTAIN] | BIT[VALLEY];
        else return 0;
        if (optional) mask |= BIT[OFF];
        return mask;
    }

    function isOptionalAssignment(assignment, optionalFlag){
        return !!optionalFlag || assignment === "OM" || assignment === "OV" || assignment === "OU";
    }

    function hasOptionalCreases(fold){
        if (!fold || !fold.edges_assignment) return false;
        var opt = fold.edges_optional || [];
        for (var i=0;i<fold.edges_assignment.length;i++){
            if (isOptionalAssignment(fold.edges_assignment[i], opt[i])) return true;
        }
        return false;
    }

    function coords2D(v){
        //Origami Simulator stores 2D patterns as [x, 0, z]
        if (v.length === 3) return [v[0], v[2]];
        return [v[0], v[1]];
    }

    /**
     * Build the constraint problem for a crease pattern.
     * fold: {vertices_coords, edges_vertices, edges_assignment, edges_optional?}
     * options: {angleTolerance (radians)}
     */
    function buildProblem(fold, options){
        var t0 = now();
        var tol = options && options.angleTolerance !== undefined ? options.angleTolerance : DEFAULT_ANGLE_TOLERANCE;
        var V = fold.vertices_coords.map(coords2D);
        var E = fold.edges_vertices;
        var A = fold.edges_assignment;
        var optional = fold.edges_optional || [];

        var domains = new Array(E.length);
        for (var i=0;i<E.length;i++) domains[i] = domainForEdge(A[i], optional[i]);

        var incident = [];
        var onBoundary = [];
        for (var i=0;i<V.length;i++){ incident.push([]); onBoundary.push(false); }
        for (var i=0;i<E.length;i++){
            var e = E[i];
            incident[e[0]].push(i);
            incident[e[1]].push(i);
            if (A[i] === "B" || A[i] === "C"){
                onBoundary[e[0]] = true;
                onBoundary[e[1]] = true;
            }
        }

        var constraints = [];
        var infeasibleVertices = [];
        var edgeConstraints = [];
        for (var i=0;i<E.length;i++) edgeConstraints.push([]);

        for (var v=0;v<V.length;v++){
            if (onBoundary[v]) continue;
            var creaseEdges = [];
            for (var k=0;k<incident[v].length;k++){
                var ei = incident[v][k];
                if (domains[ei]) creaseEdges.push(ei);
            }
            if (creaseEdges.length === 0) continue;
            var angles = {};
            for (var k=0;k<creaseEdges.length;k++){
                var ei = creaseEdges[k];
                var other = E[ei][0] === v ? E[ei][1] : E[ei][0];
                angles[ei] = normalizeAngle(Math.atan2(V[other][1]-V[v][1], V[other][0]-V[v][0]));
            }
            var vars = [], fixed = [];
            for (var k=0;k<creaseEdges.length;k++){
                var ei = creaseEdges[k];
                if (popcount(domains[ei]) > 1) vars.push(ei);
                else fixed.push(ei);
            }
            var combos = 1;
            for (var k=0;k<vars.length;k++) combos *= popcount(domains[vars[k]]);
            if (combos > MAX_VERTEX_COMBOS){
                throw new Error("Vertex " + v + " has too many optional creases (" + vars.length + ")");
            }
            var fixedCreases = [];
            for (var k=0;k<fixed.length;k++){
                var state = STATE_OF_MASK[domains[fixed[k]]];
                if (state === OFF) continue;
                fixedCreases.push({angle: angles[fixed[k]], mv: state});
            }
            var tuples = [];
            var current = new Array(vars.length);
            (function enumerate(k){
                if (k === vars.length){
                    var creases = fixedCreases.slice();
                    for (var j=0;j<vars.length;j++){
                        if (current[j] !== OFF) creases.push({angle: angles[vars[j]], mv: current[j]});
                    }
                    if (isVertexFlatFoldable(creases, tol)) tuples.push(current.slice());
                    return;
                }
                var mask = domains[vars[k]];
                for (var s=0;s<3;s++){
                    if (!(mask & BIT[s])) continue;
                    current[k] = s;
                    enumerate(k+1);
                }
            })(0);
            if (tuples.length === 0) infeasibleVertices.push(v);
            if (vars.length === 0) continue;//fully determined vertex, nothing to constrain
            var ci = constraints.length;
            constraints.push({vertex: v, vars: vars, tuples: tuples});
            for (var k=0;k<vars.length;k++) edgeConstraints[vars[k]].push(ci);
        }

        var variables = [];
        for (var i=0;i<E.length;i++){
            if (popcount(domains[i]) > 1) variables.push(i);
        }

        return {
            vertices: V,
            edges: E,
            assignments: A,
            domains: domains,
            constraints: constraints,
            edgeConstraints: edgeConstraints,
            variables: variables,
            infeasibleVertices: infeasibleVertices,
            onBoundary: onBoundary,
            angleTolerance: tol,
            buildMs: now() - t0
        };
    }

    function propagate(problem, dom, queue){
        var constraints = problem.constraints;
        var edgeConstraints = problem.edgeConstraints;
        var inQueue = new Uint8Array(constraints.length);
        for (var i=0;i<queue.length;i++) inQueue[queue[i]] = 1;
        while (queue.length){
            var ci = queue.pop();
            inQueue[ci] = 0;
            var c = constraints[ci];
            var vars = c.vars;
            var support = new Array(vars.length);
            for (var k=0;k<vars.length;k++) support[k] = 0;
            var any = false;
            for (var t=0;t<c.tuples.length;t++){
                var tuple = c.tuples[t];
                var ok = true;
                for (var k=0;k<vars.length;k++){
                    if (!(dom[vars[k]] & BIT[tuple[k]])){ ok = false; break; }
                }
                if (!ok) continue;
                any = true;
                for (var k=0;k<vars.length;k++) support[k] |= BIT[tuple[k]];
            }
            if (!any) return ci;//conflict at this constraint
            for (var k=0;k<vars.length;k++){
                var ei = vars[k];
                var nd = dom[ei] & support[k];
                if (nd === dom[ei]) continue;
                dom[ei] = nd;
                var list = edgeConstraints[ei];
                for (var j=0;j<list.length;j++){
                    var cj = list[j];
                    if (cj === ci || inQueue[cj]) continue;
                    inQueue[cj] = 1;
                    queue.push(cj);
                }
            }
        }
        return -1;
    }

    /**
     * Find valid assignments of the optional creases.
     * pins: array of [edgeIndex, allowedMask] restricting edges (e.g. from input wires)
     * options: {maxSolutions (default 64), maxNodes (default 200000)}
     * Returns {status, solutions (arrays of crease states per edge), ...}
     */
    function solve(problem, pins, options){
        options = options || {};
        var maxSolutions = options.maxSolutions || 64;
        var maxNodes = options.maxNodes || 200000;
        var t0 = now();
        var result = {
            status: "ok",
            solutions: [],
            truncated: false,
            nodes: 0,
            forced: 0,
            variables: 0,
            conflictVertex: null,
            ms: 0
        };
        if (problem.infeasibleVertices.length){
            result.status = "infeasible";
            result.conflictVertex = problem.infeasibleVertices[0];
            result.ms = now() - t0;
            return result;
        }
        var dom = problem.domains.slice();
        pins = pins || [];
        for (var i=0;i<pins.length;i++){
            var ei = pins[i][0];
            dom[ei] &= pins[i][1];
            if (!dom[ei]){
                result.status = "conflict";
                result.ms = now() - t0;
                return result;
            }
        }
        var vars = problem.variables;
        var queue = [];
        for (var i=0;i<problem.constraints.length;i++) queue.push(i);
        var conflict = propagate(problem, dom, queue);
        if (conflict >= 0){
            result.status = "conflict";
            result.conflictVertex = problem.constraints[conflict].vertex;
            result.ms = now() - t0;
            return result;
        }
        var unresolved = 0;
        for (var i=0;i<vars.length;i++){
            if (popcount(problem.domains[vars[i]]) > 1 && popcount(dom[vars[i]]) > 1) unresolved++;
        }
        result.variables = vars.length;
        result.forced = vars.length - unresolved;

        var aborted = false;
        function search(d){
            if (result.solutions.length >= maxSolutions){ result.truncated = true; return; }
            if (++result.nodes > maxNodes){ aborted = true; return; }
            var best = -1, bestSize = 4;
            for (var i=0;i<vars.length;i++){
                var size = popcount(d[vars[i]]);
                if (size > 1 && size < bestSize){
                    best = vars[i];
                    bestSize = size;
                    if (size === 2) break;
                }
            }
            if (best < 0){
                var states = new Array(d.length);
                for (var i=0;i<d.length;i++) states[i] = d[i] ? STATE_OF_MASK[d[i]] : OFF;
                result.solutions.push(states);
                return;
            }
            for (var s=0;s<3;s++){
                if (!(d[best] & BIT[s])) continue;
                var d2 = d.slice();
                d2[best] = BIT[s];
                if (propagate(problem, d2, problem.edgeConstraints[best].slice()) < 0) search(d2);
                if (aborted || result.truncated) return;
            }
        }
        search(dom);
        if (aborted) result.status = "limit";
        else if (result.solutions.length === 0) result.status = "conflict";
        result.ms = now() - t0;
        return result;
    }

    function distPointToSegment(p, a, b){
        var dx = b[0]-a[0], dy = b[1]-a[1];
        var len2 = dx*dx + dy*dy;
        var t = len2 > 0 ? ((p[0]-a[0])*dx + (p[1]-a[1])*dy)/len2 : 0;
        t = Math.max(0, Math.min(1, t));
        var x = a[0] + t*dx - p[0], y = a[1] + t*dy - p[1];
        return Math.sqrt(x*x + y*y);
    }

    /**
     * Crease edges passing through a probe point (used to attach wires to creases
     * independently of edge indexing, which changes during SVG import).
     */
    function edgesAtPoint(problem, point, tol){
        var found = [];
        var best = Infinity, bestEdge = -1;
        for (var i=0;i<problem.edges.length;i++){
            if (!problem.domains[i]) continue;
            var e = problem.edges[i];
            var d = distPointToSegment(point, problem.vertices[e[0]], problem.vertices[e[1]]);
            if (d < tol) found.push(i);
            if (d < best){ best = d; bestEdge = i; }
        }
        return {edges: found, nearest: bestEdge, distance: best};
    }

    /**
     * Resolve wire descriptors {name, role, true: [[x,y],...], false: [[x,y],...]}
     * into edge lists. Probe points are expected to lie on optional creases.
     */
    function resolveWires(problem, wires, tol){
        var resolved = [];
        var problems = [];
        for (var i=0;i<(wires || []).length;i++){
            var w = wires[i];
            var out = {name: w.name, role: w.role || "input", trueEdges: [], falseEdges: []};
            var sides = [["true", out.trueEdges], ["false", out.falseEdges]];
            for (var s=0;s<2;s++){
                var probes = w[sides[s][0]] || [];
                if (probes.length && typeof probes[0] === "number") probes = [probes];
                for (var p=0;p<probes.length;p++){
                    var hit = edgesAtPoint(problem, probes[p], tol);
                    if (!hit.edges.length) problems.push(w.name + " (" + sides[s][0] + ")");
                    for (var h=0;h<hit.edges.length;h++){
                        if (sides[s][1].indexOf(hit.edges[h]) < 0) sides[s][1].push(hit.edges[h]);
                    }
                }
            }
            resolved.push(out);
        }
        return {wires: resolved, unmatched: problems};
    }

    function pinsForInputs(wires, values){
        var pins = [];
        var ON = BIT[MOUNTAIN] | BIT[VALLEY];
        for (var i=0;i<wires.length;i++){
            var w = wires[i];
            if (w.role !== "input") continue;
            var v = values[w.name];
            if (v === undefined || v === null) continue;
            var activeEdges = v ? w.trueEdges : w.falseEdges;
            var inactiveEdges = v ? w.falseEdges : w.trueEdges;
            for (var k=0;k<activeEdges.length;k++) pins.push([activeEdges[k], ON]);
            for (var k=0;k<inactiveEdges.length;k++) pins.push([inactiveEdges[k], BIT[OFF]]);
        }
        return pins;
    }

    /** Value carried by a wire in a solution: true, false, or null if undefined. */
    function wireValue(states, wire){
        function allActive(list){
            if (!list.length) return false;
            for (var i=0;i<list.length;i++) if (states[list[i]] === OFF) return false;
            return true;
        }
        function allInactive(list){
            for (var i=0;i<list.length;i++) if (states[list[i]] !== OFF) return false;
            return true;
        }
        if (allActive(wire.trueEdges) && allInactive(wire.falseEdges)) return true;
        if (allActive(wire.falseEdges) && allInactive(wire.trueEdges)) return false;
        return null;
    }

    /**
     * Turn a solution into a plain fold for the physics simulation: active optional
     * creases become mountains/valleys, inactive ones become flat facet creases.
     */
    function applySolution(fold, states){
        var out = JSON.parse(JSON.stringify(fold));
        var optional = fold.edges_optional || [];
        var angles = fold.edges_foldAngle || [];
        for (var i=0;i<out.edges_assignment.length;i++){
            var a = fold.edges_assignment[i];
            if (!isOptionalAssignment(a, optional[i])) continue;
            var state = states[i];
            var magnitude = Math.abs(angles[i]);
            if (!magnitude || isNaN(magnitude)) magnitude = 180;
            if (state === MOUNTAIN){
                out.edges_assignment[i] = "M";
                if (out.edges_foldAngle) out.edges_foldAngle[i] = -magnitude;
            } else if (state === VALLEY){
                out.edges_assignment[i] = "V";
                if (out.edges_foldAngle) out.edges_foldAngle[i] = magnitude;
            } else {
                out.edges_assignment[i] = "F";
                if (out.edges_foldAngle) out.edges_foldAngle[i] = 0;
            }
        }
        delete out.edges_optional;
        return out;
    }

    function now(){
        if (typeof performance !== "undefined" && performance.now) return performance.now();
        return Date.now();
    }

    return {
        OFF: OFF,
        MOUNTAIN: MOUNTAIN,
        VALLEY: VALLEY,
        BIT: BIT,
        DEFAULT_ANGLE_TOLERANCE: DEFAULT_ANGLE_TOLERANCE,
        isVertexFlatFoldable: isVertexFlatFoldable,
        domainForEdge: domainForEdge,
        isOptionalAssignment: isOptionalAssignment,
        hasOptionalCreases: hasOptionalCreases,
        buildProblem: buildProblem,
        solve: solve,
        edgesAtPoint: edgesAtPoint,
        resolveWires: resolveWires,
        pinsForInputs: pinsForInputs,
        wireValue: wireValue,
        applySolution: applySolution
    };
});
