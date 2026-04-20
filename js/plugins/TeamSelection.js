/*:
 * @target MZ
 * @plugindesc Gestion d'equipes d'acteurs et equipe active utilisable par d'autres plugins.
 * @author ChatGPT
 *
 * @param teams
 * @text Equipes
 * @type struct<TeamConfig>[]
 * @default []
 * @desc Liste des equipes disponibles (ID + nom + actorIds).
 *
 * @param defaultTeamId
 * @text ID equipe par defaut
 * @type string
 * @default
 * @desc Optionnel. Si vide, la premiere equipe de la liste est utilisee.
 *
 * @param selectedTeamVariableId
 * @text Variable ID equipe choisie
 * @type variable
 * @default 114
 * @desc Variable qui stocke automatiquement l'ID de l'equipe active.
 *
 * @param defaultLockedDescription
 * @text Description verrouillee (defaut)
 * @type note
 * @default "Cette equipe est verrouillee."
 * @desc Texte affiche pour une equipe verrouillee sans description specifique.
 *
 * @command SelectTeam
 * @text Selectionner une equipe (ID)
 * @desc Definit l'equipe active via son ID.
 *
 * @arg teamId
 * @text ID equipe
 * @type string
 * @default
 *
 * @command SelectTeamByIndex
 * @text Selectionner une equipe (index)
 * @desc Definit l'equipe active via son index (0 = premiere equipe).
 *
 * @arg index
 * @text Index equipe
 * @type number
 * @min 0
 * @default 0
 *
 * @command StoreSelectedTeamId
 * @text Copier ID equipe active -> variable
 * @desc Ecrit l'ID de l'equipe active dans une variable.
 *
 * @arg variableId
 * @text Variable
 * @type variable
 * @default 0
 *
 * @command OpenTeamSelectScene
 * @text Ouvrir la selection d'equipe
 * @desc Ouvre une scene visuelle de choix d'equipe (nom, image, description, acteurs).
 *
 * @help
 * Ce plugin expose une API globale:
 *   TeamSelection.getCurrentActorIds() -> number[]
 *   TeamSelection.getCurrentTeamId() -> string
 *   TeamSelection.setSelectedTeam(teamId) -> boolean
 *   TeamSelection.selectTeamByIndex(index) -> boolean
 *
 * Utilisation typique:
 * 1) En debut de partie, utilisez la commande plugin "Selectionner une equipe".
 * 2) Lancez CharacterCarousel sans passer actorIds.
 *    CharacterCarousel utilisera automatiquement actorIds de l'equipe active.
 *
 * Config equipe:
 * - image: image dans img/pictures (sans extension) pour representer l'equipe.
 * - description: texte affiche dans la scene de selection.
 * - unlockSwitchId: interrupteur ON = equipe debloquee.
 * - actorUnlocks: acteurs supplementaires debloques via interrupteurs.
 * - lockedImage: image d'attente pour equipe verrouillee.
 * - lockedDescription: description affichee tant que l'equipe est verrouillee.
 * - Etoiles: progression visuelle bronze/argent/or par equipe via variable ou interrupteurs.
 */

/*~struct~TeamConfig:
 * @param id
 * @text ID equipe
 * @type string
 * @default team_1
 *
 * @param name
 * @text Nom equipe
 * @type string
 * @default Equipe 1
 *
 * @param actorIds
 * @text IDs acteurs
 * @type string
 * @default 201,202,203
 * @desc Exemples: 201,202,203 ou ["201","202","203"].
 *
 * @param followupActorIds
 * @text IDs acteurs (selections suivantes)
 * @type string
 * @default
 * @desc Optionnel. Utilises apres la premiere selection CharacterCarousel. Si vide, actorIds est reutilise.
 *
 * @param image
 * @text Image equipe (img/pictures)
 * @type file
 * @dir img/pictures/
 * @default
 *
 * @param description
 * @text Description
 * @type note
 * @default ""
 *
 * @param unlockSwitchId
 * @text Interrupteur de debloquage
 * @type switch
 * @default 0
 * @desc 0 = equipe toujours debloquee. Sinon ON = equipe debloquee.
 *
 * @param actorUnlocks
 * @text Acteurs debloquables
 * @type struct<ActorUnlockConfig>[]
 * @default []
 * @desc Ajoute des acteurs a cette equipe si leurs interrupteurs sont actifs.
 *
 * @param lockedImage
 * @text Image verrouillee (img/pictures)
 * @type file
 * @dir img/pictures/
 * @default
 *
 * @param lockedDescription
 * @text Description verrouillee
 * @type note
 * @default ""
 *
 * @param starProgressVariableId
 * @text Variable progression etoiles
 * @type variable
 * @default 0
 * @desc 0=ignoree. Valeur 0..3 (0 rien, 1 bronze, 2 bronze+argent, 3 bronze+argent+or).
 *
 * @param bronzeStarSwitchId
 * @text Interrupteur etoile bronze
 * @type switch
 * @default 0
 * @desc Utilise seulement si la variable progression vaut 0.
 *
 * @param silverStarSwitchId
 * @text Interrupteur etoile argent
 * @type switch
 * @default 0
 * @desc Utilise seulement si la variable progression vaut 0.
 *
 * @param goldStarSwitchId
 * @text Interrupteur etoile or
 * @type switch
 * @default 0
 * @desc Utilise seulement si la variable progression vaut 0.
 */

/*~struct~ActorUnlockConfig:
 * @param actorIds
 * @text IDs acteurs
 * @type string
 * @default 209
 * @desc Exemples: 209 ou 209,210 ou ["209","210"].
 *
 * @param switchId
 * @text Interrupteur de debloquage
 * @type switch
 * @default 0
 * @desc Si ON, les acteurs sont ajoutes a l'equipe. 0 = jamais ajoutes.
 */

(() => {
  "use strict";

  const pluginName = "TeamSelection";
  const params = PluginManager.parameters(pluginName);

  function parseActorIds(rawValue) {
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
      // Valeur non JSON, on tente un CSV.
    }
    return String(rawValue)
      .split(",")
      .map(value => Number(value.trim()))
      .filter(id => Number.isInteger(id) && id > 0);
  }

  function parseTeams(rawTeams) {
    let list = [];
    try {
      const parsed = JSON.parse(rawTeams || "[]");
      if (Array.isArray(parsed)) {
        list = parsed;
      }
    } catch (e) {
      list = [];
    }

    const seen = new Set();
    const out = [];
    for (const item of list) {
      let teamData = item;
      if (typeof item === "string") {
        try {
          teamData = JSON.parse(item);
        } catch (e) {
          continue;
        }
      }
      if (!teamData || typeof teamData !== "object") continue;
      const id = String(teamData.id || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        name: String(teamData.name || id),
        actorIds: parseActorIds(teamData.actorIds),
        followupActorIds: parseActorIds(teamData.followupActorIds),
        actorUnlocks: parseActorUnlocks(teamData.actorUnlocks),
        image: String(teamData.image || "").trim(),
        description: String(teamData.description || ""),
        unlockSwitchId: Number(teamData.unlockSwitchId || 0) || 0,
        lockedImage: String(teamData.lockedImage || "").trim(),
        lockedDescription: String(teamData.lockedDescription || ""),
        starProgressVariableId: Number(teamData.starProgressVariableId || 0) || 0,
        bronzeStarSwitchId: Number(teamData.bronzeStarSwitchId || 0) || 0,
        silverStarSwitchId: Number(teamData.silverStarSwitchId || 0) || 0,
        goldStarSwitchId: Number(teamData.goldStarSwitchId || 0) || 0
      });
    }
    return out;
  }

  function parseActorUnlocks(rawValue) {
    let list = [];
    try {
      const parsed = JSON.parse(rawValue || "[]");
      if (Array.isArray(parsed)) {
        list = parsed;
      }
    } catch (e) {
      list = [];
    }

    const out = [];
    for (const item of list) {
      let unlockData = item;
      if (typeof item === "string") {
        try {
          unlockData = JSON.parse(item);
        } catch (e) {
          continue;
        }
      }
      if (!unlockData || typeof unlockData !== "object") continue;
      const actorIds = parseActorIds(unlockData.actorIds);
      const switchId = Number(unlockData.switchId || 0) || 0;
      if (!actorIds.length || switchId <= 0) continue;
      out.push({ actorIds, switchId });
    }
    return out;
  }

  const teams = parseTeams(params.teams);
  const defaultTeamId = String(params.defaultTeamId || "").trim();
  const selectedTeamVariableId = Number(params.selectedTeamVariableId || 114) || 114;
  const defaultLockedDescription = String(params.defaultLockedDescription || "Cette equipe est verrouillee.");

  const _Game_System_initialize = Game_System.prototype.initialize;
  Game_System.prototype.initialize = function() {
    _Game_System_initialize.call(this);
    this._selectedTeamId = "";
  };

  function ensureSelectedTeamId() {
    if (!$gameSystem) return "";
    if (!$gameSystem._selectedTeamId || !isTeamSelectable(findTeamById($gameSystem._selectedTeamId))) {
      const defaultTeam = findTeamById(defaultTeamId);
      const firstUnlocked = teams.find(team => isTeamSelectable(team));
      const fallback = isTeamSelectable(defaultTeam) ? defaultTeam : (firstUnlocked || null);
      $gameSystem._selectedTeamId = fallback ? fallback.id : "";
      storeSelectedTeamIdToVariable();
    }
    return $gameSystem._selectedTeamId || "";
  }

  function findTeamById(teamId) {
    return teams.find(team => team.id === String(teamId || "").trim()) || null;
  }

  function storeSelectedTeamIdToVariable() {
    if (!$gameVariables) return;
    if (selectedTeamVariableId > 0) {
      $gameVariables.setValue(selectedTeamVariableId, getCurrentTeamIdAsNumber());
    }
  }

  function setSelectedTeam(teamId) {
    if (!$gameSystem) return false;
    const team = findTeamById(teamId);
    if (!isTeamSelectable(team)) return false;
    $gameSystem._selectedTeamId = team.id;
    storeSelectedTeamIdToVariable();
    return true;
  }

  function selectTeamByIndex(index) {
    if (!$gameSystem) return false;
    const idx = Math.floor(Number(index));
    if (!Number.isInteger(idx) || idx < 0 || idx >= teams.length) return false;
    if (!isTeamSelectable(teams[idx])) return false;
    $gameSystem._selectedTeamId = teams[idx].id;
    storeSelectedTeamIdToVariable();
    return true;
  }

  function isTeamUnlocked(team) {
    if (!team) return false;
    if (team.unlockSwitchId <= 0) return true;
    if (!$gameSwitches) return false;
    return !!$gameSwitches.value(team.unlockSwitchId);
  }

  function isTeamSelectable(team) {
    return !!team && isTeamUnlocked(team);
  }

  function getTeamStarCount(team) {
    if (!team || !isTeamUnlocked(team)) return 0;

    if (team.starProgressVariableId > 0 && $gameVariables) {
      const rawValue = Number($gameVariables.value(team.starProgressVariableId) || 0);
      const clamped = Math.max(0, Math.min(3, Math.floor(rawValue)));
      return clamped;
    }

    if (!$gameSwitches) return 0;
    let count = 0;
    if (team.bronzeStarSwitchId > 0 && $gameSwitches.value(team.bronzeStarSwitchId)) count += 1;
    if (team.silverStarSwitchId > 0 && $gameSwitches.value(team.silverStarSwitchId)) count += 1;
    if (team.goldStarSwitchId > 0 && $gameSwitches.value(team.goldStarSwitchId)) count += 1;
    return count;
  }

  function getCurrentTeam() {
    const selectedId = ensureSelectedTeamId();
    return findTeamById(selectedId);
  }

  function getCurrentActorIds() {
    const team = getCurrentTeam();
    if (!team) return [];
    const hasAnyOwnedActor = !!($gameParty && Array.isArray($gameParty._actors) && $gameParty._actors.some(id => Number(id) > 0));
    return hasAnyOwnedActor
      ? getUnlockedFollowupActorIdsForTeam(team)
      : getUnlockedStarterActorIdsForTeam(team);
  }

  function getCurrentTeamId() {
    const team = getCurrentTeam();
    return team ? team.id : "";
  }

  function getCurrentTeamIdAsNumber() {
    const numericId = Number(getCurrentTeamId());
    return Number.isFinite(numericId) ? numericId : 0;
  }

  function getCurrentTeamName() {
    const team = getCurrentTeam();
    return team ? team.name : "";
  }

  function resolveTeamFromSelectedVariable() {
    if (!$gameVariables) return null;
    const rawTeamId = $gameVariables.value(selectedTeamVariableId);
    let team = findTeamById(rawTeamId);
    if (team) return team;

    const numericTeamId = Number(rawTeamId);
    if (Number.isFinite(numericTeamId)) {
      team = teams.find(candidate => Number(candidate.id) === numericTeamId) || null;
      if (team) return team;

      const index = Math.floor(numericTeamId);
      if (index >= 0 && index < teams.length) {
        return teams[index];
      }
    }

    return getCurrentTeam();
  }

  function incrementTeamStarProgressFromSelectedVariable() {
    const team = resolveTeamFromSelectedVariable();
    if (!team) return false;
    const progressVariableId = Number(team.starProgressVariableId || 0);
    if (progressVariableId <= 0) return false;
    if (!$gameVariables) return false;
    const currentValue = Number($gameVariables.value(progressVariableId) || 0);
    const nextValue = Math.max(0, Math.min(3, Math.floor(currentValue) + 1));
    $gameVariables.setValue(progressVariableId, nextValue);
    return true;
  }

  function isActorUnlockActive(actorUnlock) {
    if (!actorUnlock || actorUnlock.switchId <= 0) return false;
    if (!$gameSwitches) return false;
    return !!$gameSwitches.value(actorUnlock.switchId);
  }

  function mergeBaseAndUnlockedActorIds(baseActorIds, actorUnlocks) {
    const resolvedIds = [];
    const seen = new Set();
    const baseList = Array.isArray(baseActorIds) ? baseActorIds : [];
    for (const actorId of baseList) {
      if (!seen.has(actorId)) {
        seen.add(actorId);
        resolvedIds.push(actorId);
      }
    }

    const unlocks = Array.isArray(actorUnlocks) ? actorUnlocks : [];
    for (const actorUnlock of unlocks) {
      if (!isActorUnlockActive(actorUnlock)) continue;
      for (const actorId of actorUnlock.actorIds) {
        if (!seen.has(actorId)) {
          seen.add(actorId);
          resolvedIds.push(actorId);
        }
      }
    }
    return resolvedIds;
  }

  function getUnlockedStarterActorIdsForTeam(team) {
    if (!team) return [];
    return mergeBaseAndUnlockedActorIds(team.actorIds, team.actorUnlocks);
  }

  function getUnlockedFollowupActorIdsForTeam(team) {
    if (!team) return [];
    const hasFollowupBaseIds = Array.isArray(team.followupActorIds) && team.followupActorIds.length > 0;
    const followupBase = hasFollowupBaseIds ? team.followupActorIds : team.actorIds;
    return mergeBaseAndUnlockedActorIds(followupBase, team.actorUnlocks);
  }

  function getUnlockedActorIdsForTeam(team) {
    return getUnlockedStarterActorIdsForTeam(team);
  }

  function decodeMultilineText(raw) {
    if (!raw) return "";
    let text = String(raw);
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
      text = text.slice(1, -1);
    }
    try {
      return JSON.parse(`"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).replace(/\\n/g, "\n");
    } catch (e) {
      return text.replace(/\\n/g, "\n");
    }
  }

  class Scene_TeamSelection extends Scene_MenuBase {
    initialize() {
      super.initialize();
      this._teams = teams.slice();
      this._index = 0;
      this._teamImageSprite = null;
      this._teamImageFrame = { x: 40, y: 20, width: 360, height: 280 };
      this._teamCounterSprite = null;
      this._nameWindow = null;
      this._descWindow = null;
      this._actorsWindow = null;
      this._validateButton = null;
      this._watchedPortraits = new Set();
    }

    create() {
      super.create();
      if (!this._teams.length) {
        return;
      }
      this.setupInitialIndex();
      this.createTeamImage();
      this.createTeamCounter();
      this.createNameWindow();
      this.createDescriptionWindow();
      this.createActorsWindow();
      this.createActionButtons();
      this.createArrows();
      this.preloadTeamAssets();
      this.refreshDisplay();
    }

    start() {
      super.start();
      if (!this._teams.length) {
        SoundManager.playBuzzer();
        this.popScene();
      }
    }

    needsCancelButton() {
      return false;
    }

    setupInitialIndex() {
      const currentId = ensureSelectedTeamId();
      const idx = this._teams.findIndex(team => team.id === currentId);
      this._index = idx >= 0 ? idx : 0;
    }

    createTeamImage() {
      this._teamImageSprite = new Sprite();
      this._teamImageSprite.anchor.x = 0.5;
      this._teamImageSprite.anchor.y = 0.5;
      this._teamImageSprite.x = this._teamImageFrame.x + this._teamImageFrame.width / 2;
      this._teamImageSprite.y = this._teamImageFrame.y + this._teamImageFrame.height / 2;
      this.addChild(this._teamImageSprite);
    }

    createNameWindow() {
      const rect = new Rectangle(420, 20, Graphics.width - 460, 84);
      this._nameWindow = new Window_Base(rect);
      this._nameWindow.deactivate();
      this.addWindow(this._nameWindow);
    }

    createDescriptionWindow() {
      const y = this._teamImageFrame.y + this._teamImageFrame.height + 30;
      const buttonY = Graphics.height - this.actionButtonsBottomMargin() - this.actionButtonHeight();
      const height = Math.max(80, buttonY - this.actionButtonsTopGap() - y);
      const rect = new Rectangle(40, y, Graphics.width - 80, height);
      this._descWindow = new Window_Base(rect);
      this._descWindow.deactivate();
      this.addWindow(this._descWindow);
    }

    createActorsWindow() {
      const rect = new Rectangle(420, 112, Graphics.width - 460, 210);
      this._actorsWindow = new Window_Base(rect);
      this._actorsWindow.deactivate();
      this.addWindow(this._actorsWindow);
    }

    createActionButtons() {
      const width = 180;
      const height = this.actionButtonHeight();
      const y = Graphics.height - this.actionButtonsBottomMargin() - height;
      const cx = Graphics.width / 2;

      const makeButton = label => {
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

      this._validateButton = makeButton("Valider");
      this._validateButton.x = cx - width / 2;
      this._validateButton.onClick = this.onValidate.bind(this);
      this.addChild(this._validateButton);
    }

    actionButtonHeight() {
      return 56;
    }

    actionButtonsBottomMargin() {
      return 20;
    }

    actionButtonsTopGap() {
      return 16;
    }

    createArrows() {
      const buttonSet = ImageManager.loadSystem("ButtonSet");
      this._arrowLeft = new Sprite_Clickable();
      this._arrowLeft.bitmap = buttonSet;
      this._arrowLeft.setFrame(48 * 2, 0, 48, 48);
      this._arrowLeft.x = this._teamImageFrame.x - 24;
      this._arrowLeft.y = this._teamImageFrame.y + this._teamImageFrame.height / 2 - 24;
      this._arrowLeft.interactive = true;
      this._arrowLeft.buttonMode = true;
      this._arrowLeft.onClick = this.onArrowLeft.bind(this);
      this.addChild(this._arrowLeft);

      this._arrowRight = new Sprite_Clickable();
      this._arrowRight.bitmap = buttonSet;
      this._arrowRight.setFrame(48 * 3, 0, 48, 48);
      this._arrowRight.x = this._teamImageFrame.x + this._teamImageFrame.width - 24;
      this._arrowRight.y = this._teamImageFrame.y + this._teamImageFrame.height / 2 - 24;
      this._arrowRight.interactive = true;
      this._arrowRight.buttonMode = true;
      this._arrowRight.onClick = this.onArrowRight.bind(this);
      this.addChild(this._arrowRight);
    }

    createTeamCounter() {
      this._teamCounterSprite = new Sprite(new Bitmap(this._teamImageFrame.width, 24));
      this._teamCounterSprite.x = this._teamImageFrame.x;
      this._teamCounterSprite.y = this._teamImageFrame.y + this._teamImageFrame.height + 4;
      this.addChild(this._teamCounterSprite);
    }

    currentTeam() {
      return this._teams[this._index] || null;
    }

    preloadTeamAssets() {
      for (const team of this._teams) {
        if (team.image) {
          ImageManager.loadPicture(team.image);
        }
        if (team.lockedImage) {
          ImageManager.loadPicture(team.lockedImage);
        }
        const ids = getUnlockedActorIdsForTeam(team);
        for (const actorId of ids) {
          const actorData = $dataActors[actorId];
          if (!actorData || !actorData.meta || !actorData.meta.portrait) continue;
          const portraitName = String(actorData.meta.portrait).trim();
          if (!portraitName) continue;
          const bitmap = ImageManager.loadBitmap("img/portrait/", portraitName);
          if (bitmap && !bitmap.isReady() && !this._watchedPortraits.has(portraitName)) {
            this._watchedPortraits.add(portraitName);
            bitmap.addLoadListener(() => {
              if (SceneManager._scene === this) {
                this.refreshActors(this.currentTeam());
              }
            });
          }
        }
      }
    }

    onArrowLeft() {
      this._index = (this._index - 1 + this._teams.length) % this._teams.length;
      SoundManager.playCursor();
      this.refreshDisplay();
    }

    onArrowRight() {
      this._index = (this._index + 1) % this._teams.length;
      SoundManager.playCursor();
      this.refreshDisplay();
    }

    onValidate() {
      const team = this.currentTeam();
      if (!team) {
        SoundManager.playBuzzer();
        return;
      }
      if (!isTeamSelectable(team)) {
        SoundManager.playBuzzer();
        return;
      }
      setSelectedTeam(team.id);
      SoundManager.playOk();
      this.popScene();
    }

    onCancel() {
      SoundManager.playCancel();
      SceneManager.goto(Scene_Title);
    }

    update() {
      super.update();
      if (!this._teams.length) return;
      if (Input.isTriggered("left")) {
        this.onArrowLeft();
      } else if (Input.isTriggered("right")) {
        this.onArrowRight();
      } else if (Input.isTriggered("ok")) {
        this.onValidate();
      } else if (Input.isTriggered("cancel")) {
        this.onCancel();
      }
    }

    refreshDisplay() {
      const team = this.currentTeam();
      if (!team) return;

      this.refreshTeamImage(team);
      this.refreshTeamCounter();
      this.refreshName(team);
      this.refreshDescription(team);
      this.refreshActors(team);
    }

    refreshTeamCounter() {
      if (!this._teamCounterSprite || !this._teamCounterSprite.bitmap) return;
      const bmp = this._teamCounterSprite.bitmap;
      bmp.clear();
      bmp.fontSize = 18;
      bmp.textColor = "#ffffff";
      bmp.outlineColor = "#000000";
      bmp.outlineWidth = 4;
      bmp.drawText(`${this._index + 1}/${this._teams.length}`, 0, 0, bmp.width, bmp.height, "center");
    }

    refreshTeamImage(team) {
      const imageName = isTeamUnlocked(team) ? team.image : (team.lockedImage || team.image);
      if (imageName) {
        this._teamImageSprite.bitmap = ImageManager.loadPicture(imageName);
      } else {
        const bmp = new Bitmap(360, 280);
        bmp.fillRect(0, 0, 360, 280, "#111");
        bmp.strokeRect(0, 0, 360, 280, "#ffffff");
        bmp.fontSize = 22;
        bmp.drawText("Aucune image", 0, 0, 360, 280, "center");
        this._teamImageSprite.bitmap = bmp;
      }

      const bitmap = this._teamImageSprite.bitmap;
      if (bitmap) {
        const fitW = this._teamImageFrame.width;
        const fitH = this._teamImageFrame.height;
        const w = Math.max(1, bitmap.width || fitW);
        const h = Math.max(1, bitmap.height || fitH);
        const ratio = Math.min(fitW / w, fitH / h);
        this._teamImageSprite.scale.x = ratio;
        this._teamImageSprite.scale.y = ratio;
      }
    }

    refreshName(team) {
      this._nameWindow.contents.clear();
      this._nameWindow.contents.fontSize = 30;
      const displayName = isTeamUnlocked(team) ? (team.name || team.id) : "?";
      const starsWidth = 120;
      const starsStartX = this._nameWindow.innerWidth - starsWidth;
      const stars = [
        { color: "#cd7f32" }, // bronze
        { color: "#c0c0c0" }, // argent
        { color: "#ffd700" }  // or
      ];
      const step = 36;
      const glyphWidth = 24;
      const starsBaseX = starsStartX + Math.floor((starsWidth - step * (stars.length - 1) - glyphWidth) / 2);
      const starsY = 8;
      const starsToShow = getTeamStarCount(team);

      this._nameWindow.drawText(displayName, 0, 6, starsStartX - 8, "left");

      for (let i = 0; i < starsToShow; i++) {
        this._nameWindow.contents.textColor = stars[i].color;
        this._nameWindow.contents.drawText("★", starsBaseX + i * step, starsY, glyphWidth, 30, "center");
      }
      this._nameWindow.resetTextColor();
      this._nameWindow.contents.fontSize = $gameSystem.mainFontSize();
    }

    refreshDescription(team) {
      const text = isTeamUnlocked(team)
        ? decodeMultilineText(team.description)
        : decodeMultilineText(team.lockedDescription || defaultLockedDescription);
      this._descWindow.contents.clear();
      this._descWindow.drawTextEx(text || "Aucune description.", 0, 0, this._descWindow.innerWidth);
    }

    refreshActors(team) {
      this._actorsWindow.contents.clear();
      if (!isTeamUnlocked(team)) {
        return;
      }
      const starterActorIds = getUnlockedStarterActorIdsForTeam(team);
      const followupActorIds = getUnlockedFollowupActorIdsForTeam(team);
      const originalFontSize = this._actorsWindow.contents.fontSize;
      const titleFontSize = Math.max(16, originalFontSize - 6);
      this._actorsWindow.changeTextColor(ColorManager.systemColor());
      this._actorsWindow.contents.fontSize = titleFontSize;
      this._actorsWindow.drawText("Debute avec", 0, 0, this._actorsWindow.innerWidth, "left");
      this._actorsWindow.contents.fontSize = originalFontSize;
      this._actorsWindow.resetTextColor();

      const maxCols = 6;
      const starterTitleWidth = 180;
      const starterActorsX = starterTitleWidth;
      const starterActorsWidth = Math.max(0, this._actorsWindow.innerWidth - starterActorsX);
      const starterMaxCols = Math.max(1, Math.min(maxCols, starterActorIds.length || 1));
      const starterCellW = Math.floor(starterActorsWidth / starterMaxCols);
      const starterStartY = 2;
      const starterShown = starterActorIds.slice(0, starterMaxCols);

      if (!starterShown.length) {
        this._actorsWindow.drawText("Aucun acteur configure.", starterActorsX, starterStartY, starterActorsWidth, "left");
      }

      for (let i = 0; i < starterShown.length; i++) {
        const actorId = starterShown[i];
        const actorData = $dataActors[actorId];
        if (!actorData) continue;
        const x = starterActorsX + i * starterCellW;
        this.drawActorPreview(actorData, x, starterStartY, starterCellW, 56);
      }

      const followupTitleY = 70;
      const followupStartY = 104;
      this._actorsWindow.changeTextColor(ColorManager.systemColor());
      this._actorsWindow.contents.fontSize = titleFontSize;
      this._actorsWindow.drawText("Pokémons jouables", 0, followupTitleY, this._actorsWindow.innerWidth, "left");
      this._actorsWindow.contents.fontSize = originalFontSize;
      this._actorsWindow.resetTextColor();

      const followupCellW = Math.floor(this._actorsWindow.innerWidth / maxCols);
      if (!followupActorIds.length) {
        this._actorsWindow.drawText("Aucun acteur configure.", 0, followupStartY, this._actorsWindow.innerWidth, "left");
        return;
      }

      const followupRows = Math.max(1, Math.ceil(followupActorIds.length / maxCols));
      const followupAvailableHeight = Math.max(1, this._actorsWindow.innerHeight - followupStartY);
      const followupRowHeight = Math.max(24, Math.floor(followupAvailableHeight / followupRows));
      const followupMaxSize = Math.max(20, Math.min(96, followupCellW - 4, followupRowHeight - 2));
      for (let i = 0; i < followupActorIds.length; i++) {
        const actorId = followupActorIds[i];
        const actorData = $dataActors[actorId];
        if (!actorData) continue;
        const col = i % maxCols;
        const row = Math.floor(i / maxCols);
        const x = col * followupCellW;
        const y = followupStartY + row * followupRowHeight;
        this.drawActorPreview(actorData, x, y, followupCellW, followupMaxSize);
      }
    }

    drawActorPreview(actorData, x, y, width, maxSize = 96) {
      const portraitName = actorData.meta ? actorData.meta.portrait : "";
      if (portraitName) {
        const bmp = ImageManager.loadBitmap("img/portrait/", portraitName);
        const size = Math.min(maxSize, width - 4);
        this._actorsWindow.contents.blt(
          bmp,
          0,
          0,
          bmp.width,
          bmp.height,
          x + Math.floor((width - size) / 2),
          y,
          size,
          size
        );
      }
    }
  }

  PluginManager.registerCommand(pluginName, "SelectTeam", args => {
    const ok = setSelectedTeam(args.teamId);
    if (!ok) {
      SoundManager.playBuzzer();
    }
  });

  PluginManager.registerCommand(pluginName, "SelectTeamByIndex", args => {
    const ok = selectTeamByIndex(args.index);
    if (!ok) {
      SoundManager.playBuzzer();
    }
  });

  PluginManager.registerCommand(pluginName, "StoreSelectedTeamId", args => {
    const variableId = Number(args.variableId) || 0;
    if (variableId > 0) {
      $gameVariables.setValue(variableId, getCurrentTeamIdAsNumber());
    }
  });

  PluginManager.registerCommand(pluginName, "OpenTeamSelectScene", () => {
    SceneManager.push(Scene_TeamSelection);
  });

  window.TeamSelection = {
    getTeams: () => teams.map(team => ({ id: team.id, name: team.name, actorIds: getUnlockedActorIdsForTeam(team) })),
    getCurrentTeamName,
    getCurrentTeamId,
    getCurrentTeamIdAsNumber,
    getCurrentActorIds,
    incrementTeamStarProgressFromSelectedVariable,
    isTeamUnlocked: teamId => isTeamUnlocked(findTeamById(teamId)),
    setSelectedTeam,
    selectTeamByIndex
  };
})();
