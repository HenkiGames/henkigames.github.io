/*:
 * @target MZ
 * @plugindesc [v1.0] Liste les acteurs du groupe avec <evolution:id> et remplace par l’acteur cible. v1.0.0
 * @author ChatGPT
 *
 * @param playOkSound
 * @text Jouer le son OK système
 * @type boolean
 * @on Oui
 * @off Non
 * @default true
 * @desc Si Oui, SoundManager.playOk() après le choix. Sinon, utilisez le SE personnalisé ci‑dessous.
 *
 * @param evolutionSe
 * @text SE personnalisé (optionnel)
 * @dir audio/se/
 * @type file
 * @default
 * @desc Nom du fichier SE (sans chemin). Vide = pas de SE si « Jouer le son OK » est Non.
 *
 * @param evolutionSeVolume
 * @text Volume SE personnalisé
 * @type number
 * @min 0
 * @max 100
 * @default 90
 *
 * @param evolutionSePitch
 * @text Pitch SE personnalisé
 * @type number
 * @min 50
 * @max 150
 * @default 100
 *
 * @command openEvolutionSelect
 * @text Ouvrir la sélection d’évolution
 * @desc Affiche les membres du groupe éligibles (note : <evolution:ID>).
 *
 * @help
 * Dans la fiche d’un acteur (onglet Note), ajoutez par exemple :
 *   <evolution:2>
 * L’ID est celui de l’acteur de remplacement dans la base de données.
 *
 * Événement :
 * - Commande de plugin : « Ouvrir la sélection d’évolution »
 *
 * Script : la commande de plugin gère l’attente dans tous les cas (y compris parallèle).
 * En Script seul, pour une carte « normale » vous pouvez tenter :
 *   EvolutionParty.open($gameMap._interpreter);
 * (Évitez pour processus parallèle sur événement : l’interpréteur n’est pas celui de la carte.)
 *
 * Tant que la liste est ouverte, l’événement ne poursuit pas (mode attente).
 * Échap / Annuler : ferme sans évolution (son d’annulation), puis l’événement reprend.
 *
 * Seuls les membres actuels du groupe dont la note contient une balise
 * <evolution:nombre> avec un ID valide apparaissent dans la liste.
 */

(() => {
    "use strict";

    const PLUGIN_NAME = "PartyEvolutionSelect";
    const EVOLUTION_TAG = /<evolution\s*:\s*(\d+)>/i;
    const WAIT_MODE = "evolutionPartySelect";

    function isEvolutionPartySceneActive() {
        const scene = SceneManager._scene;
        return !!scene && scene.constructor === Scene_EvolutionParty;
    }

    const _Game_Interpreter_updateWaitMode = Game_Interpreter.prototype.updateWaitMode;
    Game_Interpreter.prototype.updateWaitMode = function() {
        if (this._waitMode === WAIT_MODE) {
            if (isEvolutionPartySceneActive()) {
                return true;
            }
            this._waitMode = "";
            return false;
        }
        return _Game_Interpreter_updateWaitMode.call(this);
    };

    const params = PluginManager.parameters(PLUGIN_NAME);
    const PLAY_OK_SOUND = params.playOkSound !== "false";
    const EVOLUTION_SE = String(params.evolutionSe || "").trim();
    const EVOLUTION_SE_VOLUME = Number(params.evolutionSeVolume || 90);
    const EVOLUTION_SE_PITCH = Number(params.evolutionSePitch || 100);

    function metaEvolutionTargetActorId(actorId) {
        const data = $dataActors[actorId];
        if (!data || !data.note) return 0;
        const m = data.note.match(EVOLUTION_TAG);
        return m ? Number(m[1]) : 0;
    }

    function evolutionPartyEntries() {
        const out = [];
        if (!$gameParty) return out;
        for (const actor of $gameParty.members()) {
            if (!actor) continue;
            const oldId = actor.actorId();
            const newId = metaEvolutionTargetActorId(oldId);
            if (newId > 0 && $dataActors[newId]) {
                out.push({ oldId, newId, actor });
            }
        }
        return out;
    }

    function playEvolutionSound() {
        if (PLAY_OK_SOUND) {
            SoundManager.playOk();
        }
        if (EVOLUTION_SE) {
            const se = {
                name: EVOLUTION_SE,
                volume: EVOLUTION_SE_VOLUME,
                pitch: EVOLUTION_SE_PITCH,
                pan: 0
            };
            AudioManager.playSe(se);
        }
    }

    function replacePartyActorAtSlot(oldActorId, newActorId) {
        const actors = $gameParty._actors;
        const idx = actors.indexOf(oldActorId);
        if (idx < 0) return false;
        actors[idx] = newActorId;
        $gamePlayer.refresh();
        return true;
    }

    //-------------------------------------------------------------------------
    // Fenêtre liste
    //-------------------------------------------------------------------------

    function Window_EvolutionPartyList() {
        this.initialize(...arguments);
    }

    Window_EvolutionPartyList.prototype = Object.create(Window_Selectable.prototype);
    Window_EvolutionPartyList.prototype.constructor = Window_EvolutionPartyList;

    Window_EvolutionPartyList.prototype.initialize = function(rect) {
        Window_Selectable.prototype.initialize.call(this, rect);
        this._entries = [];
        this.refresh();
    };

    Window_EvolutionPartyList.prototype.setEntries = function(entries) {
        this._entries = entries;
        this.refresh();
        this.select(0);
    };

    Window_EvolutionPartyList.prototype.maxItems = function() {
        return this._entries.length;
    };

    Window_EvolutionPartyList.prototype.item = function() {
        return this._entries[this.index()];
    };

    Window_EvolutionPartyList.prototype.drawItem = function(index) {
        const entry = this._entries[index];
        if (!entry) return;
        const rect = this.itemRectWithPadding(index);
        const actor = entry.actor;
        this.drawItemBackground(index);
        this.changePaintOpacity(actor.isBattleMember());
        this.drawActorFace(actor, rect.x, rect.y, ImageManager.faceWidth, ImageManager.faceHeight);
        this.drawText(actor.name(), rect.x + ImageManager.faceWidth + 8, rect.y, rect.width - ImageManager.faceWidth - 8);
        const nextName = $dataActors[entry.newId].name;
        this.changeTextColor(ColorManager.systemColor());
        this.drawText(`→ ${nextName}`, rect.x + ImageManager.faceWidth + 8, rect.y + this.lineHeight(), rect.width - ImageManager.faceWidth - 8);
        this.resetTextColor();
        this.changePaintOpacity(true);
    };

    Window_EvolutionPartyList.prototype.itemHeight = function() {
        return Math.max(Window_Selectable.prototype.itemHeight.call(this), ImageManager.faceHeight + 8);
    };

    //-------------------------------------------------------------------------
    // Scène
    //-------------------------------------------------------------------------

    function Scene_EvolutionParty() {
        this.initialize(...arguments);
    }

    Scene_EvolutionParty.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_EvolutionParty.prototype.constructor = Scene_EvolutionParty;

    Scene_EvolutionParty.prototype.initialize = function() {
        Scene_MenuBase.prototype.initialize.call(this);
    };

    Scene_EvolutionParty.prototype.helpAreaHeight = function() {
        return 0;
    };

    Scene_EvolutionParty.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createEvolutionWindow();
        if (this._cancelButton) {
            this._cancelButton.setClickHandler(this.onEvolutionCancel.bind(this));
        }
    };

    Scene_EvolutionParty.prototype.createEvolutionWindow = function() {
        const rect = this.evolutionWindowRect();
        this._evolutionWindow = new Window_EvolutionPartyList(rect);
        this._evolutionWindow.setHandler("ok", this.onEvolutionOk.bind(this));
        this._evolutionWindow.setHandler("cancel", this.onEvolutionCancel.bind(this));
        this.addWindow(this._evolutionWindow);
    };

    Scene_EvolutionParty.prototype.evolutionWindowRect = function() {
        const ww = Math.min(Graphics.boxWidth - 48, 600);
        const pad = $gameSystem.windowPadding();
        const baseLine = Window_Base.prototype.lineHeight.call({ dummy: true });
        const rowH = Math.max(baseLine + 8, ImageManager.faceHeight + 8);
        const maxRows = 4;
        const wh = Math.min(Graphics.boxHeight - 48, maxRows * rowH + pad * 2);
        const wx = (Graphics.boxWidth - ww) / 2;
        const wy = (Graphics.boxHeight - wh) / 2;
        return new Rectangle(wx, wy, ww, wh);
    };

    Scene_EvolutionParty.prototype.start = function() {
        Scene_MenuBase.prototype.start.call(this);
        const entries = evolutionPartyEntries();
        this._evolutionWindow.setEntries(entries);
        if (entries.length === 0) {
            SoundManager.playBuzzer();
            this.popScene();
            return;
        }
        this._evolutionWindow.activate();
        this._evolutionWindow.select(0);
    };

    Scene_EvolutionParty.prototype.onEvolutionCancel = function() {
        SoundManager.playCancel();
        this.popScene();
    };

    Scene_EvolutionParty.prototype.onEvolutionOk = function() {
        const entry = this._evolutionWindow.item();
        if (!entry) {
            this.onEvolutionCancel();
            return;
        }
        playEvolutionSound();
        replacePartyActorAtSlot(entry.oldId, entry.newId);
        this.popScene();
    };

    //-------------------------------------------------------------------------
    // API publique + commande plugin
    //-------------------------------------------------------------------------

    function attachInterpreterWait(interpreter) {
        if (interpreter && interpreter.setWaitMode) {
            interpreter.setWaitMode(WAIT_MODE);
        } else if ($gameMap && $gameMap._interpreter && $gameMap._interpreter.setWaitMode) {
            $gameMap._interpreter.setWaitMode(WAIT_MODE);
        }
    }

    const EvolutionParty = {
        /**
         * @param {Game_Interpreter} [interpreter] Si fourni (ex. `this` depuis command357), l’événement attend la fermeture de l’écran.
         */
        open(interpreter) {
            attachInterpreterWait(interpreter);
            SceneManager.push(Scene_EvolutionParty);
        },
        metaEvolutionTargetActorId,
        evolutionPartyEntries,
        replacePartyActorAtSlot
    };

    window.EvolutionParty = EvolutionParty;

    PluginManager.registerCommand(PLUGIN_NAME, "openEvolutionSelect", function(/* args */) {
        EvolutionParty.open(this);
    });
})();
