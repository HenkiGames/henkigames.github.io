/*:
 * @target MZ
 * @plugindesc [v1.0] SRPG: affiche aussi les acteurs en reserve dans les scenes de statut/menu.
 * @author Carbonne Arena
 *
 * @help
 * En mode SRPG, le core limite souvent la liste d'acteurs aux unites presentes
 * sur la carte. Ce plugin restaure la liste complete du groupe (reserve incluse)
 * uniquement dans les scenes de consultation:
 * - Menu
 * - Statut
 * - Competences
 * - Equipement
 *
 * But: pouvoir consulter les details des acteurs en reserve pendant un combat SRPG.
 *
 * Placez ce plugin APRES SRPG_core_MZ (et idealement apres SRPG_BattlePrepare_MZ).
 */

(() => {
  "use strict";

  function isSrpgStatusContext() {
    if (!$gameSystem || !$gameSystem.isSRPGMode || !$gameSystem.isSRPGMode()) {
      return false;
    }
    const scene = SceneManager._scene;
    if (!scene) return false;
    return (
      scene instanceof Scene_Menu ||
      scene instanceof Scene_Status ||
      scene instanceof Scene_Skill ||
      scene instanceof Scene_Equip
    );
  }

  function fullPartyFromActorIds(party) {
    const ids = Array.isArray(party._actors) ? party._actors : [];
    const list = [];
    for (const id of ids) {
      const actor = $gameActors.actor(id);
      if (actor) list.push(actor);
    }
    return list;
  }

  const _Game_Party_members_CbnStatusShowReserve = Game_Party.prototype.members;
  Game_Party.prototype.members = function() {
    const members = _Game_Party_members_CbnStatusShowReserve.call(this);
    if (!isSrpgStatusContext()) return members;
    const fullList = fullPartyFromActorIds(this);
    return fullList.length > 0 ? fullList : members;
  };

  // En menu SRPG, MK_UICustomizer dessine une jauge HP/MP/TP sous l'image.
  // On la masque pour afficher une seule jauge HP personnalisee dans le bloc statut.
  const _Window_MenuStatus_drawActorHpMpTp_CbnStatusShowReserve =
    Window_MenuStatus.prototype.drawActorHpMpTp;
  Window_MenuStatus.prototype.drawActorHpMpTp = function(actor, x, y) {
    if ($gameSystem && $gameSystem.isSRPGMode && $gameSystem.isSRPGMode()) return;
    _Window_MenuStatus_drawActorHpMpTp_CbnStatusShowReserve.call(this, actor, x, y);
  };

  // Avec SRPG_BattleUI (menuActorDisplayCount = 5), on dessine une jauge HP unique
  // + texte "PV actuels / PV max" directement dans le bloc statut de l'acteur.
  Window_StatusBase.prototype.drawActorSimpleStatus16 = function(actor, x, y) {
    if (!$gameSystem || !$gameSystem.isSRPGMode || !$gameSystem.isSRPGMode()) {
      this.drawActorName(actor, x, y, 124);
      this.drawActorLevel(actor, x + 32, y + this.lineHeight() * 2 + 28);
      return;
    }
    if (!actor) return;
    this.drawActorName(actor, x, y, 124);
    const gaugeY = y + this.lineHeight() * 2 + 44;
    const baseGaugeWidth = this.gaugeWidth ? this.gaugeWidth() : 128;
    const gaugeWidth = Math.max(20, baseGaugeWidth - 20);
    const gaugeX = x + Math.floor((baseGaugeWidth - gaugeWidth) / 2);
    this.drawGauge(
      gaugeX,
      gaugeY,
      gaugeWidth,
      actor.hpRate(),
      ColorManager.hpGaugeColor1(),
      ColorManager.hpGaugeColor2()
    );
    this.changeTextColor(ColorManager.normalColor());
    this.drawText(actor.hp + " / " + actor.mhp, gaugeX, gaugeY - 1, gaugeWidth, "center");
    this.resetTextColor();
  };
})();
