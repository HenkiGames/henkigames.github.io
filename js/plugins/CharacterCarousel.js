/*:
 * @target MZ
 * @plugindesc Scène de sélection de personnage (carousel) via événement - portrait, stats, description, ajout au groupe.
 * @author ChatGPT
 *
 * @param maxActors
 * @text Limite acteurs (équipe + réserve)
 * @type number
 * @default 6
 * @min 1
 * @desc Nombre maximum d'acteurs possédés. Au-delà, le recrutement impose d'en remplacer un.
 *
 * @param maxActorsVariableId
 * @text Variable de jeu (prioritaire)
 * @type variable
 * @default 0
 * @desc Si > 0 et que la valeur de cette variable est > 0, elle définit la limite (sinon le paramètre numérique ci-dessus).
 *
 * @param replaceSceneHelpText
 * @text Aide scène de remplacement
 * @type string
 * @default Vous avez atteint le nombre maximum d'acteurs.\nSélectionnez l'acteur à remplacer.
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
  const rawParams = PluginManager.parameters(pluginName);
  const DEFAULT_ACTOR_IDS = [201, 202, 203];
  let nextActorIds = null;
  let pendingReplaceNewActorId = null;
  /** Conservés après SceneManager.push : pop() recrée Scene_CharacterSelect avec `new`, sans réutiliser l’instance. */
  let savedCarouselActorIds = null;
  let savedCarouselIndex = 0;

  const maxActorsDefault = Math.max(1, Number(rawParams.maxActors) || 6);
  const maxActorsVariableId = Number(rawParams.maxActorsVariableId) || 0;
  const replaceSceneHelpText = String(
    rawParams.replaceSceneHelpText ||
      "Vous avez atteint la taille maximale de votre équipe.\\nSélectionnez le pokémon à remplacer."
  ).replace(/\\n/g, "\n");

  function getMaxActorsCap() {
    if (maxActorsVariableId > 0) {
      const v = $gameVariables.value(maxActorsVariableId);
      if (Number.isFinite(v) && v > 0) {
        return Math.max(1, Math.floor(v));
      }
    }
    return maxActorsDefault;
  }

  function performRecruitment(selectedId, replaceActorId) {
    if (replaceActorId != null && replaceActorId > 0) {
      $gameParty.removeActor(replaceActorId);
    }
    if (typeof prepareRecruitmentAfterPermanentDeath === "function") {
      prepareRecruitmentAfterPermanentDeath(selectedId);
    }
    const recruited = $gameActors.actor(selectedId);
    if (recruited) {
      recruited.initialize(selectedId);
    }
    $gameParty.addActor(selectedId);
    $gameVariables.setValue(102, $gameVariables.value(102) + 1);
    SoundManager.playOk();
  }

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
      if (savedCarouselActorIds && savedCarouselActorIds.length > 0) {
        this._actorIds = savedCarouselActorIds;
        this._index = Math.max(
          0,
          Math.min(savedCarouselIndex, this._actorIds.length - 1)
        );
        savedCarouselActorIds = null;
        savedCarouselIndex = 0;
      } else {
        this._actorIds =
          nextActorIds || shuffleArray(filterUnavailableActorIds(DEFAULT_ACTOR_IDS)).slice(0, 3);
        nextActorIds = null;
        this._index = 0;
      }
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
      const gap = 16;
      const y = this._portraitSprite.y + 200;
      this._canCancelCarousel = $gameParty.allMembers().length > 0;

      this._validateButton = new Sprite_Clickable();
      const bitmapOk = new Bitmap(width, height);
      bitmapOk.fillRect(0, 0, width, height, "#222");
      bitmapOk.strokeRect(0, 0, width, height, "#ffffff");
      bitmapOk.fontSize = 22;
      bitmapOk.textColor = "#ffffff";
      bitmapOk.outlineColor = "#000000";
      bitmapOk.outlineWidth = 4;
      bitmapOk.drawText("Valider", 0, 0, width, height, "center");

      this._validateButton.bitmap = bitmapOk;
      this._validateButton.y = y;
      this._validateButton.onClick = this.onValidate.bind(this);
      this._validateButton.interactive = true;
      this._validateButton.buttonMode = true;

      if (this._canCancelCarousel) {
        this._validateButton.x = Graphics.width / 2 - width - gap / 2;
        this._cancelCarouselButton = new Sprite_Clickable();
        const bitmapCancel = new Bitmap(width, height);
        bitmapCancel.fillRect(0, 0, width, height, "#222");
        bitmapCancel.strokeRect(0, 0, width, height, "#ffffff");
        bitmapCancel.fontSize = 22;
        bitmapCancel.textColor = "#ffffff";
        bitmapCancel.outlineColor = "#000000";
        bitmapCancel.outlineWidth = 4;
        bitmapCancel.drawText("Annuler", 0, 0, width, height, "center");
        this._cancelCarouselButton.bitmap = bitmapCancel;
        this._cancelCarouselButton.x = Graphics.width / 2 + gap / 2;
        this._cancelCarouselButton.y = y;
        this._cancelCarouselButton.onClick = this.onCancelCarousel.bind(this);
        this._cancelCarouselButton.interactive = true;
        this._cancelCarouselButton.buttonMode = true;
        this.addChild(this._cancelCarouselButton);
      } else {
        this._validateButton.x = Graphics.width / 2 - width / 2;
      }

      this.addChild(this._validateButton);
    }

    onValidate() {
      this.selectActor();
    }

    onCancelCarousel() {
      if (!this._canCancelCarousel) return;
      SoundManager.playCancel();
      SceneManager.pop();
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
      if (!this._actorIds.length) return;
      const actorId = this._actorIds[this._index];
      const actor = $dataActors[actorId];
      if (!actor) return;

      const tempActor = new Game_Actor(actorId);

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
      } else if (Input.isTriggered("cancel") && this._canCancelCarousel) {
        this.onCancelCarousel();
      }
    }

    selectActor() {
      const selectedId = this._actorIds[this._index];
      if ($gameParty.members().some(member => member.actorId() === selectedId)) {
        SceneManager.pop();
        return;
      }
      if ($gameParty.allMembers().length >= getMaxActorsCap()) {
        savedCarouselActorIds = this._actorIds.slice();
        savedCarouselIndex = this._index;
        pendingReplaceNewActorId = selectedId;
        SceneManager.push(Scene_CharacterCarouselReplace);
        return;
      }
      performRecruitment(selectedId, null);
      SceneManager.pop();
    }
  }

  class Window_MenuStatusReplacePick extends Window_MenuStatus {
    initialize(rect) {
      super.initialize(rect);
      this._replaceHighlightIndex = null;
    }

    setReplaceHighlightIndex(index) {
      this._replaceHighlightIndex = index;
      this.refresh();
    }

    drawItem(index) {
      if (this._replaceHighlightIndex === index) {
        const rect = this.itemRect(index);
        this.contents.fillRect(rect.x, rect.y, rect.width, rect.height, "rgba(200, 35, 35, 0.42)");
      }
      Window_MenuStatus.prototype.drawItem.call(this, index);
    }
  }

  class Scene_CharacterCarouselReplace extends Scene_MenuBase {
    initialize() {
      super.initialize();
      this._newActorId = pendingReplaceNewActorId;
      pendingReplaceNewActorId = null;
      this._pendingReplaceIndex = null;
    }

    needsCancelButton() {
      return true;
    }

    replaceActionButtonsHeight() {
      return 68;
    }

    helpAreaHeight() {
      return (
        this.replaceActionButtonsHeight() + Scene_MenuBase.prototype.helpAreaHeight.call(this)
      );
    }

    helpWindowRect() {
      const textHelpH = Scene_MenuBase.prototype.helpAreaHeight.call(this);
      const wx = 0;
      const wy = this.helpAreaTop() + this.replaceActionButtonsHeight();
      const ww = Graphics.boxWidth;
      const wh = textHelpH;
      return new Rectangle(wx, wy, ww, wh);
    }

    createReplaceActionButtons() {
      const width = 180;
      const height = 60;
      const gap = 16;
      const y = this.helpAreaTop() + 4;
      const cx = Graphics.boxWidth / 2;

      const makeBtn = label => {
        const sp = new Sprite_Clickable();
        const bmp = new Bitmap(width, height);
        bmp.fillRect(0, 0, width, height, "#222");
        bmp.strokeRect(0, 0, width, height, "#ffffff");
        bmp.fontSize = 22;
        bmp.textColor = "#ffffff";
        bmp.outlineColor = "#000000";
        bmp.outlineWidth = 4;
        bmp.drawText(label, 0, 0, width, height, "center");
        sp.bitmap = bmp;
        sp.y = y;
        sp.interactive = true;
        sp.buttonMode = true;
        return sp;
      };

      this._btnValidateReplace = makeBtn("Valider");
      this._btnValidateReplace.x = cx - width - gap / 2;
      this._btnValidateReplace.onClick = this.onReplaceValidateClick.bind(this);
      this._windowLayer.addChild(this._btnValidateReplace);

      this._btnCancelReplace = makeBtn("Annuler");
      this._btnCancelReplace.x = cx + gap / 2;
      this._btnCancelReplace.onClick = this.onReplaceCancelClick.bind(this);
      this._windowLayer.addChild(this._btnCancelReplace);
    }

    create() {
      super.create();
      this.createReplaceActionButtons();
      this.createHelpWindow();
      this._helpWindow.setText(replaceSceneHelpText);

      const rect = this.statusWindowRect();
      this._statusWindow = new Window_MenuStatusReplacePick(rect);
      this._statusWindow.setFormationMode(false);
      this._statusWindow.setHandler("ok", this.onPickOrConfirmRow.bind(this));
      this._statusWindow.setHandler("cancel", this.onStatusCancel.bind(this));
      this.addWindow(this._statusWindow);
    }

    start() {
      super.start();
      if (!this._newActorId || !$dataActors[this._newActorId]) {
        SceneManager.pop();
        return;
      }
      this._pendingReplaceIndex = null;
      this._statusWindow.setReplaceHighlightIndex(null);
      this._statusWindow.select(0);
      this._statusWindow.activate();
    }

    statusWindowRect() {
      const wx = 0;
      const wy = this.mainAreaTop();
      const ww = Graphics.boxWidth;
      const wh = this.mainAreaHeight();
      return new Rectangle(wx, wy, ww, wh);
    }

    setPendingReplaceIndex(idx) {
      this._pendingReplaceIndex = idx;
      this._statusWindow.setReplaceHighlightIndex(idx);
      SoundManager.playCursor();
      // processOk désactive la fenêtre avant le handler : sans activate, plus de curseur clavier/sélection.
      this._statusWindow.activate();
    }

    clearPendingReplaceSelection() {
      this._pendingReplaceIndex = null;
      this._statusWindow.setReplaceHighlightIndex(null);
      this._statusWindow.activate();
    }

    confirmReplacement() {
      const actor = this._statusWindow.actor(this._pendingReplaceIndex);
      if (!actor) {
        SoundManager.playBuzzer();
        return;
      }
      if (actor.actorId() === this._newActorId) {
        SoundManager.playBuzzer();
        return;
      }
      savedCarouselActorIds = null;
      savedCarouselIndex = 0;
      performRecruitment(this._newActorId, actor.actorId());
      SceneManager.pop();
      SceneManager.pop();
    }

    /** Première validation : choix de la ligne ; même ligne encore : confirmer l’échange. */
    onPickOrConfirmRow() {
      const idx = this._statusWindow.index();
      const actor = this._statusWindow.actor(idx);
      if (!actor) {
        SoundManager.playBuzzer();
        return;
      }
      if (actor.actorId() === this._newActorId) {
        SoundManager.playBuzzer();
        return;
      }
      if (this._pendingReplaceIndex === null) {
        this.setPendingReplaceIndex(idx);
        return;
      }
      if (this._pendingReplaceIndex === idx) {
        this.confirmReplacement();
        return;
      }
      this.setPendingReplaceIndex(idx);
    }

    onReplaceValidateClick() {
      if (this._pendingReplaceIndex === null) {
        SoundManager.playBuzzer();
        return;
      }
      this.confirmReplacement();
    }

    /** Boutons Annuler à l’écran : le son n’est pas joué par processCancel. */
    onReplaceCancelClick() {
      SoundManager.playCancel();
      if (this._pendingReplaceIndex !== null) {
        this.clearPendingReplaceSelection();
        return;
      }
      SceneManager.pop();
    }

    /** Clavier / manette : processCancel joue déjà le son puis désactive la fenêtre. */
    onStatusCancel() {
      if (this._pendingReplaceIndex !== null) {
        this.clearPendingReplaceSelection();
        return;
      }
      SceneManager.pop();
    }
  }
})();
