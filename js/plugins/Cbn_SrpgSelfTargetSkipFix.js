/*:
 * @target MZ
 * @plugindesc [v1.0] SRPG: force le skip de ciblage pour skills self quand srpgSkipTargetForSelf=true.
 * @author Pokemon Carbonne Arena
 *
 * @help
 * Correctif de compatibilité (SRPG_core + SRPG_UX_Cursor/AoE):
 * - Si la compétence est "Utilisateur" et que srpgSkipTargetForSelf=true,
 *   on force l'ouverture directe de battle_window (pas de sélection cible).
 *
 * Ce plugin n'affecte pas les compétences non-self.
 * Placez-le APRÈS les plugins SRPG concernés.
 */

(() => {
  "use strict";

  const PLUGIN_NAME = "Cbn_SrpgSelfTargetSkipFix";

  function isSkipSelfEnabled() {
    const p = PluginManager.parameters("SRPG_core_MZ");
    return String(p.srpgSkipTargetForSelf || "true") === "true";
  }

  function currentSrpgAction() {
    if (!$gameTemp || !$gameSystem || !$gameTemp.activeEvent()) return null;
    const arr = $gameSystem.EventToUnit($gameTemp.activeEvent().eventId());
    if (!arr || !arr[1]) return null;
    const battler = arr[1];
    if (!battler.currentAction) return null;
    return battler.currentAction();
  }

  function shouldForceSelfSkip(action) {
    if (!action || !action.item || !action.item()) return false;
    if (!isSkipSelfEnabled()) return false;
    // Comportement canonique: uniquement les actions scope "User".
    return !!action.isForUser && action.isForUser();
  }

  function normalizedAreaType(action) {
    if (!action || !action.item || !action.item()) return "";
    const item = action.item();
    const raw = String(item.meta && item.meta.srpgAreaType ? item.meta.srpgAreaType : "");
    return raw.trim().toLowerCase();
  }

  function isAllAreaType(areaType) {
    return (
      areaType === "allopponent" ||
      areaType === "allenemy" ||
      areaType === "allfriend" ||
      areaType === "allactor"
    );
  }

  function isActorEvent(event) {
    return !!event && event.isType && event.isType() === "actor" && !event.isErased();
  }

  function isEnemyEvent(event) {
    return !!event && event.isType && event.isType() === "enemy" && !event.isErased();
  }

  function pickFallbackTargetEventForAllArea(action) {
    if (!action || !$gameTemp || !$gameTemp.activeEvent() || !$gameMap) return null;
    const userEvent = $gameTemp.activeEvent();
    const userArray = $gameSystem.EventToUnit(userEvent.eventId());
    if (!userArray || !userArray[1]) return null;
    const userBattler = userArray[1];
    const areaType = normalizedAreaType(action);
    if (!isAllAreaType(areaType)) return null;

    const events = $gameMap.events().filter(ev => ev && !ev.isErased());
    if (areaType === "allactor") {
      return events.find(isActorEvent) || null;
    }
    if (areaType === "allenemy") {
      return events.find(isEnemyEvent) || null;
    }
    // allfriend / allopponent dépendent du camp utilisateur
    if (userBattler.isActor && userBattler.isActor()) {
      if (areaType === "allfriend") return events.find(isActorEvent) || null;
      if (areaType === "allopponent") return events.find(isEnemyEvent) || null;
    } else {
      if (areaType === "allfriend") return events.find(isEnemyEvent) || null;
      if (areaType === "allopponent") return events.find(isActorEvent) || null;
    }
    return null;
  }

  function fixBattleWindowTargetForSelfAllArea(action) {
    if (!action || !$gameSystem || !$gameTemp) return;
    if ($gameSystem.isSubBattlePhase() !== "battle_window") return;
    const areaType = normalizedAreaType(action);
    if (!isAllAreaType(areaType)) return;

    const targetEvent = $gameTemp.targetEvent ? $gameTemp.targetEvent() : null;
    if (targetEvent && targetEvent !== $gameTemp.activeEvent()) return;

    const fallbackTargetEvent = pickFallbackTargetEventForAllArea(action);
    if (!fallbackTargetEvent) return;

    const actionArray = $gameSystem.EventToUnit($gameTemp.activeEvent().eventId());
    const targetArray = $gameSystem.EventToUnit(fallbackTargetEvent.eventId());
    if (!actionArray || !targetArray) return;
    $gameTemp.setTargetEvent(fallbackTargetEvent);
    if ($gameTemp.setSrpgDistance) {
      $gameTemp.setSrpgDistance($gameSystem.unitDistance($gameTemp.activeEvent(), fallbackTargetEvent));
    }
    if ($gameSystem.setSrpgBattleWindowNeedRefresh) {
      $gameSystem.setSrpgBattleWindowNeedRefresh(actionArray, targetArray);
    }
  }

  function actionMatchesSelfAllArea(action) {
    if (!action || !action.item || !action.item()) return false;
    if (!shouldForceSelfSkip(action)) return false;
    return isAllAreaType(normalizedAreaType(action));
  }

  function shouldBypassBattleWindowCanUse(actor, item) {
    if (!actor || !item) return false;
    if (!$gameSystem || !$gameSystem.isSRPGMode || !$gameSystem.isSRPGMode()) return false;
    if (!$gameSystem.isSubBattlePhase || $gameSystem.isSubBattlePhase() !== "battle_window") return false;
    const action = actor.currentAction ? actor.currentAction() : null;
    if (!action || !action.item || action.item() !== item) return false;
    return actionMatchesSelfAllArea(action);
  }

  const _Game_BattlerBase_canUse_cbnSelfSkipFix = Game_BattlerBase.prototype.canUse;
  Game_BattlerBase.prototype.canUse = function(item) {
    if (
      $gameSystem &&
      $gameSystem.isSRPGMode &&
      $gameSystem.isSRPGMode() &&
      $gameSystem.isSubBattlePhase &&
      $gameSystem.isSubBattlePhase() === "battle_window" &&
      isSkipSelfEnabled()
    ) {
      const action = this.currentAction ? this.currentAction() : null;
      if (action && action.item && action.item() === item && actionMatchesSelfAllArea(action)) {
        // Avant la validation SRPG_core (inArea/targetEvent), on force une cible valide
        // pour les compétences self + allOpponent/allEnemy/allFriend/allActor.
        fixBattleWindowTargetForSelfAllArea(action);
      }
    }
    return _Game_BattlerBase_canUse_cbnSelfSkipFix.call(this, item);
  };

  const _Window_SrpgBattle_isEnabled_cbnSelfSkipFix = Window_SrpgBattle.prototype.isEnabled;
  Window_SrpgBattle.prototype.isEnabled = function(item) {
    if (shouldBypassBattleWindowCanUse(this._actor, item)) {
      return true;
    }
    return _Window_SrpgBattle_isEnabled_cbnSelfSkipFix.call(this, item);
  };

  const _Scene_Map_startActorTargetting = Scene_Map.prototype.startActorTargetting;
  Scene_Map.prototype.startActorTargetting = function() {
    _Scene_Map_startActorTargetting.call(this);

    if (!$gameSystem || !$gameSystem.isSRPGMode || !$gameSystem.isSRPGMode()) return;
    if ($gameSystem.isSubBattlePhase() !== "actor_target") return;

    const action = currentSrpgAction();
    if (!shouldForceSelfSkip(action)) return;
    if (typeof this.skillForUser === "function") {
      this.skillForUser();
      fixBattleWindowTargetForSelfAllArea(action);
    }
  };

  if (Utils && Utils.isOptionValid && Utils.isOptionValid("test")) {
    console.log(`[${PLUGIN_NAME}] Loaded`);
  }
})();
