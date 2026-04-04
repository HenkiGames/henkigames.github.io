/*:
 * @target MZ
 * @plugindesc Permet aux états de réagir aux dégâts infligés via la balise <CustomApplyEffect>
 */

(() => {
  const _Game_Action_apply = Game_Action.prototype.apply;
  Game_Action.prototype.apply = function(target) {
    _Game_Action_apply.call(this, target);

    const result = target.result();
    const user = this.subject();
    const value = result.hpDamage;

    if (value > 0 && user && user.states) {
      user.states().forEach(state => {
        const note = state.note;
        const match = note.match(/<CustomApplyEffect>([\s\S]*?)<\/CustomApplyEffect>/i);
        if (match) {
          try {
            const code = match[1];
            const customFunc = new Function("user", "target", "value", code);
            customFunc.call(user, user, target, value);
          } catch (e) {
            console.error(`Erreur dans <CustomApplyEffect> de l'état ${state.name}:`, e);
          }
        }
      });
    }
  };
})();
