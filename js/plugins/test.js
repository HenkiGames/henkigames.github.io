(function () {
  let forceWaitOnly = false;

  // Interception après action
  const _srpgAfterAction = Scene_Map.prototype.srpgAfterAction;
  Scene_Map.prototype.srpgAfterAction = function () {
    const actionData = $gameTemp._lastActionData;
    if (actionData && actionData.length > 1) {
      const skillId = actionData[0];
      const skill = $dataSkills[skillId];
      if (skill?.meta?.SRPGMoveAfterAction) {
        forceWaitOnly = true;
        $gameTemp.setResetMoveList(true);
        $gameSystem.setSubBattlePhase("actor_move");
        return;
      }
    }
    _srpgAfterAction.call(this);
  };

  // On override makeCommandList proprement
  const _makeCommandList = Window_ActorCommand.prototype.makeCommandList;
  Window_ActorCommand.prototype.makeCommandList = function () {
    if ($gameSystem.isSRPGMode() && forceWaitOnly) {
      this.clearCommandList();
      this.addCommand(TextManager.wait, 'wait');
    } else {
      _makeCommandList.call(this);
    }
  };

  // On remet à 0 une fois que le joueur a choisi "Attendre"
  const _Scene_Map_commandWait = Scene_Map.prototype.commandWait;
  Scene_Map.prototype.commandWait = function () {
    forceWaitOnly = false;
    _Scene_Map_commandWait.call(this);
  };
})();
