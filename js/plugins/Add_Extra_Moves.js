/*:
 * @target MZ
 * @plugindesc [SRPG] Permet à un acteur spécifique de jouer deux fois par tour dans le système SRPG.
 * @help
 * Ce plugin permet à l'acteur avec un ID donné d’agir deux fois par tour.
 * 
 * Modifiez la constante `ACTOR_ID` pour spécifier l’acteur concerné.
 */

(() => {
    const ACTOR_ID = 12; // 👈 ID de l'acteur qui peut jouer deux fois

    // Étend le démarrage de tour pour donner une action supplémentaire
    const _Scene_Map_srpgStartActorTurn = Scene_Map.prototype.srpgStartActorTurn;
    Scene_Map.prototype.srpgStartActorTurn = function() {
        _Scene_Map_srpgStartActorTurn.call(this);

        const event = $gameTemp.activeEvent();
        const battler = event && typeof event.battler === 'function' ? event.battler() : null;

        if (battler && battler.isActor() && battler.actorId() === ACTOR_ID) {
            battler.addAction(1); // Ajoute une action supplémentaire
        }
    };

    // Après chaque action, réactive l’acteur s’il a encore des actions restantes
    const _Scene_Map_srpgAfterAction = Scene_Map.prototype.srpgAfterAction;
    Scene_Map.prototype.srpgAfterAction = function() {
        _Scene_Map_srpgAfterAction.call(this);

        const event = $gameTemp.activeEvent();
        const battler = event && typeof event.battler === 'function' ? event.battler() : null;

        if (
            battler &&
            battler.isActor() &&
            battler.actorId() === ACTOR_ID &&
            battler.numActions() > 0
        ) {
            // Réactiver le tour
            event._srpgTurnEnd = false;
            battler.setActionState('undecided');
            battler.clearActions(); // Nécessaire pour réengager l’action
        }
    };
})();
