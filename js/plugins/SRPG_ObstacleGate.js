/*:
 * @target MZ
 * @plugindesc SRPG: obstacles destructibles, passage tag 7, hors timeline ennemie
 * @author (patch projet)
 * @orderAfter SRPG_DispHPOnMap_MZ
 *
 * @help
 * Placer APRÈS SRPG_core_MZ, SRPG_RangeControl_MZ et (si utilisé)
 * SRPG_DispHPOnMap_MZ pour le masquage du marqueur de tour sur les obstacles.
 *
 * Obstacle ennemi:
 * - Note ennemi: <srpgObstacle>
 * - Événement type enemy, sprite via <characterName> / <characterIndex>
 *
 * Passage (classe acteur): <srpgThroughTag:7> ou <terraintag:7>
 *
 * Phase ennemie:
 * - Les obstacles ne reçoivent pas de tour (plus de ralentissement si beaucoup d'obstacles).
 *
 * Fin de combat / variable « nombre d'ennemis » (param. SRPG_core existEnemyVarID):
 * - Les obstacles ne sont pas comptés : la variable peut atteindre 0 quand il ne reste
 *   que des obstacles (<srpgObstacle>), pour déclencher victoire avec la même condition qu'avant.
 */

(() => {
    "use strict";

    const _srpgCoreExistEnemyVid = Number(
        PluginManager.parameters("SRPG_core_MZ")["existEnemyVarID"] || 2
    );

    function isSrpgObstacleBattler(battler) {
        return (
            battler &&
            battler.isEnemy &&
            battler.isEnemy() &&
            battler.enemy &&
            battler.enemy().meta &&
            battler.enemy().meta.srpgObstacle
        );
    }

    function adjustExistEnemyVarForObstacles(delta) {
        const oldValue = $gameVariables.value(_srpgCoreExistEnemyVid);
        $gameVariables.setValue(_srpgCoreExistEnemyVid, Math.max(0, oldValue + delta));
    }

    const _Game_System_setSrpgEnemysOG = Game_System.prototype.setSrpgEnemys;
    Game_System.prototype.setSrpgEnemys = function() {
        _Game_System_setSrpgEnemysOG.call(this);
        let obstacles = 0;
        $gameMap.events().forEach(event => {
            if (!event || event.isErased() || event.isType() !== "enemy") return;
            const unit = $gameSystem.EventToUnit(event.eventId());
            if (unit && unit[1] && isSrpgObstacleBattler(unit[1])) obstacles++;
        });
        if (obstacles > 0) adjustExistEnemyVarForObstacles(-obstacles);
    };

    const _Scene_Map_srpgBattlerDeadAfterBattleOG =
        Scene_Map.prototype.srpgBattlerDeadAfterBattle;
    Scene_Map.prototype.srpgBattlerDeadAfterBattle = function() {
        const activeEvent = $gameTemp.activeEvent();
        const targetEvent = $gameTemp.targetEvent();
        const allEvents = [activeEvent, targetEvent].concat($gameTemp.getAreaEvents());
        const seen = new Set();
        let obstacleDeaths = 0;
        for (let i = 0; i < allEvents.length; i++) {
            const event = allEvents[i];
            if (!event || seen.has(event.eventId())) continue;
            seen.add(event.eventId());
            const battler = $gameSystem.EventToUnit(event.eventId())[1];
            if (battler && battler.isDead() && !event.isErased() && isSrpgObstacleBattler(battler)) {
                obstacleDeaths++;
            }
        }
        _Scene_Map_srpgBattlerDeadAfterBattleOG.call(this);
        if (obstacleDeaths > 0) adjustExistEnemyVarForObstacles(obstacleDeaths);
    };

    const _Game_Interpreter_unitDieOG = Game_Interpreter.prototype.unitDie;
    Game_Interpreter.prototype.unitDie = function(eventId) {
        const eid = this.getEventId(eventId);
        const battler = $gameSystem.setEventIdToBattler(eid);
        const undoEnemyCount =
            battler &&
            battler.isAlive &&
            battler.isAlive() &&
            battler.isEnemy &&
            battler.isEnemy() &&
            isSrpgObstacleBattler(battler);
        const r = _Game_Interpreter_unitDieOG.call(this, eventId);
        if (undoEnemyCount && battler.isDead()) adjustExistEnemyVarForObstacles(1);
        return r;
    };

    const _Game_Interpreter_unitReviveOG = Game_Interpreter.prototype.unitRevive;
    Game_Interpreter.prototype.unitRevive = function(eventId) {
        const eid = this.getEventId(eventId);
        const battler = $gameSystem.setEventIdToBattler(eid);
        const isOb =
            battler &&
            battler.isEnemy &&
            battler.isEnemy() &&
            isSrpgObstacleBattler(battler);
        const r = _Game_Interpreter_unitReviveOG.call(this, eventId);
        if (isOb) adjustExistEnemyVarForObstacles(-1);
        return r;
    };

    const _Game_Interpreter_addEnemyOG = Game_Interpreter.prototype.addEnemy;
    Game_Interpreter.prototype.addEnemy = function(eventId, enemyId, mode, targetId) {
        const r = _Game_Interpreter_addEnemyOG.call(this, eventId, enemyId, mode, targetId);
        const eid = this.getEventId(eventId);
        const b = $gameSystem.setEventIdToBattler(eid);
        if (b && isSrpgObstacleBattler(b)) adjustExistEnemyVarForObstacles(-1);
        return r;
    };

    const _Game_Interpreter_removeUnitOG = Game_Interpreter.prototype.removeUnit;
    Game_Interpreter.prototype.removeUnit = function(eventId) {
        const eid = this.getEventId(eventId);
        const battler = $gameSystem.setEventIdToBattler(eid);
        const isOb =
            battler &&
            battler.isEnemy &&
            battler.isEnemy() &&
            isSrpgObstacleBattler(battler);
        const r = _Game_Interpreter_removeUnitOG.call(this, eventId);
        if (isOb) adjustExistEnemyVarForObstacles(1);
        return r;
    };

    const _slipFloorAddDeathOG = Game_Battler.prototype.slipFloorAddDeath;
    if (typeof _slipFloorAddDeathOG === "function") {
        Game_Battler.prototype.slipFloorAddDeath = function() {
            const event = $gameMap.event(this.srpgEventId());
            const undo =
                this.isEnemy() &&
                isSrpgObstacleBattler(this) &&
                this.isDead() &&
                event &&
                !event.isErased();
            _slipFloorAddDeathOG.call(this);
            if (undo) adjustExistEnemyVarForObstacles(1);
        };
    }

    // Évite le crash si characterName ennemi est absent
    const _ImageManager_isObjectCharacter = ImageManager.isObjectCharacter;
    ImageManager.isObjectCharacter = function(filename) {
        if (!filename) return false;
        return _ImageManager_isObjectCharacter.call(this, filename);
    };

    // Début phase ennemie: obstacles déjà marqués "tour fini" (timeline / icônes cohérents)
    const _Game_System_srpgStartEnemyTurn = Game_System.prototype.srpgStartEnemyTurn;
    Game_System.prototype.srpgStartEnemyTurn = function() {
        _Game_System_srpgStartEnemyTurn.call(this);
        $gameMap.events().forEach(event => {
            if (!event || event.isErased() || event.isType() !== "enemy") return;
            const unit = $gameSystem.EventToUnit(event.eventId());
            if (!unit || !unit[1]) return;
            if (isSrpgObstacleBattler(unit[1])) unit[1].setSrpgTurnEnd(true);
        });
    };

    // Avant chaque sélection d'ennemi: obstacles hors file (timeline + renforts mid-phase)
    const _Scene_Map_srpgInvokeEnemyCommand = Scene_Map.prototype.srpgInvokeEnemyCommand;
    Scene_Map.prototype.srpgInvokeEnemyCommand = function() {
        $gameMap.events().forEach(event => {
            if (!event || event.isErased() || event.isType() !== "enemy") return;
            const enemy = $gameSystem.EventToUnit(event.eventId())[1];
            if (isSrpgObstacleBattler(enemy)) enemy.setSrpgTurnEnd(true);
        });
        _Scene_Map_srpgInvokeEnemyCommand.call(this);
    };

    const _isSrpgCollidedWithEvents = Game_CharacterBase.prototype.isSrpgCollidedWithEvents;
    Game_CharacterBase.prototype.isSrpgCollidedWithEvents = function(x, y) {
        if (!$gameSystem.isSRPGMode() || !$gameTemp.activeEvent()) {
            return _isSrpgCollidedWithEvents.call(this, x, y);
        }

        const activeEvent = $gameTemp.activeEvent();
        const events = $gameMap.events();
        const friendType = activeEvent.isType();
        const opponentType = friendType === "actor" ? "enemy" : "actor";
        const passFriends = activeEvent.passFriends();
        const passOpponents = activeEvent.passOpponents();
        const passEvents = activeEvent.passEvents();
        const passObjects = activeEvent.passObjects();

        const moverUnitArray = $gameSystem.EventToUnit(activeEvent.eventId());
        const moverBattler = moverUnitArray ? moverUnitArray[1] : null;

        const canPassObstacleByClassTag = (() => {
            if (!moverBattler || !moverBattler.isActor || !moverBattler.isActor()) return false;
            const cls = moverBattler.currentClass ? moverBattler.currentClass() : null;
            if (!cls || !cls.meta) return false;
            const throughTag = Number(cls.meta.srpgThroughTag || 0);
            const terrainTag = Number(cls.meta.terraintag || 0);
            return throughTag >= 7 || terrainTag >= 7;
        })();

        return events.some(event => {
            if (event.isErased() || !event.pos(x, y)) return false;
            if (event === activeEvent) return false;

            if (event.isType() === "object" && !passObjects && event.characterName() !== "") {
                return true;
            }

            if (event.isType() === "playerEvent" && !passEvents && event.blocksUnits()) {
                return true;
            }

            if (event.isType() === friendType && !passFriends && event.blocksFriends()) {
                return true;
            }

            if (event.isType() === opponentType && !passOpponents && event.blocksOpponents()) {
                if (canPassObstacleByClassTag && event.isType() === "enemy") {
                    const targetUnitArray = $gameSystem.EventToUnit(event.eventId());
                    const targetBattler = targetUnitArray ? targetUnitArray[1] : null;
                    if (isSrpgObstacleBattler(targetBattler)) return false;
                }
                return true;
            }

            return false;
        });
    };

    // Marqueur tour fini / auto-battle (sprite à côté du personnage) : masquer
    const _Sprite_Character_updateCharacterFrame_obstacle =
        Sprite_Character.prototype.updateCharacterFrame;
    Sprite_Character.prototype.updateCharacterFrame = function() {
        _Sprite_Character_updateCharacterFrame_obstacle.call(this);
        if (
            $gameSystem.isSRPGMode() &&
            this._character.isEvent() === true &&
            !this._character.isErased()
        ) {
            const battler = $gameSystem.setEventIdToBattler(this._character.eventId());
            if (battler && isSrpgObstacleBattler(battler) && this._turnEndSprite) {
                this._turnEndSprite.visible = false;
            }
        }
    };
})();
