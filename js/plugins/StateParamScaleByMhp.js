/*:
 * @target MZ
 * @plugindesc [v1.2] Etats: scaling par MHP + critique selon % PV perdus (note-tags).
 * @author ChatGPT
 *
 * @help
 * Ajoutez ces note-tags directement dans la NOTE d'un etat:
 *
 * 1) Palier HP max obligatoire pour activer le scaling
 *    <scaleStatsByMhp:50>
 *
 * 2) Stats touchees (optionnel)
 *    <scaleParams:atk,def,mat,mdf,agi,luk>
 *
 * 3) Valeur de bonus par palier (optionnel, defaut: 1)
 *    <scaleAmount:2>
 *
 * 4) Critique selon % PV perdus (optionnel)
 *    <critPerMissingHpPercent:1>
 *    -> +1% taux critique pour chaque 1% de PV perdu.
 *
 * Si <scaleParams> est absent, le plugin applique par defaut:
 * atk,def,mat,mdf,agi,luk
 *
 * Formule:
 * bonus = floor(MHP / palier) * amount
 * Chaque stat de la liste recoit +bonus.
 *
 * Notes:
 * - MHP utilise est la valeur finale courante (this.mhp), donc equipements et
 *   modificateurs permanents sont pris en compte.
 * - Les parametres MHP (0) et MMP (1) peuvent aussi etre cibles si vous les
 *   indiquez explicitement dans <scaleParams:...>.
 * - Le tag <critPerMissingHpPercent:x> agit sur l'xparam critique (id 2).
 */

(() => {
  "use strict";

  const PLUGIN_NAME = "StateParamScaleByMhp";
  const SCALE_STEP_TAG = /<scaleStatsByMhp\s*:\s*(\d+)\s*>/i;
  const SCALE_PARAMS_TAG = /<scaleParams\s*:\s*([^>]+)\s*>/i;
  const SCALE_AMOUNT_TAG = /<scaleAmount\s*:\s*(-?\d+)\s*>/i;
  const CRIT_PER_MISSING_HP_PERCENT_TAG = /<critPerMissingHpPercent\s*:\s*(-?\d+(?:\.\d+)?)\s*>/i;
  const DEFAULT_PARAMS = [2, 3, 4, 5, 6, 7]; // atk,def,mat,mdf,agi,luk
  const XPARAM_CRIT_ID = 2;

  const PARAM_NAME_TO_ID = {
    mhp: 0,
    hp: 0,
    mmp: 1,
    mp: 1,
    atk: 2,
    def: 3,
    mat: 4,
    int: 4,
    mdf: 5,
    agi: 6,
    luk: 7,
  };

  function parseScaleStep(note) {
    if (!note) return 0;
    const match = String(note).match(SCALE_STEP_TAG);
    if (!match) return 0;
    const n = Number(match[1]);
    return Number.isInteger(n) && n > 0 ? n : 0;
  }

  function parseScaleParams(note) {
    if (!note) return DEFAULT_PARAMS.slice();
    const match = String(note).match(SCALE_PARAMS_TAG);
    if (!match) return DEFAULT_PARAMS.slice();

    const rawList = String(match[1] || "");
    const tokens = rawList
      .split(",")
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);

    const out = [];
    const seen = new Set();
    for (const token of tokens) {
      const maybeNumber = Number(token);
      const paramId = Number.isInteger(maybeNumber)
        ? maybeNumber
        : PARAM_NAME_TO_ID[token];
      if (!Number.isInteger(paramId)) continue;
      if (paramId < 0 || paramId > 7) continue;
      if (seen.has(paramId)) continue;
      seen.add(paramId);
      out.push(paramId);
    }
    return out.length > 0 ? out : DEFAULT_PARAMS.slice();
  }

  function parseScaleAmount(note) {
    if (!note) return 1;
    const match = String(note).match(SCALE_AMOUNT_TAG);
    if (!match) return 1;
    const n = Number(match[1]);
    return Number.isInteger(n) ? n : 1;
  }

  function parseCritPerMissingHpPercent(note) {
    if (!note) return 0;
    const match = String(note).match(CRIT_PER_MISSING_HP_PERCENT_TAG);
    if (!match) return 0;
    const n = Number(match[1]);
    return Number.isFinite(n) ? n : 0;
  }

  function ensureStateScaleCache(state) {
    if (!state) return null;
    if (state._cbnMhpScaleCache) {
      return state._cbnMhpScaleCache;
    }
    const cache = {
      step: parseScaleStep(state.note),
      params: parseScaleParams(state.note),
      amount: parseScaleAmount(state.note),
      critPerMissingHpPercent: parseCritPerMissingHpPercent(state.note),
    };
    state._cbnMhpScaleCache = cache;
    return cache;
  }

  function scaledBonusForParam(battler, paramId) {
    if (!battler || typeof battler.states !== "function") return 0;
    const states = battler.states();
    if (!Array.isArray(states) || states.length === 0) return 0;

    let total = 0;
    for (const state of states) {
      const cache = ensureStateScaleCache(state);
      if (!cache || cache.step <= 0) continue;
      if (!cache.params.includes(paramId)) continue;
      const bonus = Math.floor(Math.max(0, battler.mhp) / cache.step) * cache.amount;
      if (bonus > 0) {
        total += bonus;
      }
    }
    return total;
  }

  function missingHpPercent(battler) {
    if (!battler) return 0;
    const mhp = Math.max(0, Number(battler.mhp) || 0);
    if (mhp <= 0) return 0;
    const hp = Math.max(0, Math.min(mhp, Number(battler.hp) || 0));
    return ((mhp - hp) / mhp) * 100;
  }

  function scaledCritBonusForMissingHp(battler) {
    if (!battler || typeof battler.states !== "function") return 0;
    const states = battler.states();
    if (!Array.isArray(states) || states.length === 0) return 0;

    const missingPct = missingHpPercent(battler);
    if (missingPct <= 0) return 0;

    let total = 0;
    for (const state of states) {
      const cache = ensureStateScaleCache(state);
      if (!cache) continue;
      const gainPerLostPct = Number(cache.critPerMissingHpPercent) || 0;
      if (!Number.isFinite(gainPerLostPct) || gainPerLostPct === 0) continue;
      // xparam est en valeur décimale: +1% => +0.01
      total += (missingPct * gainPerLostPct) / 100;
    }
    return total;
  }

  const _Game_BattlerBase_paramPlus = Game_BattlerBase.prototype.paramPlus;
  Game_BattlerBase.prototype.paramPlus = function(paramId) {
    const base = _Game_BattlerBase_paramPlus.call(this, paramId);
    return base + scaledBonusForParam(this, paramId);
  };

  const _Game_BattlerBase_xparam = Game_BattlerBase.prototype.xparam;
  Game_BattlerBase.prototype.xparam = function(xparamId) {
    const base = _Game_BattlerBase_xparam.call(this, xparamId);
    if (xparamId !== XPARAM_CRIT_ID) return base;
    return base + scaledCritBonusForMissingHp(this);
  };

  if (Utils && Utils.isOptionValid && Utils.isOptionValid("test")) {
    console.log(`[${PLUGIN_NAME}] Loaded`);
  }
})();
