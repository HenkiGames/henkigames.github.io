/*:
 * @target MZ
 * @plugindesc Remplace le SE de mort par celui défini en note <exchangeSe:nomFichier> sur acteur / ennemi.
 * @author Carbonne Arena
 *
 * @help
 * Placez dans les notes de la base de données (onglet « Notes » de l’acteur ou
 * de l’ennemi) une balise du type :
 *
 *   <exchangeSe:nomDuFichierSE>
 *
 * « nomDuFichierSE » est le nom du fichier SE sans extension, dans audio/se/.
 * Volume et panoramique reprennent ceux des SE de disparition définis dans
 * Types de système. La hauteur (pitch) est fixée à 90 pour ce SE de mort uniquement.
 *
 * Sans balise, le comportement par défaut du moteur est conservé.
 *
 * En « effondrement boss », si un SE personnalisé est utilisé, le grondement
 * répété du boss (SE système n°14) est désactivé pendant l’animation.
 *
 * Compatibilité SRPG : les appels directs à SoundManager depuis la carte sont
 * gérés. Mettez ce plugin après SRPG_core_MZ et, si besoin, après d’autres
 * plugins qui touchent aux morts en combat.
 */

(() => {
    "use strict";

    const META_KEY = "exchangeSe";
    const DEATH_CUSTOM_SE_PITCH = 90;

    const systemCollapseSeForParty = function (forActor) {
        const idx = forActor ? 15 : 11;
        if ($dataSystem && $dataSystem.sounds && $dataSystem.sounds[idx]) {
            return {
                name: $dataSystem.sounds[idx].name,
                volume: $dataSystem.sounds[idx].volume,
                pitch: $dataSystem.sounds[idx].pitch,
                pan: $dataSystem.sounds[idx].pan
            };
        }
        return { name: "", volume: 90, pitch: 100, pan: 0 };
    };

    const resolveMetaCollapseSe = function (battler) {
        if (!battler) return null;
        const row = battler.isActor() ? battler.actor() : battler.enemy();
        const meta = row && row.meta;
        const raw = meta && meta[META_KEY] ? String(meta[META_KEY]).trim() : "";
        if (!raw) return null;
        const base = systemCollapseSeForParty(battler.isActor());
        return {
            name: raw,
            volume: base.volume,
            pitch: DEATH_CUSTOM_SE_PITCH,
            pan: base.pan
        };
    };

    //-------------------------------------------------------------------------
    // Contexte pour SoundManager (SRPG unitDie / slipFloorAddDeath, etc.)
    //-------------------------------------------------------------------------

    const _Game_Battler_addState = Game_Battler.prototype.addState;
    Game_Battler.prototype.addState = function (stateId) {
        const wasDead = this.isDeathStateAffected();
        _Game_Battler_addState.call(this, stateId);
        if (!wasDead && this.isDeathStateAffected() && stateId === this.deathStateId()) {
            SoundManager._cbnCollapseBattlerCtx = this;
        }
    };

    const _SoundManager_playActorCollapse = SoundManager.playActorCollapse;
    SoundManager.playActorCollapse = function () {
        const ctx = SoundManager._cbnCollapseBattlerCtx;
        SoundManager._cbnCollapseBattlerCtx = null;
        const se = ctx && ctx.isActor && ctx.isActor() ? resolveMetaCollapseSe(ctx) : null;
        if (se) {
            AudioManager.playSe(se);
            return;
        }
        _SoundManager_playActorCollapse.call(this);
    };

    const _SoundManager_playEnemyCollapse = SoundManager.playEnemyCollapse;
    SoundManager.playEnemyCollapse = function () {
        const ctx = SoundManager._cbnCollapseBattlerCtx;
        SoundManager._cbnCollapseBattlerCtx = null;
        const se = ctx && ctx.isEnemy && ctx.isEnemy() ? resolveMetaCollapseSe(ctx) : null;
        if (se) {
            AudioManager.playSe(se);
            return;
        }
        _SoundManager_playEnemyCollapse.call(this);
    };

    //-------------------------------------------------------------------------
    // performCollapse (scène de combat, événements, etc.)
    //-------------------------------------------------------------------------

    Game_Actor.prototype.performCollapse = function () {
        Game_Battler.prototype.performCollapse.call(this);
        if (!$gameParty.inBattle()) return;
        const se = resolveMetaCollapseSe(this);
        if (se) {
            SoundManager._cbnCollapseBattlerCtx = null;
            AudioManager.playSe(se);
        } else {
            SoundManager.playActorCollapse();
        }
    };

    const _Game_Enemy_performCollapse = Game_Enemy.prototype.performCollapse;
    Game_Enemy.prototype.performCollapse = function () {
        this._cbnSuppressBossCollapse2 = false;
        Game_Battler.prototype.performCollapse.call(this);
        const custom = resolveMetaCollapseSe(this);
        switch (this.collapseType()) {
            case 0:
                this.requestEffect("collapse");
                if (custom) {
                    SoundManager._cbnCollapseBattlerCtx = null;
                    AudioManager.playSe(custom);
                } else {
                    SoundManager.playEnemyCollapse();
                }
                break;
            case 1:
                this.requestEffect("bossCollapse");
                if (custom) {
                    SoundManager._cbnCollapseBattlerCtx = null;
                    this._cbnSuppressBossCollapse2 = true;
                    AudioManager.playSe(custom);
                } else {
                    SoundManager.playBossCollapse1();
                }
                break;
            case 2:
                this.requestEffect("instantCollapse");
                if (custom) {
                    SoundManager._cbnCollapseBattlerCtx = null;
                    AudioManager.playSe(custom);
                }
                break;
            default:
                _Game_Enemy_performCollapse.call(this);
                break;
        }
    };

    //-------------------------------------------------------------------------
    // Boss collapse : grondement périodique — désactivé si SE perso
    //-------------------------------------------------------------------------

    Sprite_Enemy.prototype.updateBossCollapse = function () {
        this._shake = (this._effectDuration % 2) * 4 - 2;
        this.blendMode = 1;
        this.opacity *= this._effectDuration / (this._effectDuration + 1);
        this.setBlendColor([255, 255, 255, 255 - this.opacity]);
        if (this._effectDuration % 20 === 19) {
            if (!this._enemy || !this._enemy._cbnSuppressBossCollapse2) {
                SoundManager.playBossCollapse2();
            }
        }
    };
})();
