/*:
 * @target MZ
 * @plugindesc SRPG: competence "Sauvetage" (cible allie puis case vide)
 * @author ChatGPT
 * @base SRPG_core_MZ
 * @orderAfter SRPG_core_MZ
 * @orderAfter SRPG_PositionEffects_MZ
 *
 * @param rescueMetaKey
 * @text Cle note-tag Sauvetage
 * @type string
 * @default cbnRescueCell
 * @desc Note-tag sur la competence pour activer le flux allie -> case vide.
 *
 * @help
 * Ajoute un flux de ciblage en 2 etapes pour une competence SRPG:
 * 1) selection d'un allie
 * 2) selection d'une case vide
 *
 * Mise en place de la competence (base de donnees):
 * - Scope: 1 allie (single friend)
 * - Damage Type: None
 * - Damage Formula: b.teleport("instant"); 0
 * - Note-tags:
 *   <cellTarget>
 *   <cbnRescueCell>    (ou la cle configuree via parametre)
 *
 * Variante allie OU ennemi:
 * - Ajouter aussi: <cbnRescueAny>
 * - Scope conseille: 1 ennemi (ou 1 allie), puis le plugin autorise les deux.
 *
 * Variante cible adjacente uniquement:
 * - Ajouter aussi: <cbnRescueAdjacentOnly>
 * - La cible (allie/ennemi) doit etre a distance Manhattan 1 du lanceur.
 *
 * Remarques:
 * - La validation de case vide reutilise la logique de SRPG_PositionEffects_MZ
 *   si disponible.
 * - Annuler pendant la selection de case revient a la fenetre de commande acteur.
 */
(() => {
    "use strict";

    const PLUGIN_NAME = "Cbn_SRPG_RescueCellTarget";
    const params = PluginManager.parameters(PLUGIN_NAME);
    const rescueMetaKey = String(params.rescueMetaKey || "cbnRescueCell").trim();
    const rescueAnyMetaKey = "cbnRescueAny";
    const rescueAdjacentMetaKey = "cbnRescueAdjacentOnly";
    const RESCUE_PHASE = "cbn_rescue_cell_target";

    function activeBattler() {
        const ev = $gameTemp && $gameTemp.activeEvent ? $gameTemp.activeEvent() : null;
        if (!ev || !$gameSystem || !$gameSystem.EventToUnit) return null;
        const pair = $gameSystem.EventToUnit(ev.eventId());
        return pair && pair[1] ? pair[1] : null;
    }

    function currentAction() {
        const battler = activeBattler();
        return battler && battler.currentAction ? battler.currentAction() : null;
    }

    function currentSkill() {
        const action = currentAction();
        return action && action.item ? action.item() : null;
    }

    function isRescueSkillActive() {
        const action = currentAction();
        const skill = currentSkill();
        if (!action || !skill) return false;
        if (!action.isForOne || !action.isForOne()) return false;
        const hasRescueTag = !!(skill.meta && skill.meta[rescueMetaKey] != null);
        if (!hasRescueTag) return false;

        const isAny = isRescueAnySkillActive();
        if (isAny) {
            const forFriend = !!(action.isForFriend && action.isForFriend());
            const forOpponent = !!(action.isForOpponent && action.isForOpponent());
            return forFriend || forOpponent;
        }
        return !!(action.isForFriend && action.isForFriend());
    }

    function isRescueAnySkillActive() {
        const skill = currentSkill();
        return !!(skill && skill.meta && skill.meta[rescueAnyMetaKey] != null);
    }

    function isRescueAdjacentOnlySkillActive() {
        const skill = currentSkill();
        return !!(skill && skill.meta && skill.meta[rescueAdjacentMetaKey] != null);
    }

    function isAdjacentToActiveEvent(targetEvent) {
        const activeEvent = $gameTemp && $gameTemp.activeEvent ? $gameTemp.activeEvent() : null;
        if (!activeEvent || !targetEvent) return false;
        const dx = Math.abs(Number(activeEvent.posX()) - Number(targetEvent.posX()));
        const dy = Math.abs(Number(activeEvent.posY()) - Number(targetEvent.posY()));
        return dx + dy === 1;
    }

    function setPendingTargetEventId(eventId) {
        if (!$gameTemp) return;
        $gameTemp._cbnRescueTargetEventId = Number(eventId || 0);
    }

    function pendingTargetEvent() {
        if (!$gameTemp || !$gameMap) return null;
        const eventId = Number($gameTemp._cbnRescueTargetEventId || 0);
        if (eventId <= 0) return null;
        const ev = $gameMap.event(eventId);
        return ev && !ev.isErased() ? ev : null;
    }

    function clearPendingTarget() {
        if (!$gameTemp) return;
        $gameTemp._cbnRescueTargetEventId = 0;
    }

    function setPendingCell(x, y) {
        if (!$gameTemp) return;
        $gameTemp._cbnRescueCellX = Number(x);
        $gameTemp._cbnRescueCellY = Number(y);
    }

    function clearPendingCell() {
        if (!$gameTemp) return;
        $gameTemp._cbnRescueCellX = null;
        $gameTemp._cbnRescueCellY = null;
    }

    function hasPendingCell() {
        if (!$gameTemp) return false;
        return Number.isInteger($gameTemp._cbnRescueCellX) && Number.isInteger($gameTemp._cbnRescueCellY);
    }

    function isValidCellSelection(x, y) {
        if ($gameSystem && typeof $gameSystem.positionIsValidTarget === "function") {
            return !!$gameSystem.positionIsValidTarget(x, y);
        }
        if (!$gameSystem || !$gameMap) return false;
        return !!($gameSystem.positionInRange && $gameSystem.positionInRange(x, y) &&
            $gameMap.positionIsOpen && $gameMap.positionIsOpen(x, y));
    }

    function commitBattleWindowForRescue(targetEvent) {
        const activeEvent = $gameTemp.activeEvent();
        if (!activeEvent || !targetEvent) return false;

        const userArray = $gameSystem.EventToUnit(activeEvent.eventId());
        const targetArray = $gameSystem.EventToUnit(targetEvent.eventId());
        if (!userArray || !userArray[1] || !targetArray || !targetArray[1]) return false;

        const user = userArray[1];
        const skill = currentSkill();
        if (!skill || (user.canUse && !user.canUse(skill))) {
            SoundManager.playBuzzer();
            return false;
        }

        $gameSystem.setSubBattlePhase("battle_window");
        $gameTemp.setTargetEvent(targetEvent);
        $gameSystem.setupSrpgBattleScene(userArray, targetArray);
        SoundManager.playOk();
        $gameSystem.clearSrpgActorCommandStatusWindowNeedRefresh();
        $gameSystem.setSrpgStatusWindowNeedRefresh(userArray);
        $gameSystem.setSrpgBattleWindowNeedRefresh(userArray, targetArray);
        clearPendingTarget();
        return true;
    }

    function isRescueActionItem(item) {
        return !!(item && item.meta && item.meta[rescueMetaKey] != null);
    }

    function currentAppliedActionItem() {
        if (!$gameTemp) return null;
        return $gameTemp._cbnRescueAppliedActionItem || null;
    }

    const _Game_Player_startMapEvent = Game_Player.prototype.startMapEvent;
    Game_Player.prototype.startMapEvent = function(x, y, triggers, normal) {
        if ($gameSystem && $gameSystem.isSRPGMode && $gameSystem.isSRPGMode()) {
            const subPhase = $gameSystem.isSubBattlePhase();
            if (subPhase === "actor_target" && isRescueSkillActive()) {
                let consumed = false;
                $gameMap.eventsXy(x, y).forEach(event => {
                    if (consumed || !event || event.isErased() || !event.isTriggerIn(triggers)) return;
                    if (event.isType) {
                        const eventType = event.isType();
                        const allowEnemy = isRescueAnySkillActive();
                        const canPick = eventType === "actor" || (allowEnemy && eventType === "enemy");
                        if (!canPick) return;
                        const targetArray = $gameSystem.EventToUnit(event.eventId());
                        const targetType = targetArray ? targetArray[0] : "";
                        const validTargetType = targetType === "actor" || (allowEnemy && targetType === "enemy");
                        if (targetArray && validTargetType) {
                            if (isRescueAdjacentOnlySkillActive() && !isAdjacentToActiveEvent(event)) {
                                SoundManager.playBuzzer();
                                consumed = true;
                                return;
                            }
                            const targetBattler = targetArray[1];
                            if (targetBattler && targetBattler.srpgImmovable && targetBattler.srpgImmovable()) {
                                SoundManager.playBuzzer();
                                consumed = true;
                                return;
                            }
                            SoundManager.playOk();
                            setPendingTargetEventId(event.eventId());
                            $gameSystem.setSubBattlePhase(RESCUE_PHASE);
                            consumed = true;
                        }
                    }
                });
                if (consumed) return;
            }
        }
        _Game_Player_startMapEvent.call(this, x, y, triggers, normal);
    };

    const _Game_Player_triggerAction = Game_Player.prototype.triggerAction;
    Game_Player.prototype.triggerAction = function() {
        if ($gameSystem && $gameSystem.isSRPGMode && $gameSystem.isSRPGMode() &&
            $gameSystem.isSubBattlePhase && $gameSystem.isSubBattlePhase() === RESCUE_PHASE) {
            if (Input.isTriggered("ok") || (TouchInput.isTriggered() && !this.touchOnCancelButton())) {
                const x = this.posX();
                const y = this.posY();
                const targetEvent = pendingTargetEvent();
                if (targetEvent && isValidCellSelection(x, y)) {
                    setPendingCell(x, y);
                    if (commitBattleWindowForRescue(targetEvent)) {
                        return true;
                    }
                    clearPendingCell();
                }
                SoundManager.playBuzzer();
                return true;
            }
            return false;
        }
        return _Game_Player_triggerAction.call(this);
    };

    const _Scene_Map_triggerdCancelInUpdateCallMenu = Scene_Map.prototype.triggerdCancelInUpdateCallMenu;
    Scene_Map.prototype.triggerdCancelInUpdateCallMenu = function() {
        if ($gameSystem && $gameSystem.isSRPGMode && $gameSystem.isSRPGMode() &&
            $gameSystem.isSubBattlePhase && $gameSystem.isSubBattlePhase() === RESCUE_PHASE) {
            if (Input.isTriggered("cancel") || TouchInput.isCancelled()) {
                SoundManager.playCancel();
                clearPendingTarget();
                clearPendingCell();
                this.reSetMoveRangeTable();
                $gameSystem.setSubBattlePhase("actor_command_window");
                return true;
            }
        }
        return _Scene_Map_triggerdCancelInUpdateCallMenu.call(this);
    };

    const _Game_Action_apply = Game_Action.prototype.apply;
    Game_Action.prototype.apply = function(target) {
        const prevItem = $gameTemp ? $gameTemp._cbnRescueAppliedActionItem : null;
        if ($gameTemp) $gameTemp._cbnRescueAppliedActionItem = this.item ? this.item() : null;
        try {
            _Game_Action_apply.call(this, target);
        } finally {
            if ($gameTemp) $gameTemp._cbnRescueAppliedActionItem = prevItem || null;
        }
    };

    const _Game_BattlerBase_teleport = Game_BattlerBase.prototype.teleport;
    Game_BattlerBase.prototype.teleport = function(type) {
        const item = currentAppliedActionItem();
        if (isRescueActionItem(item) && hasPendingCell()) {
            const ev = this.event ? this.event() : null;
            if (ev && ev.srpgTeleport) {
                const x = Number($gameTemp._cbnRescueCellX);
                const y = Number($gameTemp._cbnRescueCellY);
                const moved = ev.srpgTeleport(x, y, type);
                clearPendingCell();
                clearPendingTarget();
                return moved;
            }
        }
        return _Game_BattlerBase_teleport.call(this, type);
    };

    const _Scene_Map_srpgAfterAction = Scene_Map.prototype.srpgAfterAction;
    Scene_Map.prototype.srpgAfterAction = function() {
        clearPendingCell();
        clearPendingTarget();
        if ($gameTemp) $gameTemp._cbnRescueAppliedActionItem = null;
        _Scene_Map_srpgAfterAction.call(this);
    };
})();
