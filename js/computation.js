/**
 * Computation mode: patterns with optional creases.
 *
 * When an imported crease pattern contains optional creases (creases that may fold or
 * stay flat), this module asks CreaseLogic which of them must fold for the chosen
 * input wire values, shows the resulting outputs, and hands the decided pattern to
 * the regular simulation so it folds. Inactive optional creases are kept as flat
 * facet creases so edge indices stay stable between solves.
 *
 * Wires are described by probe points lying on their optional creases:
 *   {name, role: "input"|"output", true: [[x, y]], false: [[x, y]]}
 * A wire is TRUE when the creases under its "true" probes fold and those under its
 * "false" probes stay flat (and FALSE the other way around). FOLD files carry them in
 * "computation:wires"; SVG files in a <metadata id="computation"> JSON block.
 */

function initComputation(globals){

    var CL = window.CreaseLogic;
    var MAX_TRUTH_TABLE_INPUTS = 6;
    var state = null;
    var $panel = $("#computePanel");

    function isComputational(fold){
        return CL.hasOptionalCreases(fold);
    }

    function normalize(fold){
        var f = JSON.parse(JSON.stringify(fold));
        var opt = f.edges_optional || [];
        var n = f.edges_vertices.length;
        f.edges_optional = [];
        if (!f.edges_foldAngle) f.edges_foldAngle = [];
        for (var i=0;i<n;i++){
            var a = f.edges_assignment[i];
            var o = !!opt[i];
            if (a === "OM"){ a = "M"; o = true; }
            else if (a === "OV"){ a = "V"; o = true; }
            else if (a === "OU"){ a = "U"; o = true; }
            f.edges_assignment[i] = a;
            f.edges_optional.push(o && (a === "M" || a === "V" || a === "U"));
            if (f.edges_foldAngle[i] === undefined){
                f.edges_foldAngle[i] = a === "M" ? -180 : (a === "V" ? 180 : (a === "F" ? 0 : null));
            }
        }
        //work in 2D: Origami Simulator stores flat patterns as [x, 0, z], other tools as [x, y, 0]
        var coords = f.vertices_coords;
        if (coords.length && coords[0].length === 3){
            var flatY = _.every(coords, function(v){ return Math.abs(v[1]) < 1e-9; });
            var flatZ = _.every(coords, function(v){ return Math.abs(v[2]) < 1e-9; });
            if (!flatY && !flatZ) throw new Error("optional creases need a flat (2D) crease pattern");
            var project = function(v){ return v.length === 3 ? (flatY ? [v[0], v[2]] : [v[0], v[1]]) : v; };
            f.vertices_coords = _.map(coords, project);
            //wire probes written in the same 3D frame
            _.each(f["computation:wires"] || [], function(w){
                _.each(["true", "false"], function(side){
                    var probes = w[side];
                    if (!probes || !probes.length) return;
                    w[side] = typeof probes[0] === "number" ? project(probes) : _.map(probes, project);
                });
            });
        }
        return f;
    }

    function patternTolerance(fold){
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (var i=0;i<fold.vertices_coords.length;i++){
            var v = fold.vertices_coords[i];
            minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]);
            minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]);
        }
        return 1e-3*Math.sqrt((maxX-minX)*(maxX-minX) + (maxY-minY)*(maxY-minY));
    }

    /**
     * Load a pattern with optional creases. Returns the result of building the
     * decided pattern (what pattern.processFold returns).
     */
    function load(fold, meta){
        var compFold, problem;
        try {
            compFold = normalize(fold);
            problem = CL.buildProblem(compFold);
        } catch (err){
            globals.warn("Unable to analyze optional creases: " + err.message);
            console.warn(err);
            return null;
        }
        var wireDefs = (meta && meta.wires) || compFold["computation:wires"] || [];
        var resolvedWires = CL.resolveWires(problem, wireDefs, patternTolerance(compFold));
        if (resolvedWires.unmatched.length){
            globals.warn("Some wire probes do not lie on a crease and were ignored: " +
                resolvedWires.unmatched.join(", "));
        }
        var values = {};
        for (var i=0;i<resolvedWires.wires.length;i++){
            var w = resolvedWires.wires[i];
            if (w.role === "input") values[w.name] = false;
        }
        state = {
            fold: compFold,
            problem: problem,
            wires: resolvedWires.wires,
            wireDefs: wireDefs,
            values: values,
            result: null,
            index: 0,
            edgeStates: null,
            title: fold.file_title || globals.filename || "Crease pattern",
            expected: (meta && meta.expected) || fold["computation:expected"] || null
        };
        $("#computeTruthTable").empty().hide();
        buildPanel();
        showPanel();
        return compute();
    }

    function clear(){
        state = null;
        $panel.hide();
        $("body").removeClass("computing");
    }

    function compute(){
        if (!state) return null;
        var pins = CL.pinsForInputs(state.wires, state.values);
        state.result = CL.solve(state.problem, pins, {maxSolutions: 64});
        state.index = 0;
        updatePanel();
        if ($("#computeTruthTable").is(":visible")) renderTruthTable();
        return applyCurrent();
    }

    function currentStates(){
        var sol = state.result && state.result.solutions[state.index];
        if (sol) return sol;
        //nothing folds flat: show the mandatory creases only, so the problem is visible
        var states = [];
        for (var i=0;i<state.fold.edges_vertices.length;i++) states.push(CL.OFF);
        return states;
    }

    function applyCurrent(){
        state.edgeStates = currentStates();
        var resolved = CL.applySolution(state.fold, state.edgeStates);
        return globals.pattern.setResolvedFold(resolved);
    }

    // ---------- panel ----------

    function valueLabel(v){
        if (v === true) return "TRUE";
        if (v === false) return "FALSE";
        return "?";
    }

    function buildPanel(){
        $("#computeTitle").text(state.title);
        var $inputs = $("#computeInputs").empty();
        var inputs = state.wires.filter(function(w){ return w.role === "input"; });
        if (!inputs.length){
            $inputs.html("<div class='smallTxt'>No input wires defined: browse the valid configurations below.</div>");
        }
        _.each(inputs, function(w){
            var $row = $("<div class='computeRow'></div>");
            $row.append($("<span class='computeName'></span>").text(w.name));
            var $group = $("<div class='btn-group computeToggle'></div>");
            _.each([false, true], function(val){
                var $btn = $("<a href='#' class='btn btn-default btn-sm'></a>").text(valueLabel(val));
                $btn.click(function(e){
                    e.preventDefault();
                    state.values[w.name] = val;
                    compute();
                });
                $btn.data("value", val);
                $group.append($btn);
            });
            $row.append($group);
            $row.data("wire", w.name);
            $inputs.append($row);
        });
    }

    function updatePanel(){
        var result = state.result;
        $("#computeInputs .computeRow").each(function(){
            var name = $(this).data("wire");
            $(this).find(".btn").each(function(){
                $(this).toggleClass("active", $(this).data("value") === state.values[name]);
            });
        });
        var $outputs = $("#computeOutputs").empty();
        var outputs = state.wires.filter(function(w){ return w.role === "output"; });
        var sol = result.solutions[state.index];
        _.each(outputs, function(w){
            var values = _.uniq(_.map(result.solutions, function(s){ return CL.wireValue(s, w); }));
            var v = sol ? CL.wireValue(sol, w) : null;
            var $row = $("<div class='computeRow'></div>");
            $row.append($("<span class='computeName'></span>").text(w.name));
            var cls = v === true ? "computeTrue" : (v === false ? "computeFalse" : "computeUnknown");
            $row.append($("<span class='computeValue'></span>").addClass(cls).text(valueLabel(v)));
            if (values.length > 1) $row.append($("<span class='smallTxt'> (not determined)</span>"));
            $outputs.append($row);
        });

        var msg;
        var n = result.solutions.length;
        if (result.status === "infeasible"){
            msg = "This pattern cannot fold flat for any choice of optional creases " +
                "(vertex " + result.conflictVertex + " has no valid assignment).";
        } else if (result.status === "conflict" && !n){
            msg = "No flat-foldable configuration exists for these inputs.";
        } else if (result.status === "limit"){
            msg = "Search limit reached after " + n + " configurations.";
        } else {
            msg = n + (result.truncated ? "+" : "") + " valid configuration" + (n === 1 && !result.truncated ? "" : "s") + ". ";
            if (n === 1 && result.forced === result.variables){
                msg += "Every optional crease (" + result.variables + ") is forced by the inputs; no search needed.";
            } else {
                msg += result.forced + " of " + result.variables + " optional creases forced by propagation, " +
                    result.nodes + " search nodes.";
            }
        }
        msg += " (" + result.ms.toFixed(1) + " ms)";
        $("#computeStatus").text(msg);

        if (n > 1){
            $("#computeSolutionLabel").text("Configuration " + (state.index+1) + " of " + n + (result.truncated ? "+" : ""));
            $("#computeSolutionNav").show();
        } else {
            $("#computeSolutionNav").hide();
        }
        var inputCount = _.keys(state.values).length;
        $("#computeTruthTableButton").toggle(inputCount > 0 && inputCount <= MAX_TRUTH_TABLE_INPUTS);
    }

    function step(delta){
        if (!state || !state.result) return;
        var n = state.result.solutions.length;
        if (n < 2) return;
        state.index = (state.index + delta + n) % n;
        updatePanel();
        applyCurrent();
    }

    function renderTruthTable(){
        var inputs = state.wires.filter(function(w){ return w.role === "input"; });
        var outputs = state.wires.filter(function(w){ return w.role === "output"; });
        var $table = $("<table class='computeTable'></table>");
        var $head = $("<tr></tr>");
        _.each(inputs.concat(outputs), function(w){ $head.append($("<th></th>").text(w.name)); });
        if (state.expected) $head.append("<th>check</th>");
        $table.append($head);
        var rows = 1 << inputs.length;
        for (var r=0;r<rows;r++){
            var values = {};
            _.each(inputs, function(w, i){ values[w.name] = !!(r & (1 << (inputs.length - 1 - i))); });
            var result = CL.solve(state.problem, CL.pinsForInputs(state.wires, values), {maxSolutions: 4});
            var $tr = $("<tr></tr>");
            var current = _.every(inputs, function(w){ return state.values[w.name] === values[w.name]; });
            if (current) $tr.addClass("computeCurrentRow");
            _.each(inputs, function(w){ $tr.append($("<td></td>").text(valueLabel(values[w.name]))); });
            var outValues = [];
            _.each(outputs, function(w){
                var vals = _.uniq(_.map(result.solutions, function(s){ return CL.wireValue(s, w); }));
                var v = vals.length === 1 ? vals[0] : null;
                outValues.push(v);
                var text = result.solutions.length ? valueLabel(v) : "no fold";
                $tr.append($("<td></td>").text(text).addClass(v === true ? "computeTrue" : (v === false ? "computeFalse" : "")));
            });
            if (state.expected){
                var row = _.find(state.expected, function(e){
                    return _.every(inputs, function(w){ return e.inputs[w.name] === values[w.name]; });
                });
                var ok = row && outValues.length === 1 && outValues[0] === row.output;
                $tr.append($("<td></td>").text(row ? (ok ? "✓" : "✗") : ""));
            }
            $table.append($tr);
        }
        $("#computeTruthTable").empty().append($table).show();
    }

    function showPanel(){
        if (!state) return;
        $("body").addClass("computing");//hides the first-visit "load more patterns" hint under the panel
        if ($("#controls").css("right") === "0px") return;//advanced options open
        $panel.show();
    }

    $("#computePrev").click(function(e){ e.preventDefault(); step(-1); });
    $("#computeNext").click(function(e){ e.preventDefault(); step(1); });
    $("#computeTruthTableButton").click(function(e){
        e.preventDefault();
        if ($("#computeTruthTable").is(":visible")) $("#computeTruthTable").hide();
        else renderTruthTable();
    });
    $("#showAdvancedOptions").click(function(){ $panel.hide(); });
    $("#hideAdvancedOptions").click(function(){ window.setTimeout(showPanel, 600); });

    // ---------- pattern view decorations ----------

    function edgeStyle(index){
        if (!state || !state.edgeStates || index >= state.fold.edges_optional.length) return null;
        if (!state.fold.edges_optional[index]) return null;
        var s = state.edgeStates[index];
        if (s === CL.OFF) return {stroke: "#bbbbbb", opacity: 1, dash: true, widthScale: 0.8};
        return {stroke: s === CL.MOUNTAIN ? "#f00" : "#00f", opacity: 1, dash: false, widthScale: 1.8};
    }

    function wireLabels(){
        if (!state || !state.edgeStates) return [];
        var labels = [];
        _.each(state.wires, function(w, i){
            var def = state.wireDefs[i];
            if (!def) return;
            var v = CL.wireValue(state.edgeStates, w);
            var probes = v === false ? def["false"] : def["true"];
            if (!probes || !probes.length) return;
            var p = typeof probes[0] === "number" ? probes : probes[0];
            labels.push({x: p[0], y: p[1], text: w.name + " = " + valueLabel(v), value: v, role: w.role});
        });
        return labels;
    }

    return {
        isComputational: isComputational,
        load: load,
        clear: clear,
        compute: compute,
        edgeStyle: edgeStyle,
        wireLabels: wireLabels,
        isActive: function(){ return !!state; },
        getState: function(){ return state; }//for debugging and tests
    };
}
