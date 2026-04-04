(() => {
  const _Game_Actor_levelUp = Game_Actor.prototype.levelUp;

  Game_Actor.prototype.levelUp = function () {
    const hadNoMP = this.mmp === 0;
    _Game_Actor_levelUp.call(this);
    // rempli la barre de PP quand un nouveau PP est gagné pour la première fois.
    if (hadNoMP && this.mmp > 0 && this.mp === 0) {
      this.setMp(this.mmp);
    }
    // active le dialogue pour expliquer l'attaque signature pour la première fois
    if(this.level === 5 && this._actorId === 12) {
        $gameSwitches.setValue(89, true);
    }    
  };

  const _Game_Actor_changeClass = Game_Actor.prototype.changeClass;
  Game_Actor.prototype.changeClass = function (classId, keepExp) {
    const hadNoMP = this.mmp === 0;
    _Game_Actor_changeClass.call(this, classId, keepExp);
    if (hadNoMP && this.mmp > 0 && this.mp === 0) {
      this.setMp(this.mmp);
    }
  };
})();
