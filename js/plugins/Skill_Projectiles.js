/*:
 * @target MZ
 * @plugindesc [v1.4] Affiche des projectiles/lasers pour les competences (combat + SRPG map battle).
 * @author ChatGPT
 *
 * @param picturesFolderHint
 * @text Dossier PNG
 * @type string
 * @default img/pictures/
 * @desc Indication: les PNG sont charges avec ImageManager.loadPicture().
 *
 * @param defaultProjectileSpeed
 * @text Vitesse projectile (px/frame)
 * @type number
 * @min 1
 * @default 26
 *
 * @param defaultLaserDuration
 * @text Duree laser (frames)
 * @type number
 * @min 1
 * @default 14
 *
 * @param defaultLaserWidth
 * @text Largeur laser dessine
 * @type number
 * @min 1
 * @default 6
 *
 * @param defaultLaserColor
 * @text Couleur laser dessine
 * @type string
 * @default #ff4444
 *
 * @param defaultProjectileHoldFrames
 * @text Maintien apres impact (frames)
 * @type number
 * @min 0
 * @default 10
 * @desc Apres arrivee du projectile ou fin de duree laser : garder le sprite encore N frames avant suppression.
 *
 * @param waitBattleForProjectile
 * @text Attendre la fin du projectile
 * @type boolean
 * @default true
 * @desc Si oui : combat frontal ET combat SRPG sur la carte attendent la fin du tir avant le prochain acte / prochaine competence en file.
 *
 * @help
 * Utilisation (dans la note de la competence):
 *
 *   <useProjectile:NomImage>
 *     -> Projectile PNG (img/pictures/NomImage.png), de l'attaquant vers la cible.
 *
 *   <useProjectile:draw>
 *     -> Projectile dessine (petit cercle) sans PNG.
 *
 * Optionnel:
 *   <projectileMode:laser>
 *     -> Joue un laser au lieu d'un projectile mobile.
 *
 *   <projectileMode:projectile>
 *     -> Force le mode projectile (defaut).
 *
 *   <projectileSpeed:30>
 *     -> Vitesse du projectile (px/frame).
 *
 *   <projectileDuration:18>
 *     -> Duree d'affichage du laser (frames).
 *
 *   <projectileHoldFrames:12>
 *     -> Apres impact / fin de duree laser : maintien supplementaire (frames) pour laisser l'animation visible.
 *
 *   <projectileWidth:8>
 *     -> Largeur du laser dessine.
 *
 *   <projectileColor:#66ccff>
 *     -> Couleur du laser/projetile dessine.
 *
 *   <projectileSe:NomSE>
 *     -> Son joue au lancement du projectile/laser.
 *
 *   <chargeSe:NomSE>
 *     -> Son joue pendant la charge avant le tir.
 *
 *   <projectileChargeFrames:12>
 *     -> Duree de charge avant de lancer le tir (frames).
 *
 *   <impactSe:NomSE>
 *     -> Son joue a l'impact (arrivee cible / fin de croissance du laser).
 *
 * Reglages audio optionnels:
 *   <chargeSeVolume:90>      <chargeSePitch:100>      <chargeSePan:0>
 *   <projectileSeVolume:90>  <projectileSePitch:100>  <projectileSePan:0>
 *   <impactSeVolume:90>      <impactSePitch:100>      <impactSePan:0>
 *
 * Notes:
 * - Le plugin se declenche quand l'action commence (au clic/validation de la competence).
 * - La direction est automatiquement calculee vers la cible principale.
 * - Pour un laser PNG: mettre <projectileMode:laser> + <useProjectile:NomImage>.
 *   Le sprite est etire de la source a la cible.
 * - Compatible combat frontal + SRPG map battle.
 * - Option Attendre la fin du projectile : frontal (BattleManager) + SRPG carte (file invoke_action via waitingForSkill).
 * - Ordre des plugins : placer ce fichier APRES SRPG_core_MZ.js pour que lattente carte soit prise en compte.
 */

(() => {
    "use strict";

    const PLUGIN_NAME = "Skill_Projectiles";
    const params = PluginManager.parameters(PLUGIN_NAME);

    const DEFAULT_PROJECTILE_SPEED = Number(params.defaultProjectileSpeed || 26);
    const DEFAULT_LASER_DURATION = Number(params.defaultLaserDuration || 14);
    const DEFAULT_LASER_WIDTH = Number(params.defaultLaserWidth || 6);
    const DEFAULT_LASER_COLOR = String(params.defaultLaserColor || "#ff4444");

    const metaValue = (obj, key) => {
        if (!obj || !obj.meta) return "";
        const exact = obj.meta[key];
        if (exact != null) return String(exact);
        const lowerKey = key.toLowerCase();
        for (const k in obj.meta) {
            if (k.toLowerCase() === lowerKey) return String(obj.meta[k]);
        }
        return "";
    };

    const hasMetaKey = (obj, key) => {
        if (!obj || !obj.meta) return false;
        if (Object.prototype.hasOwnProperty.call(obj.meta, key)) return true;
        const lowerKey = key.toLowerCase();
        for (const k in obj.meta) {
            if (k.toLowerCase() === lowerKey) return true;
        }
        return false;
    };

    const toNumberOr = (value, fallback) => {
        if (value == null) return fallback;
        const s = String(value).trim();
        if (s === "") return fallback;
        const n = Number(s);
        return Number.isFinite(n) ? n : fallback;
    };

    const DEFAULT_PROJECTILE_HOLD_FRAMES = Math.max(
        0,
        Math.floor(toNumberOr(params.defaultProjectileHoldFrames, 10))
    );
    const WAIT_BATTLE_FOR_PROJECTILE =
        params.waitBattleForProjectile !== "false" && params.waitBattleForProjectile !== false;

    const playSeSafe = se => {
        if (!se || !se.name) return;
        AudioManager.playSe({
            name: se.name,
            volume: Math.max(0, Math.min(100, toNumberOr(se.volume, 90))),
            pitch: Math.max(50, Math.min(150, toNumberOr(se.pitch, 100))),
            pan: Math.max(-100, Math.min(100, toNumberOr(se.pan, 0)))
        });
    };

    const getBattleSpriteset = () => {
        const scene = SceneManager._scene;
        if (!scene || !(scene instanceof Scene_Battle)) return null;
        return scene._spriteset || null;
    };

    const getMapSpriteset = () => {
        const scene = SceneManager._scene;
        if (!scene || !(scene instanceof Scene_Map)) return null;
        return scene._spriteset || null;
    };

    const findBattlerSprite = (spriteset, battler) => {
        if (!spriteset || !battler) return null;
        const list = []
            .concat(spriteset._actorSprites || [])
            .concat(spriteset._enemySprites || []);
        return list.find(sprite => sprite && sprite._battler === battler) || null;
    };

    const battlerScreenPos = (sprite) => {
        if (!sprite) return null;
        return { x: sprite.x, y: sprite.y - (sprite.height || 64) * 0.25 };
    };

    const characterScreenPos = (sprite) => {
        if (!sprite) return null;
        return { x: sprite.x, y: sprite.y - (sprite.height || 48) * 0.25 };
    };

    const findCharacterSprite = (spriteset, character) => {
        if (!spriteset || !character) return null;
        const list = spriteset._characterSprites || [];
        return list.find(sprite => sprite && sprite._character === character) || null;
    };

    const updateProjectileLayer = (layer) => {
        if (!layer) return;
        for (let i = layer.children.length - 1; i >= 0; i--) {
            const child = layer.children[i];
            if (child && child.isFinished && child.isFinished()) {
                layer.removeChild(child);
                if (child.destroy) child.destroy();
            }
        }
    };

    const layerHasActiveProjectiles = layer => {
        if (!layer) return false;
        for (let i = 0; i < layer.children.length; i++) {
            const ch = layer.children[i];
            if (!ch) continue;
            if (typeof ch.isFinished === "function") {
                if (!ch.isFinished()) return true;
            } else {
                return true;
            }
        }
        return false;
    };

    const battleProjectileLayerBusy = () => {
        const ss = BattleManager._spriteset;
        return layerHasActiveProjectiles(ss && ss._bcaProjectileLayer);
    };

    const mapProjectileLayerBusy = () => {
        const ss = getMapSpriteset();
        return layerHasActiveProjectiles(ss && ss._bcaMapProjectileLayer);
    };

    const srpgMapBattleAwaitingMapProjectiles = () => {
        if (
            !$gameSystem ||
            typeof $gameSystem.isSRPGMode !== "function" ||
            !$gameSystem.isSRPGMode() ||
            typeof $gameSystem.useMapBattle !== "function" ||
            !$gameSystem.useMapBattle()
        ) {
            return false;
        }
        if (
            typeof $gameSystem.isSubBattlePhase !== "function" ||
            $gameSystem.isSubBattlePhase() !== "invoke_action"
        ) {
            return false;
        }
        return mapProjectileLayerBusy();
    };

    class Sprite_BcaSkillProjectile extends Sprite {
        initialize(config) {
            super.initialize();
            this._mode = config.mode;
            this._life = 0;
            this._maxLife = 0;
            this._laserGrowFrames = 1;
            this._laserFullScaleX = 1;
            this._laserScaleY = 1;
            this._vx = 0;
            this._vy = 0;
            this._targetX = config.endX;
            this._targetY = config.endY;
            this._chargeSe = config.chargeSe || null;
            this._launchSe = config.launchSe || null;
            this._impactSe = config.impactSe || null;
            this._chargeFrames = Math.max(0, config.chargeFrames || 0);
            this._chargeLife = 0;
            this._fired = false;
            this._impactPlayed = false;
            this._done = false;
            this._holdFrames = Math.max(0, config.holdFrames || 0);
            this._holdLife = 0;

            if (this._chargeFrames > 0) {
                this.visible = false;
                playSeSafe(this._chargeSe);
            } else {
                this.startFiring();
            }

            if (config.mode === "laser") {
                this.setupLaser(config);
            } else {
                this.setupProjectile(config);
            }
        }

        setupProjectile(config) {
            const angle = Math.atan2(config.endY - config.startY, config.endX - config.startX);
            this.x = config.startX;
            this.y = config.startY;
            this.rotation = angle;
            this.anchor.set(0.5, 0.5);

            if (config.assetName === "draw") {
                const size = Math.max(4, config.width);
                const b = new Bitmap(size, size);
                b.drawCircle(size / 2, size / 2, size / 2, config.color);
                this.bitmap = b;
            } else {
                this.bitmap = ImageManager.loadPicture(config.assetName);
            }

            this._vx = Math.cos(angle) * config.speed;
            this._vy = Math.sin(angle) * config.speed;
        }

        setupLaser(config) {
            const dx = config.endX - config.startX;
            const dy = config.endY - config.startY;
            const len = Math.max(1, Math.hypot(dx, dy));
            const angle = Math.atan2(dy, dx);

            this.x = config.startX;
            this.y = config.startY;
            this.rotation = angle;
            this.anchor.set(0, 0.5);
            this._life = 0;
            this._maxLife = Math.max(1, config.duration);
            this._laserGrowFrames = Math.max(1, Math.floor(this._maxLife * 0.45));

            if (config.assetName === "draw") {
                const b = new Bitmap(Math.ceil(len), Math.max(1, config.width));
                b.fillRect(0, 0, b.width, b.height, config.color);
                this.bitmap = b;
                this._laserFullScaleX = 1;
                this._laserScaleY = 1;
                this.scale.x = 0;
                this.scale.y = this._laserScaleY;
            } else {
                this.bitmap = ImageManager.loadPicture(config.assetName);
                const onReady = () => {
                    if (!this.bitmap) return;
                    const bw = Math.max(1, this.bitmap.width);
                    const bh = Math.max(1, this.bitmap.height);
                    this._laserFullScaleX = len / bw;
                    this._laserScaleY = config.useCustomWidth ? Math.max(1, config.width) / bh : 1;
                    this.scale.x = 0;
                    this.scale.y = this._laserScaleY;
                };
                if (this.bitmap.isReady()) onReady();
                else this.bitmap.addLoadListener(onReady);
            }
        }

        update() {
            super.update();
            if (this._done) return;
            if (!this._fired) {
                this._chargeLife++;
                if (this._chargeLife >= this._chargeFrames) {
                    this.startFiring();
                }
                return;
            }

            if (this._mode === "laser") {
                this._life++;
                const t = Math.min(1, this._life / this._laserGrowFrames);
                this.scale.x = this._laserFullScaleX * t;
                this.scale.y = this._laserScaleY;
                if (!this._impactPlayed && t >= 1) {
                    this._impactPlayed = true;
                    playSeSafe(this._impactSe);
                }
                const laserTotal = this._maxLife + this._holdFrames;
                if (this._life >= laserTotal) this._done = true;
                return;
            }

            this.x += this._vx;
            this.y += this._vy;

            const reachedX = (this._vx >= 0 && this.x >= this._targetX) || (this._vx < 0 && this.x <= this._targetX);
            const reachedY = (this._vy >= 0 && this.y >= this._targetY) || (this._vy < 0 && this.y <= this._targetY);
            if (reachedX && reachedY) {
                if (!this._impactPlayed) {
                    this._impactPlayed = true;
                    playSeSafe(this._impactSe);
                }
                if (this._holdLife < this._holdFrames) {
                    this._holdLife++;
                    return;
                }
                this._done = true;
            }
        }

        startFiring() {
            this._fired = true;
            this.visible = true;
            playSeSafe(this._launchSe);
        }

        isFinished() {
            return this._done;
        }
    }

    const ensureBattleProjectileLayer = (spriteset) => {
        if (!spriteset._bcaProjectileLayer) {
            const layer = new Sprite();
            const parent = spriteset._battleField || spriteset._baseSprite;
            if (!parent) return null;
            parent.addChild(layer);
            spriteset._bcaProjectileLayer = layer;
        }
        return spriteset._bcaProjectileLayer;
    };

    const ensureMapProjectileLayer = (spriteset) => {
        if (!spriteset._bcaMapProjectileLayer) {
            const layer = new Sprite();
            const parent = spriteset._tilemap || spriteset._baseSprite;
            if (!parent) return null;
            parent.addChild(layer);
            spriteset._bcaMapProjectileLayer = layer;
        }
        return spriteset._bcaMapProjectileLayer;
    };

    const buildProjectileConfig = (start, end, item) => {
        const useProjectile = metaValue(item, "useProjectile").trim();
        if (!useProjectile) return null;

        const modeRaw = metaValue(item, "projectileMode").trim().toLowerCase();
        const mode = modeRaw === "laser" ? "laser" : "projectile";
        const hasCustomWidth = hasMetaKey(item, "projectileWidth");
        const chargeFrames = Math.max(0, Math.floor(toNumberOr(metaValue(item, "projectileChargeFrames"), 0)));
        const chargeSeName = metaValue(item, "chargeSe").trim();
        const launchSeName = metaValue(item, "projectileSe").trim();
        const impactSeName = metaValue(item, "impactSe").trim();

        return {
            mode: mode,
            assetName: useProjectile.toLowerCase() === "draw" ? "draw" : useProjectile,
            startX: start.x,
            startY: start.y,
            endX: end.x,
            endY: end.y,
            speed: Math.max(1, toNumberOr(metaValue(item, "projectileSpeed"), DEFAULT_PROJECTILE_SPEED)),
            duration: Math.max(1, toNumberOr(metaValue(item, "projectileDuration"), DEFAULT_LASER_DURATION)),
            holdFrames: Math.max(
                0,
                Math.floor(toNumberOr(metaValue(item, "projectileHoldFrames"), DEFAULT_PROJECTILE_HOLD_FRAMES))
            ),
            width: Math.max(1, toNumberOr(metaValue(item, "projectileWidth"), DEFAULT_LASER_WIDTH)),
            useCustomWidth: hasCustomWidth,
            color: metaValue(item, "projectileColor") || DEFAULT_LASER_COLOR,
            chargeFrames: chargeFrames,
            chargeSe: chargeSeName
                ? {
                    name: chargeSeName,
                    volume: toNumberOr(metaValue(item, "chargeSeVolume"), 90),
                    pitch: toNumberOr(metaValue(item, "chargeSePitch"), 100),
                    pan: toNumberOr(metaValue(item, "chargeSePan"), 0)
                }
                : null,
            launchSe: launchSeName
                ? {
                    name: launchSeName,
                    volume: toNumberOr(metaValue(item, "projectileSeVolume"), 90),
                    pitch: toNumberOr(metaValue(item, "projectileSePitch"), 100),
                    pan: toNumberOr(metaValue(item, "projectileSePan"), 0)
                }
                : null,
            impactSe: impactSeName
                ? {
                    name: impactSeName,
                    volume: toNumberOr(metaValue(item, "impactSeVolume"), 90),
                    pitch: toNumberOr(metaValue(item, "impactSePitch"), 100),
                    pan: toNumberOr(metaValue(item, "impactSePan"), 0)
                }
                : null
        };
    };

    const startSkillProjectileBattle = (subject, target, item) => {
        if (!subject || !target || !item) return;
        const spriteset = getBattleSpriteset();
        if (!spriteset) return;

        const subjectSprite = findBattlerSprite(spriteset, subject);
        const targetSprite = findBattlerSprite(spriteset, target);
        if (!subjectSprite || !targetSprite) return;

        const start = battlerScreenPos(subjectSprite);
        const end = battlerScreenPos(targetSprite);
        if (!start || !end) return;

        const cfg = buildProjectileConfig(start, end, item);
        if (!cfg) return;
        const layer = ensureBattleProjectileLayer(spriteset);
        if (!layer) return;
        const sprite = new Sprite_BcaSkillProjectile(cfg);
        layer.addChild(sprite);
    };

    const startSkillProjectileMap = (userEventId, targetEventId, item) => {
        if (!userEventId || !targetEventId || !item) return;
        const spriteset = getMapSpriteset();
        if (!spriteset) return;

        const userEvent = $gameMap.event(userEventId);
        const targetEvent = $gameMap.event(targetEventId);
        if (!userEvent || !targetEvent) return;

        const userSprite = findCharacterSprite(spriteset, userEvent);
        const targetSprite = findCharacterSprite(spriteset, targetEvent);
        if (!userSprite || !targetSprite) return;

        const start = characterScreenPos(userSprite);
        const end = characterScreenPos(targetSprite);
        if (!start || !end) return;

        const cfg = buildProjectileConfig(start, end, item);
        if (!cfg) return;
        const layer = ensureMapProjectileLayer(spriteset);
        if (!layer) return;
        const sprite = new Sprite_BcaSkillProjectile(cfg);
        layer.addChild(sprite);
    };

    const _Spriteset_Battle_update = Spriteset_Battle.prototype.update;
    Spriteset_Battle.prototype.update = function() {
        _Spriteset_Battle_update.call(this);
        updateProjectileLayer(this._bcaProjectileLayer);
    };

    const _BattleManager_startAction = BattleManager.startAction;
    BattleManager.startAction = function() {
        const action = this._action;
        const subject = this._subject;
        const item = action ? action.item() : null;
        const target = this._targets && this._targets.length > 0 ? this._targets[0] : null;
        startSkillProjectileBattle(subject, target, item);
        _BattleManager_startAction.call(this);
    };

    if (WAIT_BATTLE_FOR_PROJECTILE) {
        const _BattleManager_isBusy = BattleManager.isBusy;
        BattleManager.isBusy = function() {
            if (
                (this._phase === "turn" || this._phase === "turnEnd") &&
                battleProjectileLayerBusy()
            ) {
                return true;
            }
            return _BattleManager_isBusy.call(this);
        };

        if (typeof Scene_Map !== "undefined") {
            let _bcaSrpgWaitHookDone = false;
            const installSrpgMapProjectileWait = () => {
                if (_bcaSrpgWaitHookDone || typeof Scene_Map.prototype.waitingForSkill !== "function") {
                    return;
                }
                _bcaSrpgWaitHookDone = true;
                const _Scene_Map_waitingForSkill = Scene_Map.prototype.waitingForSkill;
                Scene_Map.prototype.waitingForSkill = function() {
                    if (_Scene_Map_waitingForSkill.call(this)) return true;
                    if (srpgMapBattleAwaitingMapProjectiles()) return true;
                    return false;
                };
            };
            const _Scene_Map_update_projectileWait = Scene_Map.prototype.update;
            Scene_Map.prototype.update = function() {
                installSrpgMapProjectileWait();
                _Scene_Map_update_projectileWait.call(this);
            };
        }
    }

    if (typeof Spriteset_Map !== "undefined") {
        const _Spriteset_Map_update = Spriteset_Map.prototype.update;
        Spriteset_Map.prototype.update = function() {
            _Spriteset_Map_update.call(this);
            updateProjectileLayer(this._bcaMapProjectileLayer);
        };
    }

    const srpgEventIdFromBattler = battler => {
        if (!battler || !battler.srpgEventId) return 0;
        const id = Number(battler.srpgEventId());
        return Number.isFinite(id) ? id : 0;
    };

    const resolveSrpgTargetEventId = data => {
        if (!data) return 0;
        if (data.target && data.target.srpgEventId) return srpgEventIdFromBattler(data.target);
        if (Array.isArray(data.targets) && data.targets[0] && data.targets[0].srpgEventId) {
            return srpgEventIdFromBattler(data.targets[0]);
        }
        if (Array.isArray(data.targetArray) && data.targetArray[1] && data.targetArray[1].srpgEventId) {
            return srpgEventIdFromBattler(data.targetArray[1]);
        }
        return 0;
    };

    if (typeof Scene_Map !== "undefined") {
        const _Scene_Map_srpgInvokeMapSkill = Scene_Map.prototype.srpgInvokeMapSkill;
        Scene_Map.prototype.srpgInvokeMapSkill = function(data) {
            if (
                data &&
                data.phase === "start" &&
                $gameSystem &&
                $gameSystem.isSRPGMode &&
                $gameSystem.isSRPGMode() &&
                $gameSystem.useMapBattle &&
                $gameSystem.useMapBattle() &&
                data.action &&
                data.action.item
            ) {
                const item = data.action.item();
                const userEventId = data.user && data.user.srpgEventId ? srpgEventIdFromBattler(data.user) : 0;
                const targetEventId = resolveSrpgTargetEventId(data);
                startSkillProjectileMap(userEventId, targetEventId, item);
            }
            return _Scene_Map_srpgInvokeMapSkill.call(this, data);
        };
    }
})();
