/*:
 * @target MZ
 * @plugindesc [v1.0] SRPG: agrandit la fenetre d'aide (description skills/items) en combat.
 * @author Pokemon Carbonne Arena
 *
 * @param srpgHelpLines
 * @text Lignes fenetre aide SRPG
 * @type number
 * @min 2
 * @max 8
 * @default 5
 * @desc Nombre de lignes pour la fenetre d'aide en mode SRPG.
 *
 * @help
 * Augmente la hauteur de la fenetre d'aide utilisee en combat SRPG
 * (description de competence / item).
 *
 * Recommandation:
 * - Placez ce plugin APRES SRPG_core_MZ.
 */

(() => {
  "use strict";

  const PLUGIN_NAME = "Cbn_SRPG_HelpWindowSize";
  const params = PluginManager.parameters(PLUGIN_NAME);
  const SRPG_HELP_LINES = Math.max(2, Math.min(8, Number(params.srpgHelpLines || 5)));

  const _Scene_Map_helpAreaHeight = Scene_Map.prototype.helpAreaHeight;
  Scene_Map.prototype.helpAreaHeight = function() {
    if ($gameSystem && $gameSystem.isSRPGMode && $gameSystem.isSRPGMode()) {
      return this.calcWindowHeight(SRPG_HELP_LINES, false);
    }
    return _Scene_Map_helpAreaHeight.call(this);
  };

  function isSceneStatusActive() {
    return !!SceneManager._scene && SceneManager._scene.constructor === Scene_Status;
  }

  function shouldAutoWrapHelpText() {
    if ($gameSystem && $gameSystem.isSRPGMode && $gameSystem.isSRPGMode()) {
      return true;
    }
    // Statut: utilisé pour la description des compétences dans le panneau bas.
    if (isSceneStatusActive()) {
      return true;
    }
    return false;
  }

  function wrapTextToWindowWidth(win, text) {
    const src = String(text || "").replace(/\r/g, "");
    if (!src) return "";

    const rect = win.baseTextRect ? win.baseTextRect() : { width: win.innerWidth || 0 };
    const maxWidth = Math.max(1, Number(rect.width || 0));
    const paragraphs = src.split("\n");
    const wrappedLines = [];

    for (const paragraph of paragraphs) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        wrappedLines.push("");
        continue;
      }

      let line = "";
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (win.textWidth(next) <= maxWidth) {
          line = next;
          continue;
        }

        if (line) {
          wrappedLines.push(line);
          line = "";
        }

        // Mot plus long que la largeur: coupe caractère par caractère.
        let chunk = "";
        for (const ch of word) {
          const trial = chunk + ch;
          if (win.textWidth(trial) <= maxWidth) {
            chunk = trial;
          } else {
            if (chunk) wrappedLines.push(chunk);
            chunk = ch;
          }
        }
        line = chunk;
      }
      if (line) wrappedLines.push(line);
    }

    return wrappedLines.join("\n");
  }

  const _Window_Help_setText = Window_Help.prototype.setText;
  Window_Help.prototype.setText = function(text) {
    if (shouldAutoWrapHelpText()) {
      const wrapped = wrapTextToWindowWidth(this, text);
      _Window_Help_setText.call(this, wrapped);
      return;
    }
    _Window_Help_setText.call(this, text);
  };
})();
