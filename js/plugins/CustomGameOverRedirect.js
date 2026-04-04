/*:
 * @target MZ
 * @plugindesc Rogue-lite : plus d'ecran Game Over — echec = transfert vers une carte (hub, nouvelle run).
 * @author Pokemon Carbonne Arena
 *
 * @param destinationMapId
 * @text Carte apres echec (tous morts)
 * @type map
 * @default 1
 * @desc Carte creee dans l'editeur (ecran defaite, taverne, choix de nouvelle partie, etc.).
 *
 * @param mapX
 * @text Case X
 * @type number
 * @min 0
 * @default 0
 *
 * @param mapY
 * @text Case Y
 * @type number
 * @min 0
 * @default 0
 *
 * @param mapDirection
 * @text Direction du heros
 * @type select
 * @option 2 (bas)
 * @value 2
 * @option 4 (gauche)
 * @value 4
 * @option 6 (droite)
 * @value 6
 * @option 8 (haut)
 * @value 8
 * @default 2
 *
 * @param deathCountVariableId
 * @text Variable : +1 a chaque interception
 * @type variable
 * @default 34
 * @desc Incrementee lorsque le Game Over est remplace par le transfert (compteur de defaites / runs).
 *
 * @param defeatBgmFile
 * @text fichier BGM (defaite)
 * @dir audio/bgm/
 * @type file
 * @default
 * @desc Laissez vide pour ne pas changer le BGM (apres autoplay de la carte). Sinon joue apres l'arrivee sur la carte cible (prioritaire sur Autoplay BGM de la carte).
 *
 * @param defeatBgmVolume
 * @text Volume BGM
 * @type number
 * @min 0
 * @max 100
 * @default 90
 *
 * @param defeatBgmPitch
 * @text Pitch BGM
 * @type number
 * @min 50
 * @max 150
 * @default 100
 *
 * @param defeatBgmPan
 * @text Pan BGM
 * @type number
 * @min -100
 * @max 100
 * @default 0
 *
 * @param clearPartyOnIntercept
 * @text Vider tout le groupe
 * @type boolean
 * @on Oui
 * @off Non
 * @default true
 * @desc Retire tous les acteurs du groupe. isAllDead() ne bloque plus : prevoyez un event sur la carte cible pour ajouter un nouveau personnage.
 *
 * @param fadeType
 * @text Type de fondu
 * @type select
 * @option Noir
 * @value 0
 * @option Blanc
 * @value 1
 * @option Aucun
 * @value 2
 * @default 0
 *
 * @command forceVanillaGameOver
 * @text [Debug] Vrai Game Over MZ (une fois)
 * @desc Rarement utile. Reaffiche l'ecran classique une seule fois (tests / cinéma).
 *
 * @help
 * Tous les chemins vers Scene_Gameover sont remplaces par un transfert vers
 * la carte parametree, puis Scene_Map (carte du moteur, pas une scene JS).
 *
 * BGM : jouee apres Scene_Map.start (apres autoplay carte). Les ME actifs
 * (ex. jingle de defaite) sont coupes sinon le moteur refuse de demarrer un BGM.
 *
 * Groupe vide : sans acteurs, le moteur ne declenche plus checkGameover sur "tous morts".
 * Utilisez un evenement sur la carte hub pour addActor / choix du nouveau heros.
 *
 * La variable parametree (defaut : ID 34) augmente de 1 a chaque interception.
 *
 * SRPG : pendant isSRPGMode() ou la phase battle_prepare (plugin Prepare), les
 * appels vers Scene_Gameover sont ignores (isAllDead() peut etre faux positif).
 */

(() => {
    "use strict";

    const PLUGIN_NAME = "CustomGameOverRedirect";
    const params = PluginManager.parameters(PLUGIN_NAME);

    const destinationMapId = Number(params.destinationMapId) || 1;
    const mapX = Number(params.mapX) || 0;
    const mapY = Number(params.mapY) || 0;
    const mapDirection = Number(params.mapDirection) || 2;
    const fadeType = Number(params.fadeType);
    const fade = Number.isFinite(fadeType) ? fadeType : 0;
    const deathCountVariableId = Number(params.deathCountVariableId) || 34;
    const clearPartyOnIntercept = params.clearPartyOnIntercept !== "false";

    const holdKey = "_customGameOverRedirectHold";
    const pendingBgmKey = "_customGameOverRedirectPendingBgm";

    const isSrpgTacticalContext = () => {
        if (!$gameSystem) {
            return false;
        }
        if (typeof $gameSystem.isSRPGMode === "function" && $gameSystem.isSRPGMode()) {
            return true;
        }
        if (typeof $gameSystem.isBattlePhase === "function" && $gameSystem.isBattlePhase() === "battle_prepare") {
            return true;
        }
        return false;
    };

    const parseDefeatBgm = () => {
        const raw = params.defeatBgmFile;
        if (raw === undefined || raw === null || raw === "") {
            return null;
        }
        let name = "";
        const s = String(raw).trim();
        if (s.startsWith("{")) {
            try {
                const o = JSON.parse(s);
                if (o && o.name) {
                    name = String(o.name);
                }
            } catch (e) {
                name = s;
            }
        } else {
            name = s;
        }
        name = name
            .replace(/^audio\/bgm\//i, "")
            .replace(/\.(ogg|m4a|mp3|wav)$/i, "")
            .trim();
        if (!name) {
            return null;
        }
        return {
            name,
            volume: Number(params.defeatBgmVolume) || 90,
            pitch: Number(params.defeatBgmPitch) || 100,
            pan: Number(params.defeatBgmPan) || 0,
        };
    };

    const clearEntireParty = () => {
        if (!clearPartyOnIntercept || !$gameParty) {
            return;
        }
        const ids = $gameParty._actors.slice();
        for (const id of ids) {
            $gameParty.removeActor(id);
        }
        $gameParty._menuActorId = 0;
        $gameParty._targetActorId = 0;
    };

    // Rogue-lite : après une défaite on veut pouvoir "rejouer" n'importe quel acteur.
    // On réinitialise les instances Game_Actor (PV/MP/états/EXP/équipement/etc.) en les purgeant :
    // elles seront recréées depuis $dataActors lors du prochain $gameActors.actor(id) / addActor.
    const resetAllDatabaseActors = () => {
        if (!$gameActors || !$dataActors) {
            return;
        }
        // Chemin le plus fiable : purger le cache interne.
        if (Array.isArray($gameActors._data)) {
            for (let i = 1; i < $dataActors.length; i++) {
                if ($dataActors[i]) {
                    $gameActors._data[i] = null;
                }
            }
            return;
        }
        // Fallback : ré-appliquer setup sur les instances existantes.
        for (let i = 1; i < $dataActors.length; i++) {
            if (!$dataActors[i]) continue;
            const a = $gameActors.actor(i);
            if (a && a.setup) {
                a.setup(i);
            } else if (a && a.recoverAll) {
                a.recoverAll();
            }
        }
    };

    const ensureHold = () => {
        if (!$gameSystem) {
            return;
        }
        if ($gameSystem[holdKey] === undefined) {
            $gameSystem[holdKey] = false;
        }
    };

    const performRedirect = () => {
        if (destinationMapId <= 0) {
            console.error(`[${PLUGIN_NAME}] destinationMapId invalide. Reglez la carte dans les parametres du plugin.`);
            return;
        }
        const prev = $gameVariables.value(deathCountVariableId);
        $gameVariables.setValue(deathCountVariableId, prev + 1);
        clearEntireParty();
        resetAllDatabaseActors();
        const bgm = parseDefeatBgm();
        if (bgm && $gameSystem) {
            $gameSystem[pendingBgmKey] = bgm;
        }
        $gamePlayer.reserveTransfer(destinationMapId, mapX, mapY, mapDirection, fade);
        ensureHold();
        $gameSystem[holdKey] = true;
        SceneManager._customGameOverRedirect_skipNext = true;
        SceneManager.goto(Scene_Map);
    };

    const _SceneManager_goto = SceneManager.goto;
    SceneManager.goto = function (sceneClass) {
        if (SceneManager._customGameOverRedirect_skipNext) {
            SceneManager._customGameOverRedirect_skipNext = false;
            _SceneManager_goto.call(this, sceneClass);
            return;
        }
        if (!$gameSystem) {
            _SceneManager_goto.call(this, sceneClass);
            return;
        }
        if (sceneClass === Scene_Gameover && !$gameSystem._forceVanillaGameOverOnce) {
            if (isSrpgTacticalContext()) {
                return;
            }
            performRedirect();
            return;
        }
        if ($gameSystem._forceVanillaGameOverOnce && sceneClass === Scene_Gameover) {
            $gameSystem._forceVanillaGameOverOnce = false;
        }
        _SceneManager_goto.call(this, sceneClass);
    };

    const _Scene_Base_checkGameover = Scene_Base.prototype.checkGameover;
    Scene_Base.prototype.checkGameover = function () {
        if (!$gameSystem || !$gameParty) {
            _Scene_Base_checkGameover.call(this);
            return;
        }
        if (isSrpgTacticalContext()) {
            _Scene_Base_checkGameover.call(this);
            return;
        }
        ensureHold();
        if ($gameSystem[holdKey] && !$gameParty.isAllDead()) {
            $gameSystem[holdKey] = false;
        }
        if ($gameSystem[holdKey]) {
            return;
        }
        _Scene_Base_checkGameover.call(this);
    };

    const tryPlayPendingDefeatBgm = () => {
        if (!$gameSystem) {
            return;
        }
        const bgm = $gameSystem[pendingBgmKey];
        if (!bgm || !bgm.name) {
            return;
        }
        $gameSystem[pendingBgmKey] = null;
        AudioManager.stopMe();
        AudioManager.playBgm(bgm);
    };

    const _SceneManager_onSceneStart = SceneManager.onSceneStart;
    SceneManager.onSceneStart = function () {
        _SceneManager_onSceneStart.call(this);
        if (this._scene && this._scene.constructor === Scene_Map) {
            tryPlayPendingDefeatBgm();
        }
    };

    PluginManager.registerCommand(PLUGIN_NAME, "forceVanillaGameOver", () => {
        $gameSystem._forceVanillaGameOverOnce = true;
        SceneManager.goto(Scene_Gameover);
    });
})();
