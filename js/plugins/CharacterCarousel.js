/*:
 * @target MZ
 * @plugindesc Scène de sélection de personnage (carousel) via événement - portrait, stats, description, ajout au groupe.
 * @author ChatGPT
 *
 * @command StartCharacterSelect
 * @text Démarrer la sélection de personnage
 * @desc Lance la scène de sélection de personnage
 *
 * @arg actorIds
 * @text IDs des acteurs
 * @desc Optionnel. Exemples: 201,202,203 ou ["201","202","203"]
 * @type string
 */

(() => {
  const pluginName = "CharacterCarousel";
  const DEFAULT_ACTOR_IDS = [201, 202, 203];
  let nextActorIds = null;

  PluginManager.registerCommand(pluginName, "StartCharacterSelect", args => {
    const requestedIds = parseActorIdsArg(args.actorIds);
    const sourceIds = requestedIds.length > 0 ? requestedIds : DEFAULT_ACTOR_IDS;
    const filtered = filterUnavailableActorIds(sourceIds);
    const availableIds = shuffleArray(filtered).slice(0, 3);

    if (availableIds.length === 0) {
      SoundManager.playBuzzer();
      return;
    }

    nextActorIds = availableIds;
    SceneManager.push(Scene_CharacterSelect);
  });

  function parseActorIdsArg(rawValue) {
    if (!rawValue) return [];

    try {
      const parsed = JSON.parse(rawValue);
      if (Array.isArray(parsed)) {
        return parsed
          .map(value => Number(value))
          .filter(id => Number.isInteger(id) && id > 0);
      }
      if (typeof parsed === "number") {
        return Number.isInteger(parsed) && parsed > 0 ? [parsed] : [];
      }
      if (typeof parsed === "string") {
        return parsed
          .split(",")
          .map(value => Number(value.trim()))
          .filter(id => Number.isInteger(id) && id > 0);
      }
    } catch (e) {
      // Valeur non JSON, on tente un format CSV.
    }

    return String(rawValue)
      .split(",")
      .map(value => Number(value.trim()))
      .filter(id => Number.isInteger(id) && id > 0);
  }

  function filterValidActorIds(actorIds) {
    const seen = new Set();
    const out = [];
    for (const id of actorIds) {
      if (!Number.isInteger(id) || id <= 0) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      if (!$dataActors[id]) continue;
      out.push(id);
    }
    return out;
  }

  function filterPartyActorIds(actorIds) {
    const memberIds = new Set($gameParty.members().map(member => member.actorId()));
    return actorIds.filter(id => !memberIds.has(id));
  }

  function filterUnavailableActorIds(actorIds) {
    return filterPartyActorIds(filterValidActorIds(actorIds));
  }

  function shuffleArray(array) {
    const a = array.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  class Scene_CharacterSelect extends Scene_MenuBase {
    initialize() {
      super.initialize();
      this._actorIds =
        nextActorIds || shuffleArray(filterUnavailableActorIds(DEFAULT_ACTOR_IDS)).slice(0, 3);
      nextActorIds = null;
      this._index = 0;
    }

    needsCancelButton() {
      return false;
    }

    create() {
      super.create();
      this.createPortrait();
      this.createArrows();
      this.createStatsWindow();
      this.createDescriptionWindow();
      this.createValidateButton();
      this.refreshDisplay();
      this.playSelectionSe();
    }

    createPortrait() {
      this._portraitSprite = new Sprite();
      this._portraitSprite.x = Graphics.width / 2 - 120;
      this._portraitSprite.y = 20;
      this.addChild(this._portraitSprite);
    }

    createStatsWindow() {
      const rect = new Rectangle(100, 300, Graphics.width - 200, 140);
      this._statsWindow = new Window_Base(rect);
      this.addWindow(this._statsWindow);
    }

    createDescriptionWindow() {
      const rect = new Rectangle(100, 440, Graphics.width - 200, 100);
      this._descWindow = new Window_Base(rect);
      this.addWindow(this._descWindow);
    }

    createValidateButton() {
      const width = 180;
      const height = 60;

      this._validateButton = new Sprite_Clickable();
      const bitmap = new Bitmap(width, height);
      bitmap.fillRect(0, 0, width, height, "#222");
      bitmap.strokeRect(0, 0, width, height, "#ffffff");
      bitmap.fontSize = 22;
      bitmap.textColor = "#ffffff";
      bitmap.outlineColor = "#000000";
      bitmap.outlineWidth = 4;
      bitmap.drawText("Valider", 0, 0, width, height, "center");

      this._validateButton.bitmap = bitmap;
      this._validateButton.x = Graphics.width / 2 - width / 2;
      this._validateButton.y = this._portraitSprite.y + 200;
      this._validateButton.onClick = this.onValidate.bind(this);

      this.addChild(this._validateButton);
    }

    onValidate() {
      SoundManager.playOk();
      this.selectActor();
    }

    createArrows() {
      const buttonSet = ImageManager.loadSystem("ButtonSet");

      this._arrowLeft = new Sprite_Clickable();
      this._arrowLeft.bitmap = buttonSet;
      this._arrowLeft.setFrame(48 * 2, 0, 48, 48);
      this._arrowLeft.x = this._portraitSprite.x - 60;
      this._arrowLeft.y = this._portraitSprite.y + 100;
      this._arrowLeft.interactive = true;
      this._arrowLeft.buttonMode = true;
      this._arrowLeft.onClick = this.onArrowLeft.bind(this);
      this.addChild(this._arrowLeft);

      this._arrowRight = new Sprite_Clickable();
      this._arrowRight.bitmap = buttonSet;
      this._arrowRight.setFrame(48 * 3, 0, 48, 48);
      this._arrowRight.x = this._portraitSprite.x + 260;
      this._arrowRight.y = this._portraitSprite.y + 100;
      this._arrowRight.interactive = true;
      this._arrowRight.buttonMode = true;
      this._arrowRight.onClick = this.onArrowRight.bind(this);
      this.addChild(this._arrowRight);
    }

    onArrowLeft() {
      this._index = (this._index - 1 + this._actorIds.length) % this._actorIds.length;
      this.playSelectionSe();
      this.refreshDisplay();
    }

    onArrowRight() {
      this._index = (this._index + 1) % this._actorIds.length;
      this.playSelectionSe();
      this.refreshDisplay();
    }

    playSelectionSe() {
      const actorId = this._actorIds[this._index];
      const actor = $dataActors[actorId];
      const seName = actor && actor.meta ? actor.meta["exchangeSe"] : "";
      if (seName) {
        AudioManager.playSe({ name: seName, pan: 0, pitch: 100, volume: 90 });
      } else {
        SoundManager.playCursor();
      }
    }

    refreshDisplay() {
      const actorId = this._actorIds[this._index];
      const actor = $dataActors[actorId];
      const tempActor = new Game_Actor(actorId);
      if (!actor) return;

      const portraitName = actor.meta["portrait"];
      if (!portraitName) return;
      this._portraitSprite.bitmap = ImageManager.loadBitmap("img/portrait/", portraitName);

      const statsText =
        `Nom: ${actor.name}\n` +
        `PV:${tempActor.mhp}` +
        ` - ATK:${tempActor.atk}` +
        ` - ATK SPE:${tempActor.mat}\n` +
        `VIT:${tempActor.agi}` +
        ` - DEF:${tempActor.def}` +
        ` - DEF SPE:${tempActor.mdf}`;
      this._statsWindow.contents.clear();
      this._statsWindow.drawTextEx(statsText, 0, 0);

      this._descWindow.contents.clear();
      this._descWindow.drawTextEx(actor.note || "Aucune description", 0, 0);
    }

    update() {
      super.update();
      if (Input.isTriggered("left")) {
        this._index = (this._index - 1 + this._actorIds.length) % this._actorIds.length;
        this.playSelectionSe();
        this.refreshDisplay();
      } else if (Input.isTriggered("right")) {
        this._index = (this._index + 1) % this._actorIds.length;
        this.playSelectionSe();
        this.refreshDisplay();
      } else if (Input.isTriggered("ok")) {
        this.selectActor();
      }
    }

    selectActor() {
      const selectedId = this._actorIds[this._index];
      if (!$gameParty.members().some(member => member.actorId() === selectedId)) {
        if (typeof prepareRecruitmentAfterPermanentDeath === "function") {
          prepareRecruitmentAfterPermanentDeath(selectedId);
        }
        $gameParty.addActor(selectedId);
        $gameVariables.setValue(102, $gameVariables.value(102) + 1);
        SoundManager.playOk();
      }
      SceneManager.pop();
    }
  }
})();
