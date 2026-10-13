/**
 * Runs Flat-Folder's layer-order solver headlessly on a FOLD crease pattern and
 * returns the number of valid flat-folded states (0 when none exist).
 * Mirrors the pipeline of Flat-Folder's web interface (src/compute.js), including its
 * import normalization. Requires a checkout of https://github.com/origamimagiro/flat-folder
 */
import path from "path";
import { pathToFileURL } from "url";

export async function loadFlatFolder(dir){
    const src = path.resolve(dir, "src");
    const mod = async f => import(pathToFileURL(path.join(src, f)).href);
    const { M } = await mod("math.js");
    const { NOTE } = await mod("note.js");
    const { CON } = await mod("constraints.js");
    const { IO } = await mod("io.js");
    const { X } = await mod("conversion.js");
    const { SOLVER } = await mod("solver.js");
    NOTE.show = false;
    const quiet = fn => {
        const log = console.log;
        console.log = () => {};
        try { return fn(); } finally { console.log = log; }
    };
    quiet(() => CON.build());
    return function countStates(fold, limit = 1000){
        return quiet(() => {
            const [V, , EV, EA, EF, FV] = IO.doc_type_side_2_V_VV_EV_EA_EF_FV_FE(JSON.stringify(fold), "fold", true);
            if (V === undefined) return {states: 0n, error: "import failed"};
            const [Vf, Ff] = X.V_FV_EV_EA_2_Vf_Ff(V, FV, EV, EA);
            const L = EV.map(P => M.expand(P, Vf));
            const [P, SP, SE] = X.L_2_V_EV_EL(L);
            if (P.length === 0) return {states: 0n, error: "precision"};
            const [, CP] = X.V_EV_2_VV_FV(P, SP);
            const [SC] = X.EV_FV_2_EF_FE(SP, CP);
            const [CF, FC] = X.EF_FV_P_SP_SE_CP_SC_2_CF_FC(EF, FV, P, SP, SE, CP, SC);
            const BF = X.EF_SP_SE_CP_CF_2_BF(EF, SP, SE, CP, CF);
            const BI = new Map();
            BF.forEach((F, i) => BI.set(F, i));
            const BT = X.BF_BI_EF_SE_CF_SC_2_BT(BF, BI, EF, SE, CF, SC);
            const CC = X.FC_BF_BI_BT_2_CC(FC, BF, BI, BT);
            const BA0 = SOLVER.EF_EA_Ff_BF_BI_2_BA0(EF, EA, Ff, BF, BI);
            const trans = {all: 0, reduced: 0};
            const BA = SOLVER.initial_assignment(BA0, BF, BT, BI, FC, CF, CC, trans);
            if (BA.length === 3 && BA[1].length !== undefined){
                return {states: 0n, error: `layer conflict: ${CON.names[BA[0]]}`};
            }
            const GB = SOLVER.get_components(BI, BF, BT, BA, FC, CF, CC, trans);
            const GA = SOLVER.solve(BI, BF, BT, BA, GB, FC, CF, CC, limit);
            if (GA.length === undefined) return {states: 0n, error: `component ${GA} unsolvable`};
            return {states: GA.reduce((s, A) => s*BigInt(A.length), 1n), faces: FV.length};
        });
    };
}
