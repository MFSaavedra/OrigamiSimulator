#!/usr/bin/env python3
"""
End-to-end check of computation mode in a real (headless) browser.

Serves the repository, opens each logic-gate example, flips its inputs through the
Computation panel, and checks that the reported outputs match the truth table. Also
imports the SVG version of the NOR gate through the app's postMessage API, so the SVG
color parsing and <metadata> wires are exercised. Saves screenshots to the given
directory.

    python3 computation/browser_test.py [screenshot_dir]

Requires Playwright with Chromium (pip install playwright; playwright install chromium).
"""
import functools
import http.server
import itertools
import json
import os
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "computation", "screenshots")
os.makedirs(SHOTS, exist_ok=True)

GATES = {
    "nor": ("A NOR B", lambda a, b: not (a or b)),
    "nand": ("A NAND B", lambda a, b: not (a and b)),
    "or": ("A OR B", lambda a, b: a or b),
    "and": ("A AND B", lambda a, b: a and b),
}


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(QuietHandler, directory=ROOT)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def panel_state(page):
    return page.evaluate("""() => {
        const outputs = {};
        $('#computeOutputs .computeRow').each(function(){
            outputs[$(this).find('.computeName').text()] = $(this).find('.computeValue').text();
        });
        return {visible: $('#computePanel').is(':visible'), outputs, status: $('#computeStatus').text()};
    }""")


def set_input(page, name, value):
    label = "TRUE" if value else "FALSE"
    page.evaluate("""([name, label]) => {
        $('#computeInputs .computeRow').filter(function(){ return $(this).data('wire') === name; })
            .find('.btn').filter(function(){ return $(this).text() === label; }).click();
    }""", [name, label])


def main():
    server = serve()
    base = f"http://127.0.0.1:{server.server_address[1]}/"
    failures = []
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        page.on("pageerror", lambda e: errors.append(str(e)))
        # the stock app references Lato/flat-ui font files that are not in the repository
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)
        page.on("response", lambda r: errors.append(f"404 {r.url}") if r.status == 404 and "/fonts/" not in r.url else None)
        page.route("**/googletagmanager.com/**", lambda route: route.abort())

        for gate, (out_name, fn) in GATES.items():
            page.goto(base + f"?model=Computation/{gate}.fold")
            page.wait_for_function("() => $('#computePanel').is(':visible') && $('#computeOutputs .computeRow').length > 0", timeout=20000)
            for a, b in itertools.product([False, True], repeat=2):
                set_input(page, "A", a)
                set_input(page, "B", b)
                page.wait_for_timeout(150)
                state = panel_state(page)
                got = state["outputs"].get(out_name)
                want = "TRUE" if fn(a, b) else "FALSE"
                ok = got == want
                print(f"{gate}: A={a!s:5} B={b!s:5} -> {got} (expected {want}) {'ok' if ok else 'MISMATCH'}")
                if not ok:
                    failures.append((gate, a, b, got, want, state["status"]))

        page.goto(base + "?model=Computation/not.fold")
        page.wait_for_function("() => $('#computePanel').is(':visible') && $('#computeOutputs .computeRow').length > 0", timeout=20000)
        for a in [False, True]:
            set_input(page, "A", a)
            page.wait_for_timeout(150)
            got = panel_state(page)["outputs"].get("NOT A")
            want = "FALSE" if a else "TRUE"
            print(f"not: A={a!s:5} -> {got} (expected {want}) {'ok' if got == want else 'MISMATCH'}")
            if got != want:
                failures.append(("not", a, got, want))

        # full adder: three inputs, two outputs
        page.goto(base + "?model=Computation/full_adder.fold")
        page.wait_for_function("() => $('#computePanel').is(':visible') && $('#computeOutputs .computeRow').length === 2", timeout=30000)
        for a, b, c in itertools.product([False, True], repeat=3):
            set_input(page, "A", a)
            set_input(page, "B", b)
            set_input(page, "Cin", c)
            page.wait_for_timeout(300)
            outputs = panel_state(page)["outputs"]
            n = a + b + c
            want = {"S": "TRUE" if n % 2 else "FALSE", "Cout": "TRUE" if n >= 2 else "FALSE"}
            ok = all(outputs.get(k) == v for k, v in want.items())
            print(f"full adder: A={a!s:5} B={b!s:5} Cin={c!s:5} -> S={outputs.get('S')} Cout={outputs.get('Cout')} "
                  f"(expected S={want['S']} Cout={want['Cout']}) {'ok' if ok else 'MISMATCH'}")
            if not ok:
                failures.append(("full adder", a, b, c, outputs, want))
        page.click("#computeTruthTableButton")
        page.wait_for_timeout(1500)
        table = page.evaluate("() => $('#computeTruthTable tr').map(function(){ return $(this).text(); }).get()")
        print("full adder truth table rows:", len(table) - 1, "all checked:", all("✓" in row for row in table[1:]))
        if len(table) != 9 or not all("✓" in row for row in table[1:]):
            failures.append(("full adder truth table", table))
        set_input(page, "A", True)
        set_input(page, "B", False)
        set_input(page, "Cin", True)
        page.wait_for_timeout(500)
        page.click("#navPattern")
        page.wait_for_timeout(800)
        page.screenshot(path=os.path.join(SHOTS, "full_adder_pattern_TFT.png"))
        page.click("#navSimulation")
        page.evaluate("() => { globals.creasePercent = 1.0; globals.shouldChangeCreasePercent = true; globals.controls.updateCreasePercent(); }")
        page.wait_for_timeout(15000)
        page.screenshot(path=os.path.join(SHOTS, "full_adder_sim_TFT.png"))

        # two-bit ripple-carry adder: (A1 A0) + (B1 B0) + Cin = (Cout S1 S0)
        page.goto(base + "?model=Computation/adder_2bit.fold")
        page.wait_for_function("() => $('#computePanel').is(':visible') && $('#computeOutputs .computeRow').length === 3", timeout=60000)
        for x, y, cin in [(0, 0, 0), (1, 1, 0), (3, 1, 0), (2, 2, 1), (3, 3, 1), (2, 1, 1), (1, 2, 0), (3, 2, 0)]:
            for name, v in (("A1", x >> 1 & 1), ("A0", x & 1), ("B1", y >> 1 & 1), ("B0", y & 1), ("Cin", cin)):
                set_input(page, name, bool(v))
            page.wait_for_timeout(600)
            outputs = panel_state(page)["outputs"]
            total = x + y + cin
            want = {"Cout": total >> 2 & 1, "S1": total >> 1 & 1, "S0": total & 1}
            ok = all(outputs.get(k) == ("TRUE" if v else "FALSE") for k, v in want.items())
            got = "".join("1" if outputs.get(k) == "TRUE" else "0" for k in ("Cout", "S1", "S0"))
            print(f"2-bit adder: {x} + {y} + {cin} -> Cout S1 S0 = {got} (expected {total:03b}) {'ok' if ok else 'MISMATCH'}")
            if not ok:
                failures.append(("2-bit adder", x, y, cin, outputs))
        page.click("#computeTruthTableButton")
        page.wait_for_timeout(3000)
        table = page.evaluate("() => $('#computeTruthTable tr').map(function(){ return $(this).text(); }).get()")
        print("2-bit adder truth table rows:", len(table) - 1, "all checked:", all("✓" in row for row in table[1:]))
        if len(table) != 33 or not all("✓" in row for row in table[1:]):
            failures.append(("2-bit adder truth table", len(table)))
        for name, v in (("A1", 1), ("A0", 1), ("B1", 0), ("B0", 1), ("Cin", 0)):
            set_input(page, name, bool(v))
        page.wait_for_timeout(800)
        page.click("#navPattern")
        page.wait_for_timeout(1000)
        page.screenshot(path=os.path.join(SHOTS, "adder_2bit_pattern_3plus1.png"))
        page.click("#navSimulation")
        page.evaluate("() => { globals.creasePercent = 1.0; globals.shouldChangeCreasePercent = true; globals.controls.updateCreasePercent(); }")
        page.wait_for_timeout(20000)
        page.screenshot(path=os.path.join(SHOTS, "adder_2bit_sim_3plus1.png"))

        # NOR in detail: fold it, screenshot simulation and pattern views, open the truth table
        page.goto(base + "?model=Computation/nor.fold")
        page.wait_for_function("() => $('#computeOutputs .computeRow').length > 0", timeout=20000)
        set_input(page, "A", False)
        set_input(page, "B", False)
        page.evaluate("() => { globals.creasePercent = 0.9; globals.shouldChangeCreasePercent = true; globals.controls.updateCreasePercent(); }")
        page.wait_for_timeout(6000)
        page.screenshot(path=os.path.join(SHOTS, "nor_sim_FF.png"))
        set_input(page, "A", True)
        page.wait_for_timeout(6000)
        page.screenshot(path=os.path.join(SHOTS, "nor_sim_TF.png"))
        page.click("#computeTruthTableButton")
        page.wait_for_timeout(300)
        table = page.evaluate("() => $('#computeTruthTable tr').map(function(){ return $(this).text(); }).get()")
        print("truth table rows:", table)
        if not table or any("✗" in row for row in table):
            failures.append(("truth table", table))
        page.click("#navPattern")
        page.wait_for_timeout(500)
        page.screenshot(path=os.path.join(SHOTS, "nor_pattern_TF.png"))
        page.click("#navSimulation")

        # SVG import path: same gate, colors + <metadata> wires. First after a regular
        # pattern (the panel must be rebuilt from the SVG itself), then right after a FOLD
        # gate without reloading (fields from the previous file must not leak through).
        with open(os.path.join(ROOT, "assets", "Computation", "nor.svg")) as f:
            svg = f.read()
        for before in ["Tessellations/miura-ori.svg", "Computation/or.fold"]:
            page.goto(base + "?model=" + before)
            page.wait_for_timeout(2000)
            page.evaluate("(svg) => window.postMessage({op: 'importSVG', svg: svg, filename: 'nor-svg'}, '*')", svg)
            page.wait_for_function("() => $('#computePanel').is(':visible') && $('#computeTitle').text() === 'nor-svg' && $('#computeOutputs .computeRow').length > 0", timeout=20000)
            warning = page.evaluate("() => $('#warningMessage').text()")
            if warning:
                failures.append(("svg warning", before, warning))
            for a, b in itertools.product([False, True], repeat=2):
                set_input(page, "A", a)
                set_input(page, "B", b)
                page.wait_for_timeout(150)
                got = panel_state(page)["outputs"].get("A NOR B")
                want = "TRUE" if not (a or b) else "FALSE"
                print(f"nor.svg after {before}: A={a!s:5} B={b!s:5} -> {got} (expected {want}) {'ok' if got == want else 'MISMATCH'}")
                if got != want:
                    failures.append(("nor.svg", before, a, b, got, want))

        # FOLD files with 3D coordinates: the simulator's own [x, 0, z] frame (2D probes),
        # and [x, y, 0] with the wire probes written in 3D as well
        with open(os.path.join(ROOT, "assets", "Computation", "nor.fold")) as f:
            nor_fold = json.load(f)
        for frame in ["xz", "xy"]:
            lift = (lambda p: [p[0], 0, p[1]]) if frame == "xz" else (lambda p: [p[0], p[1], 0])
            fold3 = json.loads(json.dumps(nor_fold))
            fold3["file_title"] = f"nor-3d-{frame}"
            fold3["vertices_coords"] = [lift(v) for v in fold3["vertices_coords"]]
            if frame == "xy":
                for w in fold3["computation:wires"]:
                    for side in ["true", "false"]:
                        w[side] = [lift(p) for p in w[side]]
            page.goto(base + "?model=Tessellations/miura-ori.svg")
            page.wait_for_timeout(2000)
            page.evaluate("(fold) => window.postMessage({op: 'importFold', fold: fold}, '*')", fold3)
            page.wait_for_function("(t) => $('#computePanel').is(':visible') && $('#computeTitle').text() === t && $('#computeOutputs .computeRow').length > 0",
                                   arg=fold3["file_title"], timeout=20000)
            warning = page.evaluate("() => $('#warningMessage').text()")
            if warning:
                failures.append(("3d fold warning", frame, warning))
            for a, b in itertools.product([False, True], repeat=2):
                set_input(page, "A", a)
                set_input(page, "B", b)
                page.wait_for_timeout(150)
                got = panel_state(page)["outputs"].get("A NOR B")
                want = "TRUE" if not (a or b) else "FALSE"
                print(f"nor.fold in 3D ({frame}): A={a!s:5} B={b!s:5} -> {got} (expected {want}) {'ok' if got == want else 'MISMATCH'}")
                if got != want:
                    failures.append(("nor 3d", frame, a, b, got, want))

        # a regular pattern must hide the panel again
        page.goto(base + "?model=Tessellations/miura-ori.svg")
        page.wait_for_timeout(2500)
        if panel_state(page)["visible"]:
            failures.append("panel visible for a regular pattern")
        browser.close()
    server.shutdown()

    real_errors = [e for e in errors if "googletagmanager" not in e and "net::ERR" not in e]
    if real_errors:
        print("browser errors:")
        for e in real_errors[:20]:
            print("  ", e)
    print("FAILURES:" if failures else "All browser checks passed.", *failures, sep="\n  ")
    sys.exit(1 if failures or real_errors else 0)


if __name__ == "__main__":
    main()
