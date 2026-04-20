/*:
 * @target MZ
 * @plugindesc [v1.1] Reset rogue-lite de tous les acteurs BDD (commande debut de run).
 * @author ChatGPT
 *
 * @param clearPermanentDeathFlags
 * @text Nettoyer mort permanente
 * @type boolean
 * @on Oui
 * @off Non
 * @default true
 * @desc Retire les IDs reset de la liste PermanentDeathPartyRemoval si presente.
 *
 * @command ResetPlayableActors
 * @text Reset tous les acteurs BDD
 * @desc Reinitialise tous les acteurs existant dans la base de donnees.
 *
 * @help
 * Commande a appeler au debut d'une run rogue-lite.
 *
 * Ce que fait le reset:
 * - Purge les instances Game_Actor de TOUS les IDs acteurs BDD ($gameActors._data[id] = null).
 * - Au prochain acces, l'acteur est recree depuis la BDD (stats/skills/equipements/etats de base).
 * - Optionnel: retire ces IDs de la liste de mort permanente.
 */

(() => {
  "use strict";

  const PLUGIN_NAME = "RunPlayableActorsReset";
  const params = PluginManager.parameters(PLUGIN_NAME);

  const CLEAR_PERMANENT_DEATH_FLAGS = params.clearPermanentDeathFlags !== "false";

  function allDatabaseActorIds() {
    const ids = [];
    if (!$dataActors) return ids;
    for (let actorId = 1; actorId < $dataActors.length; actorId++) {
      if ($dataActors[actorId]) {
        ids.push(actorId);
      }
    }
    return ids;
  }

  function clearPermanentDeathFor(actorId) {
    if (!CLEAR_PERMANENT_DEATH_FLAGS || !$gameSystem) return;
    const removed = $gameSystem._permanentDeathRemovedActorIds;
    if (!Array.isArray(removed)) return;
    const index = removed.indexOf(actorId);
    if (index >= 0) {
      removed.splice(index, 1);
    }
  }

  function resetActorsToDatabaseState(actorIds) {
    if (!$gameActors || !Array.isArray($gameActors._data)) return 0;
    let count = 0;
    for (const actorId of actorIds) {
      $gameActors._data[actorId] = null;
      clearPermanentDeathFor(actorId);
      count += 1;
    }
    return count;
  }

  function resetPlayableActors() {
    const targetIds = allDatabaseActorIds();
    const resetCount = resetActorsToDatabaseState(targetIds);
    return { targetIds, resetCount };
  }

  PluginManager.registerCommand(PLUGIN_NAME, "ResetPlayableActors", () => {
    resetPlayableActors();
  });

  window.RunPlayableActorsReset = {
    resetPlayableActors
  };
})();
