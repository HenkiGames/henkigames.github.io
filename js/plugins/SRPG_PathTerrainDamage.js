/*:
 * @target MZ
 * @plugindesc [v1.1] SRPG - Inflige des degats selon les cases traversees pendant un deplacement.
 * @author ChatGPT
 * @base SRPG_core_MZ
 * @orderAfter SRPG_core_MZ
 *
 * @param Terrain Damage List
 * @text Liste degats terrain
 * @type struct<TerrainDamage>[]
 * @default ["{\"tag\":\"3\",\"damage\":\"10\"}"]
 * @desc Pour chaque tag, degats par case + son SE optionnel.
 *
 * @param Affect Actors
 * @type boolean
 * @default true
 * @desc Appliquer les degats aux acteurs.
 *
 * @param Affect Enemies
 * @type boolean
 * @default true
 * @desc Appliquer les degats aux ennemis.
 *
 * @param Minimum HP
 * @type number
 * @min 0
 * @default 1
 * @desc PV minimum apres degats de terrain (1 = ne peut pas tuer).
 *
 * @param Immune Tags Meta Key
 * @type string
 * @default terrainDamageImmuneTags
 * @desc Cle meta pour immunites de tags, ex: <terrainDamageImmuneTags:3,5>
 *
 * @param Global Immunity Meta Key
 * @type string
 * @default terrainDamageImmune
 * @desc Cle meta pour immunite totale, ex: <terrainDamageImmune:true>
 *
 * @param Terrain State List
 * @text Liste etats terrain
 * @type struct<TerrainState>[]
 * @default []
 * @desc Etat applique selon la tuile finale (utile aussi apres une poussee).
 *
 * @param Manual Trace Movement
 * @text Mode hybride trace manuelle
 * @type boolean
 * @default false
 * @desc Si true, en actor_move: deplacement optimise par defaut; maintenir Shift (PC) ou activer le bouton mobile pour tracer case par case.
 *
 * @help
 * Ce plugin suit le chemin SRPG reellement parcouru et applique les degats
 * de terrain lorsque l'action est validee (srpgAfterAction), en fonction
 * des cases traversees.
 *
 * Utilisation:
 * 1) Assignez des Terrain Tags sur vos tuiles (RPG Maker).
 * 2) Configurez "Liste degats terrain" dans ce plugin.
 * 3) Optionnel: immunites via notes:
 *    - Immunite totale:
 *      <terrainDamageImmune:true>
 *    - Immunite a certains tags:
 *      <terrainDamageImmuneTags:2,3,7>
 *
 * Sources meta lues:
 * - Acteur: acteur, classe, equips, states
 * - Ennemi: ennemi, arme SRPG, states
 */

/*~struct~TerrainDamage:
 * @param tag
 * @text Terrain Tag
 * @type number
 * @min 0
 * @max 7
 * @default 0
 *
 * @param damage
 * @text Degats par case
 * @type number
 * @min 0
 * @default 10
 *
 * @param seName
 * @text SE nom
 * @type file
 * @dir audio/se/
 * @default
 *
 * @param seVolume
 * @text SE volume
 * @type number
 * @min 0
 * @max 100
 * @default 90
 *
 * @param sePitch
 * @text SE pitch
 * @type number
 * @min 50
 * @max 150
 * @default 100
 *
 * @param sePan
 * @text SE pan
 * @type number
 * @min -100
 * @max 100
 * @default 0
 */

/*~struct~TerrainState:
 * @param tag
 * @text Terrain Tag
 * @type number
 * @min 0
 * @max 7
 * @default 0
 *
 * @param stateId
 * @text State ID
 * @type state
 * @default 0
 */

(() => {
  "use strict";

  const pluginName = "SRPG_PathTerrainDamage";
  const params = PluginManager.parameters(pluginName);

  const affectActors = String(params["Affect Actors"] || "true") === "true";
  const affectEnemies = String(params["Affect Enemies"] || "true") === "true";
  const minimumHp = Number(params["Minimum HP"] || 1);
  const immuneTagsMetaKey = String(params["Immune Tags Meta Key"] || "terrainDamageImmuneTags");
  const globalImmunityMetaKey = String(params["Global Immunity Meta Key"] || "terrainDamageImmune");
  const manualTraceMovement = String(params["Manual Trace Movement"] || "false") === "true";

  function parseDamageList(raw) {
    const map = {};
    if (!raw) return map;
    let entries = [];
    try {
      entries = JSON.parse(raw);
    } catch (e) {
      return map;
    }
    if (!Array.isArray(entries)) return map;
    entries.forEach((entry) => {
      try {
        const data = JSON.parse(entry);
        const tag = Number(data.tag);
        const damage = Number(data.damage);
        if (Number.isFinite(tag) && tag >= 0 && Number.isFinite(damage) && damage > 0) {
          map[tag] = {
            damage: damage,
            seName: String(data.seName || ""),
            seVolume: Number(data.seVolume || 90),
            sePitch: Number(data.sePitch || 100),
            sePan: Number(data.sePan || 0)
          };
        }
      } catch (e) {
        // Ignore malformed entry
      }
    });
    return map;
  }

  const damageByTag = parseDamageList(params["Terrain Damage List"]);

  function parseStateList(raw) {
    const map = {};
    if (!raw) return map;
    let entries = [];
    try {
      entries = JSON.parse(raw);
    } catch (e) {
      return map;
    }
    if (!Array.isArray(entries)) return map;
    entries.forEach((entry) => {
      try {
        const data = JSON.parse(entry);
        const tag = Number(data.tag);
        const stateId = Number(data.stateId);
        if (Number.isFinite(tag) && tag >= 0 && Number.isFinite(stateId) && stateId > 0) {
          map[tag] = stateId;
        }
      } catch (e) {
        // Ignore malformed entry
      }
    });
    return map;
  }

  const terrainStateByTag = parseStateList(params["Terrain State List"]);
  const terrainStateIds = Object.keys(terrainStateByTag).map((k) => Number(terrainStateByTag[k]));

  function srpgExistActorVarId() {
    const p = PluginManager.parameters("SRPG_core_MZ") || {};
    return Number(p.existActorVarID || 1);
  }

  function markActorPermanentlyRemovedForTerrain(actorId) {
    if (actorId <= 0 || !$gameSystem) return;
    if (!$gameSystem._permanentDeathRemovedActorIds) {
      $gameSystem._permanentDeathRemovedActorIds = [];
    }
    const removed = $gameSystem._permanentDeathRemovedActorIds;
    if (!removed.includes(actorId)) {
      removed.push(actorId);
    }
    if ($gameParty) {
      $gameParty.removeActor(actorId);
    }
  }

  function finalizeActorDeathFromTerrainDamage(event) {
    if (!event || !event._srpgDiedFromTerrainDamage) return;
    event._srpgDiedFromTerrainDamage = false;
    const unitArray = $gameSystem.EventToUnit(event.eventId());
    const battler = unitArray && unitArray[1];
    if (!battler || !battler.isDead() || !battler.isActor || !battler.isActor()) return;
    if (event.isErased()) {
      if ($gameSystem.setEventToUnit) {
        $gameSystem.setEventToUnit(event.eventId(), "null", null);
      }
      return;
    }
    const actorId = battler.actorId();
    SoundManager.playActorCollapse();
    event.erase();
    const vid = srpgExistActorVarId();
    const oldValue = $gameVariables.value(vid);
    $gameVariables.setValue(vid, oldValue - 1);
    markActorPermanentlyRemovedForTerrain(actorId);
    if ($gameSystem.setEventToUnit) {
      $gameSystem.setEventToUnit(event.eventId(), "null", null);
    }
    if ($gameMap.setEventImages) {
      $gameMap.setEventImages();
    }
  }

  function parseTagList(raw) {
    if (!raw) return [];
    return String(raw)
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n >= 0);
  }

  function hasGlobalImmunity(meta) {
    if (!meta) return false;
    return String(meta[globalImmunityMetaKey] || "false") === "true";
  }

  function addImmuneTagsFromMeta(meta, set) {
    if (!meta || !set) return;
    parseTagList(meta[immuneTagsMetaKey]).forEach((tag) => set.add(tag));
  }

  function isBattlerImmuneToAllTerrainDamage(battler) {
    if (!battler) return false;
    if (battler.isActor && battler.isActor()) {
      if (hasGlobalImmunity(battler.actor().meta)) return true;
      if (battler.currentClass && hasGlobalImmunity(battler.currentClass().meta)) return true;
      const equips = battler.equips ? battler.equips() : [];
      for (let i = 0; i < equips.length; i++) {
        if (equips[i] && hasGlobalImmunity(equips[i].meta)) return true;
      }
      const states = battler.states ? battler.states() : [];
      for (let i = 0; i < states.length; i++) {
        if (states[i] && hasGlobalImmunity(states[i].meta)) return true;
      }
    } else if (battler.isEnemy && battler.isEnemy()) {
      if (hasGlobalImmunity(battler.enemy().meta)) return true;
      const weapon = battler.srpgWeaponId ? $dataWeapons[battler.srpgWeaponId()] : null;
      if (weapon && hasGlobalImmunity(weapon.meta)) return true;
      const states = battler.states ? battler.states() : [];
      for (let i = 0; i < states.length; i++) {
        if (states[i] && hasGlobalImmunity(states[i].meta)) return true;
      }
    }
    return false;
  }

  function collectImmuneTags(battler) {
    const set = new Set();
    if (!battler) return set;

    if (battler.isActor && battler.isActor()) {
      addImmuneTagsFromMeta(battler.actor().meta, set);
      if (battler.currentClass) addImmuneTagsFromMeta(battler.currentClass().meta, set);
      const equips = battler.equips ? battler.equips() : [];
      for (let i = 0; i < equips.length; i++) {
        if (equips[i]) addImmuneTagsFromMeta(equips[i].meta, set);
      }
    } else if (battler.isEnemy && battler.isEnemy()) {
      addImmuneTagsFromMeta(battler.enemy().meta, set);
      const weapon = battler.srpgWeaponId ? $dataWeapons[battler.srpgWeaponId()] : null;
      if (weapon) addImmuneTagsFromMeta(weapon.meta, set);
    }

    const states = battler.states ? battler.states() : [];
    for (let i = 0; i < states.length; i++) {
      if (states[i]) addImmuneTagsFromMeta(states[i].meta, set);
    }
    return set;
  }

  function shouldAffectUnit(unitType) {
    if (unitType === "actor") return affectActors;
    if (unitType === "enemy") return affectEnemies;
    return false;
  }

  function computeTraversedDamage(pathTags, immuneTags) {
    let total = 0;
    for (let i = 0; i < pathTags.length; i++) {
      const tag = pathTags[i];
      if (immuneTags.has(tag)) continue;
      const config = damageByTag[tag];
      const damage = config ? Number(config.damage || 0) : 0;
      if (damage > 0) total += damage;
    }
    return total;
  }

  function computeSingleTileDamage(tag, immuneTags) {
    if (tag === null || tag === undefined) return 0;
    if (immuneTags.has(tag)) return 0;
    const config = damageByTag[tag];
    if (!config) return 0;
    return Number(config.damage || 0);
  }

  function findLastDamagingTag(pathTags, immuneTags) {
    for (let i = pathTags.length - 1; i >= 0; i--) {
      const tag = pathTags[i];
      if (immuneTags.has(tag)) continue;
      const config = damageByTag[tag];
      if (config && Number(config.damage || 0) > 0) return tag;
    }
    return null;
  }

  function playTerrainDamageSe(tag) {
    if (tag === null || tag === undefined) return;
    const config = damageByTag[tag];
    if (!config) return;
    const name = String(config.seName || "");
    if (!name) return;
    AudioManager.playSe({
      name: name,
      volume: Number(config.seVolume || 90),
      pitch: Number(config.sePitch || 100),
      pan: Number(config.sePan || 0)
    });
  }

  function refreshTerrainStateForEvent(event, battler) {
    if (!event || !battler) return;
    for (let i = 0; i < terrainStateIds.length; i++) {
      battler.removeState(terrainStateIds[i]);
    }
    const tag = $gameMap.terrainTag(event.posX(), event.posY());
    const stateId = terrainStateByTag[tag];
    if (stateId && battler.isStateAddable && battler.isStateAddable(stateId)) {
      battler.addState(stateId);
    }
  }

  function queueTerrainDamageFromPath(event, battler, pathTags) {
    if (!event || !battler || battler.isDead()) return;
    const unitArray = $gameSystem.EventToUnit(event.eventId());
    if (!unitArray) return;
    const unitType = unitArray[0];
    if (!shouldAffectUnit(unitType)) return;
    if (isBattlerImmuneToAllTerrainDamage(battler)) return;

    const finalTerrainTag = $gameMap.terrainTag(event.posX(), event.posY());
    const immuneTags = collectImmuneTags(battler);
    let rawDamage = computeTraversedDamage(pathTags, immuneTags);
    let playedTag = findLastDamagingTag(pathTags, immuneTags);
    if (pathTags.length <= 0) {
      rawDamage = computeSingleTileDamage(finalTerrainTag, immuneTags);
      playedTag = rawDamage > 0 ? finalTerrainTag : null;
    }
    if (rawDamage <= 0) return;

    const currentPending = Number(event._srpgPendingTerrainDamage || 0);
    event._srpgPendingTerrainDamage = currentPending + rawDamage;
    event._srpgPendingTerrainDamageTag = playedTag;
  }

  const _Game_Event_srpgMoveRouteForce = Game_Event.prototype.srpgMoveRouteForce;
  Game_Event.prototype.srpgMoveRouteForce = function(array) {
    this._srpgTraversedTerrainTags = [];
    if (Array.isArray(array) && array.length > 1) {
      let x = this.posX();
      let y = this.posY();
      for (let i = 1; i < array.length; i++) {
        const d = array[i];
        if (d === 2 || d === 4 || d === 6 || d === 8) {
          x = $gameMap.roundXWithDirection(x, d);
          y = $gameMap.roundYWithDirection(y, d);
          this._srpgTraversedTerrainTags.push($gameMap.terrainTag(x, y));
        }
      }
    }
    _Game_Event_srpgMoveRouteForce.call(this, array);
  };

  const _Game_Event_updateStop = Game_Event.prototype.updateStop;
  Game_Event.prototype.updateStop = function() {
    const collectOnThisTick =
      $gameSystem.isSRPGMode() &&
      this._srpgForceRoute &&
      this._srpgForceRoute.length === 1 &&
      this._srpgForceRoute[0] === 0 &&
      !this.isMoving();

    _Game_Event_updateStop.call(this);

    if (!collectOnThisTick) return;

    const unitArray = $gameSystem.EventToUnit(this.eventId());
    if (!unitArray) return;
    const battler = unitArray[1];
    refreshTerrainStateForEvent(this, battler);
    if (!battler || battler.isDead()) {
      this._srpgTraversedTerrainTags = [];
      return;
    }
    const pathTags = this._srpgTraversedTerrainTags || [];
    queueTerrainDamageFromPath(this, battler, pathTags);
    this._srpgTraversedTerrainTags = [];
  };

  const _Game_Character_srpgTryMove = Game_Character.prototype.srpgTryMove;
  Game_Character.prototype.srpgTryMove = function(dir, distance, type) {
    const startX = this.posX();
    const startY = this.posY();
    const remain = _Game_Character_srpgTryMove.call(this, dir, distance, type);
    if (!$gameSystem.isSRPGMode()) return remain;
    if (!this.eventId || !this.isForcedMovement || !this.isForcedMovement()) return remain;

    const moved = Math.max(0, Number(distance || 0) - Number(remain || 0));
    const pathTags = [];
    let x = startX;
    let y = startY;
    for (let i = 0; i < moved; i++) {
      x = $gameMap.roundXWithDirection(x, dir);
      y = $gameMap.roundYWithDirection(y, dir);
      pathTags.push($gameMap.terrainTag(x, y));
    }

    const unitArray = $gameSystem.EventToUnit(this.eventId());
    if (!unitArray) return remain;
    const battler = unitArray[1];
    refreshTerrainStateForEvent(this, battler);
    queueTerrainDamageFromPath(this, battler, pathTags);
    return remain;
  };

  function applyPendingTerrainDamageForEvent(event) {
    if (!event) return;
    const pendingDamage = Number(event._srpgPendingTerrainDamage || 0);
    if (pendingDamage <= 0) return;

    const unitArray = $gameSystem.EventToUnit(event.eventId());
    if (!unitArray) {
      event._srpgPendingTerrainDamage = null;
      event._srpgPendingTerrainDamageTag = null;
      return;
    }
    const battler = unitArray[1];
    if (!battler || battler.isDead()) {
      event._srpgPendingTerrainDamage = null;
      event._srpgPendingTerrainDamageTag = null;
      return;
    }

    const maxDamage = Math.max(0, battler.hp - Math.max(0, minimumHp));
    const finalDamage = Math.min(pendingDamage, maxDamage);
    const playedTag = event._srpgPendingTerrainDamageTag;
    event._srpgPendingTerrainDamage = null;
    event._srpgPendingTerrainDamageTag = null;
    if (finalDamage <= 0) return;

    battler.gainHp(-finalDamage);
    if (battler.onDamage) battler.onDamage(finalDamage);
    playTerrainDamageSe(playedTag);
    if (battler.startDamagePopup) battler.startDamagePopup();
    battler.refresh();
    if (battler.isDead() && unitArray[0] === "actor") {
      event._srpgDiedFromTerrainDamage = true;
    }
  }

  function clearTerrainDamageTrackingForEvent(event) {
    if (!event) return;
    event._srpgPendingTerrainDamage = null;
    event._srpgPendingTerrainDamageTag = null;
    event._srpgTraversedTerrainTags = [];
    event._srpgDiedFromTerrainDamage = false;
  }

  const _Scene_Map_srpgAfterAction = Scene_Map.prototype.srpgAfterAction;
  Scene_Map.prototype.srpgAfterAction = function() {
    const activeEvent = $gameTemp.activeEvent();
    applyPendingTerrainDamageForEvent(activeEvent);
    _Scene_Map_srpgAfterAction.call(this);
    finalizeActorDeathFromTerrainDamage(activeEvent);
  };

  function queueStandingTerrainDamageForAllActors() {
    for (let i = 1; i <= $gameMap.isMaxEventId(); i++) {
      const event = $gameMap.event(i);
      if (!event || event.isErased() || event.isType() !== "actor") continue;
      const unitArray = $gameSystem.EventToUnit(event.eventId());
      if (!unitArray || unitArray[0] !== "actor") continue;
      const battler = unitArray[1];
      if (!battler || battler.isDead()) continue;
      // Aligne le comportement sur SRPG_core menuActorTurnEnd :
      // ne pas remettre de degats aux acteurs deja termines ce tour.
      if (!battler.canInput || !battler.canInput()) continue;
      if (battler.srpgTurnEnd && battler.srpgTurnEnd()) continue;
      queueTerrainDamageFromPath(event, battler, []);
    }
  }

  const _Scene_Map_menuActorTurnEnd = Scene_Map.prototype.menuActorTurnEnd;
  Scene_Map.prototype.menuActorTurnEnd = function() {
    // Si le joueur finit le tour sans jouer certains acteurs, on applique
    // quand meme les degats de la case sur laquelle ils se trouvent.
    queueStandingTerrainDamageForAllActors();
    _Scene_Map_menuActorTurnEnd.call(this);
  };

  const _Scene_Map_srpgCancelActorMove = Scene_Map.prototype.srpgCancelActorMove;
  Scene_Map.prototype.srpgCancelActorMove = function() {
    const activeEvent = $gameTemp.activeEvent();
    // Annulation du deplacement: supprime toutes les stacks temporaires
    // accumulees pendant la previsualisation.
    clearTerrainDamageTrackingForEvent(activeEvent);
    _Scene_Map_srpgCancelActorMove.call(this);
  };

  const _Scene_Map_selectPreviousActorCommand = Scene_Map.prototype.selectPreviousActorCommand;
  Scene_Map.prototype.selectPreviousActorCommand = function() {
    const activeEvent = $gameTemp.activeEvent();
    // Retour au menu precedent: meme nettoyage que l'annulation de move.
    clearTerrainDamageTrackingForEvent(activeEvent);
    if ($gameTemp && $gameTemp.clearSrpgManualTraceRoute) {
      $gameTemp.clearSrpgManualTraceRoute();
      $gameTemp._srpgManualTraceTouchToggle = false;
    }
    _Scene_Map_selectPreviousActorCommand.call(this);
  };

  // -------- Manual trace movement (optionnel) --------
  function srpgDirectionFromDelta(dx, dy) {
    if (dx === 0 && dy === 1) return 2;
    if (dx === -1 && dy === 0) return 4;
    if (dx === 1 && dy === 0) return 6;
    if (dx === 0 && dy === -1) return 8;
    return 0;
  }

  function srpgPointForRoute(originX, originY, dirs, stepIndex) {
    let x = originX;
    let y = originY;
    const max = Math.min(stepIndex, dirs.length);
    for (let i = 0; i < max; i++) {
      x = $gameMap.roundXWithDirection(x, dirs[i]);
      y = $gameMap.roundYWithDirection(y, dirs[i]);
    }
    return [x, y];
  }

  function srpgBuildActiveRouteFromDirs(originX, originY, dirs) {
    const route = [];
    let x = originX;
    let y = originY;
    for (let i = 0; i < dirs.length; i++) {
      const d = dirs[i];
      const last = i > 0 ? dirs[i - 1] : 0;
      route.push([x, y, d, last]);
      x = $gameMap.roundXWithDirection(x, d);
      y = $gameMap.roundYWithDirection(y, d);
    }
    if (dirs.length > 0) {
      route.push([x, y, 0, dirs[dirs.length - 1]]);
    }
    return route;
  }

  Game_Temp.prototype.clearSrpgManualTraceRoute = function() {
    this._srpgManualTraceEventId = 0;
    this._srpgManualTraceOriginX = 0;
    this._srpgManualTraceOriginY = 0;
    this._srpgManualTraceDirs = [];
    this._activeRoute = null;
  };

  Game_Temp.prototype.isSrpgManualTraceInputActive = function() {
    const keyboardTrace = Input.isPressed("shift");
    const touchTrace = !!this._srpgManualTraceTouchToggle;
    return keyboardTrace || touchTrace;
  };

  Game_Temp.prototype.initSrpgManualTraceRoute = function(event) {
    if (!event) return;
    this._srpgManualTraceEventId = event.eventId();
    this._srpgManualTraceOriginX = event.posX();
    this._srpgManualTraceOriginY = event.posY();
    this._srpgManualTraceDirs = [];
    this._activeRoute = [];
  };

  Game_Temp.prototype.isSrpgManualTraceReady = function(event) {
    return !!event &&
      this._srpgManualTraceEventId === event.eventId() &&
      Array.isArray(this._srpgManualTraceDirs);
  };

  Game_Temp.prototype.srpgManualTraceCurrentPoint = function() {
    if (!Array.isArray(this._srpgManualTraceDirs)) {
      return [this._srpgManualTraceOriginX || 0, this._srpgManualTraceOriginY || 0];
    }
    return srpgPointForRoute(
      this._srpgManualTraceOriginX || 0,
      this._srpgManualTraceOriginY || 0,
      this._srpgManualTraceDirs,
      this._srpgManualTraceDirs.length
    );
  };

  Game_Temp.prototype.refreshSrpgManualTraceVisual = function() {
    const dirs = Array.isArray(this._srpgManualTraceDirs) ? this._srpgManualTraceDirs : [];
    this._activeRoute = srpgBuildActiveRouteFromDirs(
      this._srpgManualTraceOriginX || 0,
      this._srpgManualTraceOriginY || 0,
      dirs
    );
  };

  Game_Temp.prototype.srpgManualTraceRouteArray = function() {
    const dirs = Array.isArray(this._srpgManualTraceDirs) ? this._srpgManualTraceDirs : [];
    return [0].concat(dirs);
  };

  function canUseManualTraceNow() {
    if (!manualTraceMovement) return false;
    if (!$gameSystem || !$gameSystem.isSRPGMode || !$gameSystem.isSRPGMode()) return false;
    if (!$gameSystem.isSubBattlePhase || $gameSystem.isSubBattlePhase() !== "actor_move") return false;
    return $gameTemp && $gameTemp.isSrpgManualTraceInputActive && $gameTemp.isSrpgManualTraceInputActive();
  }

  const _SRPG_PathTerrainDamage_Game_Player_triggerAction = Game_Player.prototype.triggerAction;
  Game_Player.prototype.triggerAction = function() {
    if (canUseManualTraceNow()) {
      const okTriggered = Input.isTriggered("ok") || (TouchInput.isTriggered() && !this.touchOnCancelButton());
      if (!okTriggered) return false;

      const event = $gameTemp.activeEvent ? $gameTemp.activeEvent() : null;
      const battlerArray = event ? $gameSystem.EventToUnit(event.eventId()) : null;
      const battler = battlerArray && battlerArray[1];
      if (!event || !battler) return false;

      if (!$gameTemp.isSrpgManualTraceReady(event)) {
        $gameTemp.initSrpgManualTraceRoute(event);
      }

      const targetX = this._x;
      const targetY = this._y;
      const dirs = $gameTemp._srpgManualTraceDirs;
      const current = $gameTemp.srpgManualTraceCurrentPoint();
      const currentX = current[0];
      const currentY = current[1];

      // Recliquer sur la case courante valide le deplacement.
      if (targetX === currentX && targetY === currentY) {
        if (targetX !== event.posX() || targetY !== event.posY()) {
          if (!$gameSystem.areTheyNoUnits(targetX, targetY)) {
            SoundManager.playBuzzer();
            return true;
          }
        }
        SoundManager.playOk();
        const route = $gameTemp.srpgManualTraceRouteArray();
        $gameSystem.setSrpgWaitMoving(true);
        event.srpgMoveRouteForce(route);
        battler.srpgMakeNewActions();
        battler.setMovedStep(route.length - 1);
        $gameSystem.setSrpgActorCommandWindowNeedRefresh(battlerArray);
        $gameSystem.setSubBattlePhase("actor_command_window");
        $gameTemp.clearSrpgManualTraceRoute();
        return true;
      }

      const dx = targetX - currentX;
      const dy = targetY - currentY;
      const dir = srpgDirectionFromDelta(dx, dy);
      if (!dir) {
        SoundManager.playBuzzer();
        return true;
      }

      // Backtracking: revenir sur la case precedente retire une etape.
      if (dirs.length > 0) {
        const prev = srpgPointForRoute(
          $gameTemp._srpgManualTraceOriginX,
          $gameTemp._srpgManualTraceOriginY,
          dirs,
          dirs.length - 1
        );
        if (targetX === prev[0] && targetY === prev[1]) {
          dirs.pop();
          $gameTemp.refreshSrpgManualTraceVisual();
          SoundManager.playCancel();
          return true;
        }
      }

      if (dirs.length >= Number(battler.srpgMove ? battler.srpgMove() : 0)) {
        SoundManager.playBuzzer();
        return true;
      }

      if (!event.srpgMoveCanPass(currentX, currentY, dir, battler.srpgThroughTag())) {
        SoundManager.playBuzzer();
        return true;
      }

      // Autorise la case d'origine (retour), sinon impose une case libre.
      const originX = $gameTemp._srpgManualTraceOriginX;
      const originY = $gameTemp._srpgManualTraceOriginY;
      if ((targetX !== originX || targetY !== originY) && !$gameSystem.areTheyNoUnits(targetX, targetY)) {
        SoundManager.playBuzzer();
        return true;
      }

      dirs.push(dir);
      $gameTemp.refreshSrpgManualTraceVisual();
      SoundManager.playCursor();
      return true;
    }

    return _SRPG_PathTerrainDamage_Game_Player_triggerAction.call(this);
  };

  const _SRPG_PathTerrainDamage_Game_Player_startMapEvent = Game_Player.prototype.startMapEvent;
  Game_Player.prototype.startMapEvent = function(x, y, triggers, normal) {
    _SRPG_PathTerrainDamage_Game_Player_startMapEvent.call(this, x, y, triggers, normal);
    if (
      manualTraceMovement &&
      $gameSystem &&
      $gameSystem.isSRPGMode &&
      $gameSystem.isSRPGMode() &&
      $gameSystem.isSubBattlePhase &&
      $gameSystem.isSubBattlePhase() === "actor_move"
    ) {
      const event = $gameTemp.activeEvent ? $gameTemp.activeEvent() : null;
      if (event && !$gameTemp.isSrpgManualTraceReady(event)) {
        $gameTemp.initSrpgManualTraceRoute(event);
      }
    }
  };

  const _SRPG_PathTerrainDamage_Scene_Map_srpgCancelActorMove = Scene_Map.prototype.srpgCancelActorMove;
  Scene_Map.prototype.srpgCancelActorMove = function() {
    if ($gameTemp && $gameTemp.clearSrpgManualTraceRoute) {
      $gameTemp.clearSrpgManualTraceRoute();
      $gameTemp._srpgManualTraceTouchToggle = false;
    }
    _SRPG_PathTerrainDamage_Scene_Map_srpgCancelActorMove.call(this);
  };

  // Bouton tactile (mobile/touch UI) pour activer/desactiver le trace manuel.
  function Sprite_SrpgManualTraceToggleButton() {
    this.initialize(...arguments);
  }

  Sprite_SrpgManualTraceToggleButton.prototype = Object.create(Sprite_Clickable.prototype);
  Sprite_SrpgManualTraceToggleButton.prototype.constructor = Sprite_SrpgManualTraceToggleButton;

  Sprite_SrpgManualTraceToggleButton.prototype.initialize = function() {
    Sprite_Clickable.prototype.initialize.call(this);
    this.bitmap = new Bitmap(96, 36);
    this.visible = false;
    this._active = false;
    this.refresh();
  };

  Sprite_SrpgManualTraceToggleButton.prototype.onClick = function() {
    if (!$gameTemp) return;
    $gameTemp._srpgManualTraceTouchToggle = !$gameTemp._srpgManualTraceTouchToggle;
    this.refresh();
  };

  Sprite_SrpgManualTraceToggleButton.prototype.setActive = function(active) {
    if (this._active === active) return;
    this._active = active;
    this.refresh();
  };

  Sprite_SrpgManualTraceToggleButton.prototype.refresh = function() {
    const enabled = !!($gameTemp && $gameTemp._srpgManualTraceTouchToggle);
    this.bitmap.clear();
    const bg = enabled ? "rgba(36,120,58,0.9)" : "rgba(30,30,30,0.75)";
    const border = enabled ? "rgba(170,255,190,0.95)" : "rgba(255,255,255,0.5)";
    this.bitmap.fillRect(0, 0, 96, 36, bg);
    this.bitmap.fillRect(0, 0, 96, 2, border);
    this.bitmap.fillRect(0, 34, 96, 2, border);
    this.bitmap.fillRect(0, 0, 2, 36, border);
    this.bitmap.fillRect(94, 0, 2, 36, border);
    this.bitmap.fontSize = 18;
    this.bitmap.textColor = enabled ? "#e7ffe7" : "#ffffff";
    this.bitmap.drawText("TRACE", 0, 6, 96, 24, "center");
    this.opacity = this._active ? 255 : 140;
  };

  const _SRPG_PathTerrainDamage_Scene_Map_createButtons = Scene_Map.prototype.createButtons;
  Scene_Map.prototype.createButtons = function() {
    _SRPG_PathTerrainDamage_Scene_Map_createButtons.call(this);
  };

  const _SRPG_PathTerrainDamage_Scene_Map_createAllWindows = Scene_Map.prototype.createAllWindows;
  Scene_Map.prototype.createAllWindows = function() {
    _SRPG_PathTerrainDamage_Scene_Map_createAllWindows.call(this);
    if (!manualTraceMovement || !ConfigManager.touchUI) return;
    if (!this._srpgManualTraceButton) {
      this._srpgManualTraceButton = new Sprite_SrpgManualTraceToggleButton();
      this._srpgManualTraceButton.x = Graphics.boxWidth - 220;
      this._srpgManualTraceButton.y = this.buttonY();
      this.addChild(this._srpgManualTraceButton);
    }
  };

  const _SRPG_PathTerrainDamage_Scene_Map_update = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function() {
    _SRPG_PathTerrainDamage_Scene_Map_update.call(this);
    if (!manualTraceMovement || !this._srpgManualTraceButton) return;
    const srpgActorMove =
      $gameSystem &&
      $gameSystem.isSRPGMode &&
      $gameSystem.isSRPGMode() &&
      $gameSystem.isSubBattlePhase &&
      $gameSystem.isSubBattlePhase() === "actor_move";
    this._srpgManualTraceButton.visible = !!(ConfigManager.touchUI && srpgActorMove);
    this._srpgManualTraceButton.setActive(!!($gameTemp && $gameTemp._srpgManualTraceTouchToggle));
    if (!srpgActorMove && $gameTemp) {
      $gameTemp._srpgManualTraceTouchToggle = false;
    }
  };

  const _SRPG_PathTerrainDamage_Scene_Map_touchOnAnyButton = Scene_Map.prototype.touchOnAnyButton;
  Scene_Map.prototype.touchOnAnyButton = function() {
    if (_SRPG_PathTerrainDamage_Scene_Map_touchOnAnyButton.call(this)) return true;
    if (!manualTraceMovement || !ConfigManager.touchUI || !this._srpgManualTraceButton) return false;
    if (!this._srpgManualTraceButton.visible) return false;
    const offsetX = (Graphics.width - Graphics.boxWidth) / 2;
    const offsetY = (Graphics.height - Graphics.boxHeight) / 2;
    const left = offsetX + this._srpgManualTraceButton.x;
    const right = left + this._srpgManualTraceButton.width;
    const upper = offsetY + this._srpgManualTraceButton.y;
    const lower = upper + this._srpgManualTraceButton.height;
    return (
      TouchInput.x > left &&
      TouchInput.x < right &&
      TouchInput.y > upper &&
      TouchInput.y < lower
    );
  };

  if (Game_Map.prototype.changeActor) {
    const _Game_Map_changeActor = Game_Map.prototype.changeActor;
    Game_Map.prototype.changeActor = function(eventId, actorId) {
      const event = this.event ? this.event(eventId) : null;
      // Nettoie les stacks terrain avant/apres échange pour éviter
      // qu'ils soient transférés entre acteur sortant et entrant.
      clearTerrainDamageTrackingForEvent(event);
      _Game_Map_changeActor.call(this, eventId, actorId);
      clearTerrainDamageTrackingForEvent(event);
    };
  }
})();
