/*:
 * @target MZ
 * @plugindesc SRPG — synchro nombre de places (variable), cases prépa, et limite core [SRPG_SyncMaxActorFromVar]
 * @author GPT
 * @base SRPG_BattlePrepare_MZ
 * @orderAfter SRPG_BattlePrepare_MZ
 *
 * @param maxActorVariableId
 * @text Variable — nombre max d’acteurs
 * @desc Même logique que maxActorVarID dans SRPG_core (souvent 108). Valeur 3 ou 4 selon déblocage.
 * @type variable
 * @default 108
 *
 * @param defaultCapIfVariableZero
 * @text Plafond si variable ≤ 0
 * @desc Tant que la variable vaut 0, le core SRPG n’applique aucune limite : on force cette valeur avant setSrpgActors (ex. 3).
 * @type number
 * @min 0
 * @default 3
 *
 * @help
 * Problèmes corrigés :
 * - La table de préparation (cases cliquables) ignorait les événements « effacés » (4ᵉ case fantôme).
 * - Le max affiché en prépa comptait encore les événements acteur effacés.
 * - Variable à 0 = pas de limite côté SRPG_core : option pour forcer un défaut (ex. 3).
 *
 * Tu peux te passer de Condition_page_event si tu relies uniquement sur la variable :
 * avec maxActorVarID = 108 et 108 = 3, le core efface la 4ᵉ unité au démarrage du combat.
 */

(() => {
  'use strict';

  const params = PluginManager.parameters('SRPG_SyncMaxActorFromVar');
  const maxActorVariableId = Number(params['maxActorVariableId'] || 108);
  const defaultCapIfVariableZero = Number(params['defaultCapIfVariableZero'] || 3);

  const actorSlotsOnMap = () => {
    let n = 0;
    $gameMap.events().forEach(ev => {
      if (ev.event().meta.type === 'actor' && !ev.isErased()) n++;
    });
    return n;
  };

  const effectiveCap = () => {
    if (maxActorVariableId <= 0) return 0;
    const v = $gameVariables.value(maxActorVariableId);
    if (v <= 0 && defaultCapIfVariableZero > 0) return defaultCapIfVariableZero;
    return v;
  };

  // 1) Le core SRPG n’applique la limite que si la variable est > 0 : on la force le temps du chargement des unités puis on restaure
  const _setSrpgActors = Game_System.prototype.setSrpgActors;
  Game_System.prototype.setSrpgActors = function() {
    let backup = null;
    if (maxActorVariableId > 0) {
      const v = $gameVariables.value(maxActorVariableId);
      if (v <= 0 && defaultCapIfVariableZero > 0) {
        backup = v;
        $gameVariables.setValue(maxActorVariableId, defaultCapIfVariableZero);
      }
    }
    _setSrpgActors.call(this);
    if (backup !== null) {
      $gameVariables.setValue(maxActorVariableId, backup);
    }
  };

  // 2) Max en prépa : ignorer les acteurs effacés + ne pas dépasser la variable
  const _initLockedActorListandMinMaxActor = Game_Party.prototype.initLockedActorListandMinMaxActor;
  Game_Party.prototype.initLockedActorListandMinMaxActor = function() {
    _initLockedActorListandMinMaxActor.call(this);
    const slots = actorSlotsOnMap();
    const cap = effectiveCap();
    if (cap > 0) {
      this._srpgMaxActor = Math.min(slots, cap);
    } else {
      this._srpgMaxActor = slots;
    }
    return this._lockedActorList;
  };

  // 3) Cases « id:0 » dans la prépa : exclure les événements effacés (sinon 4ᵉ case fantôme)
  const _srpgMakePrepareTable = Game_Temp.prototype.srpgMakePrepareTable;
  Game_Temp.prototype.srpgMakePrepareTable = function() {
    if (this._Id0Count === 0) return;
    let count = 0;
    $gameMap.events().forEach(ev => {
      if (
        ev.event().meta.type === 'actor' &&
        Number(ev.event().meta.id) === 0 &&
        !ev.isErased()
      ) {
        this.pushMoveList([ev.posX(), ev.posY(), false]);
        count += 1;
      }
    });
    this._Id0Count = count;
  };
})();
