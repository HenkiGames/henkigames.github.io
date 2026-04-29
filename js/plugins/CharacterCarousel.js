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
 *
 * @command StartCharacterEvolutionSelect
 * @text Sélection évolution (1 parmi 3)
 * @desc Même carousel sans exclure les possédés. Validation d’un possédé : remplacement via <evolution:ID>. Pool : chaque ID liste suit la forme la plus évoluée possédée ; si elle n’a plus de méta evolution valide, la place est retirée du tirage (l’ID d’origine ne revient pas).
 *
 * @arg actorIds
 * @text IDs des acteurs
 * @desc Optionnel. Exemples: 201,202,203 ou ["201","202","203"]
 * @type string
 *
 * @command StartCharacterSelectFull
 * @text Sélection personnage (liste complète)
 * @desc Vide l’équipe et la réserve puis propose tous les actorIds (ordre conservé, sans filtre ni tirage). actorIds obligatoire. Recrutement comme « Démarrer la sélection de personnage » (choix du « starter »).
 *
 * @arg actorIds
 * @text IDs des acteurs
 * @desc Obligatoire. Liste complète à parcourir au carousel, ex. 201,202,203,204
 * @type string
 */

(() => {
  const pluginName = "CharacterCarousel";
  const rawParams = PluginManager.parameters(pluginName);
  const DEFAULT_ACTOR_IDS = [201, 202, 203];
  const FIRST_CAROUSEL_REFUSAL_SWITCH_ID = 118;
  const EVOLUTION_META_KEY = "evolution";
  const NEW_SKILL_META_KEY = "newSkill";
  let nextActorIds = null;
  let pendingReplaceNewActorId = null;
  /** Mode évolution : pas de filtre « déjà dans l’équipe » ; validation sur un possédé déclenche le remplacement via méta evolution. */
  let evolutionCarouselMode = false;
  /** Liste complète : tous les IDs de l’argument, sans filtre ni mélange. */
  let fullListCarouselMode = false;
  /** Conservés après SceneManager.push : pop() recrée Scene_CharacterSelect avec `new`, sans réutiliser l’instance. */
  let savedCarouselActorIds = null;
  let savedCarouselIndex = 0;
  let savedCarouselEvolutionMode = false;
  let savedCarouselFullListMode = false;

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

  function configuredDefaultActorIds() {
    const teamSelection = window.TeamSelection;
    if (teamSelection && typeof teamSelection.getCurrentActorIds === "function") {
      const ids = teamSelection.getCurrentActorIds();
      if (Array.isArray(ids) && ids.length > 0) {
        return ids;
      }
    }
    return DEFAULT_ACTOR_IDS;
  }

  function resolveSourceIdsFromArgs(actorIdsArg) {
    const requestedIds = parseActorIdsArg(actorIdsArg);
    return requestedIds.length > 0 ? requestedIds : configuredDefaultActorIds();
  }

  function markFirstCarouselRefusalSwitch() {
    if (!$gameSwitches) return;
    if (FIRST_CAROUSEL_REFUSAL_SWITCH_ID <= 0) return;
    if ($gameSwitches.value(FIRST_CAROUSEL_REFUSAL_SWITCH_ID)) return;
    $gameSwitches.setValue(FIRST_CAROUSEL_REFUSAL_SWITCH_ID, true);
  }

  /** Retire tous les acteurs de $gameParty (emplacements combat + réserve). */
  function clearPartyAllSlotsForFullSelect() {
    const ids = ($gameParty._actors || []).slice();
    for (let i = ids.length - 1; i >= 0; i--) {
      $gameParty.removeActor(ids[i]);
    }
    $gameParty._menuActorId = 0;
    $gameParty._targetActorId = 0;
    if (typeof $gameParty.clearSrpgBattleActors === "function") {
      $gameParty.clearSrpgBattleActors();
    }
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
    const recruitedMember = $gameActors.actor(selectedId);
    $gameVariables.setValue(109, recruitedMember ? recruitedMember.name() : "");
    $gameVariables.setValue(110, 1);
    $gameVariables.setValue(102, $gameVariables.value(102) + 1);
    SoundManager.playOk();
  }

  /** Lit l’ID acteur cible depuis la note DB, ex. <evolution:3> → méta evolution = "3". */
  function getEvolutionActorIdFromData(actorData) {
    if (!actorData || !actorData.meta) return null;
    const raw = actorData.meta[EVOLUTION_META_KEY];
    if (raw == null || raw === "") return null;
    const id = Number(String(raw).trim());
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  /** Note ex. <newSkill: "Lame d'Air"> ou <newSkill: Tranch'Herbe> → nom affichable pour la variable 113. */
  function getNewSkillNameFromActorData(actorData) {
    if (!actorData || !actorData.meta) return "";
    const raw = actorData.meta[NEW_SKILL_META_KEY];
    if (raw == null || raw === "") return "";
    let s = String(raw).trim();
    if (
      (s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'"))
    ) {
      s = s.slice(1, -1);
    }
    return s;
  }

  /** Méta sur la forme obtenue en priorité, sinon sur l’acteur qui part. */
  function getEvolutionNewSkillDisplayName(oldActorId, newActorId) {
    const fromNew = getNewSkillNameFromActorData($dataActors[newActorId]);
    if (fromNew !== "") return fromNew;
    return getNewSkillNameFromActorData($dataActors[oldActorId]);
  }

  /** La méta evolution pointe vers un acteur défini dans la base (évolution possible). */
  function hasValidFollowingEvolution(actorId) {
    const data = $dataActors[actorId];
    const nextId = getEvolutionActorIdFromData(data);
    return nextId != null && !!$dataActors[nextId] && nextId !== actorId;
  }

  /** Plus profonde forme de la lignée `rootId` présente dans l’équipe/réserve (A→C→E, équipe a E → retourne E). */
  function deepestPartyFormAlongEvolutionChain(rootId) {
    const members = partyActorIdSet();
    let lastInParty = null;
    let walk = rootId;
    const visited = new Set();
    while (walk && $dataActors[walk] && !visited.has(walk)) {
      visited.add(walk);
      if (members.has(walk)) {
        lastInParty = walk;
      }
      const nextId = getEvolutionActorIdFromData($dataActors[walk]);
      if (!nextId || !$dataActors[nextId]) break;
      walk = nextId;
    }
    return lastInParty;
  }

  /**
   * Pour la commande évolution : chaque ID source = une « place » dans la liste d’événement.
   * Si l’acteur n’est plus possédé mais une forme évoluée l’est, on propose cette forme
   * uniquement si elle peut encore évoluer (méta evolution valide), sinon la place est vide.
   */
  function resolveEvolutionPoolSlotId(rootId) {
    if (!$dataActors[rootId]) return null;
    const deepest = deepestPartyFormAlongEvolutionChain(rootId);
    if (deepest != null) {
      return hasValidFollowingEvolution(deepest) ? deepest : null;
    }
    return rootId;
  }

  function buildEvolutionPoolActorIds(sourceIds) {
    const valid = filterValidActorIds(sourceIds);
    const seen = new Set();
    const out = [];
    for (const id of valid) {
      const resolved = resolveEvolutionPoolSlotId(id);
      if (resolved == null) continue;
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      out.push(resolved);
    }
    return out;
  }

  function performEvolutionSwap(oldActorId, newActorId) {
    if (!oldActorId || oldActorId <= 0 || !newActorId || newActorId <= 0) return false;
    if (!$dataActors[newActorId]) return false;
    if (!$gameParty._actors || !$gameParty._actors.includes(oldActorId)) return false;

    const leavingMember = $gameActors.actor(oldActorId);
    const leavingName = leavingMember
      ? leavingMember.name()
      : $dataActors[oldActorId]
        ? $dataActors[oldActorId].name
        : "";

    $gameParty.removeActor(oldActorId);
    if (typeof prepareRecruitmentAfterPermanentDeath === "function") {
      prepareRecruitmentAfterPermanentDeath(newActorId);
    }
    const recruited = $gameActors.actor(newActorId);
    if (recruited) {
      recruited.initialize(newActorId);
    }
    $gameParty.addActor(newActorId);
    const recruitedMember = $gameActors.actor(newActorId);
    $gameVariables.setValue(109, leavingName);
    $gameVariables.setValue(110, 1);
    $gameVariables.setValue(111, 1);
    $gameVariables.setValue(112, recruitedMember ? recruitedMember.name() : "");
    $gameVariables.setValue(113, getEvolutionNewSkillDisplayName(oldActorId, newActorId));
    SoundManager.playOk();
    return true;
  }

  function startCarouselFromSourceIds(sourceIds, options) {
    const fullList = options && options.fullList === true;
    const withEvolution = !fullList && options && options.evolution === true;
    let filtered;
    if (fullList) {
      filtered = filterValidActorIds(sourceIds);
    } else if (withEvolution) {
      filtered = buildEvolutionPoolActorIds(sourceIds);
    } else {
      filtered = filterUnavailableActorIds(sourceIds);
    }
    const availableIds = fullList
      ? filtered
      : shuffleArray(filtered).slice(0, 3);

    if (availableIds.length === 0) {
      $gameVariables.setValue(110, 0);
      if (withEvolution) {
        $gameVariables.setValue(109, "");
        $gameVariables.setValue(111, 0);
        $gameVariables.setValue(112, "");
        $gameVariables.setValue(113, "");
      }
      SoundManager.playBuzzer();
      return;
    }

    $gameVariables.setValue(110, 0);
    if (withEvolution) {
      $gameVariables.setValue(109, "");
      $gameVariables.setValue(111, 0);
      $gameVariables.setValue(112, "");
      $gameVariables.setValue(113, "");
    }
    evolutionCarouselMode = withEvolution;
    fullListCarouselMode = fullList;
    nextActorIds = availableIds;
    SceneManager.push(Scene_CharacterSelect);
  }

  PluginManager.registerCommand(pluginName, "StartCharacterSelect", args => {
    const sourceIds = resolveSourceIdsFromArgs(args.actorIds);
    startCarouselFromSourceIds(sourceIds, { evolution: false });
  });

  PluginManager.registerCommand(pluginName, "StartCharacterEvolutionSelect", args => {
    const sourceIds = resolveSourceIdsFromArgs(args.actorIds);
    startCarouselFromSourceIds(sourceIds, { evolution: true });
  });

  PluginManager.registerCommand(pluginName, "StartCharacterSelectFull", args => {
    const requestedIds = parseActorIdsArg(args.actorIds);
    if (requestedIds.length === 0) {
      $gameVariables.setValue(110, 0);
      SoundManager.playBuzzer();
      return;
    }
    clearPartyAllSlotsForFullSelect();
    startCarouselFromSourceIds(requestedIds, { fullList: true });
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

  /** Tous les acteurs possédés (équipe + réserve), pas seulement members() qui en combat = combattants visibles. */
  function partyActorIdSet() {
    return new Set(($gameParty._actors || []).filter(id => id > 0));
  }

  function filterPartyActorIds(actorIds) {
    const memberIds = partyActorIdSet();
    return actorIds.filter(id => !memberIds.has(id));
  }

  /**
   * Vrai si une forme évoluée de `rootId` (A->C->E...) est déjà possédée.
   * Permet d'éviter de reproposer une ancienne forme déjà dépassée.
   */
  function hasOwnedEvolvedForm(rootId) {
    const memberIds = partyActorIdSet();
    const visited = new Set();
    let walk = rootId;
    while (walk && $dataActors[walk] && !visited.has(walk)) {
      visited.add(walk);
      const nextId = getEvolutionActorIdFromData($dataActors[walk]);
      if (!nextId || !$dataActors[nextId]) break;
      if (memberIds.has(nextId)) return true;
      walk = nextId;
    }
    return false;
  }

  function filterUnavailableActorIds(actorIds) {
    const valid = filterValidActorIds(actorIds);
    const notInParty = filterPartyActorIds(valid);
    return notInParty.filter(id => !hasOwnedEvolvedForm(id));
  }

  function parseTypeMetaValue(rawValue) {
    if (rawValue == null) return null;
    const text = String(rawValue).trim();
    if (!text) return null;
    if (/^\d+$/.test(text)) {
      return { elementId: Number(text), typeName: "" };
    }
    return { elementId: 0, typeName: text };
  }

  function resolveElementIdByTypeNameLoose(typeName) {
    const needle = String(typeName || "").trim().toLowerCase();
    if (!needle || !$dataSystem || !$dataSystem.elements) return 0;
    for (let i = 1; i < $dataSystem.elements.length; i++) {
      const dbName = String($dataSystem.elements[i] || "").trim();
      if (!dbName) continue;
      if (dbName.toLowerCase() === needle) return i;
    }
    return 0;
  }

  function resolveActorTypeInfo(actorData, actorInstance) {
    const fromClassMeta = actorInstance && actorInstance.currentClass && actorInstance.currentClass()
      ? parseTypeMetaValue(actorInstance.currentClass().meta ? actorInstance.currentClass().meta.type : null)
      : null;
    const fromActorMeta = actorData && actorData.meta
      ? parseTypeMetaValue(actorData.meta.type)
      : null;
    const parsed = fromClassMeta || fromActorMeta;
    if (!parsed) return null;

    let typeName = "";
    let iconIndex = 0;
    if (parsed.elementId > 0) {
      typeName = $dataSystem && $dataSystem.elements
        ? String($dataSystem.elements[parsed.elementId] || "").trim()
        : "";
      if (window.CbnTypeIcons && typeof window.CbnTypeIcons.iconByElementId === "function") {
        iconIndex = Number(window.CbnTypeIcons.iconByElementId(parsed.elementId) || 0);
      }
      if (!typeName) typeName = `ID ${parsed.elementId}`;
    } else {
      const resolvedElementId = resolveElementIdByTypeNameLoose(parsed.typeName);
      if (resolvedElementId > 0) {
        typeName = String($dataSystem.elements[resolvedElementId] || "").trim();
        if (window.CbnTypeIcons && typeof window.CbnTypeIcons.iconByElementId === "function") {
          iconIndex = Number(window.CbnTypeIcons.iconByElementId(resolvedElementId) || 0);
        }
      } else {
        typeName = parsed.typeName;
        if (window.CbnTypeIcons && typeof window.CbnTypeIcons.iconByTypeName === "function") {
          iconIndex = Number(window.CbnTypeIcons.iconByTypeName(parsed.typeName) || 0);
        }
      }
    }
    return { typeName, iconIndex };
  }

  function parseTypeListMetaValue(rawValue) {
    if (rawValue == null) return [];
    return String(rawValue)
      .split(",")
      .map(value => String(value || "").trim())
      .filter(value => value.length > 0);
  }

  function resolveTypeDisplayFromLooseValue(rawTypeValue) {
    const parsed = parseTypeMetaValue(rawTypeValue);
    if (!parsed) return null;

    let typeName = "";
    let iconIndex = 0;
    if (parsed.elementId > 0) {
      typeName = $dataSystem && $dataSystem.elements
        ? String($dataSystem.elements[parsed.elementId] || "").trim()
        : "";
      if (window.CbnTypeIcons && typeof window.CbnTypeIcons.iconByElementId === "function") {
        iconIndex = Number(window.CbnTypeIcons.iconByElementId(parsed.elementId) || 0);
      }
      if (!typeName) typeName = `ID ${parsed.elementId}`;
    } else {
      const resolvedElementId = resolveElementIdByTypeNameLoose(parsed.typeName);
      if (resolvedElementId > 0) {
        typeName = String($dataSystem.elements[resolvedElementId] || "").trim();
        if (window.CbnTypeIcons && typeof window.CbnTypeIcons.iconByElementId === "function") {
          iconIndex = Number(window.CbnTypeIcons.iconByElementId(resolvedElementId) || 0);
        }
      } else {
        typeName = parsed.typeName;
        if (window.CbnTypeIcons && typeof window.CbnTypeIcons.iconByTypeName === "function") {
          iconIndex = Number(window.CbnTypeIcons.iconByTypeName(parsed.typeName) || 0);
        }
      }
    }
    if (!typeName) return null;
    return { typeName, iconIndex };
  }

  function buildWrappedTypeLine(label, entries, maxWidth, measureTextFn) {
    if (!entries.length) return [`${label}Aucun`];
    const continuationPrefix = " ".repeat(label.length);
    const lines = [];
    let current = label;

    for (let i = 0; i < entries.length; i++) {
      const isFirstItemOnLine = current === label || current === continuationPrefix;
      const separator = isFirstItemOnLine ? "" : ", ";
      const token = `${separator}${entries[i]}`;
      const candidate = `${current}${token}`;

      if (!isFirstItemOnLine && measureTextFn(candidate) > maxWidth) {
        lines.push(current);
        current = `${continuationPrefix}${entries[i]}`;
      } else {
        current = candidate;
      }
    }

    lines.push(current);
    return lines;
  }

  function buildTypeMatchLinesForActorClass(actorInstance, maxWidth, measureTextFn) {
    const cls = actorInstance && actorInstance.currentClass ? actorInstance.currentClass() : null;
    const meta = cls && cls.meta ? cls.meta : null;
    if (!meta) return [];

    const strongTypes = parseTypeListMetaValue(meta.typeFortContre);
    const weakTypes = parseTypeListMetaValue(meta.typeFaibleContre);

    const formatTypeEntries = values => {
      if (!values.length) return [];
      return values.map(value => {
        const display = resolveTypeDisplayFromLooseValue(value);
        if (!display) return String(value);
        const iconPart = display.iconIndex > 0 ? ` \\I[${display.iconIndex}]` : "";
        return `${display.typeName}${iconPart}`;
      });
    };

    return [
      ...buildWrappedTypeLine(
        "Efficace contre : ",
        formatTypeEntries(strongTypes),
        maxWidth,
        measureTextFn
      ),
      ...buildWrappedTypeLine(
        "Faible contre : ",
        formatTypeEntries(weakTypes),
        maxWidth,
        measureTextFn
      )
    ];
  }

  function measureExTextWidth(windowBase, text) {
    if (
      windowBase &&
      typeof windowBase.textSizeEx === "function" &&
      windowBase.contents
    ) {
      return windowBase.textSizeEx(String(text || "")).width;
    }
    return String(text || "").length * 10;
  }

  function buildTypeMatchBlockForActorClass(actorInstance, windowBase) {
    const maxWidth = windowBase && typeof windowBase.contentsWidth === "function"
      ? Math.max(80, windowBase.contentsWidth() - 8)
      : 700;
    const measureTextFn = text => measureExTextWidth(windowBase, text);
    const lines = buildTypeMatchLinesForActorClass(actorInstance, maxWidth, measureTextFn);
    if (!lines.length) {
      return (
        `Efficace contre : Aucun\n` +
        `Faible contre : Aucun`
      );
    }
    return lines.join("\n");
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
        this._evolutionMode = savedCarouselEvolutionMode;
        this._fullListMode = savedCarouselFullListMode;
        savedCarouselActorIds = null;
        savedCarouselIndex = 0;
        savedCarouselEvolutionMode = false;
        savedCarouselFullListMode = false;
      } else {
        this._actorIds =
          nextActorIds ||
          shuffleArray(filterUnavailableActorIds(configuredDefaultActorIds())).slice(0, 3);
        this._evolutionMode = evolutionCarouselMode;
        evolutionCarouselMode = false;
        this._fullListMode = fullListCarouselMode;
        fullListCarouselMode = false;
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
      this.createTypeMatchWindow();
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
      this._statsWindow.deactivate();
      this.addWindow(this._statsWindow);
    }

    createDescriptionWindow() {
      const rect = new Rectangle(100, 440, Graphics.width - 200, 100);
      this._descWindow = new Window_Base(rect);
      this._descWindow.deactivate();
      this.addWindow(this._descWindow);
    }

    createTypeMatchWindow() {
      const rect = new Rectangle(100, 540, Graphics.width - 200, 180);
      this._typeMatchWindow = new Window_Base(rect);
      this._typeMatchWindow.deactivate();
      this.addWindow(this._typeMatchWindow);
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
      markFirstCarouselRefusalSwitch();
      $gameVariables.setValue(110, 0);
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
        `Nom: ${actor.name}` +
        (
          (() => {
            const typeInfo = resolveActorTypeInfo(actor, tempActor);
            if (!typeInfo || !typeInfo.typeName) return "";
            const iconSuffix = typeInfo.iconIndex > 0 ? ` \\I[${typeInfo.iconIndex}]` : "";
            return `    Type: ${typeInfo.typeName}${iconSuffix}`;
          })()
        ) +
        `\n` +
        `PV:${tempActor.mhp}` +
        ` - ATK:${tempActor.atk}` +
        ` - ATK SPE:${tempActor.mat}\n` +
        `CC:${Math.round(tempActor.cri * 100)}%` +
        ` - DEF:${tempActor.def}` +
        ` - DEF SPE:${tempActor.mdf}`;
      this._statsWindow.contents.clear();
      this._statsWindow.drawTextEx(statsText, 0, 0);

      this._descWindow.contents.clear();
      const descriptionText = actor.note || "Aucune description";
      this._descWindow.drawTextEx(descriptionText, 0, 0);

      this._typeMatchWindow.contents.clear();
      const typeMatchText = buildTypeMatchBlockForActorClass(tempActor, this._typeMatchWindow);
      this._typeMatchWindow.drawTextEx(typeMatchText, 0, 0);
    }

    update() {
      // OK / Annuler en premier : même effet que le bouton Valider (le clic ne passe pas par Input).
      if (Input.isTriggered("ok")) {
        this.selectActor();
        return;
      }
      if (Input.isTriggered("cancel") && this._canCancelCarousel) {
        this.onCancelCarousel();
        return;
      }
      super.update();
      if (Input.isTriggered("left")) {
        this._index = (this._index - 1 + this._actorIds.length) % this._actorIds.length;
        this.playSelectionSe();
        this.refreshDisplay();
      } else if (Input.isTriggered("right")) {
        this._index = (this._index + 1) % this._actorIds.length;
        this.playSelectionSe();
        this.refreshDisplay();
      }
    }

    selectActor() {
      const selectedId = this._actorIds[this._index];
      const alreadyInParty = partyActorIdSet().has(selectedId);

      if (this._evolutionMode && alreadyInParty) {
        const data = $dataActors[selectedId];
        const evolveToId = getEvolutionActorIdFromData(data);
        if (!evolveToId || !$dataActors[evolveToId] || evolveToId === selectedId) {
          SoundManager.playBuzzer();
          return;
        }
        if (performEvolutionSwap(selectedId, evolveToId)) {
          SceneManager.pop();
        }
        return;
      }

      if (alreadyInParty) {
        $gameVariables.setValue(110, 0);
        SceneManager.pop();
        return;
      }
      if ($gameParty.allMembers().length >= getMaxActorsCap()) {
        savedCarouselActorIds = this._actorIds.slice();
        savedCarouselIndex = this._index;
        savedCarouselEvolutionMode = this._evolutionMode;
        savedCarouselFullListMode = !!this._fullListMode;
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
        $gameVariables.setValue(110, 0);
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
      savedCarouselEvolutionMode = false;
      savedCarouselFullListMode = false;
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
      $gameVariables.setValue(110, 0);
      SceneManager.pop();
    }

    /** Clavier / manette : processCancel joue déjà le son puis désactive la fenêtre. */
    onStatusCancel() {
      if (this._pendingReplaceIndex !== null) {
        this.clearPendingReplaceSelection();
        return;
      }
      $gameVariables.setValue(110, 0);
      SceneManager.pop();
    }
  }
})();
