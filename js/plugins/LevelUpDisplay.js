/*:
 * @target MZ
 * @plugindesc Affiche une fenêtre personnalisée lors du changement de niveau avec les nouvelles statistiques et les compétences apprises. [v1.4] + intégration SRPG core + style Fire Emblem
 * @author ChatGPT
 *
 * @param ShowNewSkill
 * @type boolean
 * @default true
 * @desc Afficher le nom des nouvelles compétences apprises ?
 *
 * @help
 * Ce plugin affiche une fenêtre lors du gain de niveau pour montrer les stats modifiées
 * et les nouvelles compétences apprises. Il reproduit le style de présentation façon Fire Emblem.
 *
 * Il met également le jeu en pause (dans les combats map/battle style SRPG)
 * pour laisser le temps à la fenêtre d'apparaître avant la reprise.
 * Et il masque la fenêtre d'expérience SRPG pendant cette animation.
 */

(() => {
  const params = PluginManager.parameters("LevelUpDisplay");
  const showNewSkill = params["ShowNewSkill"] === "true";

  let _levelUpWindowActive = false;

  const _Game_Actor_levelUp = Game_Actor.prototype.levelUp;
  Game_Actor.prototype.levelUp = function () {
    if($gameSwitches.value(3)) {
      const oldParams = [];
      for (let i = 0; i < 8; i++) oldParams[i] = this.param(i);
      const oldSkills = this.skills().map((s) => s.id);

      _Game_Actor_levelUp.call(this);

      $gameTemp._levelUpPopupActive = true;

      const newParams = [];
      for (let i = 0; i < 8; i++) newParams[i] = this.param(i);
      const newSkills = this.skills().map((s) => s.id);
      const learned = newSkills.filter((id) => !oldSkills.includes(id));

      _levelUpWindowActive = true;
      SceneManager._scene.showLevelUpPopup(this, oldParams, newParams, learned);
    } else {
      const oldParams = [];
      for (let i = 0; i < 8; i++) oldParams[i] = this.param(i);
      const oldSkills = this.skills().map((s) => s.id);

      _Game_Actor_levelUp.call(this);

      $gameTemp._levelUpPopupActive = true;

      const newParams = [];
      for (let i = 0; i < 8; i++) newParams[i] = this.param(i);
      const newSkills = this.skills().map((s) => s.id);
      const learned = newSkills.filter((id) => !oldSkills.includes(id));
    }
  };

  Scene_Map.prototype.showLevelUpPopup = function (actor, oldParams, newParams, learnedSkills) {
    if (this._srpgExpWindow && this._srpgExpWindow.hide) {
      this._srpgExpWindow.hide();
    }

    $gameTemp._levelUpPopupActive = true;

    this._levelUpWindow = new Window_LevelUpPopup(actor, oldParams, newParams, learnedSkills);
    this.addChild(this._levelUpWindow);
  };

  const _Scene_Map_update = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function () {
    if (_levelUpWindowActive) {
      $gameTemp._srpgWaitPhase = true;
      if (TouchInput.isTriggered() || Input.isTriggered("ok") || Input.isTriggered("cancel")) {
        _levelUpWindowActive = false;
        if (this._levelUpWindow) {
          this._levelUpWindow.close();
          this.removeChild(this._levelUpWindow);
          this._levelUpWindow = null;
        }
        if (this._srpgExpWindow && this._srpgExpWindow.show) {
          this._srpgExpWindow.show();
        }
      }
    } else {
      $gameTemp._srpgWaitPhase = false;
    }
    _Scene_Map_update.call(this);
  };

  class Window_LevelUpPopup extends Window_Base {
    constructor(actor, oldParams, newParams, learnedSkills) {
      const width = 360;
      const height = 360;
      const x = 20;
      const y = (Graphics.boxHeight / 4)+120;
      super(new Rectangle(x, y, width, height));
      this._actor = actor;
      this._oldParams = oldParams;
      this._newParams = newParams;
      this._learnedSkills = learnedSkills;
      this._frame = 0;
      this._statIndex = 0;
      this._statChanges = this._computeChanges();
      this._portraitSprite = this.showPortrait();
      this._portraitBackground = this.showBackground(this._portraitSprite);      
      // this._portrait = new Sprite(ImageManager.loadFace(actor.faceName()));
      // this._portrait.x = width + 16;
      // this._portraitSprite.y = height - this._portraitSprite.height;
      this.addChild(this._portraitBackground);
      this.addChild(this._portraitSprite);
      this.refresh();
    }

    _computeChanges() {
      const changes = [];
      for (let i = 0; i < 7; i++) {
        const diff = this._newParams[i] - this._oldParams[i];
        if (diff !== 0) {
          changes.push({ index: i, old: this._oldParams[i], new: this._newParams[i], diff });
        }
      }
      return changes;
    }

    update() {
      super.update();
      if (this._frame % 20 === 0 && this._statIndex < this._statChanges.length) {
        AudioManager.playSe({ name: "Sword1", volume: 60, pitch: 100, pan: 0 });
        this.drawNextStat();
        this._statIndex++;
      }
      this._frame++;
    }

    refresh() {
      this.contents.clear();       
      this.changeTextColor(ColorManager.systemColor());
      this.changeTextColor(ColorManager.textColor(0));
      this.drawText(`${this._actor.name()} passe au niveau ${this._actor._level}`, 0, 0, this.width - 32);    
      if (this._learnedSkills.length > 0) {
        let line = this._statIndex + 1;
        this.changeTextColor(ColorManager.textColor(0));
        this.drawText("Nouvelle compétence :", 0, line * this.lineHeight(), this.width - 32);
          line ++;
          this._learnedSkills.forEach(id => {
            const skill = $dataSkills[id];
            if (skill) {
              this.changeTextColor(ColorManager.textColor(1));
              this.drawText(skill.name, 0, line * this.lineHeight(), this.width - 32);
              line ++;
            }
          });
      }
    }

    drawNextStat() {
      const change = this._statChanges[this._statIndex];
      const line = this._learnedSkills.length > 0 ? this._statIndex + 3 : this._statIndex + 1;
      const paramName = TextManager.param(change.index);
      this.changeTextColor(ColorManager.textColor(6));
      this.drawText(
        `(+${change.diff})`,
        0,
        line * this.lineHeight(),
        this.width - 32
      );      
      this.changeTextColor(ColorManager.textColor(0)); // yellow
      this.drawText(
        `${paramName}: ${change.old} → ${change.new}`,
        80,
        line * this.lineHeight(),
        this.width - 32
      );      
    }
        showPortrait() {
      if (!this._actor.actor) return;
      const meta = this._actor.actor().meta["portrait"];
      if (!meta) return;

      const sprite = new Sprite();
      // new Sprite(ImageManager.loadBitmap("img/portrait/", meta));
      sprite.bitmap = ImageManager.loadBitmap("img/portrait/", meta);
      sprite.x = this.x + this.width + 10;
      sprite.y = 0;
      return sprite;
    }

    showBackground(portrait) {
      const bg = new Sprite(new Bitmap(200, 200));
      bg.bitmap.fillAll("rgba(0, 0, 0, 0.5)");
      bg.x = this.x + this.width + 10;
      bg.y = 0;
      return bg;
    }

    close() {
      if (this._portraitSprite) {
        SceneManager._scene.removeChild(this._portraitSprite);
        this._portraitSprite = null;
      }
      $gameTemp._levelUpPopupActive = false;
      super.close();
    }

  }
})();
