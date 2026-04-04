/*:
 * @target MZ
 * @plugindesc Petite avance/recul du battler lors d'une competence. v1.0.0
 * @author ChatGPT
 *
 * @param distance
 * @text Distance (pixels)
 * @type number
 * @min 1
 * @default 18
 * @desc Nombre de pixels avances pendant l'animation.
 *
 * @param forwardDuration
 * @text Duree aller (frames)
 * @type number
 * @min 1
 * @default 8
 * @desc Duree de l'avance.
 *
 * @param backDuration
 * @text Duree retour (frames)
 * @type number
 * @min 1
 * @default 10
 * @desc Duree du retour a la position initiale.
 *
 * @param includeItems
 * @text Inclure les objets
 * @type boolean
 * @on Oui
 * @off Non
 * @default false
 * @desc Si Oui, joue aussi l'animation pour les objets.
 *
 * @help
 * Ce plugin ajoute un petit mouvement du battler pendant une action :
 * - il avance legerement dans sa direction d'attaque
 * - puis revient automatiquement a sa position initiale.
 *
 * Fonctionne en combat standard ET en combat SRPG sur la carte (map battle).
 *
 * Ordre conseille:
 * - Placez ce plugin sous les plugins qui modifient fortement les animations
 *   de combat, afin que ce deplacement soit applique en dernier.
 */

(() => {
    "use strict";

    const PLUGIN_NAME = "BattlerSkillLunge";
    const params = PluginManager.parameters(PLUGIN_NAME);
    const DISTANCE = Number(params.distance || 18);
    const FORWARD_DURATION = Number(params.forwardDuration || 8);
    const BACK_DURATION = Number(params.backDuration || 10);
    const INCLUDE_ITEMS = params.includeItems === "true";

    const _Game_Battler_performActionStart = Game_Battler.prototype.performActionStart;
    Game_Battler.prototype.performActionStart = function(action) {
        _Game_Battler_performActionStart.call(this, action);
        if (!action) return;
        if (action.isSkill() || (INCLUDE_ITEMS && action.isItem())) {
            this._bcaLungeStartRequested = true;
            this._bcaLungeEndRequested = false;
        }
    };

    const _Game_Battler_performActionEnd = Game_Battler.prototype.performActionEnd;
    Game_Battler.prototype.performActionEnd = function() {
        _Game_Battler_performActionEnd.call(this);
        if (this._bcaLungeInProgress) {
            this._bcaLungeEndRequested = true;
        }
    };

    const _Sprite_Battler_initMembers = Sprite_Battler.prototype.initMembers;
    Sprite_Battler.prototype.initMembers = function() {
        _Sprite_Battler_initMembers.call(this);
        this._bcaLungeState = "idle";
        this._bcaLungeBaseX = 0;
        this._bcaLungeBaseY = 0;
    };

    const _Sprite_Battler_updateMain = Sprite_Battler.prototype.updateMain;
    Sprite_Battler.prototype.updateMain = function() {
        _Sprite_Battler_updateMain.call(this);
        this.updateBcaSkillLunge();
    };

    Sprite_Battler.prototype.updateBcaSkillLunge = function() {
        const battler = this._battler;
        if (!battler) return;

        if (battler._bcaLungeStartRequested && this._bcaLungeState === "idle") {
            battler._bcaLungeStartRequested = false;
            battler._bcaLungeInProgress = true;
            battler._bcaLungeEndRequested = false;
            this.startBcaLungeForward();
        }

        if (
            battler._bcaLungeEndRequested &&
            this._bcaLungeState === "forward" &&
            !this.isMoving()
        ) {
            battler._bcaLungeEndRequested = false;
            this.startBcaLungeBack();
        }

        if (this._bcaLungeState === "back" && !this.isMoving()) {
            this._bcaLungeState = "idle";
            battler._bcaLungeInProgress = false;
            battler._bcaLungeEndRequested = false;
        }
    };

    Sprite_Battler.prototype.startBcaLungeForward = function() {
        const targetOffsetX = Number.isFinite(this._targetOffsetX) ? this._targetOffsetX : this._offsetX;
        const targetOffsetY = Number.isFinite(this._targetOffsetY) ? this._targetOffsetY : this._offsetY;
        const towardTargetX = this._battler && this._battler.isActor() ? -DISTANCE : DISTANCE;

        this._bcaLungeBaseX = targetOffsetX;
        this._bcaLungeBaseY = targetOffsetY;
        this._bcaLungeState = "forward";
        this.startMove(targetOffsetX + towardTargetX, targetOffsetY, FORWARD_DURATION);
    };

    Sprite_Battler.prototype.startBcaLungeBack = function() {
        this._bcaLungeState = "back";
        this.startMove(this._bcaLungeBaseX, this._bcaLungeBaseY, BACK_DURATION);
    };

    // -------------------------------------------------------------------------
    // SRPG map battle support (Sprite_Character)
    // -------------------------------------------------------------------------
    const _Sprite_Character_initMembers_Bca = Sprite_Character.prototype.initMembers;
    Sprite_Character.prototype.initMembers = function() {
        _Sprite_Character_initMembers_Bca.call(this);
        this._bcaMapOffsetX = 0;
        this._bcaMapOffsetY = 0;
        this._bcaMapTargetOffsetX = 0;
        this._bcaMapTargetOffsetY = 0;
        this._bcaMapMoveDuration = 0;
        this._bcaMapBaseX = 0;
        this._bcaMapBaseY = 0;
    };

    const _Sprite_Character_update_Bca = Sprite_Character.prototype.update;
    Sprite_Character.prototype.update = function() {
        _Sprite_Character_update_Bca.call(this);
        this.updateBcaMapLungeMotion();
    };

    const _Sprite_Character_updatePosition_Bca = Sprite_Character.prototype.updatePosition;
    Sprite_Character.prototype.updatePosition = function() {
        _Sprite_Character_updatePosition_Bca.call(this);
        this.x += this._bcaMapOffsetX || 0;
        this.y += this._bcaMapOffsetY || 0;
    };

    Sprite_Character.prototype.updateBcaMapLungeMotion = function() {
        if (this._bcaMapMoveDuration > 0) {
            const d = this._bcaMapMoveDuration;
            this._bcaMapOffsetX = (this._bcaMapOffsetX * (d - 1) + this._bcaMapTargetOffsetX) / d;
            this._bcaMapOffsetY = (this._bcaMapOffsetY * (d - 1) + this._bcaMapTargetOffsetY) / d;
            this._bcaMapMoveDuration--;
            this.updatePosition();
        }
    };

    Sprite_Character.prototype.startBcaMapLungeMove = function(x, y, duration) {
        this._bcaMapTargetOffsetX = x;
        this._bcaMapTargetOffsetY = y;
        this._bcaMapMoveDuration = Math.max(1, duration || 1);
    };

    Sprite_Character.prototype.startBcaMapLungeForward = function(distance) {
        const dir = this._character ? this._character.direction() : 2;
        let dx = 0;
        let dy = 0;
        if (dir === 2) dy = distance;
        else if (dir === 4) dx = -distance;
        else if (dir === 6) dx = distance;
        else if (dir === 8) dy = -distance;
        this._bcaMapBaseX = this._bcaMapOffsetX || 0;
        this._bcaMapBaseY = this._bcaMapOffsetY || 0;
        this.startBcaMapLungeMove(this._bcaMapBaseX + dx, this._bcaMapBaseY + dy, FORWARD_DURATION);
    };

    Sprite_Character.prototype.startBcaMapLungeBack = function() {
        this.startBcaMapLungeMove(this._bcaMapBaseX || 0, this._bcaMapBaseY || 0, BACK_DURATION);
    };

    const findBcaCharacterSprite = function(character) {
        const scene = SceneManager._scene;
        const spriteset = scene && scene._spriteset;
        const sprites = spriteset && spriteset._characterSprites;
        if (!character || !sprites) return null;
        return sprites.find(sprite => sprite && sprite._character === character) || null;
    };

    const isBcaLungeEligibleAction = function(action) {
        if (!action) return false;
        return action.isSkill() || (INCLUDE_ITEMS && action.isItem());
    };

    const _Scene_Map_srpgInvokeMapSkill_Bca = Scene_Map.prototype.srpgInvokeMapSkill;
    Scene_Map.prototype.srpgInvokeMapSkill = function(data) {
        if (
            data &&
            $gameSystem &&
            $gameSystem.isSRPGMode &&
            $gameSystem.isSRPGMode() &&
            $gameSystem.useMapBattle &&
            $gameSystem.useMapBattle() &&
            isBcaLungeEligibleAction(data.action)
        ) {
            const userEvent = $gameMap.event(data.user.srpgEventId());
            const userSprite = findBcaCharacterSprite(userEvent);
            if (userSprite) {
                if (data.phase === "start") {
                    userSprite.startBcaMapLungeForward(DISTANCE);
                } else if (data.phase === "end" || data.phase === "cancel") {
                    userSprite.startBcaMapLungeBack();
                }
            }
        }
        return _Scene_Map_srpgInvokeMapSkill_Bca.call(this, data);
    };
})();
