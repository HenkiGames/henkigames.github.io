/*:
 * @target MZ
 * @plugindesc Récup. PV (HRG) = −(tour × malus) pour certains états, sans plugin de formules.
 * @base RPG Maker MZ
 *
 * @param stateIds
 * @text IDs d'état (virgules)
 * @desc Ex. 45 ou 12,45. Si le combattant a l'un de ces états, son HRG est réduit selon le tour.
 * @default
 *
 * @param hrgPenaltyPerTurn
 * @text Malus HRG par tour
 * @desc 0.01 = 1 % du taux de récup. par point de tour (tour 5 → −0.05 si malus 0.01).
 * @type number
 * @decimals 4
 * @default 0.01
 *
 * @param turnVariableId
 * @text Variable « tour » (0 = auto)
 * @desc 0 = $gameTroop.turnCount(). Sinon ex. 3 si tu préfères la variable SRPG (turnVarID).
 * @type variable
 * @default 0
 *
 * @help
 * Place équipement / états : enlève le trait fixe « Récup. PV −1 % » sur cet état si tu veux
 * uniquement le malus dynamique (sinon les deux s’additionnent).
 * Avec SRPG_core, turnCount() renvoie déjà le bon tour en combat tactique.
 */

(() => {
    "use strict";

    const pluginName = "Cbn_StateHRGScaleByTurn";
    const params = PluginManager.parameters(pluginName);
    const STATE_IDS = String(params.stateIds || "")
        .split(/[,;\s]+/)
        .map(s => Number(String(s).trim()))
        .filter(id => id > 0);
    const PENALTY = Number(params.hrgPenaltyPerTurn);
    const malusPerTurn = Number.isFinite(PENALTY) ? PENALTY : 0.01;
    const TURN_VAR = Number(params.turnVariableId || 0);
    const HRG_ID = 7;

    if (!STATE_IDS.length) return;

    function currentTurn() {
        if (TURN_VAR > 0) {
            return Math.max(0, Number($gameVariables.value(TURN_VAR)) || 0);
        }
        if ($gameTroop && typeof $gameTroop.turnCount === "function") {
            return Math.max(0, $gameTroop.turnCount());
        }
        return 0;
    }

    function hasTrackedState(battler) {
        if (!STATE_IDS.length) return false;
        for (let i = 0; i < STATE_IDS.length; i++) {
            if (battler.isStateAffected(STATE_IDS[i])) return true;
        }
        return false;
    }

    const _Game_BattlerBase_xparam = Game_BattlerBase.prototype.xparam;
    Game_BattlerBase.prototype.xparam = function (xparamId) {
        let value = _Game_BattlerBase_xparam.call(this, xparamId);
        if (xparamId === HRG_ID && hasTrackedState(this)) {
            value -= currentTurn() * malusPerTurn;
        }
        return value;
    };
})();
