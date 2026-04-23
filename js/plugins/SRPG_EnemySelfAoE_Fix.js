/*:
 * @target MZ
 * @plugindesc [v1.1] SRPG - AoE auto-units (<srpgRange:0>) + map battle multi-cibles (après ARTM)
 * @author ChatGPT
 *
 * @help
 * Placez ce plugin EN DERNIER (au moins sous SRPG_AoE_MZ et ARTM_SkillOtherTargetMZ2).
 *
 * 1) Unité auto (IA) + AoE + portée 0 : zone centrée sur le lanceur, avec la direction du lanceur
 *    (important pour srpgAreaType:star).
 * 2) Map battle + compétence avec <srpgAreaRange:x> : si plusieurs événements sont dans srpgTargets,
 *    applique l'effet à toutes les cibles (contourne un makeTargets réduit à 1 cible par d'autres plugins
 *    ou par une portée « aléatoire » dans la base de données).
 *
 * Aucun paramètre.
 */

(() => {
  "use strict";

  //----------------------------------------------------------------------
  // setupAoEforAutoUnits : centrer sur soi + direction explicite pour les formes directionnelles
  //----------------------------------------------------------------------
  const _setupAoEforAutoUnits = Scene_Map.prototype.setupAoEforAutoUnits;
  Scene_Map.prototype.setupAoEforAutoUnits = function() {
    if (!$gameSystem.isSRPGMode()) {
      return _setupAoEforAutoUnits.call(this);
    }

    const activeEvent = $gameTemp.activeEvent();
    if (!activeEvent) {
      return _setupAoEforAutoUnits.call(this);
    }

    const userArray = $gameSystem.EventToUnit(activeEvent.eventId());
    const user = userArray && userArray[1];
    const action = user && user.currentAction ? user.currentAction() : null;
    const item = action && action.item ? action.item() : null;
    const area = action && action.area ? Number(action.area()) : 0;
    const hasSrpgRangeTag =
      item &&
      item.meta &&
      Object.prototype.hasOwnProperty.call(item.meta, "srpgRange");
    const metaRange = hasSrpgRangeTag ? Number(item.meta.srpgRange || 0) : null;
    const srpgRange0 =
      user &&
      item &&
      user.srpgSkillRange &&
      (metaRange !== null ? metaRange <= 0 : user.srpgSkillRange(item) <= 0);

    // Garde-fou: certains enchainements laissent une AoE active sans cible valide.
    // Le plugin SRPG_AoE_MZ fait areaTargets().shift().event sans verification.
    if ($gameTemp._activeAoE && user && action) {
      $gameTemp.selectArea(user, action);
      const areaTargets = $gameTemp.areaTargets ? $gameTemp.areaTargets() : [];
      const first = Array.isArray(areaTargets) ? areaTargets[0] : null;
      if (first && first.event) {
        $gameTemp.setTargetEvent(first.event);
      }
      return;
    }

    if (!$gameTemp._activeAoE && user && action && item && area > 0 && srpgRange0) {
      const dir = activeEvent.direction();
      $gameTemp.showArea(activeEvent.posX(), activeEvent.posY(), dir);
      if ($gameTemp.selectArea(user, action) && $gameTemp.areaTargets().length > 0) {
        const first = $gameTemp.areaTargets()[0];
        if (first && first.event) {
          $gameTemp.setTargetEvent(first.event);
        }
        return;
      }
    }

    return _setupAoEforAutoUnits.call(this);
  };

  //----------------------------------------------------------------------
  // makeTargets : map battle + AoE = une entrée dans la file par cible listée (dernier plugin = prioritaire)
  //----------------------------------------------------------------------
  const _makeTargetsAoEMapBattleAll = Game_Action.prototype.makeTargets;
  Game_Action.prototype.makeTargets = function() {
    const item = this.item();
    const aoe =
      item &&
      item.meta &&
      Number(item.meta.srpgAreaRange || 0) > 0;

    const ids = this.srpgTargets ? this.srpgTargets() : [];

    if (
      !$gameSystem.isSRPGMode() ||
      !$gameSystem.useMapBattle() ||
      !aoe ||
      !ids ||
      ids.length <= 1
    ) {
      return _makeTargetsAoEMapBattleAll.call(this);
    }

    if (!this._forcing && this.subject().isConfused()) {
      return _makeTargetsAoEMapBattleAll.call(this);
    }

    const targets = [];
    const addUnique = b => {
      if (!b) return;
      if (targets.indexOf(b) >= 0) return;
      targets.push(b);
    };

    if (this.isForEveryone()) {
      return _makeTargetsAoEMapBattleAll.call(this);
    }

    if (this.isForOpponent()) {
      const unit = this.opponentsUnit();
      for (let i = 0; i < ids.length; i++) {
        addUnique(unit.srpgSmoothTarget(ids[i]));
      }
      return targets;
    }

    if (this.isForFriend()) {
      const unit = this.friendsUnit();
      for (let i = 0; i < ids.length; i++) {
        if (this.isForDeadFriend()) {
          addUnique(unit.srpgSmoothDeadTarget(ids[i]));
        } else {
          addUnique(unit.srpgSmoothTarget(ids[i]));
        }
      }
      return targets;
    }

    return _makeTargetsAoEMapBattleAll.call(this);
  };

  //----------------------------------------------------------------------
  // srpgInvokeMapSkill : sécuriser user/target avant passage aux autres plugins/core
  //----------------------------------------------------------------------
  const _Scene_Map_srpgInvokeMapSkill_AoeGuard = Scene_Map.prototype.srpgInvokeMapSkill;
  Scene_Map.prototype.srpgInvokeMapSkill = function(data) {
    if (!data) {
      return _Scene_Map_srpgInvokeMapSkill_AoeGuard.call(this, data);
    }

    // Certains enchaînements de plugins AoE peuvent omettre data.target
    // alors que le core attend toujours une cible valide.
    if (!data.target) {
      if (Array.isArray(data.targets) && data.targets.length > 0) {
        data.target = data.targets[0];
      } else if (Array.isArray(data.targetArray) && data.targetArray.length > 1) {
        data.target = data.targetArray[1];
      }
    }

    // Si les données restent incomplètes, NE PAS appeler le core:
    // SRPG_core_MZ lit target.srpgEventId() avant de gérer "cancel".
    if (!data.user || !data.target) {
      return false;
    }

    return _Scene_Map_srpgInvokeMapSkill_AoeGuard.call(this, data);
  };
})();
