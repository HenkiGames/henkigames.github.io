/*:
 * @target MZ
 * @plugindesc SRPG: quand l'etat 97 expire en fin de tour, lance un echange reserve aleatoire.
 * @author ChatGPT
 * @base SRPG_core_MZ
 * @orderAfter SRPG_core_MZ
 * @orderAfter BattleExchange
 *
 * @param triggerStateId
 * @text Etat declencheur
 * @type state
 * @default 97
 * @desc Si cet etat est retire automatiquement en fin de tour, un echange aleatoire est tente.
 *
 * @param triggerTiming
 * @text Moment de suppression auto
 * @type select
 * @option Fin d'action
 * @value actionEnd
 * @option Fin de tour
 * @value turnEnd
 * @default actionEnd
 * @desc Doit correspondre au timing de suppression auto de l'etat.
 *
 * @help
 * Fonctionnement:
 * - Detecte la suppression auto de l'etat (fin d'action ou fin de tour).
 * - Ajoute l'acteur concerne a une file interne.
 * - Des que la map est libre, tente un echange reserve aleatoire via BattleExchange.
 *
 * Notes:
 * - Requiert BattleExchange.js (methode map interne).
 * - Ignore les ennemis; acteurs uniquement.
 * - Si aucun remplacant n'est disponible, rien ne se passe.
 */
(() => {
    "use strict";

    const PLUGIN_NAME = "Cbn_State97RandomExchange";
    const params = PluginManager.parameters(PLUGIN_NAME);
    const TRIGGER_STATE_ID = Number(params.triggerStateId || 97);
    const timingParam = String(params.triggerTiming || "actionEnd").trim();
    const TRIGGER_TIMING = timingParam === "turnEnd" ? 2 : 1;

    function queue() {
        if (!$gameTemp) return [];
        if (!$gameTemp._cbnState97ExchangeQueue) $gameTemp._cbnState97ExchangeQueue = [];
        return $gameTemp._cbnState97ExchangeQueue;
    }

    function readyQueue() {
        if (!$gameTemp) return [];
        if (!$gameTemp._cbnState97ExchangeReadyQueue) $gameTemp._cbnState97ExchangeReadyQueue = [];
        return $gameTemp._cbnState97ExchangeReadyQueue;
    }

    function enqueueActor(actorId) {
        const id = Number(actorId || 0);
        if (id <= 0) return;
        const q = queue();
        if (!q.includes(id)) q.push(id);
    }

    function markReadyActor(actorId) {
        const id = Number(actorId || 0);
        if (id <= 0) return;
        const q = queue();
        const idx = q.indexOf(id);
        if (idx < 0) return;
        q.splice(idx, 1);
        const rq = readyQueue();
        if (!rq.includes(id)) rq.push(id);
    }

    function forceRemoveTriggerState(actorId) {
        if (TRIGGER_STATE_ID <= 0) return;
        if (!$gameActors || !$gameActors.actor) return;
        const actor = $gameActors.actor(Number(actorId || 0));
        if (!actor) return;
        if (actor.isStateAffected && actor.isStateAffected(TRIGGER_STATE_ID)) {
            actor.removeState(TRIGGER_STATE_ID);
        }
        if (actor._stateTurns && Object.prototype.hasOwnProperty.call(actor._stateTurns, TRIGGER_STATE_ID)) {
            delete actor._stateTurns[TRIGGER_STATE_ID];
        }
    }

    function canAttemptNow() {
        if (!$gameSystem || !$gameSystem.isSRPGMode || !$gameSystem.isSRPGMode()) return false;
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Map)) return false;
        if (scene._exchangeWindow && scene._exchangeWindow.visible) return false;
        if ($gameMap.isEventRunning()) return false;
        if ($gameMap._interpreter && $gameMap._interpreter.isRunning()) return false;
        if (!$gameSystem.isBattlePhase || $gameSystem.isBattlePhase() !== "actor_phase") return false;
        return true;
    }

    function activeActorIdOnMap() {
        if (!$gameTemp || !$gameTemp.activeEvent || !$gameTemp.activeEvent()) return 0;
        if (!$gameSystem || !$gameSystem.EventToUnit) return 0;
        const pair = $gameSystem.EventToUnit($gameTemp.activeEvent().eventId());
        const battler = pair && pair[1];
        if (!battler || !battler.isActor || !battler.isActor() || !battler.actorId) return 0;
        return Number(battler.actorId() || 0);
    }

    function tryRandomExchangeOnMap(actorId) {
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Map)) return false;
        if (typeof scene._cbnMapBattleExchangeCommand !== "function") return false;
        if (typeof scene._cbnMapOnExchangeOk !== "function") return false;

        const actor = $gameActors && $gameActors.actor ? $gameActors.actor(Number(actorId || 0)) : null;
        if (!actor || !actor.isActor || !actor.isActor() || !actor.isAlive || !actor.isAlive()) return false;

        // Securite: l'etat declencheur doit etre retire sur l'acteur qui finit son action,
        // pour eviter qu'il revienne depuis la reserve avec cet etat encore actif.
        forceRemoveTriggerState(actorId);

        scene._cbnExchangeSourceActor = actor;
        if (!scene._cbnMapBattleExchangeCommand({
            eventInterpreter: null,
            ignoreTurnLimit: true,
            autoTrigger: true
        })) return false;

        const max = scene._exchangeWindow && scene._exchangeWindow.maxItems ? scene._exchangeWindow.maxItems() : 0;
        if (max <= 0) {
            if (scene._exchangeWindow) {
                scene._exchangeWindow.hide();
                scene._exchangeWindow.deactivate();
            }
            return false;
        }
        scene._exchangeWindow.select(Math.randomInt(max));
        scene._cbnMapOnExchangeOk();
        return true;
    }

    function flushReadyQueue() {
        const rq = readyQueue();
        if (rq.length <= 0) return;
        if (!canAttemptNow()) return;
        const actorId = Number(rq[0] || 0);
        if (actorId <= 0) {
            rq.shift();
            return;
        }
        forceRemoveTriggerState(actorId);
        const ok = tryRandomExchangeOnMap(actorId);
        // On consomme l'entree meme en echec pour eviter les boucles infinies
        // (ex: acteur mort, plus de reserve, contexte invalide durable).
        rq.shift();
        if (!ok) return;
    }

    const _Game_Battler_removeStatesAuto = Game_Battler.prototype.removeStatesAuto;
    Game_Battler.prototype.removeStatesAuto = function(timing) {
        const shouldTrack =
            Number(timing) === TRIGGER_TIMING &&
            TRIGGER_STATE_ID > 0 &&
            this.isActor && this.isActor() &&
            this.isStateAffected && this.isStateAffected(TRIGGER_STATE_ID);
        _Game_Battler_removeStatesAuto.call(this, timing);
        if (!shouldTrack) return;
        if (this.isStateAffected && this.isStateAffected(TRIGGER_STATE_ID)) return;
        if (!this.actorId) return;
        enqueueActor(this.actorId());
    };

    const _Scene_Map_srpgAfterAction = Scene_Map.prototype.srpgAfterAction;
    Scene_Map.prototype.srpgAfterAction = function() {
        const endedActorId = activeActorIdOnMap();
        _Scene_Map_srpgAfterAction.call(this);
        if (endedActorId > 0) {
            markReadyActor(endedActorId);
        }
        flushReadyQueue();
    };

    const _Game_Map_update = Game_Map.prototype.update;
    Game_Map.prototype.update = function(sceneActive) {
        _Game_Map_update.call(this, sceneActive);
        if (!sceneActive) return;
        flushReadyQueue();
    };
})();
