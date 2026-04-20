/*:
 * @target MZ
 * @plugindesc [v1.0] Vol de vie sur le lanceur base sur les degats reels infliges via note-tag.
 * @author Pokemon Carbonne Arena
 *
 * @param enableInSRPG
 * @text Actif en mode SRPG
 * @type boolean
 * @on Oui
 * @off Non
 * @default true
 * @desc Si Non, le vol de vie ne s'applique pas pendant les combats SRPG.
 *
 * @help
 * Ajoutez une note-tag sur une competence:
 *
 *   <lifeStealRealDamagePercent:50>
 *
 * Effet:
 * - Le lanceur recupere 50% des degats reels infliges a la cible.
 * - "Degats reels" = PV effectivement perdus apres reductions/resistances.
 *
 * Notes:
 * - Le soin est applique apres executeHpDamage.
 * - En multi-cible, le soin est applique pour chaque cible touchee (cumulatif).
 * - Pas de soin si les degats reels <= 0.
 * - Les competences de type Drain sont ignorees pour eviter un double vol de vie.
 */

(() => {
  "use strict";

  const PLUGIN_NAME = "SkillLifeStealByRealDamage";
  const params = PluginManager.parameters(PLUGIN_NAME);
  const ENABLE_IN_SRPG = params.enableInSRPG !== "false";
  const LIFE_STEAL_TAG = /<lifeStealRealDamagePercent\s*:\s*(-?\d+(?:\.\d+)?)\s*>/i;

  function lifeStealRateFromItem(item) {
    if (!item || !item.note) return 0;
    const match = String(item.note).match(LIFE_STEAL_TAG);
    if (!match) return 0;
    const n = Number(match[1]);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n / 100;
  }

  const _Game_Action_executeHpDamage = Game_Action.prototype.executeHpDamage;
  Game_Action.prototype.executeHpDamage = function(target, value) {
    _Game_Action_executeHpDamage.call(this, target, value);

    if (!ENABLE_IN_SRPG && $gameSystem && $gameSystem.isSRPGMode && $gameSystem.isSRPGMode()) {
      return;
    }
    if (value == null || value <= 0) return;
    if (!target || !target.result) return;
    if (this.isDrain && this.isDrain()) return; // Evite le cumul avec le drain natif.

    const realHpDamage = Number(target.result().hpDamage || 0);
    if (!Number.isFinite(realHpDamage) || realHpDamage <= 0) return;

    const item = this.item ? this.item() : null;
    const rate = lifeStealRateFromItem(item);
    if (rate <= 0) return;

    const subject = this.subject ? this.subject() : null;
    if (!subject || !subject.gainHp) return;

    const healValue = Math.floor(realHpDamage * rate);
    if (healValue <= 0) return;
    subject.gainHp(healValue);
    if (subject.refresh) subject.refresh();
  };
})();
