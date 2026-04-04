/*:
 * @target MZ
 * @plugindesc Ajoute une commande "Échanger" en combat pour remplacer un acteur par un autre hors combat
 * @author ChatGPT
 */

(() => {

    // ===============================
    // 🔹 AJOUT COMMANDE "ÉCHANGER"
    // ===============================
    const _Window_ActorCommand_makeCommandList = Window_ActorCommand.prototype.makeCommandList;
    Window_ActorCommand.prototype.makeCommandList = function() {
        _Window_ActorCommand_makeCommandList.call(this);

        if (this._actor) {
            const canExchange = $gameParty.allMembers().length > $gameParty.battleMembers().length;
            this.addCommand("Échanger", "exchange", canExchange);
        }
    };

    // ===============================
    // 🔹 WINDOW EXCHANGE
    // ===============================
    class Window_ExchangeActor extends Window_Selectable {
        initialize(rect) {
            super.initialize(rect);
            this._data = [];
            this.refresh();
            this.select(0);
        }

        setActors(actors) {
            this._data = actors;
            this.refresh();
            this.select(0);
        }

        maxItems() {
            return this._data ? this._data.length : 0;
        }

        drawItem(index) {
            const actor = this._data[index];
            if (!actor) return;

            const rect = this.itemLineRect(index);
            this.drawText(actor.name(), rect.x, rect.y, rect.width);
        }

        actor(index) {
            return this._data[index];
        }
    }

    // ===============================
    // 🔹 SCENE BATTLE
    // ===============================
    const _Scene_Battle_createAllWindows = Scene_Battle.prototype.createAllWindows;
    Scene_Battle.prototype.createAllWindows = function() {
        _Scene_Battle_createAllWindows.call(this);
        this.createExchangeWindow();
    };

    Scene_Battle.prototype.createExchangeWindow = function() {
        const rect = new Rectangle(
            Graphics.boxWidth / 2 - 200,
            Graphics.boxHeight / 2 - 150,
            400,
            300
        );

        this._exchangeWindow = new Window_ExchangeActor(rect);
        this._exchangeWindow.hide();
        this._exchangeWindow.deactivate();

        this._exchangeWindow.setHandler("ok", this.onExchangeOk.bind(this));
        this._exchangeWindow.setHandler("cancel", this.onExchangeCancel.bind(this));

        this.addWindow(this._exchangeWindow);
    };

    // ===============================
    // 🔹 HANDLER COMMANDE
    // ===============================
    const _Scene_Battle_createActorCommandWindow = Scene_Battle.prototype.createActorCommandWindow;
    Scene_Battle.prototype.createActorCommandWindow = function() {
        _Scene_Battle_createActorCommandWindow.call(this);
        this._actorCommandWindow.setHandler("exchange", this.commandExchange.bind(this));
    };

    Scene_Battle.prototype.commandExchange = function() {
        const actors = $gameParty.allMembers().filter(actor =>
            !$gameParty.battleMembers().includes(actor) && actor.isAlive()
        );

        this._exchangeWindow.setActors(actors);
        this._exchangeWindow.show();
        this._exchangeWindow.activate();
        this._exchangeWindow.select(0);

        this._actorCommandWindow.deactivate();
    };

    // ===============================
    // 🔹 VALIDATION
    // ===============================
    Scene_Battle.prototype.onExchangeOk = function() {
        const newActor = this._exchangeWindow.actor(this._exchangeWindow.index());
        const currentActor = BattleManager.actor();

        const party = $gameParty.members();

        const index = party.indexOf(currentActor);
        const newIndex = $gameParty.allMembers().indexOf(newActor);

        $gameParty.swapOrder(index, newIndex);

        SoundManager.playOk();

        this._exchangeWindow.hide();
        this._exchangeWindow.deactivate();

        this._actorCommandWindow.activate();

        BattleManager.startActorInput();
    };

    // ===============================
    // 🔹 ANNULATION
    // ===============================
    Scene_Battle.prototype.onExchangeCancel = function() {
        this._exchangeWindow.hide();
        this._exchangeWindow.deactivate();
        this._actorCommandWindow.activate();
    };

})();