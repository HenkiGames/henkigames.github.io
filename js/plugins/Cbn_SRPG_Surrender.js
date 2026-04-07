/*:
 * @target MZ
 * @plugindesc [SRPG] Abandon : tue tous les allies vivants puis laisse le moteur appliquer la defaite (phase after_battle).
 * @author Carbonne Arena
 *
 * @help
 * On tue tous les allies SRPG (allMembers), on vide la file de competences carte,
 * puis on synchronise la carte (events effaces, variables existActor / existEnemy comme le core)
 * et le nettoyage SRPG sans utiliser la phase after_battle du core (celle-ci exige un activeEvent).
 *
 * En Scene_Battle : mort des cibles de combat + BattleManager.endTurn().
 *
 * Script : srpgSurrenderBattle()
 *
 * MENU SRPG : srpgMenuCommandList doit contenir "surrender" (voir parametres SRPG_core_MZ).
 *
 * Placez ce plugin APRES SRPG_core_MZ et (si vous l'utilisez) apres CustomGameOverRedirect
 * pour que l'abandon declenche le transfert « defaite » (Scene_Gameover interceptee).
 *
 * @param menuLabel
 * @text Libelle dans le menu SRPG
 * @default Abandonner
 *
 * @command SurrenderBattle
 * @text Abandonner la bataille
 * @desc Defaite en tuant tous les allies vivants (SRPG).
 */

(() => {
  "use strict";

  const PLUGIN_NAME = "Cbn_SRPG_Surrender";
  const PENDING_KEY = "_cbnSrpgSurrenderPending";

  const _params = () => PluginManager.parameters(PLUGIN_NAME);

  /**
   * Tous les allies vivants a eliminer.
   * En SRPG, allMembers() ne couvre que les unites sur la carte ; la reserve reste dans _actors.
   */
  function killAllAlliedActorsForDefeat() {
    if (!$gameSystem.isSRPGMode()) {
      for (const b of $gameParty.battleMembers()) {
        if (b && b.isAlive()) b.addState(b.deathStateId());
      }
      return;
    }
    for (const a of $gameParty.allMembers()) {
      if (a && a.isAlive()) a.addState(a.deathStateId());
    }
    const ids = $gameParty._actors ? $gameParty._actors.slice() : [];
    for (const id of ids) {
      const actor = $gameActors.actor(id);
      if (actor && actor.isAlive()) actor.addState(actor.deathStateId());
    }
  }

  /**
   * Meme routine que Game_System.endSRPG sans recoverAll : sinon les allies morts peuvent etre revivifies
   * par le soin de fin de bataille SRPG, et isAllDead() resterait faux.
   */
  function endSrpgAfterSurrenderDefeat() {
    if (!$gameSystem.isSRPGMode()) return;
    $gameTemp.clearActiveEvent();
    $gameMap.events().forEach(event => {
      const battler = $gameSystem.setEventIdToBattler(event.eventId());
      if (battler) {
        battler.onTurnEnd();
        battler.onBattleEnd();
      }
    });
    const srpgP = PluginManager.parameters("SRPG_core_MZ");
    const switchId = Number(srpgP.srpgBattleSwitchID || 1);
    $gameSystem._SRPGMode = false;
    $gameSwitches.setValue(switchId, false);
    $gameSystem._isBattlePhase = "initialize";
    $gameSystem._isSubBattlePhase = "initialize";
    $gamePlayer.loadOriginalData();
    $gamePlayer.refresh();
    $gameSystem.clearData();
    $gameTemp.clearMoveTable();
    $gameTemp.clearAreaTargets();
    $gameTemp.clearArea();
    $gameTemp.clearSrpgEventList();
    $gameMap.setEventImages();
  }

  function canSrpgSurrenderOnMap() {
    if (!$gameSystem.isSRPGMode()) return false;
    if ($gameSystem.isBattlePhase() === "initialize") return false;
    const sp = $gameSystem.isSubBattlePhase();
    if (sp === "after_battle" || sp === "afterAction") return false;
    return true;
  }

  function surrenderSceneBattle() {
    killAllAlliedActorsForDefeat();
    BattleManager.endTurn();
  }

  function cbnSrpgSurrenderMapFinalize(scene) {
    const srpgP = PluginManager.parameters("SRPG_core_MZ");
    const existActorVarID = Number(srpgP.existActorVarID || 1);

    $gameMap.events().forEach(event => {
      if (!event || event.isErased()) return;
      const unit = $gameSystem.EventToUnit(event.eventId());
      if (!unit || unit[0] !== "actor" || !unit[1]) return;
      const battler = unit[1];
      if (!battler.isDead()) return;
      SoundManager.playActorCollapse();
      event.erase();
      const v = $gameVariables.value(existActorVarID);
      $gameVariables.setValue(existActorVarID, v - 1);
    });

    if ($gameMap.setEventImages) {
      $gameMap.setEventImages();
    }

    $gameTemp.clearActiveEvent();
    $gameTemp.clearTargetEvent();
    $gameTemp.clearAreaTargets();
    $gameTemp.clearMoveTable();
    $gameTemp.clearArea();
    $gameSystem.clearSrpgActorCommandWindowNeedRefresh();
    $gameSystem.clearSrpgActorCommandStatusWindowNeedRefresh();
    $gameParty.clearSrpgBattleActors();
    $gameTroop.clearSrpgBattleEnemys();
    $gameSystem.clearSRPGBattleMode();

    if (scene._logWindow) {
      scene._logWindow.clear();
      if (scene._logWindow.hide) scene._logWindow.hide();
    }

    $gameSystem.setSubBattlePhase("normal");
  }

  function surrenderSceneMap(scene) {
    if (scene.srpgClearMapSkills) {
      scene.srpgClearMapSkills();
    } else if (scene._srpgSkillList) {
      scene._srpgSkillList.length = 0;
    }
    killAllAlliedActorsForDefeat();
    cbnSrpgSurrenderMapFinalize(scene);
    endSrpgAfterSurrenderDefeat();
    if (SceneManager && typeof Scene_Gameover !== "undefined") {
      SceneManager.goto(Scene_Gameover);
    }
  }

  window.srpgSurrenderBattle = function () {
    if (!$gameSystem || !$gameSystem.isSRPGMode()) {
      SoundManager.playBuzzer();
      return false;
    }
    if (!$gameParty.aliveMembers().length) {
      SoundManager.playBuzzer();
      return false;
    }

    const scene = SceneManager._scene;

    if (scene instanceof Scene_Battle) {
      surrenderSceneBattle();
      return true;
    }

    if (scene instanceof Scene_Map) {
      if (!canSrpgSurrenderOnMap()) {
        SoundManager.playBuzzer();
        return false;
      }
      surrenderSceneMap(scene);
      return true;
    }

    SoundManager.playBuzzer();
    return false;
  };

  PluginManager.registerCommand(PLUGIN_NAME, "SurrenderBattle", () => {
    window.srpgSurrenderBattle();
  });

  const _Cbn_Scene_Map_update = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function () {
    if ($gameSystem && $gameSystem[PENDING_KEY]) {
      $gameSystem[PENDING_KEY] = false;
      window.srpgSurrenderBattle();
    }
    _Cbn_Scene_Map_update.call(this);
  };

  Window_MenuCommand.prototype.isCommandEnabled = function (index) {
    const sym = this.commandSymbol(index);
    const base = Window_Command.prototype.isCommandEnabled.call(this, index);
    if ($gameSystem && $gameSystem.isSRPGMode() && sym === "surrender") {
      return true;
    }
    return base;
  };

  const _Cbn_Window_MenuCommand_makeCommandList = Window_MenuCommand.prototype.makeCommandList;
  Window_MenuCommand.prototype.makeCommandList = function () {
    _Cbn_Window_MenuCommand_makeCommandList.call(this);
    if (!$gameSystem || !$gameSystem.isSRPGMode()) return;
    const srpgList = (PluginManager.parameters("SRPG_core_MZ").srpgMenuCommandList || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    if (!srpgList.includes("surrender")) return;
    if (this.findSymbol("surrender") >= 0) return;
    const label = _params().menuLabel || "Abandonner";
    const afterTurn = this.findSymbol("status");
    if (afterTurn >= 0) {
      const tail = this._list.slice(afterTurn + 1);
      this._list.length = afterTurn + 1;
      this.addCommand(label, "surrender", true);
      for (let i = 0; i < tail.length; i++) {
        this._list.push(tail[i]);
      }
    } else {
      this.addCommand(label, "surrender", true);
    }
  };

  const _Cbn_Scene_Menu_createCommandWindow = Scene_Menu.prototype.createCommandWindow;
  Scene_Menu.prototype.createCommandWindow = function () {
    _Cbn_Scene_Menu_createCommandWindow.call(this);
    if ($gameSystem.isSRPGMode() && this._commandWindow) {
      this._commandWindow.setHandler("surrender", this.commandSrpgSurrenderFromMenu.bind(this));
    }
  };

  Scene_Menu.prototype.commandSrpgSurrenderFromMenu = function () {
    if ($gameSystem) {
      $gameSystem[PENDING_KEY] = true;
    }
    SceneManager.pop();
  };
})();
