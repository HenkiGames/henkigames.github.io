(function() {
  const _srpgAfterAction = Scene_Map.prototype.srpgAfterAction;
  Scene_Map.prototype.srpgAfterAction = function() {
    const activeEvent = $gameTemp.activeEvent();
    const unit = $gameSystem.EventToUnit(activeEvent.eventId());
    const battler = unit && unit[1]; // 1 = battler, 0 = type
    const skill = $dataSkills[battler?._lastUsedSrpgSkillId];
    battler._originalCommandList = battler.srpgActorCommandList ? [...battler.srpgActorCommandList] : [];
    battler.srpgActorCommandList = ["wait"];

    if (skill && skill.meta && skill.meta.SRPGMoveAfterAction) {
      // Ne termine pas le tour, autorise le déplacement
      const actor = $gameActors.actor(battler._actorId);
      $gameTemp._srpgActionTiming = 0;
      $gameTemp.setResetMoveList(true);
      $gameTemp._autoMoveDestinationValid = false;
      $gameSystem.setSubBattlePhase('actor_move'); // Autorise déplacement
      $gameTemp._srpgPostActionMove = true;
      return;
    }
    _srpgAfterAction.call(this);
  };

  // Étape 2 : Après le déplacement, l'acteur pourra uniquement faire "wait"
  const _srpgAfterMapMovement = Scene_Map.prototype.srpgAfterMapMovement;
  Scene_Map.prototype.srpgAfterMapMovement = function() {
    _srpgAfterMapMovement.call(this);
    
    const event = $gameTemp.activeEvent();
    if (!event) return;

    const unit = $gameSystem.EventToUnit(event.eventId());
    if (!unit || unit[0] !== "actor") return;

    const actor = unit[1];
    if (actor && actor.srpgActorCommandList && actor.srpgActorCommandList.length === 1 && actor.srpgActorCommandList[0] === "wait") {
      console.log("⏳ Attente forcée post-compétence");
      $gameSystem.setSubBattlePhase("actor_command");
    }
  };

  const _processSrpgActorCommand = Scene_Map.prototype.processSrpgActorCommand;
  Scene_Map.prototype.processSrpgActorCommand = function() {
    const event = $gameTemp.activeEvent();
    if (event) {
      const unit = $gameSystem.EventToUnit(event.eventId());
      if (unit && unit[0] === "actor") {
        const actor = unit[1];
        if (actor && actor._originalCommandList) {
          actor.srpgActorCommandList = [...actor._originalCommandList];
          delete actor._originalCommandList;
        }
      }
    }

    _processSrpgActorCommand.call(this);
  };

})();