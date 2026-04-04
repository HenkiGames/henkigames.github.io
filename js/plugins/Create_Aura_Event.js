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
      return false;
    }
    return true;
  });
};
