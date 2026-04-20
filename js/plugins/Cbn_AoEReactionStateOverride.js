/*:
 * @target MZ
 * @plugindesc [v1.0] SRPG: autorise la reaction AoE (mode false) si la cible porte un etat avec <srpgReactionSkill:X>.
 * @author Pokemon Carbonne Arena
 *
 * @help
 * Correctif de compatibilite pour SRPG_core_MZ.
 *
 * Objectif:
 * - Garder AoEReactionMode = false (pas de reaction AoE par defaut)
 * - Autoriser une exception si la cible possede au moins un etat avec:
 *   <srpgReactionSkill:X>
 *   avec X != 0
 *
 * Comportement:
 * - En dehors des AoE: inchange.
 * - Si AoEReactionMode est different de "false": inchange.
 * - Si AoEReactionMode = "false" et cible sans etat reaction: pas de reaction.
 * - Si AoEReactionMode = "false" et cible avec etat reaction: reaction autorisee.
 *
 * Placez ce plugin APRES SRPG_core_MZ.
 */

(() => {
  "use strict";

  const PLUGIN_NAME = "Cbn_AoEReactionStateOverride";

  function hasStateReactionSkillTag(battler) {
    if (!battler || !battler.states) return false;
    const states = battler.states();
    if (!Array.isArray(states) || states.length === 0) return false;
    for (const state of states) {
      if (!state || !state.meta) continue;
      if (!Object.prototype.hasOwnProperty.call(state.meta, "srpgReactionSkill")) continue;
      const raw = state.meta.srpgReactionSkill;
      const skillId = Number(raw);
      if (Number.isFinite(skillId) && skillId !== 0) return true;
    }
    return false;
  }

  const _Game_System_counterModeValid = Game_System.prototype.counterModeValid;
  Game_System.prototype.counterModeValid = function(targetEvent) {
    if (!$gameTemp || !$gameTemp._activeAoE) {
      return _Game_System_counterModeValid.call(this, targetEvent);
    }

    // On n'intervient que pour le mode "false" (no AoE counter).
    const aoeMode = this.AoEReactionMode ? String(this.AoEReactionMode()) : "";
    if (aoeMode !== "false") {
      return _Game_System_counterModeValid.call(this, targetEvent);
    }

    if (!targetEvent || !targetEvent.eventId || !$gameSystem || !$gameSystem.EventToUnit) {
      return false;
    }

    const targetArray = $gameSystem.EventToUnit(targetEvent.eventId());
    const targetBattler = targetArray && targetArray[1] ? targetArray[1] : null;
    if (!targetBattler) return false;

    // Exception: la cible a un etat porteur de <srpgReactionSkill:X>.
    if (hasStateReactionSkillTag(targetBattler)) {
      return true;
    }
    return false;
  };

  if (Utils && Utils.isOptionValid && Utils.isOptionValid("test")) {
    console.log(`[${PLUGIN_NAME}] Loaded`);
  }
})();
