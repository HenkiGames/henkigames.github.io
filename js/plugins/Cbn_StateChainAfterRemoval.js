/*:
 * @target MZ
 * @plugindesc Enchaîne un état quand un autre se termine, optionnel : événement commun.
 * @base RPG Maker MZ
 * @orderAfter SRPG_core_MZ
 *
 * @param chainRules
 * @text Règles (une par ligne)
 * @type note
 * @default ""
 *
 * @param maxChainDepth
 * @text Profondeur max (anti-boucle)
 * @desc Si A→B→A, s’arrête après N applications d’affilée.
 * @type number
 * @min 1
 * @max 32
 * @default 8
 *
 * @param contextActorVariable
 * @text Variable « ID acteur » (0 = off)
 * @desc Si > 0 : avant l’événement commun, y stocke l’ID de l’acteur (sinon 0 si ennemi).
 * @type variable
 * @default 0
 *
 * @param contextEventIdVariable
 * @text Variable « ID événement carte » (0 = off, SRPG)
 * @desc Si > 0 et srpgEventId() existe : ID événement SRPG de l’unité (sinon 0).
 * @type variable
 * @default 0
 *
 * @help
 * Quand un état est retiré via removeState(), le plugin applique l’état suivant et/ou
 * enfile un événement commun.
 *
 * Format : étatSource,étatCible,toursMin,toursMax[,idÉvénementCommun][,modeEvent]
 *
 * modeEvent (6ᵉ valeur, optionnel) :
 * - absent ou « mapIdle » : l’événement est lancé dès que l’interpréteur de carte est libre
 *   (retrait d’état « fin de l’action » SRPG, guérison hors fin de tour global).
 * - « turnEnd » ou « 1 » : à utiliser si l’état source a la suppression auto « fin du tour »
 *   (SRPG). L’événement est enfilé pendant srpgTurnEnd puis joué dès que la carte est libre
 *   (après les événements de carte type turnEnd, etc.).
 *
 * Les événements ne sont plus réservés directement dans removeState() : file d’attente +
 * exécution quand l’interpréteur de carte est inactif (évite les réservations perdues).
 *
 * Exemple SRPG (état 20 expire en fin de tour → état 21 + événement 12 à la fin du tour) :
 *   20,21,1,1,12,turnEnd
 */

(() => {
    "use strict";

    const pluginName = "Cbn_StateChainAfterRemoval";
    const params = PluginManager.parameters(pluginName);
    const MAX_DEPTH = Math.min(32, Math.max(1, Number(params.maxChainDepth) || 8));
    const VAR_ACTOR = Number(params.contextActorVariable || 0);
    const VAR_EVENT = Number(params.contextEventIdVariable || 0);

    /** @type {Map<number, { nextId: number, turnMin: number, turnMax: number, commonEventId: number, eventMode: string }>} */
    const rules = new Map();

    function parseEventMode(s) {
        if (s === undefined || s === null || String(s).trim() === "") return "mapIdle";
        const t = String(s).trim().toLowerCase();
        if (t === "1" || t === "turnend" || t === "fin_tour" || t === "global") return "turnEnd";
        return "mapIdle";
    }

    function parseRules() {
        rules.clear();
        const raw = String(params.chainRules || "");
        const lines = raw.split(/\r\n|\r|\n/);
        for (const line of lines) {
            const t = line.trim();
            if (!t || t.startsWith("#")) continue;
            const parts = t.split(",").map(s => String(s).trim());
            if (parts.length < 2) continue;
            const fromId = Number(parts[0]);
            const nextId = Number(parts[1]);
            const turnMin = parts.length > 2 ? Number(parts[2]) : 0;
            const turnMax = parts.length > 3 ? Number(parts[3]) : turnMin;
            const commonEventId =
                parts.length > 4 && parts[4] !== "" ? Number(parts[4]) : 0;
            const eventMode = parts.length > 5 ? parseEventMode(parts[5]) : "mapIdle";
            if (fromId <= 0) continue;
            if (nextId < 0) continue;
            rules.set(fromId, {
                nextId,
                turnMin: Number.isFinite(turnMin) ? turnMin : 0,
                turnMax: Number.isFinite(turnMax) ? turnMax : turnMin,
                commonEventId: Number.isFinite(commonEventId) && commonEventId > 0 ? commonEventId : 0,
                eventMode,
            });
        }
    }

    parseRules();

    function applyTurnOverride(battler, stateId, turnMin, turnMax) {
        if (turnMin <= 0 && turnMax <= 0) return;
        const min = turnMin > 0 ? turnMin : turnMax;
        const max = turnMax > 0 ? turnMax : turnMin;
        const lo = Math.min(min, max);
        const hi = Math.max(min, max);
        const variance = 1 + Math.max(hi - lo, 0);
        battler._stateTurns[stateId] = lo + Math.randomInt(variance);
    }

    function makeContextSnapshot(battler) {
        return {
            actorId: battler.isActor() ? battler.actorId() : 0,
            srpgEventId:
                typeof battler.srpgEventId === "function"
                    ? Number(battler.srpgEventId()) || 0
                    : 0,
        };
    }

    function applyContextSnapshot(ctx) {
        if (VAR_ACTOR > 0) {
            $gameVariables.setValue(VAR_ACTOR, ctx.actorId || 0);
        }
        if (VAR_EVENT > 0) {
            $gameVariables.setValue(VAR_EVENT, ctx.srpgEventId || 0);
        }
    }

    /** File d’attente hors fin de tour global SRPG */
    function enqueueMapIdleEvent(commonEventId, ctx) {
        if (commonEventId <= 0) return;
        if (!$dataCommonEvents[commonEventId]) return;
        if (!$gameTemp._cbnChainMapIdleQueue) $gameTemp._cbnChainMapIdleQueue = [];
        $gameTemp._cbnChainMapIdleQueue.push({ commonEventId, ctx });
    }

    /** Pendant Game_System.srpgTurnEnd uniquement (référence temporaire) */
    let srpgTurnEndBatch = null;

    function enqueueTurnEndEvent(commonEventId, ctx) {
        if (commonEventId <= 0) return;
        if (!$dataCommonEvents[commonEventId]) return;
        if (srpgTurnEndBatch) {
            srpgTurnEndBatch.push({ commonEventId, ctx });
        } else {
            enqueueMapIdleEvent(commonEventId, ctx);
        }
    }

    function mergeBatchIntoMapIdleQueue(batch) {
        if (!batch || batch.length === 0) return;
        if (!$gameTemp._cbnChainMapIdleQueue) $gameTemp._cbnChainMapIdleQueue = [];
        for (let i = 0; i < batch.length; i++) {
            $gameTemp._cbnChainMapIdleQueue.push(batch[i]);
        }
    }

    function flushMapIdleQueueOne() {
        if (!$gameMap) return;
        if ($gameMap.isEventRunning()) return;
        if ($gameMap._interpreter && $gameMap._interpreter.isRunning()) return;
        const q = $gameTemp._cbnChainMapIdleQueue;
        if (!q || q.length === 0) return;
        const item = q.shift();
        if (!item) return;
        applyContextSnapshot(item.ctx);
        $gameTemp.reserveCommonEvent(item.commonEventId);
    }

    const _removeState = Game_Battler.prototype.removeState;
    Game_Battler.prototype.removeState = function (stateId) {
        if (!this.isStateAffected(stateId)) {
            return;
        }
        const rule = rules.get(stateId);
        const depth = this._cbnStateChainDepth || 0;
        _removeState.call(this, stateId);

        if (!rule || depth >= MAX_DEPTH) return;
        if (!this.isAlive()) return;

        const nextId = rule.nextId;
        const st = nextId > 0 ? $dataStates[nextId] : null;
        if (nextId > 0 && !st) return;

        const ctx = makeContextSnapshot(this);

        this._cbnStateChainDepth = depth + 1;
        try {
            if (nextId > 0) {
                this.addState(nextId);
                if (this.isStateAffected(nextId)) {
                    applyTurnOverride(this, nextId, rule.turnMin, rule.turnMax);
                }
            }
            if (rule.commonEventId > 0) {
                if (rule.eventMode === "turnEnd") {
                    enqueueTurnEndEvent(rule.commonEventId, ctx);
                } else {
                    enqueueMapIdleEvent(rule.commonEventId, ctx);
                }
            }
        } finally {
            this._cbnStateChainDepth = depth;
        }
    };

    if (Game_System.prototype.srpgTurnEnd) {
        const _srpgTurnEnd = Game_System.prototype.srpgTurnEnd;
        Game_System.prototype.srpgTurnEnd = function () {
            const batch = [];
            srpgTurnEndBatch = batch;
            _srpgTurnEnd.call(this);
            srpgTurnEndBatch = null;
            mergeBatchIntoMapIdleQueue(batch);
        };
    }

    const _Game_Map_update = Game_Map.prototype.update;
    Game_Map.prototype.update = function (sceneActive) {
        _Game_Map_update.call(this, sceneActive);
        if (sceneActive) {
            flushMapIdleQueueOne();
        }
    };
})();
