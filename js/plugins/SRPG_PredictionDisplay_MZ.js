//=============================================================================
// SRPG_PredictionDisplay_MZ.js
// Fenêtre de prédiction allégée + options d’affichage statut SRPG
//=============================================================================
/*:
 * @target MZ
 * @plugindesc Allège la prédiction SRPG et le statut SRPG (classe, stats, PM, équipement, etc.).
 * @author Projet Carbonne Arena
 *
 * @base SRPG_core_MZ
 * @orderAfter SRPG_core_MZ
 * @orderAfter SRPG_UX_Windows_MZ
 *
 * @param showUnitNames
 * @text Ligne noms des unités
 * @desc Affiche une ligne avec le nom de la cible (gauche) et de l’attaquant (droite), en prédiction seulement.
 * @type boolean
 * @default true
 *
 * @param showCenterDivider
 * @text Séparateur vertical (prédiction)
 * @desc Ligne discrète entre la colonne cible et la colonne attaquant.
 * @type boolean
 * @default true
 *
 * @param coloredDamageValues
 * @text Couleurs dégâts / soins
 * @desc Met en évidence les chiffres (dégâts / soins) dans la prédiction.
 * @type boolean
 * @default true
 *
 * @help
 * Prédiction : compétence + dégâts/soins uniquement (pas de coût affiché,
 * pas de précision ni portée de compétence, pas d’ordre d’action).
 *
 * Statut SRPG (survol) : fenêtre basse ~50 % hauteur, portrait taille normale,
 * pas de niveau, ligne ATQ / DEF / ATK.SPE / DEF.SPE / PM, icônes d’état
 * cliquables → fenêtre d’aide (description du state BDD ; buffs → nom du param).
 */

(function () {
    'use strict';

    const pluginName = 'SRPG_PredictionDisplay_MZ';
    const params = PluginManager.parameters(pluginName);
    const showUnitNames = params['showUnitNames'] === 'true';
    const showCenterDivider = params['showCenterDivider'] === 'true';
    const coloredDamageValues = params['coloredDamageValues'] === 'true';

    const coreParams = PluginManager.parameters('SRPG_core_MZ');
    const _srpgPredictionWindowMode = Number(coreParams['srpgPredictionWindowMode'] || 1);
    const _srpgUseAgiAttackPlus = coreParams['useAgiAttackPlus'] || 'true';
    const _srpgBattleReaction = Number(coreParams['srpgBattleReaction'] || 1);
    const _textSrpgDamage = coreParams['textSrpgDamage'] || 'Damage';
    const _textSrpgHealing = coreParams['textSrpgHealing'] || 'Healing';
    const _textSrpgMove = coreParams['textSrpgMove'] || 'Move';

    const SRPG_CMD_STATUS_TEXT_X = 180;
    const SRPG_CMD_STATUS_STEP = 22;
    const SRPG_CMD_STATUS_ICON_ROW_WIDTH = 200;

    const formatSrpgBattlerStatsLine = function (battler) {
        return (
            'ATQ ' +
            battler.param(2) +
            '  DEF ' +
            battler.param(3) +
            '  ATK.SPE ' +
            battler.param(4) +
            '  DEF.SPE ' +
            battler.param(5) +
            '  PM ' +
            battler.srpgMove()
        );
    };

    const extraHeaderHeight = function (scene) {
        if (_srpgPredictionWindowMode !== 1 || !showUnitNames) return 0;
        return scene.calcWindowHeight(1, false);
    };

    Scene_Map.prototype.srpgActorCommandStatusWindowRect = function () {
        const ww = Graphics.boxWidth - 240;
        const pad = $gameSystem.windowPadding();
        let lh = this.calcWindowHeight(1, false) - pad * 2;
        if (!lh || lh < 12) lh = 36;
        let faceInnerH = this.calcWindowHeight(2, false) - 8;
        if (!faceInnerH || faceInnerH < 24) faceInnerH = lh * 2 + pad * 2 - 8;
        const gH = Window_StatusBase.prototype.gaugeLineHeight();
        const st = SRPG_CMD_STATUS_STEP;
        const rightColH =
            st * 2 +
            ImageManager.iconHeight +
            6 +
            gH +
            ($dataSystem.optDisplayTp ? gH : 0);
        const innerH = Math.max(faceInnerH, rightColH) + 2;
        const wh = Math.max(innerH + pad * 2, this.calcWindowHeight(2, false));
        const wx = 120;
        const wy = Graphics.boxHeight - wh;
        return new Rectangle(wx, wy, ww, wh);
    };

    const _predSceneMapUpdate = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function () {
        _predSceneMapUpdate.call(this);
        this.updateSrpgBattlerStateHelp();
    };

    Scene_Map.prototype.updateSrpgBattlerStateHelp = function () {
        if (!$gameSystem.isSRPGMode() || !this._srpgStateHelpFromStatusClick) return;
        const hw = this._helpWindow;
        if (!hw || !hw.visible) {
            this._srpgStateHelpFromStatusClick = false;
            return;
        }
        if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
            hw.clear();
            hw.close();
            hw.hide();
            this._srpgStateHelpFromStatusClick = false;
        }
    };

    Scene_Map.prototype.srpgShowBattlerStateHelp = function (entry) {
        const hw = this._helpWindow;
        if (!hw || !entry) return;
        let text = '';
        if (entry.kind === 'state' && entry.state) {
            const s = entry.state;
            const desc = s.description != null ? String(s.description).trim() : '';
            if (desc) {
                text = desc;
            } else {
                text = s.name || '';
                if (s.message1) text = text + (text ? '\n' : '') + s.message1;
            }
        } else if (entry.kind === 'buff') {
            const n = TextManager.param(entry.paramId);
            const lv = entry.level;
            text = lv > 0 ? n + ' +' + lv : n + ' ' + lv;
        }
        hw.setText(text);
        hw.show();
        hw.open();
        this._srpgStateHelpFromStatusClick = true;
    };

    Window_SrpgActorCommandStatus.prototype.srpgBuildIconClickEntries = function () {
        const battler = this._battler;
        const entries = [];
        battler.states().forEach(function (state) {
            if (state && state.iconIndex > 0) {
                entries.push({ kind: 'state', state: state });
            }
        });
        for (let i = 0; i < battler._buffs.length; i++) {
            if (battler._buffs[i] !== 0) {
                entries.push({ kind: 'buff', paramId: i, level: battler._buffs[i] });
            }
        }
        return entries;
    };

    Window_SrpgActorCommandStatus.prototype.srpgHitTestStatusIcon = function () {
        if (!this._battler) return null;
        const touchPos = new Point(TouchInput.x, TouchInput.y);
        const localPos = this.worldTransform.applyInverse(touchPos);
        if (!this.innerRect.contains(localPos.x, localPos.y)) return null;
        const cx = localPos.x - this.padding;
        const cy = localPos.y - this.padding;
        const x = SRPG_CMD_STATUS_TEXT_X;
        const step = SRPG_CMD_STATUS_STEP;
        const yIcons = step * 2;
        const top = yIcons + 2;
        const bottom = top + ImageManager.iconHeight;
        if (cy < top || cy >= bottom) return null;
        const delta = ImageManager.standardIconWidth - ImageManager.iconWidth;
        const iconW = ImageManager.standardIconWidth;
        const entries = this.srpgBuildIconClickEntries();
        const maxIcons = Math.floor(SRPG_CMD_STATUS_ICON_ROW_WIDTH / iconW);
        const n = Math.min(entries.length, maxIcons);
        let iconX = x + delta / 2;
        for (let i = 0; i < n; i++) {
            if (cx >= iconX && cx < iconX + iconW) {
                return entries[i];
            }
            iconX += iconW;
        }
        return null;
    };

    const _predWacsUpdate = Window_Selectable.prototype.update;
    Window_SrpgActorCommandStatus.prototype.update = function () {
        _predWacsUpdate.call(this);
        if (!this.isOpen() || !this._battler) return;
        if (TouchInput.isTriggered() && this.isTouchedInsideFrame()) {
            const entry = this.srpgHitTestStatusIcon();
            if (entry) {
                TouchInput.clear();
                const sc = SceneManager._scene;
                if (sc && sc.srpgShowBattlerStateHelp) {
                    sc.srpgShowBattlerStateHelp(entry);
                }
            }
        }
    };

    const _Scene_Map_srpgPredictionWindowRect = Scene_Map.prototype.srpgPredictionWindowRect;
    Scene_Map.prototype.srpgPredictionWindowRect = function () {
        const r = _Scene_Map_srpgPredictionWindowRect.call(this);
        let h = r.height;
        if (_srpgPredictionWindowMode === 1) {
            h -= this.calcWindowHeight(1, false);
            if (_srpgUseAgiAttackPlus === 'true' && _srpgBattleReaction !== 3) {
                h -= 12;
            }
        }
        h += extraHeaderHeight(this);
        return new Rectangle(r.x, r.y, r.width, h);
    };

    Window_SrpgPrediction.prototype.drawSrpgBattleActionName = function (battler, action, x, y, flag) {
        if (action && flag === true) {
            var skill = action.item();
            if (skill) {
                this.changePaintOpacity(this.isEnabled(battler, skill));
                if (DataManager.isSkill(skill) && skill.id === battler.attackSkillId() && !battler.hasNoWeapons()) {
                    var item;
                    if (battler.isActor()) {
                        item = battler.weapons()[0];
                    } else {
                        item = $dataWeapons[battler.srpgWeaponId()];
                    }
                    this.drawItemName(item, x, y, 300);
                } else {
                    this.drawItemName(skill, x, y, 300);
                }
                this.changePaintOpacity(1);
            } else {
                this.drawText('------------', x + 52, y, 96, 'right');
            }
        } else {
            this.drawText('------------', x + 52, y, 96, 'right');
        }
    };

    Window_SrpgPrediction.prototype.drawSrpgBattleDamage = function (damage, x, y) {
        this.changeTextColor(ColorManager.systemColor());
        if (damage >= 0) {
            this.drawText(_textSrpgDamage, x, y, 164);
            this.resetTextColor();
            if (coloredDamageValues) {
                this.changeTextColor(ColorManager.powerDownColor());
            }
            this.drawText(damage, x + 188, y, 112, 'right');
        } else {
            this.drawText(_textSrpgHealing, x, y, 164);
            this.resetTextColor();
            if (coloredDamageValues) {
                this.changeTextColor(ColorManager.powerUpColor());
            }
            this.drawText(damage * -1, x + 188, y, 112, 'right');
        }
        this.resetTextColor();
    };

    Window_SrpgPrediction.prototype.drawContents = function () {
        this.resetFontSettings();
        const lineHeight = this.lineHeight();
        const padding = 24;
        const user = this._userArray[1];
        const target = this._targetArray[1];

        if (_srpgPredictionWindowMode === 2) {
            var act2 = user.currentAction();
            this.drawSrpgBattleActionName(user, act2, this.innerWidth / 2 + padding * 2, 0, true);
            var react2 = target.currentAction();
            if (react2 && !target.canUse(react2.item())) react2 = null;
            if (act2 && act2.item().meta.srpgUncounterable) react2 = null;
            if (!react2 || user === target) {
                this.drawSrpgBattleActionName(target, react2, padding, 0, false);
            } else {
                this.drawSrpgBattleActionName(target, react2, padding, 0, true);
            }
            return;
        }

        const headerShift = showUnitNames && _srpgPredictionWindowMode === 1 ? lineHeight : 0;

        const cx = Math.floor(this.innerWidth / 2);
        if (showCenterDivider && _srpgPredictionWindowMode === 1) {
            this.contents.fillRect(cx, 0, 1, this.innerHeight, ColorManager.dimColor1());
        }

        if (showUnitNames && _srpgPredictionWindowMode === 1) {
            const colW = Math.floor(this.innerWidth / 2) - padding * 2;
            this.contents.fontSize = Math.max(16, $gameSystem.mainFontSize() - 4);
            this.changeTextColor(ColorManager.systemColor());
            this.drawText(target.name(), padding, 4, colW, 'left');
            this.drawText(user.name(), this.innerWidth - padding - colW, 4, colW, 'right');
            this.resetFontSettings();
        }

        const y0 = headerShift + lineHeight * 0;
        const y1 = headerShift + lineHeight * 1;

        var damage = 0;
        var action = user.currentAction();
        if (action) {
            damage = action.srpgPredictionDamage(target);
            this.drawSrpgBattleActionName(user, action, this.innerWidth / 2 + padding * 2, y0, true);
            this.drawSrpgBattleDamage(damage, this.innerWidth / 2 + padding * 2, y1);
        } else {
            this.drawSrpgBattleActionName(user, action, this.innerWidth / 2 + padding * 2, y0, true);
        }

        var reaction = target.currentAction();
        if (reaction && !target.canUse(reaction.item())) reaction = null;
        if (action && action.item().meta.srpgUncounterable) reaction = null;
        if (!reaction || user === target) {
            this.drawSrpgBattleActionName(target, reaction, padding, y0, false);
        } else {
            damage = reaction.srpgPredictionDamage(user);
            this.drawSrpgBattleActionName(target, reaction, padding, y0, true);
            this.drawSrpgBattleDamage(damage, padding, y1);
        }
    };

    Window_StatusBase.prototype.placeBasicGaugesSrpg = function (battler, x, y) {
        this.placeGaugeSrpg(battler, 'hp', x, y);
        if ($dataSystem.optDisplayTp) {
            this.placeGaugeSrpg(battler, 'tp', x, y + this.gaugeLineHeight());
        }
    };

    Window_StatusBase.prototype.drawActorSimpleStatusSrpg = function (actor, x, y) {
        const step = SRPG_CMD_STATUS_STEP;
        const fs = Math.max(13, $gameSystem.mainFontSize() - 5);
        this.contents.fontSize = fs;
        this.drawActorName(actor, x, y, 300);
        const y1 = y + step;
        this.drawText(formatSrpgBattlerStatsLine(actor), x, y1, this.contentsWidth() - x, 'left');
        const y2 = y1 + step;
        this.drawActorIcons(actor, x, y2, SRPG_CMD_STATUS_ICON_ROW_WIDTH);
        const y3 = y2 + ImageManager.iconHeight + 6;
        this.placeBasicGaugesSrpg(actor, x, y3);
        this.resetFontSettings();
    };

    Window_StatusBase.prototype.drawEnemySimpleStatusSrpg = function (enemy, x, y) {
        const step = SRPG_CMD_STATUS_STEP;
        const fs = Math.max(13, $gameSystem.mainFontSize() - 5);
        this.contents.fontSize = fs;
        this.drawActorName(enemy, x, y, 300);
        const y1 = y + step;
        this.drawText(formatSrpgBattlerStatsLine(enemy), x, y1, this.contentsWidth() - x, 'left');
        const y2 = y1 + step;
        this.drawActorIcons(enemy, x, y2, SRPG_CMD_STATUS_ICON_ROW_WIDTH);
        const y3 = y2 + ImageManager.iconHeight + 6;
        this.placeBasicGaugesSrpg(enemy, x, y3);
        this.resetFontSettings();
    };

    Window_SrpgStatus.prototype.drawContentsActor = function () {
        const lineHeight = this.lineHeight();
        const battler = this.battler();
        this.drawActorName(battler, 6, lineHeight * 0);
        if (this._flip) {
            this.drawActorFace(battler, 6, lineHeight * 1);
            this.drawBasicInfoActor(176, lineHeight * 1);
        } else {
            this.drawActorFace(battler, 220, lineHeight * 1);
            this.drawBasicInfoActor(6, lineHeight * 1);
        }
        this.drawParameters(6, lineHeight * 5);
        this.drawSrpgParameters(6, lineHeight * 7);
    };

    Window_SrpgStatus.prototype.drawContentsEnemy = function () {
        const lineHeight = this.lineHeight();
        const battler = this.battler();
        this.drawActorName(battler, 6, lineHeight * 0);
        if (this._flip) {
            this.drawEnemyFace(battler, 6, lineHeight * 1);
            this.drawBasicInfoEnemy(176, lineHeight * 1);
        } else {
            this.drawEnemyFace(battler, 220, lineHeight * 1);
            this.drawBasicInfoEnemy(6, lineHeight * 1);
        }
        this.drawParameters(6, lineHeight * 5);
        this.drawSrpgParameters(6, lineHeight * 7);
    };

    Window_SrpgStatus.prototype.drawParameters = function (x, y) {
        const lineHeight = this.lineHeight();
        const battler = this.battler();
        const paramIds = [2, 3, 4, 5];
        for (var i = 0; i < paramIds.length; i++) {
            var paramId = paramIds[i];
            var x2 = x + 188 * (i % 2);
            var y2 = y + lineHeight * Math.floor(i / 2);
            this.changeTextColor(ColorManager.systemColor());
            this.drawText(TextManager.param(paramId), x2, y2, 120);
            this.resetTextColor();
            this.drawText(battler.param(paramId), x2 + 120, y2, 48, 'right');
        }
    };

    Window_SrpgStatus.prototype.drawSrpgParameters = function (x, y) {
        const battler = this.battler();
        this.changeTextColor(ColorManager.systemColor());
        this.drawText(_textSrpgMove, x, y, 120);
        this.resetTextColor();
        this.drawText(battler.srpgMove(), x + 120, y, 48, 'right');
    };
})();
