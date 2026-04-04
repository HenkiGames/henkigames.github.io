/*:
 * @target MZ
 * @plugindesc EXP dynamique selon <srpgLevel:x> pour l’ennemi, ignorée si l’attaquant a ≥ 3 niveaux de plus [v1.3.0]
 * @author GPT
 *
 * @help
 * Dans les remarques de l’ennemi, ajoutez :
 *     <srpgLevel:5>
 *
 * Le plugin :
 *  - Calcule l’EXP donnée en fonction du niveau de l’ennemi avec une formule équivalente à [20, 7, 20, 21]
 *  - Empêche le gain d’EXP si l’acteur qui a tué l’ennemi a ≥ 3 niveaux de plus que lui
 */

(() => {
  const basis = 5;
  const extra = 7;
  const acc_a = 20;
  const acc_b = 21;

  function expForLevel(n) {
    const actorId = $gameTemp.lastActionData(2) ? $gameTemp.lastActionData(2) : $gameTemp.lastActionData(4);
    const actorLevel = $gameActors.actor(actorId)._level;
    let diffLevel = actorLevel - n;
    if (n <= 1) return 0;
    if( diffLevel >= 3) return 0;

    if(actorLevel <= n) {
      diffLevel = n - actorLevel;
    } else {
      diffLevel = 0
    }

    return Math.round(
      (basis + diffLevel) *
        Math.pow(n - 1, 0.9 + acc_a / 250) *
        n *
        (n + 1) /
        (6 + Math.pow(n, 2) / 50) +
        (n - 1) * extra
    );
  }

  function getEnemyLevel(enemy) {
    const note = enemy.note || "";
    const match = note.match(/<srpgLevel\s*:\s*(\d+)>/i);
    return match ? Number(match[1]) : 1;
  }

  // Remplace la méthode d’XP d’un ennemi
  Game_Enemy.prototype.exp = function () {
    const level = getEnemyLevel(this.enemy());
    return expForLevel(level);
  };

  // On garde l’ennemi vaincu et l’acteur ayant agi
  let _lastActingActor = null;
  const _BattleManager_startAction = BattleManager.startAction;
  BattleManager.startAction = function () {
    if (this._subject && this._subject.isActor && this._subject.isActor()) {
      _lastActingActor = this._subject.actor();
    } else {
      _lastActingActor = null;
    }
    _BattleManager_startAction.call(this);
  };

  // Modifie le gain d’XP selon le niveau de l’ennemi vs l’acteur qui l’a tué
  const _BattleManager_gainExp = BattleManager.gainExp;
  BattleManager.gainExp = function () {
    const expMap = new Map();

    for (const enemy of $gameTroop.deadMembers()) {
      const baseExp = enemy.exp();
      const enemyLevel = getEnemyLevel(enemy.enemy());

      for (const actor of $gameParty.members()) {
        let gain = baseExp;

        if (actor === _lastActingActor) {
          const actorLevel = actor.level;
          if (actorLevel - enemyLevel >= 3) {
            gain = 0; // Trop haut niveau → pas d'XP
          }
        }

        if (!expMap.has(actor)) {
          expMap.set(actor, gain);
        } else {
          expMap.set(actor, expMap.get(actor) + gain);
        }
      }
    }

    for (const actor of $gameParty.members()) {
      const gain = expMap.get(actor) || 0;
      actor.gainExp(gain);
    }
  };
})();
