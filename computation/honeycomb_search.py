#!/usr/bin/env python3
"""
Searches for logic circuits built from Hull-Zakharevich gadgets on a honeycomb.

Every gadget used here (the four gates and the bare triangle twist) is a triangle
twist: three arms 120 degrees apart, pointing either at 30/150/270 degrees (a "down"
node) or at 90/210/330 degrees (an "up" node). Wires are straight, so a network of
such gadgets is a piece of the honeycomb lattice, and every closed face is a hexagon.
This program picks a patch of hexagons and asks the CP-SAT solver to label each node
as a twist or as a gate (which arm is the output, which function) and each loose arm
as an input, an output or a junk wire running off the paper, so that the network
computes the requested functions.

Values are read "outward": an arm's value is the value of the wire as seen by a signal
leaving the node along it (TRUE when the valley on the left of the direction of travel
folds). With that reading, along any wire the two ends disagree, a twist makes its
three arms agree, and the gates compute AND (the paper's NOR gadget), OR (NAND
gadget), NAND (OR gadget) and NOR (AND gadget) of their two input arms. Requiring an
acyclic flow of information makes every input row determine all wires uniquely.

    python3 computation/honeycomb_search.py full-adder > computation/layouts/full_adder.json
    python3 computation/honeycomb_search.py chain 2 < computation/layouts/full_adder.json \
        > computation/layouts/adder_2bit.json

Loose arms end on a sheet that hugs the network (paper_outline), and no two wires,
counted with their width, may cross. computation/generate_adder.mjs turns a layout
into a crease pattern.
"""
import itertools
import json
import math
import sys
import time

from ortools.sat.python import cp_model

EDGE = 4.0                       # distance between neighboring gadget centers
C30 = math.cos(math.pi/6)
A1 = (2*EDGE*C30, 0.0)           # hexagon center lattice
A2 = (EDGE*C30, -1.5*EDGE)

DOWN_ARMS = (30, 150, 270)       # "down" nodes (the paper's gate orientation)
UP_ARMS = (90, 210, 330)

# gadget name -> function of the two input arms (outward reading)
GATES = {"nor": "AND", "nand": "OR", "or": "NAND", "and": "NOR"}


def key(p):
    return (round(p[0], 3), round(p[1], 3))


def unit(deg):
    return (math.cos(math.radians(deg)), math.sin(math.radians(deg)))


def hex_center(q, r):
    return (q*A1[0] + r*A2[0], q*A1[1] + r*A2[1])


def patch_nodes(hexes):
    """Nodes of a set of hexagons (axial coords) -> {key: (pos, kind)}."""
    nodes = {}
    for (q, r) in hexes:
        c = hex_center(q, r)
        for ang in (90, 30, -30, -90, -150, 150):
            u = unit(ang)
            p = (c[0] + EDGE*u[0], c[1] + EDGE*u[1])
            kind = "down" if ang in (30, 150, -90) else "up"
            nodes[key(p)] = (p, kind)
    return nodes


def build_graph(hexes):
    nodes = patch_nodes(hexes)
    names = sorted(nodes, key=lambda k: (-k[1], k[0]))
    index = {k: i for i, k in enumerate(names)}
    arms = []            # per node: list of (dir, neighbor index or None)
    for k in names:
        p, kind = nodes[k]
        lst = []
        for d in (DOWN_ARMS if kind == "down" else UP_ARMS):
            u = unit(d)
            q = key((p[0] + EDGE*u[0], p[1] + EDGE*u[1]))
            lst.append((d, index.get(q)))
        arms.append(lst)
    return [nodes[k] for k in names], arms


def honeycomb_nodes(radius):
    """All honeycomb nodes of the hexagons within `radius` cells of the origin."""
    hexes = [(q, r) for q in range(-radius, radius+1) for r in range(-radius, radius+1) if abs(q + r) <= radius]
    return patch_nodes(hexes)


def build_graph_nodes(keys, all_nodes, margin=3.0, check_wires=True):
    """
    Graph on an arbitrary set of honeycomb nodes: an arm joins the nearest node straight
    ahead if that node has the facing arm. Returns (nodes, arms, boundary) or None when an
    arm runs into a node without a facing arm or when wires would cross.
    """
    pts = [all_nodes[k] for k in keys]
    order = sorted(range(len(pts)), key=lambda i: (-pts[i][0][1], pts[i][0][0]))
    nodes = [pts[i] for i in order]
    arms = []
    for i, (p, kind) in enumerate(nodes):
        lst = []
        for d in (DOWN_ARMS if kind == "down" else UP_ARMS):
            u = unit(d)
            best, bt = None, None
            for j, (q, kind2) in enumerate(nodes):
                if j == i:
                    continue
                wx, wy = q[0]-p[0], q[1]-p[1]
                t = wx*u[0] + wy*u[1]
                if t > 1e-6 and abs(wx*u[1] - wy*u[0]) < 1e-6 and (bt is None or t < bt):
                    best, bt = j, t
            if best is not None:
                back = (d + 180) % 360
                if back not in (DOWN_ARMS if nodes[best][1] == "down" else UP_ARMS):
                    return None
            lst.append((d, best))
        arms.append(lst)
    xs = [p[0] for p, _ in nodes]
    ys = [p[1] for p, _ in nodes]
    boundary = lattice_box(min(xs) - margin, min(ys) - margin, max(xs) + margin, max(ys) + margin)
    if check_wires and not wires_ok(nodes, arms, boundary):
        return None
    return nodes, arms, boundary


def ray_exit(p, d, box):
    x0, y0, x1, y1 = box
    ts = []
    if abs(d[0]) > 1e-12:
        ts += [(x0 - p[0])/d[0], (x1 - p[0])/d[0]]
    if abs(d[1]) > 1e-12:
        ts += [(y0 - p[1])/d[1], (y1 - p[1])/d[1]]
    t = min(t for t in ts if t > 1e-9)
    return (p[0] + t*d[0], p[1] + t*d[1])


def seg_cross(a1, a2, b1, b2):
    d1 = (a2[0]-a1[0], a2[1]-a1[1])
    d2 = (b2[0]-b1[0], b2[1]-b1[1])
    den = d1[0]*d2[1] - d1[1]*d2[0]
    if abs(den) < 1e-9:
        return False
    wx, wy = b1[0]-a1[0], b1[1]-a1[1]
    t = (wx*d2[1] - wy*d2[0])/den
    s = (wx*d1[1] - wy*d1[0])/den
    return 1e-6 < t < 1-1e-6 and 1e-6 < s < 1-1e-6


GADGET_RADIUS = 2.01
WIRE_HALF_WIDTH = math.sqrt(3)/2


def lattice_box(x0, y0, x1, y1):
    """Expand a box to lattice-friendly coordinates (x a multiple of sqrt(3)/2, y an integer)."""
    s = WIRE_HALF_WIDTH
    return (math.floor(x0/s + 1e-9)*s, math.floor(y0 + 1e-9), math.ceil(x1/s - 1e-9)*s, math.ceil(y1 - 1e-9))


def wires_ok(nodes, arms, box):
    """
    No two wires may cross. Each wire is a strip of three lines (a mountain between two
    valleys); arms of one gadget may cross next to it, as they do inside the gadgets.
    """
    wires = []
    for i, lst in enumerate(arms):
        for d, j in lst:
            u = unit(d)
            n = (-u[1], u[0])
            p = nodes[i][0]
            lines = []
            for off in (-WIRE_HALF_WIDTH, 0.0, WIRE_HALF_WIDTH):
                a = (p[0] + off*n[0], p[1] + off*n[1])
                if j is None:
                    b = ray_exit(a, u, box)
                elif j > i:
                    q = nodes[j][0]
                    b = (q[0] + off*n[0], q[1] + off*n[1])
                else:
                    break
                lines.append((a, b))
            if lines:
                wires.append((lines, {i} if j is None else {i, j}))
    for (la, na), (lb, nb) in itertools.combinations(wires, 2):
        shared = na & nb
        for a1, a2 in la:
            for b1, b2 in lb:
                x = seg_cross_point(a1, a2, b1, b2)
                if x is None:
                    continue
                if any(math.hypot(x[0]-nodes[k][0][0], x[1]-nodes[k][0][1]) < GADGET_RADIUS for k in shared):
                    continue
                return False
    # a wire must not pass through another node
    for lines, ends in wires:
        p, q = lines[1]
        dx, dy = q[0]-p[0], q[1]-p[1]
        L = math.hypot(dx, dy)
        for k, (r, _) in enumerate(nodes):
            if k in ends:
                continue
            wx, wy = r[0]-p[0], r[1]-p[1]
            if abs(wx*dy - wy*dx)/L < GADGET_RADIUS and -GADGET_RADIUS < (wx*dx + wy*dy)/L < L + GADGET_RADIUS:
                return False
    # gadgets must stay inside the paper with room for their creases
    x0, y0, x1, y1 = box
    for r, _ in nodes:
        if not (x0 + GADGET_RADIUS < r[0] < x1 - GADGET_RADIUS and y0 + GADGET_RADIUS < r[1] < y1 - GADGET_RADIUS):
            return False
    return True


def seg_cross_point(a1, a2, b1, b2):
    d1 = (a2[0]-a1[0], a2[1]-a1[1])
    d2 = (b2[0]-b1[0], b2[1]-b1[1])
    den = d1[0]*d2[1] - d1[1]*d2[0]
    if abs(den) < 1e-9:
        return None
    wx, wy = b1[0]-a1[0], b1[1]-a1[1]
    t = (wx*d2[1] - wy*d2[0])/den
    s = (wx*d1[1] - wy*d1[0])/den
    if 1e-6 < t < 1-1e-6 and 1e-6 < s < 1-1e-6:
        return (a1[0] + t*d1[0], a1[1] + t*d1[1])
    return None


def paper_outline(nodes, arms, margin=3.0):
    """
    A sheet that hugs the network: every node and internal wire, grown by `margin`, with
    holes filled. Loose arms leave through its edge right away, so arms that point at each
    other from different gadgets do not have to cross.
    """
    from shapely.geometry import Point, LineString
    from shapely.ops import unary_union
    from shapely import Polygon
    shapes = [Point(p).buffer(margin, quad_segs=6) for p, _ in nodes]
    for i, lst in enumerate(arms):
        for d, j in lst:
            if j is not None and j > i:
                shapes.append(LineString([nodes[i][0], nodes[j][0]]).buffer(margin, cap_style="flat", join_style="mitre"))
    blob = unary_union(shapes)
    if blob.geom_type != "Polygon":
        return None
    poly = Polygon(blob.exterior).simplify(0.05)
    coords = list(poly.exterior.coords)[:-1]
    if not Polygon(coords).exterior.is_ccw:
        coords.reverse()
    return [(round(x, 9), round(y, 9)) for x, y in coords]


def polygon_exit(p, u, polygon):
    """First point where the ray p + t*u leaves the polygon."""
    best = None
    n = len(polygon)
    for k in range(n):
        a, b = polygon[k], polygon[(k+1) % n]
        ex, ey = b[0]-a[0], b[1]-a[1]
        den = u[0]*ey - u[1]*ex
        if abs(den) < 1e-12:
            continue
        wx, wy = a[0]-p[0], a[1]-p[1]
        t = (wx*ey - wy*ex)/den
        s = (wx*u[1] - wy*u[0])/den
        if t > 1e-9 and -1e-9 <= s <= 1+1e-9 and (best is None or t < best):
            best = t
    return None if best is None else (p[0] + best*u[0], p[1] + best*u[1])


def wires_ok_polygon(nodes, arms, polygon):
    """Strip-aware crossing test for loose arms that end on an arbitrary polygon."""
    wires = []
    for i, lst in enumerate(arms):
        for d, j in lst:
            u = unit(d)
            n = (-u[1], u[0])
            p = nodes[i][0]
            lines = []
            for off in (-WIRE_HALF_WIDTH, 0.0, WIRE_HALF_WIDTH):
                a = (p[0] + off*n[0], p[1] + off*n[1])
                if j is None:
                    b = polygon_exit(a, u, polygon)
                    if b is None:
                        return False
                elif j > i:
                    q = nodes[j][0]
                    b = (q[0] + off*n[0], q[1] + off*n[1])
                else:
                    break
                lines.append((a, b))
            if lines:
                wires.append((lines, {i} if j is None else {i, j}))
    for (la, na), (lb, nb) in itertools.combinations(wires, 2):
        shared = na & nb
        for a1, a2 in la:
            for b1, b2 in lb:
                x = seg_cross_point(a1, a2, b1, b2)
                if x is None:
                    continue
                if any(math.hypot(x[0]-nodes[k][0][0], x[1]-nodes[k][0][1]) < GADGET_RADIUS for k in shared):
                    continue
                return False
    return True


def ray_hits(p, d, q1, q2):
    """Does the ray p + t*d (t > 0) touch the segment q1-q2?"""
    ex, ey = q2[0]-q1[0], q2[1]-q1[1]
    den = d[0]*ey - d[1]*ex
    wx, wy = q1[0]-p[0], q1[1]-p[1]
    if abs(den) < 1e-9:
        return False
    t = (wx*ey - wy*ex)/den
    s = (wx*d[1] - wy*d[0])/den
    return t > 1e-6 and -1e-6 <= s <= 1+1e-6


def loose_arms_ok(nodes, arms):
    """Loose arms must run to the paper's edge without meeting the network or each other."""
    segs = []
    for i, lst in enumerate(arms):
        for d, j in lst:
            if j is not None and j > i:
                segs.append((nodes[i][0], nodes[j][0]))
    rays = [(nodes[i][0], unit(d)) for i, lst in enumerate(arms) for d, j in lst if j is None]
    for p, d in rays:
        for q1, q2 in segs:
            if ray_hits(p, d, q1, q2):
                return False
    for (p, d), (p2, d2) in itertools.combinations(rays, 2):
        den = d[0]*d2[1] - d[1]*d2[0]
        if abs(den) < 1e-9:
            continue
        wx, wy = p2[0]-p[0], p2[1]-p[1]
        t = (wx*d2[1] - wy*d2[0])/den
        s = (wx*d[1] - wy*d[0])/den
        if t > 1e-6 and s > 1e-6:
            return False
    return True


def solve(hexes, inputs, outputs, extra=None, time_limit=60.0, workers=8, input_dirs=None, output_dirs=None,
          optimize=False, allowed=None, log=False, symmetric_inputs=False):
    """
    inputs: names; outputs: {name: function(values dict) -> bool}.
    allowed: optional {role: set of (arm direction, rounded node position)} where a role may go.
    """
    nodes, arms = build_graph(hexes)
    if not loose_arms_ok(nodes, arms):
        return None
    res = solve_graph(nodes, arms, inputs, outputs, extra, time_limit, workers, input_dirs, output_dirs,
                      optimize, allowed, log, symmetric_inputs)
    if res and "nodes" in res:
        res["hexes"] = hexes
    return res


def solve_graph(nodes, arms, inputs, outputs, extra=None, time_limit=60.0, workers=8, input_dirs=None,
                output_dirs=None, optimize=False, allowed=None, log=False, symmetric_inputs=False):
    """CP-SAT labeling of a prebuilt graph (see build_graph and build_graph_nodes)."""
    m = cp_model.CpModel()
    N = len(nodes)
    rows = list(itertools.product([False, True], repeat=len(inputs)))
    terminals = [(i, a) for i in range(N) for a in range(3) if arms[i][a][1] is None]
    roles = list(inputs) + list(outputs) + ["junk"]

    twist = [m.NewBoolVar(f"twist{i}") for i in range(N)]
    out = [[m.NewBoolVar(f"out{i}_{a}") for a in range(3)] for i in range(N)]
    func = [{f: m.NewBoolVar(f"f{i}_{f}") for f in GATES.values()} for i in range(N)]
    inc = [[m.NewBoolVar(f"in{i}_{a}") for a in range(3)] for i in range(N)]
    level = [m.NewIntVar(0, N, f"lv{i}") for i in range(N)]
    for i in range(N):
        m.AddExactlyOne([twist[i]] + out[i])
        m.AddExactlyOne(list(func[i].values()))
        m.Add(sum(inc[i]) == 1).OnlyEnforceIf(twist[i])
        for a in range(3):
            m.AddImplication(out[i][a], inc[i][a].Not())
            for b in range(3):
                if b != a:
                    m.AddImplication(out[i][a], inc[i][b])
    for i in range(N):
        for a, (d, j) in enumerate(arms[i]):
            if j is None or j < i:
                continue
            b = next(b for b, (d2, j2) in enumerate(arms[j]) if j2 == i)
            m.Add(inc[i][a] + inc[j][b] == 1)
            m.Add(level[j] >= level[i] + 1).OnlyEnforceIf(inc[j][b])
            m.Add(level[i] >= level[j] + 1).OnlyEnforceIf(inc[i][a])

    # in-degrees: twists take one input, gates two, inputs bring one each, so the number
    # of gates is fixed by the patch (redundant, but it helps the solver)
    n_edges = (3*N - len(terminals))//2
    n_gates = n_edges + len(inputs) - N
    if n_gates < 0:
        return {"status": "INFEASIBLE"}
    m.Add(sum(sum(out[i]) for i in range(N)) == n_gates)
    role = {t: {r: m.NewBoolVar(f"role{t}_{r}") for r in roles} for t in terminals}
    pol = {t: m.NewBoolVar(f"pol{t}") for t in terminals}
    for t in terminals:
        m.AddExactlyOne(list(role[t].values()))
        i, a = t
        m.Add(inc[i][a] == sum(role[t][r] for r in inputs))
        dirn = arms[i][a][0]
        if input_dirs is not None and dirn not in input_dirs:
            for r in inputs:
                m.Add(role[t][r] == 0)
        if output_dirs is not None and dirn not in output_dirs:
            for r in outputs:
                m.Add(role[t][r] == 0)
    for r in list(inputs) + list(outputs):
        m.AddExactlyOne([role[t][r] for t in terminals])
        if allowed and r in allowed:
            for t in terminals:
                if (arms[t[0]][t[1]][0], tuple(round(c, 2) for c in nodes[t[0]][0])) not in allowed[r]:
                    m.Add(role[t][r] == 0)

    for ri, row in enumerate(rows):
        vals = dict(zip(inputs, row))
        o = [[m.NewBoolVar(f"o{ri}_{i}_{a}") for a in range(3)] for i in range(N)]
        for i in range(N):
            for a, (d, j) in enumerate(arms[i]):
                if j is not None and j > i:
                    b = next(b for b, (d2, j2) in enumerate(arms[j]) if j2 == i)
                    m.Add(o[i][a] != o[j][b])
            m.Add(o[i][0] == o[i][1]).OnlyEnforceIf(twist[i])
            m.Add(o[i][1] == o[i][2]).OnlyEnforceIf(twist[i])
            for a in range(3):
                x, y = [o[i][b] for b in range(3) if b != a]
                z = o[i][a]
                for f, lit in func[i].items():
                    en = [out[i][a], lit]
                    if f == "AND":
                        m.AddBoolOr([z.Not(), x]).OnlyEnforceIf(en)
                        m.AddBoolOr([z.Not(), y]).OnlyEnforceIf(en)
                        m.AddBoolOr([z, x.Not(), y.Not()]).OnlyEnforceIf(en)
                    elif f == "OR":
                        m.AddBoolOr([z, x.Not()]).OnlyEnforceIf(en)
                        m.AddBoolOr([z, y.Not()]).OnlyEnforceIf(en)
                        m.AddBoolOr([z.Not(), x, y]).OnlyEnforceIf(en)
                    elif f == "NAND":
                        m.AddBoolOr([z, x]).OnlyEnforceIf(en)
                        m.AddBoolOr([z, y]).OnlyEnforceIf(en)
                        m.AddBoolOr([z.Not(), x.Not(), y.Not()]).OnlyEnforceIf(en)
                    elif f == "NOR":
                        m.AddBoolOr([z.Not(), x.Not()]).OnlyEnforceIf(en)
                        m.AddBoolOr([z.Not(), y.Not()]).OnlyEnforceIf(en)
                        m.AddBoolOr([z, x, y]).OnlyEnforceIf(en)
        for t in terminals:
            i, a = t
            for r in inputs:
                # incoming value is the input; the outward reading is its negation
                want = not vals[r]
                m.Add(o[i][a] == (1 if want else 0)).OnlyEnforceIf([role[t][r], pol[t].Not()])
                m.Add(o[i][a] == (0 if want else 1)).OnlyEnforceIf([role[t][r], pol[t]])
            for r, fn in outputs.items():
                want = fn(vals)
                m.Add(o[i][a] == (1 if want else 0)).OnlyEnforceIf([role[t][r], pol[t].Not()])
                m.Add(o[i][a] == (0 if want else 1)).OnlyEnforceIf([role[t][r], pol[t]])
    if symmetric_inputs:
        # the requested functions do not change when inputs are permuted: order them
        idx = {r: sum(k*role[t][r] for k, t in enumerate(terminals)) for r in inputs}
        for r1, r2 in zip(inputs, inputs[1:]):
            m.Add(idx[r1] < idx[r2])
    if extra:
        extra(m, locals())
    if optimize:
        # prefer plain polarities and few gates
        m.Minimize(sum(pol.values()) + sum(sum(out[i]) for i in range(N)))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.num_workers = workers
    solver.parameters.log_search_progress = log
    status = solver.Solve(m)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {"status": solver.StatusName(status)}
    result = {"status": solver.StatusName(status), "nodes": []}
    inv = {v: k for k, v in GATES.items()}
    for i in range(N):
        p, kind = nodes[i]
        node = {"pos": [round(p[0], 6), round(p[1], 6)], "kind": kind,
                "arms": [d for d, _ in arms[i]],
                "neighbors": [j for _, j in arms[i]]}
        if solver.Value(twist[i]):
            node["gadget"] = "twist"
            node["input_arm"] = [arms[i][a][0] for a in range(3) if solver.Value(inc[i][a])][0]
        else:
            a = [a for a in range(3) if solver.Value(out[i][a])][0]
            f = [f for f, lit in func[i].items() if solver.Value(lit)][0]
            node["gadget"] = inv[f]
            node["output_arm"] = arms[i][a][0]
        node["level"] = solver.Value(level[i])
        result["nodes"].append(node)
    result["terminals"] = []
    for t in terminals:
        i, a = t
        r = [r for r in roles if solver.Value(role[t][r])][0]
        result["terminals"].append({"node": i, "arm": arms[i][a][0], "role": r,
                                    "inverted": bool(solver.Value(pol[t])) if r != "junk" else False})
    return result


def chain_layout(layout, bits):
    """
    Ripple-carry adder from copies of a one-bit full adder layout: copy k+1 is the copy k
    shifted along the line that leaves its Cout arm, so that one straight pleat carries
    Cout of bit k into Cin of bit k+1. Returns a new layout (inputs A_k, B_k and Cin,
    outputs S_k and Cout) with a sheet hugging the whole network, or None.
    """
    role = {t["role"]: t for t in layout["terminals"] if t["role"] != "junk"}
    if role["Cout"]["inverted"] != role["Cin"]["inverted"]:
        return None
    ic, iin = role["Cout"]["node"], role["Cin"]["node"]
    d = unit(role["Cout"]["arm"])
    cout, cin = layout["nodes"][ic]["pos"], layout["nodes"][iin]["pos"]
    N = len(layout["nodes"])
    for s in range(4, 200, 4):
        T = (cout[0] + s*d[0] - cin[0], cout[1] + s*d[1] - cin[1])
        r = -T[1]/(1.5*EDGE)
        q = (T[0] - r*EDGE*C30)/(2*EDGE*C30)
        if abs(r - round(r)) > 1e-6 or abs(q - round(q)) > 1e-6:
            continue
        nodes, arms = [], []
        for b in range(bits):
            for n in layout["nodes"]:
                nodes.append(((n["pos"][0] + b*T[0], n["pos"][1] + b*T[1]), n["kind"]))
                arms.append([[a, None if j is None else j + b*N] for a, j in zip(n["arms"], n["neighbors"])])
        for b in range(bits - 1):
            i, j = ic + b*N, iin + (b + 1)*N
            for arm in arms[i]:
                if arm[0] == role["Cout"]["arm"]:
                    arm[1] = j
            for arm in arms[j]:
                if arm[0] == role["Cin"]["arm"]:
                    arm[1] = i
        if any(math.hypot(a[0][0]-b2[0][0], a[0][1]-b2[0][1]) < EDGE - 1e-6
               for k, a in enumerate(nodes) for b2 in nodes[k+1:]):
            continue
        poly = paper_outline(nodes, [[tuple(x) for x in lst] for lst in arms])
        if poly is None or not wires_ok_polygon(nodes, [[tuple(x) for x in lst] for lst in arms], poly):
            continue
        out_nodes = []
        for b in range(bits):
            for k, n in enumerate(layout["nodes"]):
                m = dict(n)
                m["pos"] = [round(n["pos"][0] + b*T[0], 6), round(n["pos"][1] + b*T[1], 6)]
                m["neighbors"] = [x for _, x in arms[b*N + k]]
                out_nodes.append(m)
        terminals = []
        for b in range(bits):
            for t in layout["terminals"]:
                r_ = t["role"]
                if r_ == "Cin" and b > 0 or r_ == "Cout" and b < bits - 1:
                    continue
                name = {"A": f"A{b}", "B": f"B{b}", "S": f"S{b}"}.get(r_, r_)
                terminals.append(dict(t, node=t["node"] + b*N, role=name))
        order = [f"A{b}" for b in reversed(range(bits))] + [f"B{b}" for b in reversed(range(bits))] + ["Cin"] + \
                ["Cout"] + [f"S{b}" for b in reversed(range(bits))]
        terminals.sort(key=lambda t: order.index(t["role"]) if t["role"] in order else len(order))
        return {
            "description": f"{bits}-bit ripple-carry adder: {bits} copies of the one-bit full adder layout, "
                           f"each Cout feeding the next Cin through one straight pleat.",
            "inputs": order[:2*bits + 1],
            "outputs": order[2*bits + 1:],
            "nodes": out_nodes,
            "terminals": terminals,
            "boundary": [[round(x, 9), round(y, 9)] for x, y in poly],
            "shift": [round(T[0], 9), round(T[1], 9)],
        }
    return None


def polyhexes(n):
    """Fixed polyhexes with n cells (axial coordinates), up to translation."""
    nbrs = [(1, 0), (-1, 0), (0, 1), (0, -1), (1, -1), (-1, 1)]
    def norm(cells):
        mq = min(q for q, r in cells)
        mr = min(r for q, r in cells)
        return tuple(sorted((q-mq, r-mr) for q, r in cells))
    level = {norm([(0, 0)])}
    for _ in range(n-1):
        nxt = set()
        for shape in level:
            s = set(shape)
            for (q, r) in shape:
                for dq, dr in nbrs:
                    c = (q+dq, r+dr)
                    if c not in s:
                        nxt.add(norm(list(s | {c})))
        level = nxt
    return sorted(level)


def xor_test():
    hexes = [(0, 0), (1, 0), (0, 1)]
    return solve(hexes, ["A", "B"], {"X": lambda v: v["A"] != v["B"]})


ADDER_OUTPUTS = {
    "S": lambda v: (v["A"] + v["B"] + v["Cin"]) % 2 == 1,
    "Cout": lambda v: (v["A"] + v["B"] + v["Cin"]) >= 2,
}

FLOWERS = {"n": [(0, 0), (1, 0), (0, 1)], "i": [(0, 0), (1, 0), (1, -1)]}


def full_adder_search(time_limit=20.0, workers=2, log=sys.stderr, chainable=True):
    """
    A full adder is two half adders and an OR. A half adder fits in a flower of three
    hexagons, so try every placement of two flowers plus one extra node (the gate that
    combines the two carries) such that the extra node is wired to both flowers and the
    flowers are wired together. Inputs A and B go on the first flower, Cin and S on the
    second, Cout on the extra node; CP-SAT labels the rest. With `chainable`, keep going
    until copies of the adder can be chained into a ripple-carry adder (chain_layout).
    """
    ALL = honeycomb_nodes(8)
    def keys_of(hexes, dq=0, dr=0):
        return set(patch_nodes([(q + dq, r + dr) for q, r in hexes]).keys())
    tried = 0
    for o1, o2 in itertools.product("ni", repeat=2):
        k1 = keys_of(FLOWERS[o1])
        for dq in range(-3, 4):
            for dr in range(-3, 4):
                if abs(dq + dr) > 3 or (dq, dr) == (0, 0):
                    continue
                k2 = keys_of(FLOWERS[o2], dq, dr)
                if k2 <= k1:
                    continue
                base = k1 | k2
                c = [ALL[k][0] for k in base]
                mid = (sum(p[0] for p in c)/len(c), sum(p[1] for p in c)/len(c))
                for kg in sorted(ALL):
                    p = ALL[kg][0]
                    if kg in base or math.hypot(p[0]-mid[0], p[1]-mid[1]) > 22:
                        continue
                    g = build_graph_nodes(list(base | {kg}), ALL, check_wires=False)
                    if g is None:
                        continue
                    nodes, arms, _ = g
                    nkeys = [key(q) for q, _ in nodes]
                    gi = nkeys.index(kg)
                    nb = {nkeys[j] for d, j in arms[gi] if j is not None}
                    if len(nb) != 2 or not (nb & k1 and nb & (k2 - k1)):
                        continue
                    linked = (k1 & k2) or any(j is not None and nkeys[i] in k1 and nkeys[j] in k2 - k1
                                              for i, lst in enumerate(arms) for d, j in lst)
                    if not linked:
                        continue
                    poly = paper_outline(nodes, arms)
                    if poly is None or not wires_ok_polygon(nodes, arms, poly):
                        continue
                    allowed = {r: set() for r in ("A", "B", "Cin", "S", "Cout")}
                    for i, lst in enumerate(arms):
                        for d, j in lst:
                            if j is not None:
                                continue
                            tag = (d, tuple(round(v, 2) for v in nodes[i][0]))
                            if nkeys[i] in k1 - k2:
                                allowed["A"].add(tag)
                                allowed["B"].add(tag)
                            if nkeys[i] in k2 - k1:
                                allowed["Cin"].add(tag)
                                allowed["S"].add(tag)
                            if nkeys[i] == kg:
                                allowed["Cout"].add(tag)
                    if any(not v for v in allowed.values()):
                        continue
                    tried += 1
                    t = time.time()
                    res = solve_graph(nodes, arms, ["A", "B", "Cin"], ADDER_OUTPUTS, time_limit=time_limit,
                                      workers=workers, allowed=allowed)
                    print(f"flowers {o1}{o2} offset ({dq},{dr}), gate at {kg}: {len(nodes)} nodes -> "
                          f"{res['status']} ({time.time()-t:.1f} s)", file=log, flush=True)
                    if "nodes" in res:
                        res["boundary"] = [[x, y] for x, y in poly]
                        if chainable and chain_layout(layout_json(res, [], [], ""), 2) is None:
                            print("  copies of this one cannot be chained; continuing", file=log, flush=True)
                            continue
                        return res
    return None


def layout_json(res, inputs, outputs, description):
    """Trim a solver result to the layout format read by computation/circuit.mjs."""
    nodes = []
    for n in res["nodes"]:
        m = {k: n[k] for k in ("pos", "kind", "arms", "neighbors", "gadget")}
        if "output_arm" in n:
            m["output_arm"] = n["output_arm"]
        nodes.append(m)
    return {"description": description, "inputs": inputs, "outputs": outputs, "nodes": nodes,
            "terminals": res["terminals"],
            "boundary": [[round(x, 9), round(y, 9)] for x, y in res["boundary"]]}


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "xor"
    if what == "xor":
        print(json.dumps(xor_test(), indent=1))
    elif what == "full-adder":
        res = full_adder_search()
        if res is None:
            print("no layout found", file=sys.stderr)
            sys.exit(1)
        print(json.dumps(layout_json(res, ["A", "B", "Cin"], ["S", "Cout"],
            "One-bit full adder on a honeycomb of Hull-Zakharevich triangle twists, found by "
            "computation/honeycomb_search.py (two flowers of three hexagons plus one gate). Every node is "
            "a bare twist or a gate rotated so that its output is on output_arm."), indent=1))
    elif what == "chain":
        bits = int(sys.argv[2]) if len(sys.argv) > 2 else 2
        res = chain_layout(json.load(sys.stdin), bits)
        if res is None:
            print("copies cannot be chained", file=sys.stderr)
            sys.exit(1)
        print(json.dumps(res, indent=1))
    else:
        print(__doc__)
