/*:
 * @target MZ
 * @plugindesc [v1.1] Recompense fossile unique par combat sur coordonnees cibles (vars 115/116).
 * @author ChatGPT
 *
 * @param messageTemplate
 * @text Texte du message
 * @type string
 * @default Felicitations, vous avez deterre {itemName}
 * @desc Utilise {itemName} pour inserer le nom de l'objet.
 *
 * @param seName
 * @text SE - Nom
 * @type file
 * @dir audio/se/
 * @default
 * @desc Laisser vide pour ne pas jouer de SE.
 *
 * @param seVolume
 * @text SE - Volume
 * @type number
 * @min 0
 * @max 100
 * @default 90
 *
 * @param sePitch
 * @text SE - Pitch
 * @type number
 * @min 50
 * @max 150
 * @default 100
 *
 * @param sePan
 * @text SE - Pan
 * @type number
 * @min -100
 * @max 100
 * @default 0
 *
 * @help
 * ============================================================================
 * FossilePlugin.js
 * ============================================================================
 * API script evenement (commande Script):
 *
 * 1) Cas recommande:
 *    - Les coordonnees cibles du fossile sont dans variables 115 (X) et 116 (Y)
 *      en debut de combat.
 *    - Les coordonnees creusees par le joueur sont dans des variables (ex: 10/11).
 *    Appel:
 *    FossilePlugin.tryDigOnStoredTargetByVariables(10, 11, [21, 22, 23]);
 *
 * 2) Directement avec des coordonnees creusees:
 *    FossilePlugin.tryDigOnStoredTarget(12, 7, [21, 22, 23]);
 *
 * Comportement:
 * - Une seule recompense totale par combat SRPG.
 * - La recompense est donnee uniquement si la case creusee correspond a la
 *   case cible stockee en variables (par defaut 115/116).
 * - L'etat est reinitialise automatiquement au debut et a la fin du combat
 *   SRPG (hook sur startSRPG/endSRPG).
 * - Si condition valide, le plugin choisit un ID d'objet aleatoire dans le
 *   tableau fourni, ajoute 1 exemplaire au joueur, puis
 *   affiche un message centre avec fond sombre:
 *   "Felicitations, vous avez deterre <NomObjet>"
 *
 * Retour des fonctions:
 * - null si echec/ignore
 * - itemId obtenu si succes
 *
 * ============================================================================
 */

(() => {
  "use strict";

  const pluginName = "FossilePlugin";
  const rawParams = PluginManager.parameters(pluginName);

  const DEFAULT_TARGET_VAR_X = 115;
  const DEFAULT_TARGET_VAR_Y = 116;
  const MESSAGE_TEMPLATE = String(rawParams.messageTemplate || "Felicitations, vous avez déterré {itemName}");
  const FOUND_SE = {
    name: String(rawParams.seName || ""),
    volume: Number(rawParams.seVolume || 90),
    pitch: Number(rawParams.sePitch || 100),
    pan: Number(rawParams.sePan || 0),
  };

  function ensureState() {
    if (typeof $gameSystem._fossileRewardGivenThisBattle !== "boolean") {
      $gameSystem._fossileRewardGivenThisBattle = false;
    }
    if (!Array.isArray($gameSystem._fossileOriginalItemIds)) {
      $gameSystem._fossileOriginalItemIds = null;
    }
    if (!Array.isArray($gameSystem._fossileRemainingItemIds)) {
      $gameSystem._fossileRemainingItemIds = null;
    }
  }

  function resetBattleState() {
    if ($gameSystem) {
      $gameSystem._fossileRewardGivenThisBattle = false;
    }
  }

  function normalizeItemIds(itemIds) {
    if (!Array.isArray(itemIds)) return [];
    return itemIds.filter((id) => Number.isInteger(id) && !!$dataItems[id]);
  }

  function arraysMatch(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
      if (left[i] !== right[i]) return false;
    }
    return true;
  }

  function initializeOrSyncFossilePool(itemIds) {
    ensureState();
    const validIds = normalizeItemIds(itemIds);
    if (validIds.length === 0) return [];

    const originalIds = $gameSystem._fossileOriginalItemIds;
    const remainingIds = $gameSystem._fossileRemainingItemIds;
    const needsInit =
      !Array.isArray(originalIds) ||
      !Array.isArray(remainingIds) ||
      !arraysMatch(originalIds, validIds);

    if (needsInit) {
      $gameSystem._fossileOriginalItemIds = validIds.slice();
      $gameSystem._fossileRemainingItemIds = validIds.slice();
    }

    return $gameSystem._fossileRemainingItemIds;
  }

  function removeItemIdFromPool(itemId) {
    ensureState();
    const remainingIds = $gameSystem._fossileRemainingItemIds;
    if (!Array.isArray(remainingIds)) return;
    const index = remainingIds.indexOf(itemId);
    if (index >= 0) {
      remainingIds.splice(index, 1);
    }
  }

  function resetFossilePool() {
    if (!$gameSystem) return;
    ensureState();
    if (Array.isArray($gameSystem._fossileOriginalItemIds)) {
      $gameSystem._fossileRemainingItemIds = $gameSystem._fossileOriginalItemIds.slice();
    } else {
      $gameSystem._fossileRemainingItemIds = null;
    }
  }

  function clearFossileSourceIds() {
    if (!$gameSystem) return;
    $gameSystem._fossileOriginalItemIds = null;
    $gameSystem._fossileRemainingItemIds = null;
  }

  function randomFrom(array) {
    const index = Math.floor(Math.random() * array.length);
    return array[index];
  }

  function showFoundMessage(itemName) {
    if (FOUND_SE.name) {
      AudioManager.playSe(FOUND_SE);
    }
    const message = MESSAGE_TEMPLATE.replace("{itemName}", itemName);
    $gameMessage.setBackground(1); // fond sombre
    $gameMessage.setPositionType(1); // centre
    $gameMessage.add(message);
  }

  function isValidMapTile(x, y) {
    if (!$gameMap) return false;
    if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
    return $gameMap.isValid(x, y);
  }

  function tryDigOnStoredTarget(digX, digY, itemIds, targetVarXId = DEFAULT_TARGET_VAR_X, targetVarYId = DEFAULT_TARGET_VAR_Y) {
    ensureState();
    if ($gameSystem._fossileRewardGivenThisBattle) return null;
    if (!isValidMapTile(digX, digY)) return null;

    const targetX = $gameVariables.value(targetVarXId);
    const targetY = $gameVariables.value(targetVarYId);
    if (!isValidMapTile(targetX, targetY)) return null;
    if (digX !== targetX || digY !== targetY) return null;

    const remainingIds = initializeOrSyncFossilePool(itemIds);
    if (remainingIds.length === 0) return null;

    const chosenItemId = randomFrom(remainingIds);
    const item = $dataItems[chosenItemId];
    if (!item) return null;

    $gameSystem._fossileRewardGivenThisBattle = true;
    removeItemIdFromPool(chosenItemId);
    $gameParty.gainItem(item, 1, false);
    showFoundMessage(item.name);
    return chosenItemId;
  }

  function tryDigOnStoredTargetByVariables(digVarXId, digVarYId, itemIds, targetVarXId = DEFAULT_TARGET_VAR_X, targetVarYId = DEFAULT_TARGET_VAR_Y) {
    const digX = $gameVariables.value(digVarXId);
    const digY = $gameVariables.value(digVarYId);
    return tryDigOnStoredTarget(digX, digY, itemIds, targetVarXId, targetVarYId);
  }

  const _Game_System_startSRPG = Game_System.prototype.startSRPG;
  Game_System.prototype.startSRPG = function() {
    _Game_System_startSRPG.call(this);
    resetBattleState();
  };

  const _Game_System_endSRPG = Game_System.prototype.endSRPG;
  Game_System.prototype.endSRPG = function() {
    _Game_System_endSRPG.call(this);
    resetBattleState();
  };

  const _Scene_Gameover_start = Scene_Gameover.prototype.start;
  Scene_Gameover.prototype.start = function() {
    _Scene_Gameover_start.call(this);
    if ($gameSystem) {
      resetBattleState();
      // En cas d'abandon/retry via game over, on conserve la source initiale
      // et on restaure seulement le pool restant.
      resetFossilePool();
    }
  };

  window.FossilePlugin = {
    resetBattleState,
    resetFossilePool,
    clearFossileSourceIds,
    tryDigOnStoredTarget,
    tryDigOnStoredTargetByVariables,
  };

  // Alias globaux pour les appels "Script" sans prefixe d'objet.
  window.clearFossileSourceIds = clearFossileSourceIds;
  window.resetFossilePool = resetFossilePool;

  PluginManager.registerCommand(pluginName, "TryDigOnStoredTarget", (args) => {
    const digX = Number(args.x || 0);
    const digY = Number(args.y || 0);
    const targetVarXId = Number(args.targetVarXId || DEFAULT_TARGET_VAR_X);
    const targetVarYId = Number(args.targetVarYId || DEFAULT_TARGET_VAR_Y);
    let itemIds = [];
    try {
      itemIds = JSON.parse(args.itemIds || "[]").map(Number);
    } catch (_e) {
      itemIds = [];
    }
    tryDigOnStoredTarget(digX, digY, itemIds, targetVarXId, targetVarYId);
  });

  PluginManager.registerCommand(pluginName, "TryDigOnStoredTargetByVariables", (args) => {
    const digVarXId = Number(args.varXId || 0);
    const digVarYId = Number(args.varYId || 0);
    const targetVarXId = Number(args.targetVarXId || DEFAULT_TARGET_VAR_X);
    const targetVarYId = Number(args.targetVarYId || DEFAULT_TARGET_VAR_Y);
    let itemIds = [];
    try {
      itemIds = JSON.parse(args.itemIds || "[]").map(Number);
    } catch (_e) {
      itemIds = [];
    }
    tryDigOnStoredTargetByVariables(digVarXId, digVarYId, itemIds, targetVarXId, targetVarYId);
  });
})();
