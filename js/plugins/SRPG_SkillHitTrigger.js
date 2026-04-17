/*:
 * @target MZ
 * @plugindesc [v1.0] Active un switch quand une competence ennemie touche un acteur sur une case precise en SRPG.
 * @author ChatGPT
 *
 * @param skillId
 * @text ID competence
 * @type skill
 * @default 9
 * @desc ID de la competence a surveiller.
 *
 * @param targetX
 * @text Case X
 * @type number
 * @default 8
 * @desc Position X de la case a surveiller.
 *
 * @param targetY
 * @text Case Y
 * @type number
 * @default 3
 * @desc Position Y de la case a surveiller.
 *
 * @param switchId
 * @text Switch a activer
 * @type switch
 * @default 1
 * @desc Switch active quand toutes les conditions sont remplies.
 *
 * @param onlyEnemyToActor
 * @text Seulement ennemi vers acteur
 * @type boolean
 * @on Oui
 * @off Non
 * @default true
 * @desc Si oui, ne detecte que les competences lancees par un ennemi sur un acteur.
 *
 * @help
 * ============================================================================
 * SRPG_SkillHitTrigger.js
 * ============================================================================
 * Ce plugin active un switch quand une competence precise touche reellement
 * une unite sur une case precise pendant un combat SRPG sur la map.
 *
 * Conditions verifiees:
 * - mode SRPG actif
 * - la competence utilisee correspond a l'ID configure
 * - l'attaque touche vraiment la cible (pas ratee / pas esquivee)
 * - la cible est sur la case X/Y configuree
 * - optionnellement: seulement ennemi -> acteur
 *
 * Usage typique:
 * - Creer un evenement en processus parallele
 * - Condition: switch configure ON
 * - Faire les actions voulues
 * - Remettre le switch sur OFF a la fin
 *
 * Notes:
 * - Le switch est simplement passe a ON. Le plugin ne le remet pas a OFF.
 * - Si la competence touche plusieurs cibles et que plusieurs satisfont la
 *   condition, le switch sera juste mis a ON.
 * ============================================================================
 */

(() => {
  "use strict";

  const pluginName = "SRPG_SkillHitTrigger";
  const params = PluginManager.parameters(pluginName);

  const TARGET_SKILL_ID = Number(params.skillId || 9);
  const TARGET_X = Number(params.targetX || 8);
  const TARGET_Y = Number(params.targetY || 3);
  const SWITCH_ID = Number(params.switchId || 1);
  const ONLY_ENEMY_TO_ACTOR = String(params.onlyEnemyToActor || "true") === "true";

  function isSrpgActive() {
    return !!($gameSystem && $gameSystem.isSRPGMode && $gameSystem.isSRPGMode());
  }

  function findEventByBattler(battler) {
    if (!$gameSystem || !$gameMap || !$gameSystem.EventToUnit) return null;
    const events = $gameMap.events ? $gameMap.events() : [];
    for (const event of events) {
      if (!event) continue;
      const entry = $gameSystem.EventToUnit(event.eventId());
      if (entry && entry[1] === battler) {
        return event;
      }
    }
    return null;
  }

  function resolveTargetEvent(target) {
    // En SRPG, targetEvent est souvent la source la plus fiable.
    const tempTargetEvent = $gameTemp && $gameTemp.targetEvent ? $gameTemp.targetEvent() : null;
    if (tempTargetEvent && $gameSystem && $gameSystem.EventToUnit) {
      const entry = $gameSystem.EventToUnit(tempTargetEvent.eventId());
      if (entry && (!target || entry[1] === target)) {
        return tempTargetEvent;
      }
    }
    return findEventByBattler(target);
  }

  const _Game_Action_apply = Game_Action.prototype.apply;
  Game_Action.prototype.apply = function(target) {
    _Game_Action_apply.call(this, target);

    if (!isSrpgActive()) return;

    const item = this.item();
    const user = this.subject();
    const result = target ? target.result() : null;

    if (!item || !DataManager.isSkill(item) || item.id !== TARGET_SKILL_ID) return;
    if (!result || !result.isHit()) return;

    if (ONLY_ENEMY_TO_ACTOR) {
      if (!user || !user.isEnemy || !user.isEnemy()) return;
      if (!target || !target.isActor || !target.isActor()) return;
    }

    const targetEvent = resolveTargetEvent(target);
    if (!targetEvent) return;

    if (targetEvent.posX() === TARGET_X && targetEvent.posY() === TARGET_Y) {
      $gameSwitches.setValue(SWITCH_ID, true);
      if ($gameMessage) {
        $gameMessage.add("Un interrupteur vient de s'enclencher");
      }
    }
  };
})();
