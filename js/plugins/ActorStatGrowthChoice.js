/*:
 * @target MZ
 * @plugindesc Choix 1 parmi 3 pour augmenter une stat de l’acteur (bonus cumulables, conservés à l’évolution).
 * @author Carbonne Arena
 *
 * @param defaultChoicePoolJson
 * @text Pool de choix (JSON)
 * @type note
 * @default "[{\"label\":\"+8 PV max\",\"paramId\":0,\"value\":8},{\"label\":\"+2 Attaque\",\"paramId\":2,\"value\":2},{\"label\":\"+3 % critique\",\"xparamId\":2,\"valuePercent\":3},{\"label\":\"+2 Défense\",\"paramId\":3,\"value\":2},{\"label\":\"+2 Att. magique\",\"paramId\":4,\"value\":2},{\"label\":\"+2 Déf. magique\",\"paramId\":5,\"value\":2},{\"label\":\"+2 Agilité\",\"paramId\":6,\"value\":2},{\"label\":\"+2 Chance\",\"paramId\":7,\"value\":2}]"
 * @desc JSON : paramId (stats), xparamId (ex. critique), ou lifeStealPercent / lifeStealRate (vol de vie sur dégâts PV). L’éditeur peut double-encoder le JSON : géré automatiquement.
 *
 * @param actorTargetMode
 * @text Cible par défaut
 * @type select
 * @option Acteur du menu (formation / dernier menu)
 * @value menu
 * @option Chef de groupe
 * @value leader
 * @option ID acteur = variable de jeu
 * @value variable
 * @default menu
 *
 * @param actorVariableId
 * @text Variable (ID acteur si « variable »)
 * @type variable
 * @default 1
 * @desc Utilisée seulement si la cible par défaut est « variable ».
 *
 * @param resultVariableId
 * @text Variable résultat (index du choix)
 * @type variable
 * @default 0
 * @desc 0 = 1er choix, 1 = 2e, 2 = 3e. Mettre 0 pour ne pas écrire.
 *
 * @param helpText
 * @text Texte d’aide (fenêtre)
 * @type string
 * @default Choisissez une amélioration pour %1.
 * @desc %1 = nom de l’acteur.
 *
 * @param resetBonusesOnVanillaGameOver
 * @text Réinitialiser bonus (Game Over classique)
 * @type boolean
 * @default false
 * @desc Si oui : bonus vidés au démarrage de l’écran Game Over MZ. Inutile si vous utilisez CustomGameOverRedirect (voir ci‑dessous).
 *
 * @param resetBonusesOnDefeatRedirect
 * @text Réinitialiser bonus (défaite → hub)
 * @type boolean
 * @default true
 * @desc Si oui : bonus vidés quand CustomGameOverRedirect intercepte la défaite (nouvelle run). Mettre Non pour garder les bonus entre les « morts ».
 *
 * @command openStatChoice
 * @text Ouvrir le choix de stats (1 parmi 3)
 * @desc Affiche 3 propositions tirées au hasard dans le pool (ou le pool de la commande). L’événement attend la fermeture.
 *
 * @arg actorTargetMode
 * @text Cible acteur
 * @type select
 * @option Utiliser le réglage du plugin
 * @value
 * @option Acteur du menu
 * @value menu
 * @option Chef de groupe
 * @value leader
 * @option ID acteur = variable de jeu
 * @value variable
 * @default
 *
 * @arg actorVariableId
 * @text Variable ID acteur (si « variable »)
 * @type variable
 * @default 0
 * @desc Si 0 et mode variable : utilise le paramètre du plugin.
 *
 * @arg choicePoolJson
 * @text Pool JSON (optionnel)
 * @type note
 * @default
 * @desc Laisser vide pour utiliser le pool du plugin. Même format que le paramètre « Pool de choix ».
 *
 * @command resetAllGrowthBonuses
 * @text Réinitialiser tous les bonus (stats / xparam / vol de vie)
 * @desc Vide les bonus cumulés par lignée d’évolution et sur les instances d’acteurs. À appeler au début d’une nouvelle run si besoin.
 *
 * @help
 * Bonus stockés par « racine » de lignée d’évolution (balises evolution / evolutionId sur les acteurs) : toutes les formes partagent les mêmes bonus.
 * Réinitialisation : paramètres Game Over / défaite hub, ou commande « Réinitialiser tous les bonus ».
 * Placez ce plugin APRÈS SRPG_core_MZ (et après PartyEvolutionSelect si vous l’utilisez).
 */

(() => {
  "use strict";

  const PLUGIN_NAME = "ActorStatGrowthChoice";
  const WAIT_MODE = "actorStatGrowthChoice";
  const EVOLUTION_META_KEY = "evolution";

  const raw = PluginManager.parameters(PLUGIN_NAME);
  const DEFAULT_POOL_JSON = String(raw.defaultChoicePoolJson || "[]");
  const RESET_BONUSES_ON_VANILLA_GAME_OVER = raw.resetBonusesOnVanillaGameOver === "true";
  const RESET_BONUSES_ON_DEFEAT_REDIRECT = raw.resetBonusesOnDefeatRedirect !== "false";

  /** L’éditeur RM enregistre parfois le JSON du plugin comme chaîne JSON (double encodage). */
  function parseJsonArrayFlexible(str) {
    let s = String(str || "").trim();
    if (!s) return [];
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    let data;
    try {
      data = JSON.parse(s);
    } catch (e1) {
      try {
        s = s.replace(/,\s*]/g, "]").replace(/,\s*}/g, "}");
        data = JSON.parse(s);
      } catch (e2) {
        return [];
      }
    }
    if (typeof data === "string") {
      try {
        data = JSON.parse(data.trim());
      } catch (e3) {
        return [];
      }
    }
    return Array.isArray(data) ? data : [];
  }
  const DEFAULT_TARGET = String(raw.actorTargetMode || "menu");
  const DEFAULT_ACTOR_VAR = Number(raw.actorVariableId) || 1;
  const RESULT_VAR_ID = Number(raw.resultVariableId) || 0;
  const HELP_TEXT = String(raw.helpText || "Choisissez une amélioration pour %1.").replace(/\\n/g, "\n");

  /** Données passées à la prochaine `SceneManager.push(Scene_StatGrowthChoice)` (push attend une classe, pas une instance). */
  let _pendingStatChoiceActor = null;
  let _pendingStatChoices = null;

  //---------------------------------------------------------------------------
  // Pool & parsing
  //---------------------------------------------------------------------------

  const XPARAM_LABELS_FR = [
    "Précision",
    "Esquive",
    "Taux critique",
    "Prévention critique",
    "Évasion magique",
    "Réflexion magique",
    "Contre-attaque",
    "Régén. PV",
    "Régén. PM",
    "Régén. TP"
  ];

  function parseXparamNumericValue(entry) {
    if (entry.valuePercent != null && entry.valuePercent !== "") {
      const p = Number(entry.valuePercent);
      if (!Number.isFinite(p) || p === 0) return null;
      return p / 100;
    }
    const value = Number(entry.value);
    if (!Number.isFinite(value) || value === 0) return null;
    return value;
  }

  function defaultLabelForXparam(xparamId, value) {
    const name = XPARAM_LABELS_FR[xparamId] || `xparam ${xparamId}`;
    const pct = Math.round(value * 10000) / 100;
    const sign = value > 0 ? "+" : "";
    return `${sign}${pct}% ${name}`;
  }

  function defaultLabelForLifeSteal(rate) {
    const pct = Math.round(rate * 10000) / 100;
    const sign = rate > 0 ? "+" : "";
    return `${sign}${pct}% vol de vie`;
  }

  function parseLifeStealRate(entry) {
    if (entry.lifeStealPercent != null && entry.lifeStealPercent !== "") {
      const p = Number(entry.lifeStealPercent);
      if (!Number.isFinite(p) || p === 0) return null;
      return p / 100;
    }
    if (entry.lifeStealRate != null && entry.lifeStealRate !== "") {
      const r = Number(entry.lifeStealRate);
      if (!Number.isFinite(r) || r === 0) return null;
      return r;
    }
    if (entry.statType === "lifeSteal" || entry.statType === "lifeStealPercent") {
      return parseXparamNumericValue(entry);
    }
    return null;
  }

  function parseChoicePoolJson(str) {
    if (!str || !String(str).trim()) return [];
    try {
      const data = parseJsonArrayFlexible(str);
      return data
        .map(entry => {
          const label = String(entry.label != null ? entry.label : "");
          const ls = parseLifeStealRate(entry);
          const wantsLifeSteal =
            entry.statType === "lifeSteal" ||
            entry.statType === "lifeStealPercent" ||
            (entry.lifeStealPercent != null && entry.lifeStealPercent !== "") ||
            (entry.lifeStealRate != null && entry.lifeStealRate !== "");
          if (wantsLifeSteal) {
            if (ls == null) return null;
            return {
              label: label || defaultLabelForLifeSteal(ls),
              lifeStealRate: ls
            };
          }
          const hasX =
            entry.xparamId != null &&
            entry.xparamId !== "" &&
            !Number.isNaN(Number(entry.xparamId));
          if (hasX) {
            const xparamId = Number(entry.xparamId);
            const num = parseXparamNumericValue(entry);
            if (!Number.isInteger(xparamId) || xparamId < 0 || xparamId > 9) return null;
            if (num == null) return null;
            return {
              label: label || defaultLabelForXparam(xparamId, num),
              xparamId,
              value: num
            };
          }
          const paramId = Number(entry.paramId);
          const value = Number(entry.value);
          if (!Number.isInteger(paramId) || paramId < 0 || paramId > 7) return null;
          if (!Number.isFinite(value) || value === 0) return null;
          return {
            label: label || defaultLabelForParam(paramId, value),
            paramId,
            value: Math.trunc(value)
          };
        })
        .filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  function defaultLabelForParam(paramId, value) {
    const sign = value > 0 ? "+" : "";
    const name = TextManager.param(paramId);
    return `${sign}${value} ${name}`;
  }

  function defaultPool() {
    const live = String(PluginManager.parameters(PLUGIN_NAME).defaultChoicePoolJson || DEFAULT_POOL_JSON || "[]");
    const p = parseChoicePoolJson(live);
    return p.length > 0 ? p : fallbackPool();
  }

  function fallbackPool() {
    return [
      { label: "+5 PV max", paramId: 0, value: 5 },
      { label: "+2 Attaque", paramId: 2, value: 2 },
      { label: "+2 Défense", paramId: 3, value: 2 }
    ];
  }

  function shuffleAndPickThree(pool) {
    const src = pool.slice();
    for (let i = src.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = src[i];
      src[i] = src[j];
      src[j] = t;
    }
    const n = Math.min(3, src.length);
    return src.slice(0, n);
  }

  //---------------------------------------------------------------------------
  // Méta évolution (CharacterCarousel : evolution ; aussi evolutionId et note)
  //---------------------------------------------------------------------------

  function getEvolutionTargetFromActorData(actorData) {
    if (!actorData) return null;
    if (actorData.meta) {
      for (const key of ["evolution", "evolutionId", EVOLUTION_META_KEY]) {
        const rawMeta = actorData.meta[key];
        if (rawMeta == null || rawMeta === "") continue;
        const id = Number(String(rawMeta).trim());
        if (Number.isInteger(id) && id > 0) return id;
      }
    }
    const note = actorData.note || "";
    let m = note.match(/<evolution\s*:\s*(\d+)>/i);
    if (m) return Number(m[1]);
    m = note.match(/<evolutionId\s*:\s*(\d+)>/i);
    return m ? Number(m[1]) : null;
  }

  function buildEvolutionParentByChild() {
    if (window._cbnEvolutionParentByChild) return;
    const map = {};
    for (let i = 1; i < $dataActors.length; i++) {
      const d = $dataActors[i];
      if (!d) continue;
      const to = getEvolutionTargetFromActorData(d);
      if (to && to > 0 && $dataActors[to]) {
        map[to] = i;
      }
    }
    window._cbnEvolutionParentByChild = map;
  }

  function getEvolutionRootId(actorId) {
    if (!actorId || !$dataActors[actorId]) return actorId;
    buildEvolutionParentByChild();
    const parentByChild = window._cbnEvolutionParentByChild;
    const seen = new Set();
    let cur = actorId;
    while (parentByChild[cur] != null && $dataActors[parentByChild[cur]] && !seen.has(cur)) {
      seen.add(cur);
      cur = parentByChild[cur];
    }
    return cur;
  }

  //---------------------------------------------------------------------------
  // Stockage bonus par lignée ($gameSystem) + anciennes instances (migration)
  //---------------------------------------------------------------------------

  function ensureGameSystemLineageRoot() {
    if (!$gameSystem) return;
    if (!$gameSystem._cbnLineageGrowth || typeof $gameSystem._cbnLineageGrowth !== "object") {
      $gameSystem._cbnLineageGrowth = {};
    }
  }

  function ensureLineageStore(rootId) {
    ensureGameSystemLineageRoot();
    const k = String(rootId);
    const g = $gameSystem._cbnLineageGrowth;
    if (!g[k]) {
      g[k] = {
        s: [0, 0, 0, 0, 0, 0, 0, 0],
        x: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        ls: 0
      };
    } else {
      const o = g[k];
      if (!o.s || !Array.isArray(o.s)) o.s = [0, 0, 0, 0, 0, 0, 0, 0];
      if (!o.x || !Array.isArray(o.x)) o.x = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      if (typeof o.ls !== "number" || Number.isNaN(o.ls)) o.ls = 0;
    }
    return g[k];
  }

  function migrateLegacyInstanceToLineage(actor) {
    if (!actor || !actor.isActor()) return;
    if (actor._cbnLegacyGrowthMerged) return;
    actor._cbnLegacyGrowthMerged = true;
    const root = getEvolutionRootId(actor.actorId());
    const st = ensureLineageStore(root);
    let touched = false;
    if (actor._cbnStatGrowth && Array.isArray(actor._cbnStatGrowth)) {
      for (let i = 0; i < 8; i++) {
        const n = actor._cbnStatGrowth[i] || 0;
        if (n) {
          st.s[i] += n;
          touched = true;
        }
      }
    }
    if (actor._cbnXparamGrowth && Array.isArray(actor._cbnXparamGrowth)) {
      for (let i = 0; i < 10; i++) {
        const n = actor._cbnXparamGrowth[i] || 0;
        if (n) {
          st.x[i] += n;
          touched = true;
        }
      }
    }
    if (typeof actor._cbnLifeStealRate === "number" && actor._cbnLifeStealRate !== 0) {
      st.ls += actor._cbnLifeStealRate;
      touched = true;
    }
    if (touched) {
      actor._cbnStatGrowth = [0, 0, 0, 0, 0, 0, 0, 0];
      actor._cbnXparamGrowth = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      actor._cbnLifeStealRate = 0;
    }
  }

  function addStatGrowth(actor, paramId, value) {
    if (!actor || paramId < 0 || paramId > 7 || !value) return;
    const st = ensureLineageStore(getEvolutionRootId(actor.actorId()));
    st.s[paramId] += Math.trunc(value);
    actor.refresh();
  }

  function addXparamGrowth(actor, xparamId, value) {
    if (!actor || xparamId < 0 || xparamId > 9 || !Number.isFinite(value) || value === 0) return;
    const st = ensureLineageStore(getEvolutionRootId(actor.actorId()));
    st.x[xparamId] += value;
    actor.refresh();
  }

  function addLifeStealGrowth(actor, rate) {
    if (!actor || !Number.isFinite(rate) || rate === 0) return;
    const st = ensureLineageStore(getEvolutionRootId(actor.actorId()));
    st.ls += rate;
    actor.refresh();
  }

  function applyGrowthChoice(actor, choice) {
    if (!actor || !choice) return;
    if (choice.lifeStealRate != null && Number(choice.lifeStealRate) > 0) {
      addLifeStealGrowth(actor, choice.lifeStealRate);
      return;
    }
    if (choice.xparamId != null && choice.xparamId !== "") {
      addXparamGrowth(actor, choice.xparamId, choice.value);
    } else {
      addStatGrowth(actor, choice.paramId, choice.value);
    }
  }

  //---------------------------------------------------------------------------
  // Hooks Game_Actor / Game_Party
  //---------------------------------------------------------------------------

  const _Game_Actor_initMembers = Game_Actor.prototype.initMembers;
  Game_Actor.prototype.initMembers = function() {
    _Game_Actor_initMembers.call(this);
    this._cbnStatGrowth = [0, 0, 0, 0, 0, 0, 0, 0];
    this._cbnXparamGrowth = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    this._cbnLifeStealRate = 0;
    this._cbnLegacyGrowthMerged = false;
  };

  const _Game_Actor_initialize = Game_Actor.prototype.initialize;
  Game_Actor.prototype.initialize = function(actorId) {
    _Game_Actor_initialize.call(this, actorId);
    this._cbnLegacyGrowthMerged = false;
  };

  const _Game_Actor_paramPlus = Game_Actor.prototype.paramPlus;
  Game_Actor.prototype.paramPlus = function(paramId) {
    let v = _Game_Actor_paramPlus.call(this, paramId);
    migrateLegacyInstanceToLineage(this);
    const st = ensureLineageStore(getEvolutionRootId(this.actorId()));
    if (paramId >= 0 && paramId < 8) {
      v += st.s[paramId] || 0;
    }
    return v;
  };

  const _Game_BattlerBase_xparam = Game_BattlerBase.prototype.xparam;
  Game_BattlerBase.prototype.xparam = function(xparamId) {
    let v = _Game_BattlerBase_xparam.call(this, xparamId);
    if (this.isActor()) {
      migrateLegacyInstanceToLineage(this);
      const st = ensureLineageStore(getEvolutionRootId(this.actorId()));
      if (xparamId >= 0 && xparamId < 10) {
        v += st.x[xparamId] || 0;
      }
    }
    return v;
  };

  //---------------------------------------------------------------------------
  // PartyEvolutionSelect : fusion des vieux bonus instance → lignée avant swap
  //---------------------------------------------------------------------------

  function patchEvolutionParty() {
    const EP = window.EvolutionParty;
    if (!EP || typeof EP.replacePartyActorAtSlot !== "function" || EP._cbnStatPatched) return;
    const original = EP.replacePartyActorAtSlot;
    EP.replacePartyActorAtSlot = function(oldActorId, newActorId) {
      const oldActor = $gameActors.actor(oldActorId);
      if (oldActor) migrateLegacyInstanceToLineage(oldActor);
      const ok = original.call(this, oldActorId, newActorId);
      if (ok) {
        const newActor = $gameActors.actor(newActorId);
        if (newActor) {
          newActor._cbnLegacyGrowthMerged = false;
          migrateLegacyInstanceToLineage(newActor);
          newActor.refresh();
        }
      }
      return ok;
    };
    EP._cbnStatPatched = true;
  }

  patchEvolutionParty();

  //---------------------------------------------------------------------------
  // Vol de vie : hook executeHpDamage (valeur réelle, fiable SRPG / plugins sur apply)
  //---------------------------------------------------------------------------

  const _Game_Action_executeHpDamage_cbnLs = Game_Action.prototype.executeHpDamage;
  Game_Action.prototype.executeHpDamage = function(target, value) {
    _Game_Action_executeHpDamage_cbnLs.call(this, target, value);
    if (value == null || value <= 0) return;
    if (this.isDrain()) return;
    if (!this.isForOpponent()) return;
    const user = this.subject();
    if (!user || !user.isActor()) return;
    migrateLegacyInstanceToLineage(user);
    const st = ensureLineageStore(getEvolutionRootId(user.actorId()));
    const rate = st.ls || 0;
    if (rate <= 0) return;
    const heal = Math.floor(value * rate);
    if (heal > 0) user.gainHp(heal);
  };

  //---------------------------------------------------------------------------
  // Game_System : conteneur des bonus (sauvegarde)
  //---------------------------------------------------------------------------

  const _Game_System_initialize = Game_System.prototype.initialize;
  Game_System.prototype.initialize = function() {
    _Game_System_initialize.call(this);
    this._cbnLineageGrowth = {};
  };

  //---------------------------------------------------------------------------
  // Réinitialisation totale + hooks Game Over / défaite hub
  //---------------------------------------------------------------------------

  function resetAllGrowthBonuses() {
    window._cbnEvolutionParentByChild = null;
    if ($gameSystem) {
      $gameSystem._cbnLineageGrowth = {};
    }
    if ($gameActors && $gameActors._data) {
      for (let i = 0; i < $gameActors._data.length; i++) {
        const a = $gameActors._data[i];
        if (!a) continue;
        a._cbnStatGrowth = [0, 0, 0, 0, 0, 0, 0, 0];
        a._cbnXparamGrowth = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        a._cbnLifeStealRate = 0;
        a._cbnLegacyGrowthMerged = false;
        if (a.refresh) a.refresh();
      }
    }
  }

  window.cbnActorStatGrowthChoiceReset = resetAllGrowthBonuses;

  if (RESET_BONUSES_ON_VANILLA_GAME_OVER) {
    const _Scene_Gameover_start = Scene_Gameover.prototype.start;
    Scene_Gameover.prototype.start = function() {
      resetAllGrowthBonuses();
      _Scene_Gameover_start.call(this);
    };
  }

  //---------------------------------------------------------------------------
  // Résolution acteur cible
  //---------------------------------------------------------------------------

  function resolveTargetActor(mode, variableId) {
    const m = mode || DEFAULT_TARGET;
    if (m === "leader") {
      return $gameParty.leader() || null;
    }
    if (m === "variable") {
      const vid = variableId > 0 ? variableId : DEFAULT_ACTOR_VAR;
      const id = $gameVariables.value(vid);
      const aid = Number(id);
      if (!Number.isInteger(aid) || aid <= 0) return null;
      if (!$gameParty.allMembers().some(a => a && a.actorId() === aid)) return null;
      return $gameActors.actor(aid);
    }
    return $gameParty.menuActor() || $gameParty.leader() || null;
  }

  //---------------------------------------------------------------------------
  // Scène + fenêtre
  //---------------------------------------------------------------------------

  function isStatGrowthSceneActive() {
    const scene = SceneManager._scene;
    return !!scene && scene.constructor === Scene_StatGrowthChoice;
  }

  const _Game_Interpreter_updateWaitMode = Game_Interpreter.prototype.updateWaitMode;
  Game_Interpreter.prototype.updateWaitMode = function() {
    if (this._waitMode === WAIT_MODE) {
      if (isStatGrowthSceneActive()) {
        return true;
      }
      this._waitMode = "";
      return false;
    }
    return _Game_Interpreter_updateWaitMode.call(this);
  };

  function Window_StatGrowthChoice() {
    this.initialize(...arguments);
  }

  Window_StatGrowthChoice.prototype = Object.create(Window_Selectable.prototype);
  Window_StatGrowthChoice.prototype.constructor = Window_StatGrowthChoice;

  Window_StatGrowthChoice.prototype.initialize = function(rect) {
    Window_Selectable.prototype.initialize.call(this, rect);
    this._choices = [];
    this.refresh();
  };

  Window_StatGrowthChoice.prototype.setChoices = function(choices) {
    this._choices = choices || [];
    this.refresh();
    this.select(0);
  };

  Window_StatGrowthChoice.prototype.maxItems = function() {
    return this._choices.length;
  };

  Window_StatGrowthChoice.prototype.item = function() {
    return this._choices[this.index()];
  };

  Window_StatGrowthChoice.prototype.drawItem = function(index) {
    const ch = this._choices[index];
    if (!ch) return;
    const rect = this.itemLineRect(index);
    this.drawText(ch.label, rect.x, rect.y, rect.width);
  };

  function Scene_StatGrowthChoice() {
    this.initialize(...arguments);
  }

  Scene_StatGrowthChoice.prototype = Object.create(Scene_MenuBase.prototype);
  Scene_StatGrowthChoice.prototype.constructor = Scene_StatGrowthChoice;

  Scene_StatGrowthChoice.prototype.initialize = function() {
    Scene_MenuBase.prototype.initialize.call(this);
    this._targetActor = _pendingStatChoiceActor;
    this._pickedChoices = (_pendingStatChoices || []).slice();
    _pendingStatChoiceActor = null;
    _pendingStatChoices = null;
  };

  Scene_StatGrowthChoice.prototype.create = function() {
    Scene_MenuBase.prototype.create.call(this);
    this.createHelpWindow();
    this.createChoiceWindow();
    if (this._cancelButton) {
      this._cancelButton.setClickHandler(this.onChoiceCancel.bind(this));
    }
  };

  Scene_StatGrowthChoice.prototype.start = function() {
    Scene_MenuBase.prototype.start.call(this);
    const actor = this._targetActor;
    if (!actor || !this._pickedChoices.length) {
      SoundManager.playBuzzer();
      this.popScene();
      return;
    }
    const name = actor.name();
    this._helpWindow.setText(HELP_TEXT.replace("%1", name));
    this._choiceWindow.setChoices(this._pickedChoices);
    this._choiceWindow.activate();
    this._choiceWindow.select(0);
  };

  Scene_StatGrowthChoice.prototype.choiceWindowRect = function() {
    const ww = Math.min(Graphics.boxWidth - 48, 560);
    const lines = Math.max(1, this._pickedChoices.length);
    const wh = this.calcWindowHeight(lines, true);
    const wx = (Graphics.boxWidth - ww) / 2;
    const wy = this.mainAreaTop() + 16;
    return new Rectangle(wx, wy, ww, wh);
  };

  Scene_StatGrowthChoice.prototype.createChoiceWindow = function() {
    const rect = this.choiceWindowRect();
    this._choiceWindow = new Window_StatGrowthChoice(rect);
    this._choiceWindow.setHandler("ok", this.onChoiceOk.bind(this));
    this._choiceWindow.setHandler("cancel", this.onChoiceCancel.bind(this));
    this.addWindow(this._choiceWindow);
  };

  Scene_StatGrowthChoice.prototype.onChoiceOk = function() {
    const item = this._choiceWindow.item();
    const actor = this._targetActor;
    const index = this._choiceWindow.index();
    if (!item || !actor) {
      this.onChoiceCancel();
      return;
    }
    applyGrowthChoice(actor, item);
    if (RESULT_VAR_ID > 0) {
      $gameVariables.setValue(RESULT_VAR_ID, index);
    }
    SoundManager.playOk();
    this.popScene();
  };

  Scene_StatGrowthChoice.prototype.onChoiceCancel = function() {
    SoundManager.playCancel();
    if (RESULT_VAR_ID > 0) {
      $gameVariables.setValue(RESULT_VAR_ID, -1);
    }
    this.popScene();
  };

  //---------------------------------------------------------------------------
  // API commande plugin
  //---------------------------------------------------------------------------

  function attachInterpreterWait(interpreter) {
    if (interpreter && interpreter.setWaitMode) {
      interpreter.setWaitMode(WAIT_MODE);
    } else if ($gameMap && $gameMap._interpreter && $gameMap._interpreter.setWaitMode) {
      $gameMap._interpreter.setWaitMode(WAIT_MODE);
    }
  }

  function openStatChoiceScene(interpreter, options) {
    patchEvolutionParty();
    const opt = options || {};
    const mode = opt.actorTargetMode != null && opt.actorTargetMode !== "" ? opt.actorTargetMode : null;
    const varId = Number(opt.actorVariableId) || 0;
    const pool =
      opt.choicePoolJson && String(opt.choicePoolJson).trim()
        ? parseChoicePoolJson(opt.choicePoolJson)
        : defaultPool();
    const actor = resolveTargetActor(mode, varId);
    const three = shuffleAndPickThree(pool.length > 0 ? pool : fallbackPool());
    _pendingStatChoiceActor = actor;
    _pendingStatChoices = three;
    attachInterpreterWait(interpreter);
    SceneManager.push(Scene_StatGrowthChoice);
  }

  PluginManager.registerCommand(PLUGIN_NAME, "openStatChoice", function(args) {
    openStatChoiceScene(this, {
      actorTargetMode: args.actorTargetMode,
      actorVariableId: args.actorVariableId,
      choicePoolJson: args.choicePoolJson
    });
  });

  PluginManager.registerCommand(PLUGIN_NAME, "resetAllGrowthBonuses", function() {
    resetAllGrowthBonuses();
  });

  window.ActorStatGrowthChoice = {
    open: openStatChoiceScene,
    addStatGrowth,
    addXparamGrowth,
    addLifeStealGrowth,
    applyGrowthChoice,
    resetAllGrowthBonuses,
    getEvolutionRootId,
    ensureLineageStore,
    parseChoicePoolJson,
    defaultPool,
    WAIT_MODE
  };
})();
