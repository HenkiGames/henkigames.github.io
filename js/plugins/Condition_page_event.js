/*:
 * @plugindesc Masque les événements dont une page contient <page condition> et une condition invalide. [CustomPageConditionHide]
 * @author GPT
 * @help
 * ▶️ Utilisation :
 * - Ajoutez un commentaire : <page condition>
 * - Juste en dessous, mettez un "If" (branche conditionnelle)
 * - Si la condition échoue, l’événement n’apparaîtra pas du tout
 *
 * Ex :
 * Commentaire : <page condition>
 * Si : Switch [10] est ON
 *   (ne rien mettre à l’intérieur)
 */

(() => {

  const PAGE_CONDITION_TAG = /<page[-_ ]condition>/i;

  // Redéfinition douce de setupPage
  const _Game_Event_setupPage = Game_Event.prototype.setupPage;
  Game_Event.prototype.setupPage = function() {
    _Game_Event_setupPage.call(this);

    const page = this.page();
    if (!page || !page.list) return;

    for (let i = 0; i < page.list.length - 1; i++) {
      const cmd = page.list[i];
      const nextCmd = page.list[i + 1];

      if (cmd.code === 108 && PAGE_CONDITION_TAG.test(cmd.parameters[0])) {
        if (nextCmd.code === 111) {
          const valid = this.evaluateCustomCondition(nextCmd.parameters);
          if (!valid) {
            this._erased = true;
            this.setImage('', 0);
          }
        }
      }
    }
  };

  // Évalue la condition comme RPG Maker le ferait pour un branchement conditionnel
  Game_Event.prototype.evaluateCustomCondition = function(params) {
    const [type, param1, param2, param3, param4, param5] = params;
    switch (type) {
      case 0: // Switch
        return $gameSwitches.value(param1) === (param2 === 0);
      case 1: { // Variable
        const val1 = $gameVariables.value(param1);
        const val2 = param2 === 0 ? param3 : $gameVariables.value(param3);
        switch (param4) {
          case 0: return val1 === val2;
          case 1: return val1 >= val2;
          case 2: return val1 <= val2;
          case 3: return val1 > val2;
          case 4: return val1 < val2;
          case 5: return val1 !== val2;
        }
        break;
      }
      case 2: { // Self Switch
        const key = [this._mapId, this._eventId, param1];
        return $gameSelfSwitches.value(key) === (param2 === 0);
      }
      case 3: // Timer
        if (!$gameTimer.isWorking()) return false;
        return param2 === 0 ? $gameTimer.seconds() >= param1 : $gameTimer.seconds() <= param1;
      case 4: // Actor in party
        return $gameParty.members().some(actor => actor.actorId() === param1);
      case 5: // Enemy defeated
        return $gameTroop.isEnemyDead(param1); // facultatif selon besoin
      case 6: // Gold
        return param2 === 0 ? $gameParty.gold() >= param1 : $gameParty.gold() <= param1;
      case 12: // Script
        try {
          return !!eval(param1);
        } catch (e) {
          console.error("Erreur dans <page condition> script:", e);
          return false;
        }
      default:
        return true;
    }
  };

})();
