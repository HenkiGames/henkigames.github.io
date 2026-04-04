/*:
 * @target MZ
 * @plugindesc Permet d'ajouter des actions supplémentaires par note tag dans le système SRPG. Exemple : <srpgAddActionTimes: 1>
 * @help
 * Ajoute la prise en charge du tag <srpgAddActionTimes: X> dans les états, classes, équipements, acteurs.
 * Cela permet d'accorder X actions supplémentaires par tour à un personnage.
 */

(function() {
    Game_Battler.prototype.srpgTraitsWithNotes = function() {
        let objects = [];

        if (this.isActor()) {
            objects = objects.concat(this.actor(), this.currentClass());
            objects = objects.concat(this.equips().filter(e => e));
        } else if (this.isEnemy()) {
            objects.push(this.enemy());
        }

        return objects.concat(this.states());
    };

    Game_Battler.prototype.srpgAddedActions = function() {
        let total = 0;
        const regex = /<srpgAddActionTimes:\s*(\d+)>/i;

        this.srpgTraitsWithNotes().forEach(obj => {
            if (obj && obj.note) {
                const match = obj.note.match(regex);
                if (match) {
                    total += Number(match[1]);
                }
            }
        });

        return total;
    };

    const _Scene_Map_srpgStartActorTurn = Scene_Map.prototype.srpgStartActorTurn;
    Scene_Map.prototype.srpgStartActorTurn = function() {
        _Scene_Map_srpgStartActorTurn.call(this);

        const battler = $gameTemp.activeEvent().battler();
        if (battler && battler.isActor()) {
            const extraActions = battler.srpgAddedActions();
            if (extraActions > 0) {
                for (let i = 0; i < extraActions; i++) {
                    battler.addAction(1);
                }
            }
        }
    };
})();
