/*:
 * @target MZ
 * @plugindesc [v1.0] Recoil sur le lanceur base sur les degats reels infliges via note-tag.
 * @author ChatGPT
 *
 * @param allowDeathByRecoil
 * @text Autoriser le KO par recoil
 * @type boolean
 * @on Oui
 * @off Non
 * @default false
 * @desc Si Non, le recoil laisse toujours le lanceur a 1 PV minimum.
 *
 * @help
 * Ajoutez une note-tag sur une competence:
 *
 *   <recoilRealDamagePercent:25>
 *
 * Effet:
 * - Le lanceur perd 25% des degats reels subis par la cible.
 * - Les degats reels incluent reductions/mitigations appliquees par le moteur
 *   (ce qui est effectivement retire en PV a la cible).
 *
 * Notes:
 * - Le recoil est applique apres executeHpDamage.
 * - Si la competence touche plusieurs cibles, le recoil est applique pour
 *   chaque cible touchee (cumulatif).
 * - Pas de recoil si les degats reels <= 0.
 * - Si allowDeathByRecoil = false, le lanceur ne descend jamais sous 1 PV.
 */

(() => {
  "use strict";

  const PLUGIN_NAME = "SkillRecoilByRealDamage";
  const params = PluginManager.parameters(PLUGIN_NAME);
  const ALLOW_DEATH_BY_RECOIL = params.allowDeathByRecoil === "true";
  const RECOIL_TAG = /<recoilRealDamagePercent\s*:\s*(-?\d+(?:\.\d+)?)\s*>/i;

  function recoilRateFromItem(item) {
    if (!item || !item.note) return 0;
    const match = String(item.note).match(RECOIL_TAG);
    if (!match) return 0;
    const n = Number(match[1]);
    if (!Number.isFinite(n) || n === 0) return 0;
    return n / 100;
  }

  function applyRecoil(subject, recoilValue) {
    if (!subject || !subject.gainHp || recoilValue <= 0) return;
    const currentHp = Number(subject.hp || 0);
    if (!ALLOW_DEATH_BY_RECOIL) {
      const safeRecoil = Math.max(0, Math.min(recoilValue, Math.max(0, currentHp - 1)));
      if (safeRecoil <= 0) return;
      subject.gainHp(-safeRecoil);
    } else {
      subject.gainHp(-recoilValue);
    }
    if (subject.refresh) subject.refresh();
  }

  const _Game_Action_executeHpDamage = Game_Action.prototype.executeHpDamage;
  Game_Action.prototype.executeHpDamage = function(target, value) {
    _Game_Action_executeHpDamage.call(this, target, value);

    if (value == null || value <= 0) return;
    if (!target || !target.result) return;
    const realHpDamage = Number(target.result().hpDamage || 0);
    if (!Number.isFinite(realHpDamage) || realHpDamage <= 0) return;

    const item = this.item ? this.item() : null;
    const rate = recoilRateFromItem(item);
    if (rate <= 0) return;

    const subject = this.subject ? this.subject() : null;
    const recoilValue = Math.floor(realHpDamage * rate);
    if (recoilValue <= 0) return;
    applyRecoil(subject, recoilValue);
  };
})();
