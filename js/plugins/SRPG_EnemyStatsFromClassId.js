/*:
 * @target MZ
 * @plugindesc Applique les stats d'une classe RPG Maker à un ennemi selon un niveau défini via <srpgLevel:x> et <srpgClassId:x> [v1.0.0]
 * @author GPT
 *
 * @help
 * 🔹 Place ces balises dans les REMARQUES des ennemis :
 *
 *   <srpgLevel:x>      → niveau de l’ennemi (ex: <srpgLevel:7>)
 *   <srpgClassId:x>    → ID d'une classe existante (ex: <srpgClassId:3>)
 *
 * ⚠️ Si l’une des balises est absente ou invalide, les stats par défaut de l’ennemi sont utilisées.
 *
 * Aucune commande plugin n’est nécessaire.
 */

(() => {

  function getEnemyLevel(enemy) {
    const match = enemy.note.match(/<srpgLevel\s*:\s*(\d+)>/i);
    return match ? Number(match[1]) : null;
  }

  function getEnemyClass(enemy) {
    const match = enemy.note.match(/<srpgClassId\s*:\s*(\d+)>/i);
    const id = match ? Number(match[1]) : null;
    return id && $dataClasses[id] ? $dataClasses[id] : null;
  }

  const paramTypes = [0, 1, 2, 3, 4, 5, 6, 7]; // Param IDs: MHP, MMP, ATK, DEF, MAT, MDF, AGI, LUK

  const _Game_Enemy_param = Game_Enemy.prototype.param;
  Game_Enemy.prototype.param = function (paramId) {
    const enemy = this.enemy();
    const cls = getEnemyClass(enemy);
    const lvl = getEnemyLevel(enemy);

    if (cls && lvl && paramTypes.includes(paramId)) {
      const curve = cls.params[paramId]; // Liste des stats du niveau 1 à 99
      const level = Math.max(1, Math.min(lvl, curve.length)); // Clamp niveau
      return curve[level - 1];
    }

    return _Game_Enemy_param.call(this, paramId);
  };

})();
