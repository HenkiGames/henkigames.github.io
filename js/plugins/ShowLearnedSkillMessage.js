/*:
 * @target MZ
 * @plugindesc Affiche un message automatique quand un acteur apprend une compétence en montant de niveau [v1.0.0]
 * @author GPT
 *
 * @help
 * Ce plugin affiche un message dans la fenêtre de texte quand un acteur apprend une compétence
 * en montant de niveau (automatiquement via les courbes d'expérience).
 *
 * ✅ Aucun paramètre ou commande plugin nécessaire.
 * ✅ Fonctionne pour tous les acteurs et toutes les compétences.
 * ✅ Compatible avec le système de messages natif.
 */

(() => {
  const _Game_Actor_levelUp = Game_Actor.prototype.levelUp;
  Game_Actor.prototype.levelUp = function () {
    const oldSkills = this.skills().map(skill => skill.id);
    _Game_Actor_levelUp.call(this);
    const newSkills = this.skills().map(skill => skill.id);
    const learned = newSkills.filter(id => !oldSkills.includes(id));

    learned.forEach(skillId => {
      const skill = $dataSkills[skillId];
      if (skill) {
        const message = `${this.name()} a appris ${skill.name} !`;
        $gameMessage.add(message);
      }
    });
  };
})();
