/*:
 * @target MZ
 * @plugindesc [SRPG] Met à jour automatiquement la commande "original" avec la dernière compétence utilisée.
 * @author GPT
 *
 * @help
 * Ce plugin met à jour dynamiquement la commande SRPG "original"
 * avec la dernière compétence utilisée par l’acteur.
 */

(() => {

  // Stocke la dernière skill utilisée
  const _Game_Battler_useItem = Game_Battler.prototype.useItem;
  Game_Battler.prototype.useItem = function(item) {
    if (this.isActor() && DataManager.isSkill(item) && $gameSystem.isSRPGMode()) {
      this._lastUsedSrpgSkillId = item.id;
    }
    _Game_Battler_useItem.call(this, item);
  };

  // Remplace la méthode qui récupère l'ID de la commande "original"
  const _Scene_Map_srpgCommandSkillId = Scene_Map.prototype.srpgCommandSkillId;
  Scene_Map.prototype.srpgCommandSkillId = function(command) {
    if (command === 'original') {
      const battler = $gameSystem.EventToUnit($gameTemp.activeEvent().eventId())[1];
      if (battler && battler._lastUsedSrpgSkillId) {
        return battler._lastUsedSrpgSkillId;
      }
    }
    return _Scene_Map_srpgCommandSkillId.call(this, command);
  };

})();
