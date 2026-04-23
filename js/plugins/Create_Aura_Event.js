/*:
 * @target MZ
 * @plugindesc Crée dynamiquement une aura sur une case vide avec des tags SRPG_AuraSkill pendant 4 tours [v1.1] - avec détection de tuile ciblée automatiquement
 * @author ChatGPT
 *
 * @help
 * Utilisation :
 * Appelez dans un événement ou un effet de compétence via un appel de script :
 *
 *   SRPGHelper.spawnAuraFromTarget(50, 4);
 *
 * - 50 : ID de l'état à appliquer (SRPGAuraState)
 * - 4 : durée en tours SRPG avant que l'aura disparaisse
 */

var SRPGHelper = SRPGHelper || {};
SRPGHelper._auraEvents = SRPGHelper._auraEvents || [];

// Nouvelle méthode : utilise la cellule actuellement ciblée par la compétence SRPG
SRPGHelper.spawnAuraFromTarget = function(stateId, duration) {
  const x = $gameTemp._activeTarget ? $gameTemp._activeTarget.posX() : null;
  const y = $gameTemp._activeTarget ? $gameTemp._activeTarget.posY() : null;
  if (x != null && y != null) {
    SRPGHelper.spawnAura(x, y, stateId, duration);
  } else {
    console.warn("Aucune cible active pour créer l'aura.");
  }
};

SRPGHelper.spawnAura = function(x, y, stateId, duration) {
  const mapId = $gameMap.mapId();
  const eventId = $dataMap.events.length;
  const eventData = {
    id: eventId,
    name: "AuraTemp",
    note: "",
    pages: [
      {
        conditions: {
          actorId: 1, actorValid: false,
          itemId: 1, itemValid: false,
          switch1Id: 1, switch1Valid: false,
          switch2Id: 1, switch2Valid: false,
          variableId: 1, variableValid: false, variableValue: 0
        },
        directionFix: false,
        image: {tileId: 0, characterName: "", characterIndex: 0, direction: 2, pattern: 0},
        moveFrequency: 3,
        moveRoute: {list:[{code:0}], repeat:true, skippable:false, wait:false},
        moveSpeed: 3,
        priorityType: 1,
        stepAnime: false,
        through: true,
        trigger: 0,
        walkAnime: false,
        list: [
          {code: 108, parameters: ["<type:object>"]},
          {code: 108, parameters: ["<SRPGAuraState:" + stateId + ">"]},
          {code: 108, parameters: ["<SRPGAuraTarget:all>"]},
          {code: 108, parameters: ["<SRPGAuraRange:1>"]},
          {code: 108, parameters: ["<SRPGAuraShape:circle>"]},
          {code: 108, parameters: ["<SRPGShowAura:true>"]},
          {code: 0, parameters: []}
        ]
      }
    ]
  };

  // Ajoute aux données de la map
  $dataMap.events[eventId] = eventData;
  const gameEvent = new Game_Event(mapId, eventData);
  $gameMap._events[eventId] = gameEvent;
  gameEvent.locate(x, y);
  SRPGHelper._auraEvents.push({ id: eventId, turns: duration });
  SRPGHelper.requestPersistentAuraOverlayRefresh();
  SRPGHelper.refreshAuraImmediatelyOnPlacement();
};

// Verrouille le curseur SRPG sur une case pendant N frames
SRPGHelper.lockCursorOnCell = function(x, y, frames) {
  if (!$gameSystem || !$gameSystem.isSRPGMode || !$gameSystem.isSRPGMode()) return;
  if (!$gameTemp) return;
  const fx = Number(x);
  const fy = Number(y);
  const f = Math.max(1, Number(frames || 30));
  if (!Number.isFinite(fx) || !Number.isFinite(fy)) return;
  $gameTemp._cbnAuraCursorLock = { x: fx, y: fy, frames: f };
  if ($gameTemp.setAutoMoveDestinationValid) $gameTemp.setAutoMoveDestinationValid(true);
  if ($gameTemp.setAutoMoveDestination) $gameTemp.setAutoMoveDestination(fx, fy);
  if ($gamePlayer && $gamePlayer.locate) $gamePlayer.locate(fx, fy);
};

// Applique l'aura des sa pose:
// - immediate si la map est libre
// - sinon via la file de refresh de SRPG_AuraSkill (prochain update disponible)
SRPGHelper.refreshAuraImmediatelyOnPlacement = function() {
  if (!$gameSystem || !$gameSystem.isSRPGMode || !$gameSystem.isSRPGMode()) return;
  if (!$gameTemp) return;

  if ($gameTemp.setSrpgRequestRefreshAura) {
    $gameTemp.setSrpgRequestRefreshAura("all");
  }

  const scene = SceneManager && SceneManager._scene;
  const canRefreshNow =
    scene instanceof Scene_Map &&
    $gameTemp.refreshAuraForAll &&
    $gameMap &&
    !$gameMap.isEventRunning();

  if (canRefreshNow) {
    $gameTemp.refreshAuraForAll();
    if ($gameTemp.resetSrpgRequestRefreshAura) {
      $gameTemp.resetSrpgRequestRefreshAura();
    }
  }
};

const _CBN_AuraCursorLock_SceneMap_update = Scene_Map.prototype.update;
Scene_Map.prototype.update = function() {
  _CBN_AuraCursorLock_SceneMap_update.call(this);
  if (!$gameSystem || !$gameSystem.isSRPGMode || !$gameSystem.isSRPGMode()) return;
  if (!$gameTemp || !$gameTemp._cbnAuraCursorLock) return;
  const lock = $gameTemp._cbnAuraCursorLock;
  if (lock.frames <= 0) {
    $gameTemp._cbnAuraCursorLock = null;
    return;
  }
  if ($gameTemp.setAutoMoveDestinationValid) $gameTemp.setAutoMoveDestinationValid(true);
  if ($gameTemp.setAutoMoveDestination) $gameTemp.setAutoMoveDestination(lock.x, lock.y);
  if ($gamePlayer && $gamePlayer.locate) $gamePlayer.locate(lock.x, lock.y);
  lock.frames -= 1;
  if (lock.frames <= 0) {
    $gameTemp._cbnAuraCursorLock = null;
  }
};

// ===============================
// Affichage persistant des auras
// ===============================
SRPGHelper._persistentAuraOverlayVersion = 0;

SRPGHelper.requestPersistentAuraOverlayRefresh = function() {
  SRPGHelper._persistentAuraOverlayVersion += 1;
};

SRPGHelper._extractAuraMetaFromEvent = function(event) {
  if (!event || event.isErased() || !event.event || !event.event()) return null;
  const base = event.event();
  const meta = (base && base.meta) ? base.meta : {};
  const hasAura = !!meta.SRPGAuraState;
  if (!hasAura) return null;

  const showAura = String(meta.SRPGShowAura || "").toLowerCase() === "true";
  if (!showAura) return null;

  return {
    x: event.posX(),
    y: event.posY(),
    range: Number(meta.SRPGAuraRange || 2),
    minRange: Number(meta.SRPGAuraMinRange || 0),
    shape: String(meta.SRPGAuraShape || "circle"),
    color: String(meta.SRPGAuraColor || "SpringGreen")
  };
};

SRPGHelper.collectPersistentAuraCells = function() {
  const out = new Map();
  if (!$gameMap || !$gameMap.events) return out;

  const events = $gameMap.events();
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const aura = SRPGHelper._extractAuraMetaFromEvent(ev);
    if (!aura) continue;

    const range = Math.max(0, aura.range);
    const minRange = Math.max(0, aura.minRange);
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        if (!$gameMap.inArea(dx, dy, range, minRange, aura.shape, 0)) continue;
        const tx = aura.x + dx;
        const ty = aura.y + dy;
        if (!$gameMap.isValid(tx, ty)) continue;
        const key = tx + "," + ty;
        if (!out.has(key)) {
          out.set(key, { x: tx, y: ty, color: aura.color });
        }
      }
    }
  }
  return out;
};

SRPGHelper.applyPersistentAuraOverlayToScene = function(scene) {
  if (!(scene instanceof Scene_Map)) return;
  if (!scene._spriteset || !scene._spriteset._tilemap) return;
  if (!scene._cbnPersistentAuraOverlay) {
    scene._cbnPersistentAuraOverlay = new Sprite();
    scene._spriteset._tilemap.addChild(scene._cbnPersistentAuraOverlay);
  }

  const container = scene._cbnPersistentAuraOverlay;
  const tw = $gameMap.tileWidth();
  const th = $gameMap.tileHeight();
  const cells = SRPGHelper.collectPersistentAuraCells();

  while (container.children.length > cells.size) {
    const s = container.children.pop();
    if (s && s.bitmap) s.bitmap.destroy();
  }

  let idx = 0;
  cells.forEach(cell => {
    let sprite = container.children[idx];
    if (!sprite) {
      sprite = new Sprite();
      container.addChild(sprite);
    }
    if (!sprite.bitmap || sprite.bitmap.width !== tw || sprite.bitmap.height !== th) {
      if (sprite.bitmap) sprite.bitmap.destroy();
      sprite.bitmap = new Bitmap(tw, th);
    }
    sprite.bitmap.clear();
    sprite.bitmap.fillAll(cell.color);
    sprite.opacity = 85;
    sprite.blendMode = 0;
    sprite.x = Math.floor(cell.x * tw);
    sprite.y = Math.floor(cell.y * th) + 5;
    sprite.visible = true;
    idx += 1;
  });
};

SRPGHelper.clearPersistentAuraOverlayFromScene = function(scene) {
  if (!scene || !scene._cbnPersistentAuraOverlay) return;
  const container = scene._cbnPersistentAuraOverlay;
  for (let i = 0; i < container.children.length; i++) {
    const sprite = container.children[i];
    if (sprite && sprite.bitmap) sprite.bitmap.destroy();
  }
  container.removeChildren();
  if (container.parent) {
    container.parent.removeChild(container);
  }
  scene._cbnPersistentAuraOverlay = null;
};

const _CBN_AuraOverlay_SceneMap_update = Scene_Map.prototype.update;
Scene_Map.prototype.update = function() {
  _CBN_AuraOverlay_SceneMap_update.call(this);

  if (!$gameSystem || !$gameSystem.isSRPGMode || !$gameSystem.isSRPGMode()) {
    SRPGHelper.clearPersistentAuraOverlayFromScene(this);
    this._cbnPersistentAuraOverlayLastVersion = undefined;
    this._cbnPersistentAuraOverlayLastTick = 0;
    return;
  }

  // Rebuild périodique + sur demande explicite (spawn/erase)
  this._cbnPersistentAuraOverlayLastTick = (this._cbnPersistentAuraOverlayLastTick || 0) + 1;
  const versionChanged = this._cbnPersistentAuraOverlayLastVersion !== SRPGHelper._persistentAuraOverlayVersion;
  const periodicRefresh = this._cbnPersistentAuraOverlayLastTick >= 20;
  if (!versionChanged && !periodicRefresh) return;

  SRPGHelper.applyPersistentAuraOverlayToScene(this);
  this._cbnPersistentAuraOverlayLastVersion = SRPGHelper._persistentAuraOverlayVersion;
  this._cbnPersistentAuraOverlayLastTick = 0;
};

const _CBN_AuraOverlay_SceneMap_terminate = Scene_Map.prototype.terminate;
Scene_Map.prototype.terminate = function() {
  SRPGHelper.clearPersistentAuraOverlayFromScene(this);
  _CBN_AuraOverlay_SceneMap_terminate.call(this);
};

const _CBN_AuraOverlay_SceneMap_srpgTurnEnd = Scene_Map.prototype.srpgTurnEnd;
Scene_Map.prototype.srpgTurnEnd = function() {
  _CBN_AuraOverlay_SceneMap_srpgTurnEnd.call(this);
  SRPGHelper.requestPersistentAuraOverlayRefresh();
};

// Gestion de la durée de vie des auras temporaires
const _srpg_updateTurnEnd = Scene_Map.prototype.srpgTurnEnd;
Scene_Map.prototype.srpgTurnEnd = function() {
  _srpg_updateTurnEnd.call(this);
  SRPGHelper._auraEvents.forEach(entry => entry.turns--);
  SRPGHelper._auraEvents = SRPGHelper._auraEvents.filter(entry => {
    if (entry.turns <= 0) {
      const ev = $gameMap.event(entry.id);
      if (ev) ev.erase();
      $dataMap.events[entry.id] = null;
      $gameMap._events[entry.id] = null;
      SRPGHelper.requestPersistentAuraOverlayRefresh();
      return false;
    }
    return true;
  });
};
