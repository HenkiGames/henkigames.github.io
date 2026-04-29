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
 * @command openStateChoice
 * @text Ouvrir le choix d'états (1 parmi 3)
 * @desc Affiche 3 cartes d'états tirées depuis stateIds. Le choix applique l'état à l'acteur cible.
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
 * @arg stateIds
 * @text IDs états (obligatoire)
 * @type string
 * @default
 * @desc CSV ou JSON. Ex: 10,11,12,13 ou [10,11,12,13]
 *
 * @command resetChosenStates
 * @text Réinitialiser les états choisis persistants
 * @desc Vide la mémoire des états choisis via openStateChoice (réappliqués au start SRPG).
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
  let _pendingStateChoices = null;

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

  function shuffleAndPick(pool, count) {
    const src = pool.slice();
    for (let i = src.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = src[i];
      src[i] = src[j];
      src[j] = t;
    }
    const wanted = Number.isInteger(count) && count > 0 ? count : 1;
    const n = Math.min(wanted, src.length);
    return src.slice(0, n);
  }

  function shuffleAndPickThree(pool) {
    return shuffleAndPick(pool, 3);
  }

  function parseIdListFlexible(rawValue) {
    if (!rawValue) return [];
    try {
      const parsed = JSON.parse(String(rawValue));
      if (Array.isArray(parsed)) {
        return parsed.map(Number).filter(id => Number.isInteger(id) && id > 0);
      }
      if (typeof parsed === "number") {
        return Number.isInteger(parsed) && parsed > 0 ? [parsed] : [];
      }
      if (typeof parsed === "string") {
        return parsed
          .split(",")
          .map(s => Number(s.trim()))
          .filter(id => Number.isInteger(id) && id > 0);
      }
    } catch (_e) {
      // fallback CSV
    }
    return String(rawValue)
      .split(",")
      .map(s => Number(s.trim()))
      .filter(id => Number.isInteger(id) && id > 0);
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

  function ensurePersistentChosenStatesRoot() {
    if (!$gameSystem) return;
    if (
      !$gameSystem._cbnPersistentChosenStatesByRoot ||
      typeof $gameSystem._cbnPersistentChosenStatesByRoot !== "object"
    ) {
      $gameSystem._cbnPersistentChosenStatesByRoot = {};
    }
  }

  function getPersistentChosenStatesForRoot(rootId) {
    ensurePersistentChosenStatesRoot();
    const key = String(rootId);
    const store = $gameSystem._cbnPersistentChosenStatesByRoot;
    if (!Array.isArray(store[key])) {
      store[key] = [];
    }
    return store[key];
  }

  function rememberChosenStateForActor(actor, stateId) {
    if (!actor || !Number.isInteger(stateId) || stateId <= 0) return;
    if (!$dataStates || !$dataStates[stateId]) return;
    const rootId = getEvolutionRootId(actor.actorId());
    const list = getPersistentChosenStatesForRoot(rootId);
    if (!list.includes(stateId)) {
      list.push(stateId);
    }
  }

  function applyPersistentChosenStatesToActor(actor) {
    if (!actor) return;
    const rootId = getEvolutionRootId(actor.actorId());
    const list = getPersistentChosenStatesForRoot(rootId);
    for (const stateId of list) {
      if (!Number.isInteger(stateId) || stateId <= 0) continue;
      if (!$dataStates || !$dataStates[stateId]) continue;
      actor.addState(stateId);
    }
  }

  function reapplyPersistentChosenStatesOnSrpgStart() {
    if (!$gameParty || typeof $gameParty.allMembers !== "function") return;
    const members = $gameParty.allMembers();
    for (const actor of members) {
      if (!actor || !actor.isActor || !actor.isActor()) continue;
      applyPersistentChosenStatesToActor(actor);
      actor.refresh();
    }
  }

  function resetPersistentChosenStates() {
    if ($gameSystem) {
      $gameSystem._cbnPersistentChosenStatesByRoot = {};
    }
  }

  function extractStateDescription(stateData) {
    if (!stateData) return "";
    const note = String(stateData.note || "");
    const explicitMatch = note.match(/<description\s*:\s*([^>]+)>/i);
    if (explicitMatch && explicitMatch[1]) {
      return String(explicitMatch[1]).trim();
    }
    const noteWithoutTags = note.replace(/<[^>]*>/g, "");
    const lines = noteWithoutTags
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);
    return lines.slice(0, 2).join("\n");
  }

  function parseStateChoicePool(rawStateIds) {
    const ids = parseIdListFlexible(rawStateIds);
    const seen = new Set();
    const out = [];
    for (const stateId of ids) {
      if (seen.has(stateId)) continue;
      seen.add(stateId);
      const stateData = $dataStates[stateId];
      if (!stateData) continue;
      out.push({
        stateId,
        title: String(stateData.name || `État ${stateId}`),
        description: extractStateDescription(stateData),
        iconIndex: Number(stateData.iconIndex || 0)
      });
    }
    return out;
  }

  function removeAlreadyChosenStatesForActor(actor, pool) {
    if (!actor || !actor.isActor || !actor.isActor()) return pool.slice();
    if (!Array.isArray(pool) || pool.length === 0) return [];
    const rootId = getEvolutionRootId(actor.actorId());
    const chosen = new Set(getPersistentChosenStatesForRoot(rootId));
    return pool.filter(entry => entry && !chosen.has(Number(entry.stateId)));
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

  function lineageParamBonus(actor, paramId) {
    if (!actor || !actor.isActor || !actor.isActor()) return 0;
    if (!Number.isInteger(paramId) || paramId < 0 || paramId > 7) return 0;
    migrateLegacyInstanceToLineage(actor);
    const st = ensureLineageStore(getEvolutionRootId(actor.actorId()));
    return Number(st.s[paramId] || 0);
  }

  function lineageXparamBonus(actor, xparamId) {
    if (!actor || !actor.isActor || !actor.isActor()) return 0;
    if (!Number.isInteger(xparamId) || xparamId < 0 || xparamId > 9) return 0;
    migrateLegacyInstanceToLineage(actor);
    const st = ensureLineageStore(getEvolutionRootId(actor.actorId()));
    return Number(st.x[xparamId] || 0);
  }

  function lineageLifeStealRate(actor) {
    if (!actor || !actor.isActor || !actor.isActor()) return 0;
    migrateLegacyInstanceToLineage(actor);
    const st = ensureLineageStore(getEvolutionRootId(actor.actorId()));
    return Number(st.ls || 0);
  }

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
    this._cbnPersistentChosenStatesByRoot = {};
  };

  const _Game_System_startSRPG_cbnStateChoice = Game_System.prototype.startSRPG;
  Game_System.prototype.startSRPG = function() {
    _Game_System_startSRPG_cbnStateChoice.call(this);
    reapplyPersistentChosenStatesOnSrpgStart();
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

  function Window_StatGrowthActorStats() {
    this.initialize(...arguments);
  }

  Window_StatGrowthActorStats.prototype = Object.create(Window_Base.prototype);
  Window_StatGrowthActorStats.prototype.constructor = Window_StatGrowthActorStats;

  Window_StatGrowthActorStats.prototype.initialize = function(rect) {
    Window_Base.prototype.initialize.call(this, rect);
    this._actor = null;
    this._title = "";
    this.refresh();
  };

  Window_StatGrowthActorStats.prototype.setTitle = function(title) {
    this._title = String(title || "");
    this.refresh();
  };

  Window_StatGrowthActorStats.prototype.setActor = function(actor) {
    this._actor = actor || null;
    this.refresh();
  };

  Window_StatGrowthActorStats.prototype.makeRows = function() {
    const actor = this._actor;
    if (!actor) return [];
    const hpBonus = lineageParamBonus(actor, 0) + flatStateParamBonus(actor, 0);
    const atkBonus = lineageParamBonus(actor, 2) + flatStateParamBonus(actor, 2);
    const matBonus = lineageParamBonus(actor, 4) + flatStateParamBonus(actor, 4);
    const defBonus = lineageParamBonus(actor, 3) + flatStateParamBonus(actor, 3);
    const mdfBonus = lineageParamBonus(actor, 5) + flatStateParamBonus(actor, 5);
    const critBonus = lineageXparamBonus(actor, 2);
    const lsRate = lineageLifeStealRate(actor);
    return [
      { name: TextManager.param(0), value: String(actor.mhp), bonus: hpBonus },
      { name: TextManager.param(2), value: String(actor.atk), bonus: atkBonus },
      { name: TextManager.param(4), value: String(actor.mat), bonus: matBonus },
      { name: TextManager.param(3), value: String(actor.def), bonus: defBonus },
      { name: TextManager.param(5), value: String(actor.mdf), bonus: mdfBonus },
      { name: "CC", value: formatPercent(actor.xparam(2)), bonus: critBonus, percentBonus: true },
      { name: "VdV", value: formatPercent(lsRate), bonus: lsRate, percentBonus: true }
    ];
  };

  Window_StatGrowthActorStats.prototype.drawRow = function(row, x, y, width) {
    const valueX = x + Math.max(70, width - 110);
    this.changeTextColor(ColorManager.systemColor());
    this.drawText(row.name, x, y, Math.max(48, valueX - x - 6), "left");
    this.resetTextColor();
    this.drawText(row.value, valueX, y, 56, "right");
    if (Number.isFinite(row.bonus) && row.bonus !== 0) {
      const sign = row.bonus > 0 ? "+" : "";
      const bonusValue = row.percentBonus ? formatPercent(row.bonus) : String(row.bonus);
      const bonusText = `(${sign}${bonusValue})`;
      this.changeTextColor(ColorManager.powerUpColor());
      this.drawText(bonusText, valueX + 60, y, Math.max(50, x + width - (valueX + 60)), "right");
      this.resetTextColor();
    }
  };

  Window_StatGrowthActorStats.prototype.refresh = function() {
    this.contents.clear();
    const rows = this.makeRows();
    const lineHeight = this.lineHeight();
    let topY = 0;
    if (this._title) {
      this.changeTextColor(ColorManager.systemColor());
      this.drawText(this._title, 0, 0, this.innerWidth, "left");
      this.resetTextColor();
      topY = lineHeight + 4;
    }
    const colGap = 16;
    const colWidth = Math.floor((this.innerWidth - colGap) / 2);
    const availableHeight = Math.max(lineHeight, this.innerHeight - topY);
    const maxLines = Math.max(1, Math.floor(availableHeight / lineHeight));
    const maxItems = Math.min(rows.length, maxLines * 2);
    for (let i = 0; i < maxItems; i++) {
      const col = Math.floor(i / maxLines);
      const row = i % maxLines;
      const x = col * (colWidth + colGap);
      this.drawRow(rows[i], x, topY + row * lineHeight, colWidth);
    }
  };

  function Window_StatGrowthMessage() {
    this.initialize(...arguments);
  }

  Window_StatGrowthMessage.prototype = Object.create(Window_Base.prototype);
  Window_StatGrowthMessage.prototype.constructor = Window_StatGrowthMessage;

  Window_StatGrowthMessage.prototype.initialize = function(rect) {
    Window_Base.prototype.initialize.call(this, rect);
    this._text = "";
    this.refresh();
  };

  Window_StatGrowthMessage.prototype.setText = function(text) {
    this._text = String(text || "");
    this.refresh();
  };

  Window_StatGrowthMessage.prototype.refresh = function() {
    this.contents.clear();
    this.resetTextColor();
    this.drawText(this._text, 0, 0, this.innerWidth, "left");
  };

  function Window_StateChoiceCards() {
    this.initialize(...arguments);
  }

  Window_StateChoiceCards.prototype = Object.create(Window_Selectable.prototype);
  Window_StateChoiceCards.prototype.constructor = Window_StateChoiceCards;

  Window_StateChoiceCards.prototype.initialize = function(rect) {
    this._choices = [];
    Window_Selectable.prototype.initialize.call(this, rect);
    this.refresh();
  };

  Window_StateChoiceCards.prototype.setChoices = function(choices) {
    this._choices = choices || [];
    this.refresh();
    this.select(0);
  };

  Window_StateChoiceCards.prototype.maxItems = function() {
    return this._choices.length;
  };

  Window_StateChoiceCards.prototype.maxCols = function() {
    return 1;
  };

  Window_StateChoiceCards.prototype.rowSpacing = function() {
    return 10;
  };

  Window_StateChoiceCards.prototype.itemWidth = function() {
    return this.innerWidth;
  };

  Window_StateChoiceCards.prototype.itemHeight = function() {
    const count = Math.max(1, this.maxItems());
    const totalSpacing = this.rowSpacing() * Math.max(0, count - 1);
    const byAvailableSpace = Math.floor((this.innerHeight - totalSpacing) / count);
    const minForThreeDescLines = this.lineHeight() * 4 + 26; // 1 ligne titre + 3 lignes desc + marges
    return Math.max(minForThreeDescLines, byAvailableSpace);
  };

  Window_StateChoiceCards.prototype.item = function() {
    return this._choices[this.index()];
  };

  Window_StateChoiceCards.prototype.wrapCardText = function(text, maxWidth, maxLines) {
    const source = String(text || "").replace(/\r/g, "");
    const paragraphs = source.split("\n");
    const lines = [];

    for (const paragraph of paragraphs) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        lines.push("");
        if (lines.length >= maxLines) break;
        continue;
      }

      let current = "";
      for (const word of words) {
        const next = current ? `${current} ${word}` : word;
        if (this.textWidth(next) <= maxWidth) {
          current = next;
          continue;
        }

        if (current) {
          lines.push(current);
          if (lines.length >= maxLines) break;
          current = word;
          if (this.textWidth(current) <= maxWidth) continue;
        }

        // Mot plus large que la carte : découpe caractère par caractère.
        let chunk = "";
        for (const char of word) {
          const trial = chunk + char;
          if (this.textWidth(trial) <= maxWidth) {
            chunk = trial;
          } else {
            if (chunk) {
              lines.push(chunk);
              if (lines.length >= maxLines) break;
            }
            chunk = char;
          }
        }
        if (lines.length >= maxLines) break;
        current = chunk;
      }

      if (lines.length >= maxLines) break;
      if (current) {
        lines.push(current);
        if (lines.length >= maxLines) break;
      }
    }

    if (lines.length > maxLines) {
      lines.length = maxLines;
    }
    return lines;
  };

  Window_StateChoiceCards.prototype.drawWrappedCardText = function(text, x, y, width, maxLines) {
    const lines = this.wrapCardText(text, width, maxLines);
    for (let i = 0; i < lines.length; i++) {
      this.drawText(lines[i], x, y + i * this.lineHeight(), width, "left");
    }
  };

  Window_StateChoiceCards.prototype.drawItem = function(index) {
    const ch = this._choices[index];
    if (!ch) return;
    const rect = this.itemRect(index);
    const pad = 8;
    const x = rect.x + pad;
    const y = rect.y + pad;
    const w = rect.width - pad * 2;
    const h = rect.height - pad * 2;

    this.contents.fillRect(x, y, w, h, "rgba(20, 20, 24, 0.78)");
    this.contents.strokeRect(x, y, w, h, "rgba(255, 255, 255, 0.75)");
    this.changeTextColor(ColorManager.systemColor());
    const titleText = `${String(ch.title || "")} :`;
    const iconIndex = Number(ch.iconIndex || 0);
    const hasIcon = iconIndex > 0;
    const titleTextW = this.textWidth(titleText);
    const iconW = hasIcon ? ImageManager.iconWidth : 0;
    const gap = hasIcon ? 6 : 0;
    const combinedW = titleTextW + gap + iconW;
    const blockStartX = x + 10;
    const titleY = y + 6;
    if (hasIcon) {
      const iconX = blockStartX;
      const iconY = titleY + Math.floor((this.lineHeight() - ImageManager.iconHeight) / 2);
      this.drawIcon(iconIndex, iconX, iconY);
      this.drawText(titleText, blockStartX + iconW + gap, titleY, w - 24 - iconW - gap, "left");
    } else {
      this.drawText(titleText, blockStartX, titleY, w - 24, "left");
    }
    this.resetTextColor();

    const descY = y + this.lineHeight() + 14;
    const desc = ch.description && ch.description.trim()
      ? ch.description
      : "Aucune description.";
    const textX = x + 10;
    const textW = w - 20;
    const maxDescLines = Math.max(2, Math.floor((h - (descY - y) - 8) / this.lineHeight()));
    this.drawWrappedCardText(desc, textX, descY, textW, maxDescLines);
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
    this.createChoiceWindow();
    this.createBottomMessageWindow();
    this.createActorStatsWindow();
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
    this._actorStatsWindow.setTitle("Statistiques actuelles");
    this._actorStatsWindow.setActor(actor);
    this._bottomMessageWindow.setText("Choisissez une amélioration pour Riolu");
    this._choiceWindow.setChoices(this._pickedChoices);
    this._choiceWindow.activate();
    this._choiceWindow.select(0);
  };

  Scene_StatGrowthChoice.prototype.actorStatsWindowRect = function() {
    const ww = Math.min(Graphics.boxWidth - 48, 560);
    const desiredStatsWh = this.calcWindowHeight(5, false);
    const minStatsWh = this.calcWindowHeight(3, false);
    const wx = (Graphics.boxWidth - ww) / 2;
    const wy = this._choiceWindow.y + this._choiceWindow.height + 8;
    const areaBottom = this._bottomMessageWindow ? this._bottomMessageWindow.y - 8 : this.mainAreaBottom();
    const available = areaBottom - wy;
    const wh = Math.max(minStatsWh, Math.min(desiredStatsWh, available));
    return new Rectangle(wx, wy, ww, wh);
  };

  Scene_StatGrowthChoice.prototype.choiceWindowRect = function() {
    const ww = Math.min(Graphics.boxWidth - 48, 560);
    const lines = Math.max(1, this._pickedChoices.length);
    const wh = this.calcWindowHeight(lines, true);
    const wx = (Graphics.boxWidth - ww) / 2;
    const wy = this.mainAreaTop() + 16;
    return new Rectangle(wx, wy, ww, wh);
  };

  Scene_StatGrowthChoice.prototype.createActorStatsWindow = function() {
    const rect = this.actorStatsWindowRect();
    this._actorStatsWindow = new Window_StatGrowthActorStats(rect);
    this.addWindow(this._actorStatsWindow);
  };

  Scene_StatGrowthChoice.prototype.bottomMessageWindowRect = function() {
    const ww = Math.min(Graphics.boxWidth - 48, 560);
    const wh = this.calcWindowHeight(1, false);
    const wx = (Graphics.boxWidth - ww) / 2;
    const wy = this.mainAreaBottom() - wh;
    return new Rectangle(wx, wy, ww, wh);
  };

  Scene_StatGrowthChoice.prototype.createBottomMessageWindow = function() {
    const rect = this.bottomMessageWindowRect();
    this._bottomMessageWindow = new Window_StatGrowthMessage(rect);
    this.addWindow(this._bottomMessageWindow);
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
  // UI Statut : afficher les bonus de stats sélectionnées
  //---------------------------------------------------------------------------

  function formatPercent(rate) {
    const pct = Math.round((Number(rate) || 0) * 10000) / 100;
    return `${pct}%`;
  }

  function flatStateParamBonus(actor, paramId) {
    if (!actor || !window.CbnFlatStatBuffs || !window.CbnFlatStatBuffs.flatBonusForParam) {
      return 0;
    }
    const value = window.CbnFlatStatBuffs.flatBonusForParam(actor, paramId);
    return Number.isFinite(value) ? value : 0;
  }

  function battleExchangeSkillDescriptionForActor(actor) {
    if (!actor || !$gameVariables || $gameVariables.value(114) !== 5) return "";
    const actorData = actor.actor ? actor.actor() : null;
    if (!actorData || !actorData.meta) return "";
    const skillId = Number(actorData.meta.battleExchangeSkillId || 0);
    if (!(skillId > 0)) return "";
    const skill = $dataSkills && $dataSkills[skillId];
    if (!skill || !skill.description) return "";
    return String(skill.description).trim();
  }

  function drawWrappedLines(window, text, x, y, width, maxLines) {
    if (!text || width <= 0 || maxLines <= 0) return;
    const normalized = String(text).replace(/\r\n/g, "\n");
    const paragraphs = normalized.split("\n");
    const lines = [];
    for (const paragraph of paragraphs) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        lines.push("");
      } else {
        let line = words[0];
        for (let i = 1; i < words.length; i++) {
          const candidate = line + " " + words[i];
          if (window.textWidth(candidate) <= width) {
            line = candidate;
          } else {
            lines.push(line);
            line = words[i];
          }
        }
        lines.push(line);
      }
      if (lines.length >= maxLines) break;
    }
    const lineHeight = window.lineHeight();
    const count = Math.min(lines.length, maxLines);
    for (let i = 0; i < count; i++) {
      window.drawText(lines[i], x, y + lineHeight * i, width, "left");
    }
  }

  const _Window_Status_drawBasicInfo_cbnGrowth = Window_Status.prototype.drawBasicInfo;
  Window_Status.prototype.drawBasicInfo = function(x, y) {
    _Window_Status_drawBasicInfo_cbnGrowth.call(this, x, y);
    if (!this._actor) return;
    const hpBonus = lineageParamBonus(this._actor, 0) + flatStateParamBonus(this._actor, 0);
    if (!Number.isFinite(hpBonus) || hpBonus === 0) return;
    const lineHeight = this.lineHeight();
    const sign = hpBonus > 0 ? "+" : "";
    const bonusText = `(${sign}${hpBonus})`;
    this.changeTextColor(ColorManager.powerUpColor());
    // Aligne le bonus sur la ligne HP des jauges dans la fenetre de statut.
    this.drawText(bonusText, x + 190, y + lineHeight * 2, 120, "right");
    this.resetTextColor();
  };

  Window_Status.prototype.drawBlock2 = function() {
    const y = this.block2Y();
    this.drawActorFace(this._actor, 12, y);
    // On conserve uniquement les infos de base (niveau, icones, jauges).
    // Les blocs "Total XP" et "Prochain niveau" sont volontairement supprimes.
    this.drawBasicInfo(204, y);
    const desc = battleExchangeSkillDescriptionForActor(this._actor);
    if (!desc) return;
    const x = 430;
    const width = Math.max(120, this.innerWidth - x - 12);
    const title = "Passif d'echange";
    const top = y + this.lineHeight() * 0;
    const maxLines = 6;
    this.resetTextColor();
    this.changeTextColor(ColorManager.systemColor());
    this.drawText(title, x, top, width, "left");
    this.resetTextColor();
    drawWrappedLines(this, desc, x, top + this.lineHeight(), width, maxLines);
  };

  Window_StatusParams.prototype.drawItem = function(index) {
    if (!this._actor) return;

    const rect = this.itemLineRect(index);
    let name = "";
    let value = "";
    let bonusText = "";

    if (index <= 3) {
      const paramId = index + 2; // ATK, DEF, MAT, MDF
      const paramValue = this._actor.param(paramId);
      const bonus = lineageParamBonus(this._actor, paramId) + flatStateParamBonus(this._actor, paramId);
      name = TextManager.param(paramId);
      value = String(paramValue);
      if (Number.isFinite(bonus) && bonus !== 0) {
        const sign = bonus > 0 ? "+" : "";
        bonusText = `(${sign}${bonus})`;
      }
    } else if (index === 4) {
      const lsRate = lineageLifeStealRate(this._actor);
      name = "Vol de vie";
      value = formatPercent(lsRate);
    } else if (index === 5) {
      const critTotal = this._actor.xparam(2);
      const critBonus = lineageXparamBonus(this._actor, 2);
      name = "CC";
      value = formatPercent(critTotal);
      if (Number.isFinite(critBonus) && critBonus !== 0) {
        const sign = critBonus > 0 ? "+" : "";
        bonusText = `(${sign}${formatPercent(critBonus)})`;
      }
    }

    this.changeTextColor(ColorManager.systemColor());
    this.drawText(name, rect.x, rect.y, 160);
    this.resetTextColor();
    this.drawText(value, rect.x + 160, rect.y, 70, "right");
    if (bonusText) {
      this.changeTextColor(ColorManager.powerUpColor());
      this.drawText(bonusText, rect.x + 235, rect.y, 110, "left");
      this.resetTextColor();
    }
  };

  //---------------------------------------------------------------------------
  // UI Statut : élargir la colonne stats + afficher les compétences à droite
  //---------------------------------------------------------------------------

  function Window_StatusAllSkills() {
    this.initialize(...arguments);
  }

  Window_StatusAllSkills.prototype = Object.create(Window_SkillList.prototype);
  Window_StatusAllSkills.prototype.constructor = Window_StatusAllSkills;

  Window_StatusAllSkills.prototype.initialize = function(rect) {
    Window_SkillList.prototype.initialize.call(this, rect);
    this._actor = null;
  };

  Window_StatusAllSkills.prototype.includes = function(item) {
    return !!item;
  };

  Window_StatusAllSkills.prototype.isEnabled = function(/*item*/) {
    return true;
  };

  const _Scene_Status_statusParamsWidth = Scene_Status.prototype.statusParamsWidth;
  Scene_Status.prototype.statusParamsWidth = function() {
    const base = _Scene_Status_statusParamsWidth.call(this);
    return base + 40;
  };

  const _Scene_Status_profileHeight = Scene_Status.prototype.profileHeight;
  Scene_Status.prototype.profileHeight = function() {
    // Plus de place en bas pour la description des compétences:
    // on réduit le premier bloc et on remonte stats/compétences.
    const base = _Scene_Status_profileHeight.call(this);
    const oneLine = this.calcWindowHeight(1, false) - this.calcWindowHeight(0, false);
    return base + oneLine * 2;
  };

  Scene_Status.prototype.createStatusEquipWindow = function() {
    const rect = this.statusEquipWindowRect();
    this._statusEquipWindow = new Window_StatusAllSkills(rect);
    this._statusEquipWindow.setHelpWindow(this._profileWindow);
    this._statusEquipWindow.setHandler("ok", this.onStatusSkillOk.bind(this));
    this._statusEquipWindow.setHandler("cancel", this.popScene.bind(this));
    this._statusEquipWindow.setHandler("pagedown", this.nextActor.bind(this));
    this._statusEquipWindow.setHandler("pageup", this.previousActor.bind(this));
    this.addWindow(this._statusEquipWindow);
  };

  Scene_Status.prototype.onStatusSkillOk = function() {
    // Fenêtre purement informative : on garde la sélection active pour lire la description.
    if (this._statusEquipWindow) {
      this._statusEquipWindow.activate();
    }
  };

  const _Scene_Status_start = Scene_Status.prototype.start;
  Scene_Status.prototype.start = function() {
    _Scene_Status_start.call(this);
    if (this._statusWindow) this._statusWindow.deactivate();
    if (this._statusEquipWindow) {
      this._statusEquipWindow.activate();
      this._statusEquipWindow.select(0);
    }
  };

  const _Scene_Status_refreshActor = Scene_Status.prototype.refreshActor;
  Scene_Status.prototype.refreshActor = function() {
    _Scene_Status_refreshActor.call(this);
    if (this._statusEquipWindow) {
      this._statusEquipWindow.activate();
      this._statusEquipWindow.select(0);
    }
  };

  const _Scene_Status_onActorChange = Scene_Status.prototype.onActorChange;
  Scene_Status.prototype.onActorChange = function() {
    _Scene_Status_onActorChange.call(this);
    if (this._statusWindow) this._statusWindow.deactivate();
    if (this._statusEquipWindow) {
      this._statusEquipWindow.activate();
      this._statusEquipWindow.select(0);
    }
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
    _pendingStateChoices = null;
    attachInterpreterWait(interpreter);
    SceneManager.push(Scene_StatGrowthChoice);
  }

  function openStateChoiceScene(interpreter, options) {
    patchEvolutionParty();
    const opt = options || {};
    const mode = opt.actorTargetMode != null && opt.actorTargetMode !== "" ? opt.actorTargetMode : null;
    const varId = Number(opt.actorVariableId) || 0;
    const actor = resolveTargetActor(mode, varId);
    const pool = parseStateChoicePool(opt.stateIds);
    const filteredPool = removeAlreadyChosenStatesForActor(actor, pool);
    const three = shuffleAndPick(filteredPool, 3);
    _pendingStatChoiceActor = actor;
    _pendingStatChoices = null;
    _pendingStateChoices = three;
    attachInterpreterWait(interpreter);
    SceneManager.push(Scene_StateChoice);
  }

  function Scene_StateChoice() {
    this.initialize(...arguments);
  }

  Scene_StateChoice.prototype = Object.create(Scene_MenuBase.prototype);
  Scene_StateChoice.prototype.constructor = Scene_StateChoice;

  Scene_StateChoice.prototype.initialize = function() {
    Scene_MenuBase.prototype.initialize.call(this);
    this._targetActor = _pendingStatChoiceActor;
    this._pickedChoices = (_pendingStateChoices || []).slice();
    _pendingStatChoiceActor = null;
    _pendingStateChoices = null;
    _pendingStatChoices = null;
  };

  Scene_StateChoice.prototype.create = function() {
    Scene_MenuBase.prototype.create.call(this);
    this.createHelpWindow();
    this.createChoiceWindow();
    if (this._cancelButton) {
      this._cancelButton.setClickHandler(this.onChoiceCancel.bind(this));
    }
  };

  Scene_StateChoice.prototype.start = function() {
    Scene_MenuBase.prototype.start.call(this);
    const actor = this._targetActor;
    if (!actor || !this._pickedChoices.length) {
      SoundManager.playBuzzer();
      this.popScene();
      return;
    }
    const name = actor.name();
    this._helpWindow.setText(`Choisissez un passif pour ${name}.`);
    this._choiceWindow.setChoices(this._pickedChoices);
    this._choiceWindow.activate();
    this._choiceWindow.select(0);
  };

  Scene_StateChoice.prototype.choiceWindowRect = function() {
    const ww = Graphics.boxWidth - 40;
    const wh = Math.max(320, this.mainAreaHeight() - 8);
    const wx = (Graphics.boxWidth - ww) / 2;
    const wy = this.mainAreaTop() + 8;
    return new Rectangle(wx, wy, ww, wh);
  };

  Scene_StateChoice.prototype.createChoiceWindow = function() {
    const rect = this.choiceWindowRect();
    this._choiceWindow = new Window_StateChoiceCards(rect);
    this._choiceWindow.setHandler("ok", this.onChoiceOk.bind(this));
    this._choiceWindow.setHandler("cancel", this.onChoiceCancel.bind(this));
    this.addWindow(this._choiceWindow);
  };

  Scene_StateChoice.prototype.onChoiceOk = function() {
    const item = this._choiceWindow.item();
    const actor = this._targetActor;
    const index = this._choiceWindow.index();
    if (!item || !actor) {
      this.onChoiceCancel();
      return;
    }
    actor.addState(item.stateId);
    rememberChosenStateForActor(actor, item.stateId);
    actor.refresh();
    if (RESULT_VAR_ID > 0) {
      $gameVariables.setValue(RESULT_VAR_ID, index);
    }
    SoundManager.playOk();
    this.popScene();
  };

  Scene_StateChoice.prototype.onChoiceCancel = function() {
    SoundManager.playCancel();
    if (RESULT_VAR_ID > 0) {
      $gameVariables.setValue(RESULT_VAR_ID, -1);
    }
    this.popScene();
  };

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

  PluginManager.registerCommand(PLUGIN_NAME, "resetChosenStates", function() {
    resetPersistentChosenStates();
  });

  PluginManager.registerCommand(PLUGIN_NAME, "openStateChoice", function(args) {
    openStateChoiceScene(this, {
      actorTargetMode: args.actorTargetMode,
      actorVariableId: args.actorVariableId,
      stateIds: args.stateIds
    });
  });

  window.ActorStatGrowthChoice = {
    open: openStatChoiceScene,
    openStateChoice: openStateChoiceScene,
    addStatGrowth,
    addXparamGrowth,
    addLifeStealGrowth,
    applyGrowthChoice,
    resetAllGrowthBonuses,
    resetPersistentChosenStates,
    rememberChosenStateForActor,
    applyPersistentChosenStatesToActor,
    reapplyPersistentChosenStatesOnSrpgStart,
    lineageParamBonus,
    lineageXparamBonus,
    lineageLifeStealRate,
    getEvolutionRootId,
    ensureLineageStore,
    parseChoicePoolJson,
    defaultPool,
    WAIT_MODE
  };
})();
