(() => {
  const PROJECTILE_EVENT_ID = 11;

const _SRPG_BattleManager_invokeAction = BattleManager.invokeAction;
BattleManager.invokeAction = function(subject, target) {
    if ($gameSystem.isSRPGMode()) {
        const action = subject.currentAction();
        if (!action) return;

        const item = action.item();
        const meta = item.meta || {};
        const useProjectile = meta.SRPGProjectile === "true";
        const projectileEvent = $gameMap.event(11);

        const invoke = () => {
            // Le code de ton plugin original, sans le projectile
            if (_AAPwithYEP_BattleEngineCore === 'true') {
                if (!eval(Yanfly.Param.BECOptSpeed)) this._logWindow.push('pushBaseLine');
                if (Math.random() < this._action.itemMrf(target)) {
                    this.invokeMagicReflection(subject, target);
                } else {
                    this.invokeNormalAction(subject, target);
                }
                if (subject) subject.setLastTarget(target);
                if (!eval(Yanfly.Param.BECOptSpeed)) this._logWindow.push('popBaseLine');
            } else {
                this._logWindow.push('pushBaseLine');
                if (Math.random() < this._action.itemMrf(target)) {
                    this.invokeMagicReflection(subject, target);
                } else {
                    this.invokeNormalAction(subject, target);
                }
                subject.setLastTarget(target);
                this._logWindow.push('popBaseLine');
            }
        };

        if (useProjectile && projectileEvent) {
            console.log("[SRPG Projectile] Tir du projectile");

            projectileEvent.setPosition(subject.posX(), subject.posY());

            const route = {
                list: [
                    { code: 45, parameters: [target.posX(), target.posY()] },
                    { code: 0 }
                ],
                repeat: false,
                skippable: false,
                wait: true
            };
            projectileEvent.forceMoveRoute(route);

            const waitForProjectile = () => {
                if (projectileEvent.isMoving()) {
                    setTimeout(waitForProjectile, 30);
                } else {
                    console.log("[SRPG Projectile] Arrivé sur la cible");
                    invoke();
                }
            };

            waitForProjectile();
        } else {
            invoke();
        }
    } else {
        _SRPG_BattleManager_invokeAction.call(this, subject, target);
    }
};

})();
