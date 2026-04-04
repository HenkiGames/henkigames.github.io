/*:
 * @target MZ
 * @plugindesc Affiche "Réputation" en haut à droite et "Équipe" en bas à gauche à l'écran hors combat, avec des variables configurables.
 * @author ChatGPT
 *
 * @param ReputationVariableId
 * @text ID de la variable Réputation
 * @type variable
 * @desc ID de la variable contenant la réputation
 * @default 1
 *
 * @param TeamVarCurrent
 * @text ID variable Équipe actuelle
 * @type variable
 * @desc Variable contenant le nombre actuel dans l'équipe
 * @default 2
 *
 * @param TeamVarMax
 * @text ID variable Équipe max
 * @type variable
 * @desc Variable contenant le nombre max de l'équipe
 * @default 3
 */

(() => {
  const params = PluginManager.parameters("DisplayHudInfo");
  const reputationVarId = Number(params["ReputationVariableId"] || 1);
  const teamVarCurrent = Number(params["TeamVarCurrent"] || 2);
  const teamVarMax = Number(params["TeamVarMax"] || 3);

  // Fenêtre de réputation en haut à droite
  class Reputation_Window extends Window_Base {
    initialize() {
      const width = 200;
      const height = this.fittingHeight(1);
      const x = 10;
      const y = Graphics.boxHeight - height - 10;
      super.initialize(new Rectangle(x, y, width, height));
      this.opacity = 180;
      this.refresh();
    }

    refresh() {
      this.contents.clear();
      const value = $gameVariables.value(reputationVarId);
      this.drawText("Réputation : " + value, 0, 0, this.contents.width, "right");
    }

    update() {
      super.update();
      this.refresh();
    }
  }

  // Fenêtre d’équipe en bas à gauche
  class Team_Window extends Window_Base {
    initialize() {
      const width = 200;
      const height = this.fittingHeight(1);
      const x = Graphics.boxWidth - width ;
      const y = Graphics.boxHeight - height - 10;
      super.initialize(new Rectangle(x, y, width, height));
      this.opacity = 180;
      this.refresh();
    }

    refresh() {
      this.contents.clear();
      const current = $gameVariables.value(teamVarCurrent);
      const max = $gameVariables.value(teamVarMax);
      this.drawText("Équipe : " + current + "/" + max, 0, 0, this.contents.width, "left");
    }

    update() {
      super.update();
      this.refresh();
    }
  }

  // Intégrer les fenêtres à la scène de la map
  const _Scene_Map_createAllWindows = Scene_Map.prototype.createAllWindows;
  Scene_Map.prototype.createAllWindows = function () {
    _Scene_Map_createAllWindows.call(this);
    this._reputationWindow = new Reputation_Window();
    this._teamWindow = new Team_Window();
    this.addWindow(this._reputationWindow);
    this.addWindow(this._teamWindow);
  };

  // Masquer dans les combats
  const _Scene_Map_update = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function () {
    _Scene_Map_update.call(this);
    if (this._reputationWindow && this._teamWindow) {
      const inBattle = $gameSystem.isSRPGMode();
      this._reputationWindow.visible = !inBattle;
      this._teamWindow.visible = !inBattle;
    }
  };
})();
