/*:
 * @target MZ
 * @plugindesc [v1.1] Bonus de stats plats via States avec stack du meme state.
 * @author Pokemon Carbonne Arena
 *
 * @help
 * Ce plugin ajoute des bonus/malus de stats en valeur fixe
 * a partir des States actifs, avec support du stack du meme State.
 *
 * ============================================================================
 * Notetags (a ecrire dans la NOTE d'un State)
 * ============================================================================
 * Format principal:
 *   <flatParam: atk,+1>
 *   <flatParam: def,+2>
 *   <flatParam: agi,-1>
 *
 * Format alternatif accepte:
 *   <flatParam: atk +1>
 *
 * Stats acceptees:
 *   mhp, mmp, atk, def, mat, mdf, agi, luk
 * Ou directement l'index:
 *   0..7
 *
 * Mapping index -> stat:
 *   0:mhp 1:mmp 2:atk 3:def 4:mat 5:mdf 6:agi 7:luk
 *
 * ============================================================================
 * Stack du meme State
 * ============================================================================
 * - Un State avec <flatParam: ...> peut etre applique plusieurs fois.
 * - Chaque application ajoute 1 stack et reapplique la duree du State (comportement RM).
 * - Bonus total = bonus du State * nombre de stacks.
 * - Par defaut, max stack = 99.
 * - Tu peux definir une limite par State:
 *   <flatStackMax: 5>
 *
 * Exemple:
 *   State "Buff ATK +1" avec <flatParam: atk,+1> et <flatStackMax: 5>
 *   applique 3 fois => ATK +3.
 *
 * ============================================================================
 * Conseils d'utilisation
 * ============================================================================
 * - Cree des States "Buff ATK +1", "Buff DEF +2", etc.
 * - Dans les skills, applique ces States via les Effets.
 * - Regle la duree dans le State (tours auto-remove) selon ton equilibrage.
 *
 * Plugin order:
 * - Place ce plugin APRES SRPG_core_MZ (et apres les plugins qui touchent
 *   fortement le calcul de parametres), pour garantir l'ajout final du bonus.
 */

(() => {
  "use strict";

  const PLUGIN_NAME = "Cbn_FlatStatBuffs";

  const PARAM_ID_BY_NAME = Object.freeze({
    mhp: 0,
    mmp: 1,
    atk: 2,
    def: 3,
    mat: 4,
    mdf: 5,
    agi: 6,
    luk: 7
  });

  const _stateDataCache = new Map();

  function normalizeParamId(rawKey) {
    if (rawKey == null) return null;
    const key = String(rawKey).trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(PARAM_ID_BY_NAME, key)) {
      return PARAM_ID_BY_NAME[key];
    }
    const id = Number(key);
    if (Number.isInteger(id) && id >= 0 && id <= 7) return id;
    return null;
  }

  function parseFlatParamTagPayload(payload, bonusMap) {
    if (!payload) return;
    const text = String(payload).trim();
    if (!text) return;

    let match = text.match(/^([a-z0-7_]+)\s*,\s*([+-]?\d+)$/i);
    if (!match) {
      match = text.match(/^([a-z0-7_]+)\s+([+-]?\d+)$/i);
    }
    if (!match) return;

    const paramId = normalizeParamId(match[1]);
    if (paramId == null) return;

    const delta = Number(match[2]);
    if (!Number.isFinite(delta)) return;

    bonusMap[paramId] += delta;
  }

  function parseStateFlatData(state) {
    if (!state || !state.id) {
      return {
        bonuses: [0, 0, 0, 0, 0, 0, 0, 0],
        hasFlatParam: false,
        maxStack: 1
      };
    }
    if (_stateDataCache.has(state.id)) return _stateDataCache.get(state.id);

    const bonuses = [0, 0, 0, 0, 0, 0, 0, 0];
    const note = String(state.note || "");
    const tagRegex = /<flatParam\s*:\s*([^>]+)>/gi;
    let result;
    while ((result = tagRegex.exec(note)) !== null) {
      parseFlatParamTagPayload(result[1], bonuses);
    }

    const hasFlatParam = bonuses.some(value => value !== 0);
    const maxMatch = note.match(/<flatStackMax\s*:\s*(\d+)\s*>/i);
    const parsedMax = maxMatch ? Number(maxMatch[1]) : 99;
    const maxStack = Math.max(1, Number.isFinite(parsedMax) ? parsedMax : 99);

    const data = {
      bonuses: bonuses,
      hasFlatParam: hasFlatParam,
      maxStack: maxStack
    };
    _stateDataCache.set(state.id, data);
    return data;
  }

  function ensureFlatStackMap(battler) {
    if (!battler._cbnFlatStateStacks) {
      battler._cbnFlatStateStacks = {};
    }
    return battler._cbnFlatStateStacks;
  }

  function getFlatStateStackCount(battler, stateId) {
    if (!battler || !stateId || !battler.isStateAffected || !battler.isStateAffected(stateId)) {
      return 0;
    }
    const stacks = battler._cbnFlatStateStacks;
    if (stacks && Number(stacks[stateId]) > 0) {
      return Number(stacks[stateId]);
    }
    return 1;
  }

  function setFlatStateStackCount(battler, stateId, count) {
    const stacks = ensureFlatStackMap(battler);
    if (count > 0) {
      stacks[stateId] = count;
    } else {
      delete stacks[stateId];
    }
  }

  function stateFlatDataById(stateId) {
    return parseStateFlatData($dataStates[stateId]);
  }

  function flatBonusFromStates(battler, paramId) {
    if (!battler || !battler.states) return 0;
    return battler.states().reduce((sum, state) => {
      const data = parseStateFlatData(state);
      if (!data.hasFlatParam) return sum;
      const stacks = getFlatStateStackCount(battler, state.id);
      return sum + (data.bonuses[paramId] || 0) * stacks;
    }, 0);
  }

  const _Game_BattlerBase_paramPlus = Game_BattlerBase.prototype.paramPlus;
  Game_BattlerBase.prototype.paramPlus = function(paramId) {
    const base = _Game_BattlerBase_paramPlus.call(this, paramId);
    return base + flatBonusFromStates(this, paramId);
  };

  window.CbnFlatStatBuffs = window.CbnFlatStatBuffs || {};
  window.CbnFlatStatBuffs.flatBonusForParam = function(battler, paramId) {
    return flatBonusFromStates(battler, paramId);
  };
  window.CbnFlatStatBuffs.stateStackCount = function(battler, stateId) {
    return getFlatStateStackCount(battler, stateId);
  };

  const _Game_Battler_addState = Game_Battler.prototype.addState;
  Game_Battler.prototype.addState = function(stateId) {
    const hadStateBefore = this.isStateAffected(stateId);
    const stackBefore = getFlatStateStackCount(this, stateId);
    _Game_Battler_addState.call(this, stateId);

    const data = stateFlatDataById(stateId);
    if (!data.hasFlatParam) return;

    const hasStateAfter = this.isStateAffected(stateId);
    if (!hasStateAfter) {
      setFlatStateStackCount(this, stateId, 0);
      return;
    }

    if (hadStateBefore) {
      const nextStack = Math.min(data.maxStack, Math.max(1, stackBefore) + 1);
      setFlatStateStackCount(this, stateId, nextStack);
    } else {
      setFlatStateStackCount(this, stateId, 1);
    }
  };

  const _Game_Battler_removeState = Game_Battler.prototype.removeState;
  Game_Battler.prototype.removeState = function(stateId) {
    _Game_Battler_removeState.call(this, stateId);
    if (!this.isStateAffected(stateId)) {
      setFlatStateStackCount(this, stateId, 0);
    }
  };

  const _Game_BattlerBase_eraseState = Game_BattlerBase.prototype.eraseState;
  Game_BattlerBase.prototype.eraseState = function(stateId) {
    _Game_BattlerBase_eraseState.call(this, stateId);
    setFlatStateStackCount(this, stateId, 0);
  };

  const _Game_BattlerBase_clearStates = Game_BattlerBase.prototype.clearStates;
  Game_BattlerBase.prototype.clearStates = function() {
    _Game_BattlerBase_clearStates.call(this);
    this._cbnFlatStateStacks = {};
  };

  if (Utils && Utils.isOptionValid && Utils.isOptionValid("test")) {
    console.log(`[${PLUGIN_NAME}] Loaded`);
  }
})();
