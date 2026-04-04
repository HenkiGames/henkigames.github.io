
/*:
 * @target MZ
 * @plugindesc SRPG - Effet différé en zone (ex: explosion après 1 tour) [v1.0]
 * @author ChatGPT
 * 
 * @help
 * Utilisation :
 * Appelez dans un événement commun avec un script comme ceci :
 * 
 *   SRPGHelper.spawnDelayedEffect(x, y, {
 *     delay: 1,
 *     animationId: 56,
 *     stateId: 10,
 *     damageFormula: "a.mat * 2",
 *     message: "⚠ Explosion !",
 *     areaSize: 2
 *   });
 * 
 * Le plugin applique l'effet une fois que le délai est écoulé, à tous les battlers
 * dans une zone centrée sur (x, y).
 */

var SRPGHelper = SRPGHelper || {};

(function() {
  const _update = Scene_Map.prototype.update;
  let _lastTurn = -1;

  Scene_Map.prototype.update = function() {
    _update.call(this);

    const currentTurn = $gameVariables.value(3) || 0;
    if (currentTurn !== _lastTurn) {
      _lastTurn = currentTurn;
      
    // console.log($gameSwitches.value(94), 'swiiiiiiiiiiiiiitch')
    // if ($gameSwitches.value(94)) {
      if ($gameSystem.isSRPGMode && $gameSystem.isSRPGMode()) {
        SRPGHelper.resolveDelayedEffects();
      }
    }
  };

  SRPGHelper.getAffectedTiles = function(x, y, shape, range) {
  const tiles = [];
  if (shape === "square") {
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        tiles.push([x + dx, y + dy]);
      }
    }
  } else if (shape === "circle") {
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        if (Math.sqrt(dx * dx + dy * dy) <= range) {
          tiles.push([x + dx, y + dy]);
        }
      }
    }
  } else if (shape === "cross") {
    for (let i = -range; i <= range; i++) {
      tiles.push([x + i, y]);
      tiles.push([x, y + i]);
    }
  }
  return tiles;
};

  SRPGHelper.resolveDelayedEffects = function() {
    if (!SRPGHelper._delayedEffects) return;
    SRPGHelper._delayedEffects = SRPGHelper._delayedEffects.filter(effect => {
      effect.turnsLeft--;
      if (effect.turnsLeft > 0) return true;

      let targetsCounter = 0;
      let enemiesAlive = 0;
      const tiles = SRPGHelper.getAffectedTiles(effect.centerX, effect.centerY, effect.shape, effect.areaSize || "square", Math.floor(effect.areaSize / 2));
      for (const [tx, ty] of tiles) {
        const targets = $gameMap.eventsXy(tx, ty).filter(e => {
          const unit = $gameSystem.EventToUnit(e.eventId());
          return unit && unit[1];
        });

        console.log('targets ??? => ', targets);
        for (const target of targets) {
          targetsCounter++;
          const unit = $gameSystem.EventToUnit(target.eventId());
          const battler = unit[1];            
          console.log('UNIT ??? => ', unit);
          console.log('BATTLER ??? => ', battler);

          if (effect.animationId) {
            $gameTemp.requestAnimation([battler], effect.animationId);
            $gameTemp.requestAnimation([$gameMap.event(target._eventId)], effect.animationId);
            target._animationId = effect.animationId;
            target._animationPlaying = true;
          }
          if (effect.stateId) battler.addState(effect.stateId);

          if (effect.damageFormula && !battler.isDead()) {
            const a = $gameActors.actor($gameVariables.value(31));
            const b = battler;
            const damage = Math.max(0, Math.floor(eval(effect.damageFormula)));
            battler.gainHp(-damage);
            battler.startDamagePopup();
            if (battler.hp <= 0) {
              battler.performCollapse()
              if(unit[0] === 'enemy') {
                enemiesAlive++;
              }
              target.erase(); // Cache l'event de la map
            };
          }
        }                    
      }

      console.log($gameVariables.value(2), ' current switch')
      console.log(enemiesAlive, ' number of dead enemies ?')
      $gameVariables.setValue(2, $gameVariables.value(2) - enemiesAlive);
      console.log($gameVariables.value(2), ' current variable after')

      if (effect.message && targetsCounter > 0) {
        $gameMessage.add(effect.message);
      } else {
        $gameMessage.add(effect.message2);
      }

      $gameSwitches.setValue(94, false);
      return false;
    });
  };

  SRPGHelper.spawnDelayedEffect = function(x, y, config) {
    if (!SRPGHelper._delayedEffects) SRPGHelper._delayedEffects = [];
    SRPGHelper._delayedEffects.push({
      centerX: x,
      centerY: y,
      turnsLeft: config.delay || 1,
      animationId: config.animationId || null,
      stateId: config.stateId || null,
      damageFormula: config.damageFormula || null,
      message: config.message || null,
      message2: config.message2 || null,
      areaSize: config.areaSize || 1,
      shape: config.shape || "square",
    });
  };
})();