/*:
 * @target MZ
 * @plugindesc [v1.0] SRPG: affiche les bonus flat (+X) en vert dans la preview statut en combat.
 * @author Pokemon Carbonne Arena
 *
 * @help
 * Ajoute l'affichage des bonus de stats en combat (fenetre de focus SRPG):
 * - Format: (+X) en vert a droite de chaque stat.
 * - Source des bonus: plugin Cbn_FlatStatBuffs (states stackes).
 *
 * Ce plugin elargit aussi la fenetre de statut SRPG pour laisser la place
 * au texte de bonus.
 *
 * Placez ce plugin APRES:
 * - SRPG_core_MZ
 * - SRPG_PredictionDisplay_MZ (si utilise)
 * - Cbn_FlatStatBuffs
 */

(() => {
  "use strict";

  const EXTRA_STATUS_WIDTH = 80;
  const EXTRA_BOTTOM_STATUS_WIDTH = 220;
  const PARAM_IDS = [2, 3, 4, 5];

  function flatBonusForParam(battler, paramId) {
    if (!battler || !window.CbnFlatStatBuffs || !window.CbnFlatStatBuffs.flatBonusForParam) {
      return 0;
    }
    const value = window.CbnFlatStatBuffs.flatBonusForParam(battler, paramId);
    return Number.isFinite(value) ? value : 0;
  }

  function lineageBonusForParam(battler, paramId) {
    const api = window.ActorStatGrowthChoice;
    if (!battler || !api || !api.lineageParamBonus) return 0;
    const value = api.lineageParamBonus(battler, paramId);
    return Number.isFinite(value) ? value : 0;
  }

  function totalBonusForParam(battler, paramId) {
    return flatBonusForParam(battler, paramId) + lineageBonusForParam(battler, paramId);
  }

  function drawInlineParamWithBonus(win, battler, x, y, label, paramId) {
    const value = battler.param(paramId);
    const baseText = `${label} ${value}`;
    win.resetTextColor();
    win.drawText(baseText, x, y, 240, "left");

    let cursorX = x + win.textWidth(baseText) + 12;
    const bonus = totalBonusForParam(battler, paramId);
    if (bonus !== 0) {
      const sign = bonus > 0 ? "+" : "";
      const bonusText = `(${sign}${bonus})`;
      win.changeTextColor(ColorManager.powerUpColor());
      win.drawText(bonusText, cursorX, y, 84, "left");
      win.resetTextColor();
      cursorX += win.textWidth(bonusText) + 16;
    }
    return cursorX;
  }

  function drawCompactSrpgStatLine(win, battler, x, y) {
    let cursorX = x;
    cursorX = drawInlineParamWithBonus(win, battler, cursorX, y, "ATQ", 2);
    cursorX = drawInlineParamWithBonus(win, battler, cursorX, y, "DEF", 3);
    cursorX = drawInlineParamWithBonus(win, battler, cursorX, y, "ATK.SPE", 4);
    cursorX = drawInlineParamWithBonus(win, battler, cursorX, y, "DEF.SPE", 5);
    win.resetTextColor();
    win.drawText(`PM ${battler.srpgMove()}`, cursorX, y, 120, "left");
  }

  const _Scene_Map_srpgStatusWindowRect = Scene_Map.prototype.srpgStatusWindowRect;
  Scene_Map.prototype.srpgStatusWindowRect = function(target) {
    const rect = _Scene_Map_srpgStatusWindowRect.call(this, target);
    // On elargit la preview principale (focus unite active), pas la cible.
    if (!target) {
      const ww = Math.min(Graphics.boxWidth - 6, rect.width + EXTRA_STATUS_WIDTH);
      const wx = Math.max(0, Graphics.boxWidth - ww);
      return new Rectangle(wx, rect.y, ww, rect.height);
    }
    return rect;
  };

  const _Scene_Map_srpgActorCommandStatusWindowRect = Scene_Map.prototype.srpgActorCommandStatusWindowRect;
  Scene_Map.prototype.srpgActorCommandStatusWindowRect = function() {
    const rect = _Scene_Map_srpgActorCommandStatusWindowRect.call(this);
    const ww = Math.min(Graphics.boxWidth, rect.width + EXTRA_BOTTOM_STATUS_WIDTH);
    const wx = Math.max(0, Math.floor((Graphics.boxWidth - ww) / 2));
    return new Rectangle(wx, rect.y, ww, rect.height);
  };

  Window_SrpgStatus.prototype.drawParameters = function(x, y) {
    const lineHeight = this.lineHeight();
    const battler = this.battler();
    if (!battler) return;

    const columnWidth = 230;
    const valueWidth = 52;
    const bonusXOffset = 176;
    const bonusWidth = 64;

    for (let i = 0; i < PARAM_IDS.length; i++) {
      const paramId = PARAM_IDS[i];
      const x2 = x + columnWidth * (i % 2);
      const y2 = y + lineHeight * Math.floor(i / 2);

      this.changeTextColor(ColorManager.systemColor());
      this.drawText(TextManager.param(paramId), x2, y2, 120);
      this.resetTextColor();

      this.drawText(battler.param(paramId), x2 + 120, y2, valueWidth, "right");

      const bonus = totalBonusForParam(battler, paramId);
      if (bonus !== 0) {
        const sign = bonus > 0 ? "+" : "";
        this.changeTextColor(ColorManager.powerUpColor());
        this.drawText(`(${sign}${bonus})`, x2 + bonusXOffset, y2, bonusWidth, "left");
        this.resetTextColor();
      }
    }
  };

  Window_StatusBase.prototype.drawActorSimpleStatusSrpg = function(actor, x, y) {
    const step = 22;
    const fs = Math.max(13, $gameSystem.mainFontSize() - 5);
    this.contents.fontSize = fs;
    this.drawActorName(actor, x, y, 300);
    const y1 = y + step;
    drawCompactSrpgStatLine(this, actor, x, y1);
    const y2 = y1 + step;
    this.drawActorIcons(actor, x, y2, 200);
    const y3 = y2 + ImageManager.iconHeight + 6;
    this.placeBasicGaugesSrpg(actor, x, y3);
    this.resetFontSettings();
  };

  Window_StatusBase.prototype.drawEnemySimpleStatusSrpg = function(enemy, x, y) {
    const step = 22;
    const fs = Math.max(13, $gameSystem.mainFontSize() - 5);
    this.contents.fontSize = fs;
    this.drawActorName(enemy, x, y, 300);
    const y1 = y + step;
    drawCompactSrpgStatLine(this, enemy, x, y1);
    const y2 = y1 + step;
    this.drawActorIcons(enemy, x, y2, 200);
    const y3 = y2 + ImageManager.iconHeight + 6;
    this.placeBasicGaugesSrpg(enemy, x, y3);
    this.resetFontSettings();
  };
})();
