/*:
 * @target MZ
 * @plugindesc [v1.1] Gestion simple des cooldowns de compétence (acteurs + ennemis) avec tag <cooldown:x>
 * @author ChatGPT
 *
 * @help
 * Ajoutez dans la fiche d'une compétence : <cooldown:X>
 * - X est le nombre de tours de cooldown après utilisation.
 * 
 * Le cooldown diminue à la fin du tour de chaque combattant.
 * Une compétence en cooldown ne peut pas être utilisée.
 *
 * Aucune commande plugin requise.
 */

(() => {
  const COOLDOWN_TAG = /<cooldown\s*:\s*(\d+)>/i;

  /**
   * Map battle SRPG : une compétence AoE enfile plusieurs srpgAddMapSkill (une entrée par cible).
   * Chaque entrée appelle useItem + canUse : si le cooldown est posé dès la 1ère cible,
   * canUse échoue pour les suivantes → un seul acteur touché.
   * On ne pose le cooldown qu'une fois qu'il ne reste plus d'entrée en file pour ce lanceur + cette compétence.
   */
  function hasPendingSrpgMapSkillSameSkill(battler, item) {
    if (!$gameSystem.isSRPGMode() || !$gameSystem.useMapBattle()) return false;
    if (!DataManager.isSkill(item)) return false;
    if (!item.meta || Number(item.meta.srpgAreaRange || 0) <= 0) return false;
    const scene = SceneManager._scene;
    if (!(scene instanceof Scene_Map) || !scene._srpgSkillList) return false;
    for (let i = 0; i < scene._srpgSkillList.length; i++) {
      const d = scene._srpgSkillList[i];
      if (!d || d.user !== battler || !d.action || !d.action.item()) continue;
      if (d.action.item().id !== item.id) continue;
      return true;
    }
    return false;
  }

  // Ajoute un dictionnaire pour les cooldowns à chaque combattant
  const _Game_Battler_initMembers = Game_Battler.prototype.initMembers;
  Game_Battler.prototype.initMembers = function() {
    _Game_Battler_initMembers.call(this);
    this._skillCooldowns = {};
  };

  // Applique le cooldown quand le skill est utilisé
  const _Game_Battler_useItem = Game_Battler.prototype.useItem;
  Game_Battler.prototype.useItem = function(item) {
    _Game_Battler_useItem.call(this, item);
    if (!DataManager.isSkill(item)) return;
    const cd = this.getSkillCooldownTurns(item);
    if (cd <= 0) return;
    if (hasPendingSrpgMapSkillSameSkill(this, item)) return;
    this._skillCooldowns = this._skillCooldowns || {};
    this._skillCooldowns[item.id] = cd;
  };

  // Baisse les cooldowns à la fin du tour de chaque combattant
  const _Game_Battler_onTurnEnd = Game_Battler.prototype.onTurnEnd;
  Game_Battler.prototype.onTurnEnd = function() {
    _Game_Battler_onTurnEnd.call(this);
    this.reduceCooldowns();
  };

  Game_BattlerBase.prototype.reduceCooldowns = function() {
    for (const skillId in this._skillCooldowns) {
      this._skillCooldowns[skillId] -= 1;
      if (this._skillCooldowns[skillId] <= 0) {
        delete this._skillCooldowns[skillId];
      }
    }
  };

  // Empêche l’utilisation si cooldown actif (sauf riposte SRPG : timing défenseur = 1)
  const _Game_BattlerBase_canUse = Game_BattlerBase.prototype.canUse;
  Game_BattlerBase.prototype.canUse = function(item) {
    if (DataManager.isSkill(item)) {
      if (this._skillCooldowns && this._skillCooldowns[item.id] > 0) {
        const riposteSrpg =
          $gameSystem &&
          $gameSystem.isSRPGMode &&
          $gameSystem.isSRPGMode() &&
          typeof this.srpgActionTiming === "function" &&
          this.srpgActionTiming() === 1;
        if (!riposteSrpg) return false;
      }
    }
    return _Game_BattlerBase_canUse.call(this, item);
  };

  // Extrait le cooldown depuis la note de la compétence
  Game_BattlerBase.prototype.getSkillCooldownTurns = function(skill) {
    if (!skill || !skill.note) return 0;
    const match = skill.note.match(COOLDOWN_TAG);
    return match ? parseInt(match[1]) : 0;
  };

  // Affichage du cooldown dans la liste de compétences
  const _Window_SkillList_drawSkillCost = Window_SkillList.prototype.drawSkillCost;
  Window_SkillList.prototype.drawSkillCost = function(skill, x, y, width) {
    const actor = this._actor;
    if (actor && actor._skillCooldowns?.[skill.id]) {
      this.changeTextColor(ColorManager.textColor(8)); // gris
      const text = `${actor._skillCooldowns[skill.id]} CD`;
      this.drawText(text, x, y, width, "right");
    } else {
      _Window_SkillList_drawSkillCost.call(this, skill, x, y, width);
    }
  };

})();
