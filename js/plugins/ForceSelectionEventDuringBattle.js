/*:
 * @target MZ
 * @plugindesc [SRPG] Force la sélection d’un acteur via son eventId dans le SRPG Core MZ. Idéal pour tutoriels guidés.
 * @author ChatGPT
 * 
 * @help
 * Utilisation :
 * SRPGHelper.forceSelectEvent(eventId);
 *
 * Exemple :
 * SRPGHelper.forceSelectEvent(4);
 */

var SRPGHelper = SRPGHelper || {};

SRPGHelper.forceSelectEvent = function(eventId) {
  if (!$gameSystem.isSRPGMode()) {
    console.warn("SRPG Mode non actif.");
    return;
  }

  const event = $gameMap.event(eventId);
  if (!event) {
    console.warn(`Événement ${eventId} introuvable.`);
    return;
  }

  const unit = $gameSystem.EventToUnit(eventId);
  if (!unit || unit[0] !== 'actor') {
    console.warn(`Aucune unité acteur liée à l’événement ${eventId}.`);
    return;
  }

  // Forcer la sélection de l’acteur
  $gameSystem.setSubBattlePhase('actor_move');
  $gameMap.setSrpgActorEvent(event);
  $gameSystem.setSrpgStatusWindowRefresh(true);
  $gameSystem.setSrpgActorCommandWindowNeed(true);

  // Centrer la caméra
  $gamePlayer.center(event.x, event.y);

  // Ouvre la fenêtre de commande acteur si elle existe déjà
  const scene = SceneManager._scene;
  if (scene && scene._mapSrpgActorWindow) {
    scene._mapSrpgActorWindow.select(0);
    scene._mapSrpgActorWindow.open();
    scene._mapSrpgActorWindow.activate();
  }

  console.log(`[SRPGHelper] Sélection forcée de l’acteur sur event ${eventId}`);
};
