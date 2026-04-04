/*:
 * @target MZ
 * @plugindesc SRPG — Phase ennemie en premier sur certaines cartes (liste d’IDs ou switch).
 * @author Carbonne Arena
 *
 * @param mapIdList
 * @text IDs de carte (virgules)
 * @desc Ex. 11,15. Laisse vide si tu utilises uniquement le switch ci‑dessous.
 * @default
 *
 * @param switchId
 * @text Switch « ennemis d’abord »
 * @desc Si > 0 : ce switch ON active l’effet sur la carte courante (en plus de la liste).
 * @type switch
 * @default 0
 *
 * @param skipTurnPlusAfterOpenEnemy
 * @text Ne pas +1 tour après la salve ennemie initiale
 * @desc Si Oui, le compteur de tour (variable SRPG) ne monte pas entre la première salve ennemie et la phase alliée.
 * @type boolean
 * @on Oui
 * @off Non
 * @default true
 *
 * @help
 * À placer APRÈS SRPG_core_MZ et SRPG_BattlePrepare_MZ, de préférence AVANT BattleExchange.js
 * (pour rester compatible avec ses hooks sur srpgStartActorTurn).
 *
 * Au premier démarrage du tour acteur (début de bataille), si la carte ou le switch matche,
 * la phase passera tout de suite en phase ennemie. Ensuite le déroulement redevient normal.
 */

(() => {
    "use strict";

    const PLUGIN = "Cbn_SrpgEnemyFirstTurn";
    const p = PluginManager.parameters(PLUGIN);
    const MAP_IDS = String(p.mapIdList || "")
        .split(/[,;\s]+/)
        .map(s => Number(String(s).trim()))
        .filter(id => id > 0);
    const SWITCH_ID = Number(p.switchId || 0);
    const SKIP_TURN_PLUS = p.skipTurnPlusAfterOpenEnemy !== "false";

    function turnVarId() {
        return Number((PluginManager.parameters("SRPG_core_MZ") || {}).turnVarID || 3);
    }

    function enemyFirstWanted() {
        if (!$gameMap) return false;
        const mid = $gameMap.mapId();
        if (MAP_IDS.length && MAP_IDS.includes(mid)) return true;
        if (SWITCH_ID > 0 && $gameSwitches.value(SWITCH_ID)) return true;
        return false;
    }

    const _startSRPG = Game_System.prototype.startSRPG;
    Game_System.prototype.startSRPG = function () {
        this._cbnEnemyFirstConsumed = false;
        this._cbnSkipOneTurnPlusAfterEnemy = false;
        return _startSRPG.call(this);
    };

    const _srpgStartActorTurn = Game_System.prototype.srpgStartActorTurn;
    Game_System.prototype.srpgStartActorTurn = function () {
        _srpgStartActorTurn.call(this);
        if (!$gameSystem.isSRPGMode()) return;
        if (!enemyFirstWanted()) return;
        if (this._cbnEnemyFirstConsumed) return;
        if ($gameVariables.value(turnVarId()) !== 1) return;
        this._cbnEnemyFirstConsumed = true;
        if (SKIP_TURN_PLUS) this._cbnSkipOneTurnPlusAfterEnemy = true;
        this.srpgStartEnemyTurn();
    };

    const _srpgTurnPlus = Game_System.prototype.srpgTurnPlus;
    Game_System.prototype.srpgTurnPlus = function () {
        if (this._cbnSkipOneTurnPlusAfterEnemy) {
            this._cbnSkipOneTurnPlusAfterEnemy = false;
            return;
        }
        _srpgTurnPlus.call(this);
    };
})();

