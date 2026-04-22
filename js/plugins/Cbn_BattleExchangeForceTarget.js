/*:
 * @target MZ
 * @plugindesc Force l'echange reserve BattleExchange sur un allie cible (mode instantane aleatoire).
 * @author ChatGPT
 * @base BattleExchange
 * @orderAfter BattleExchange
 *
 * @param autoSkillIds
 * @text Skills auto-echange (IDs)
 * @type string
 * @default 220
 * @desc IDs de competences separes par virgules (ex: 220,235). Ou utilisez <forceReserveExchangeOnAlly>.
 *
 * @command OpenForcedReserveExchange
 * @text Ouvrir echange reserve force
 * @desc Ouvre BattleExchange sur l'acteur memorise (legacy/menu), puis vide la memoire.
 *
 * @help
 * Utilisation recommandee:
 * - Les competences listees dans "Skills auto-echange (IDs)" sont detectees automatiquement.
 * - Alternative: ajoutez <forceReserveExchangeOnAlly> dans la note d'une competence.
 * - Si la cible est un allie (acteur), le plugin effectue un echange instantane
 *   avec un acteur vivant de la reserve (aleatoire), sans ouvrir de fenetre.
 *
 * Formule conseillee pour les skills concernees:
 *   b.isEnemy() ? (a.push(b,10,"jump"), (a.atk - b.def) + 4) : 0
 *
 * Le mode "menu" reste disponible pour compatibilite via commandes/script,
 * mais la detection auto des skills utilise le mode instantane.
 */
(() => {
    "use strict";

    const PLUGIN_NAME = "Cbn_BattleExchangeForceTarget";
    const LOG_PREFIX = `[${PLUGIN_NAME}]`;
    const params = PluginManager.parameters(PLUGIN_NAME) || {};
    const AUTO_SKILL_IDS = parseSkillIdList(params.autoSkillIds || "220");
    console.log(`${LOG_PREFIX} Loaded`);

    function parseSkillIdList(raw) {
        return String(raw || "")
            .split(",")
            .map(s => Number(s.trim()))
            .filter(n => Number.isInteger(n) && n > 0);
    }

    function setForcedActorId(actorId) {
        const id = Number(actorId || 0);
        if (!$gameTemp || id <= 0) return false;
        $gameTemp._cbnForcedReserveExchangeActorId = id;
        $gameTemp._cbnForcedReserveExchangePending = true;
        $gameTemp._cbnForcedReserveExchangeReady = false;
        console.log(`${LOG_PREFIX} forced actor memorise: actorId=${id}.`);
        return true;
    }

    function consumeForcedActorId() {
        if (!$gameTemp) return 0;
        const id = Number($gameTemp._cbnForcedReserveExchangeActorId || 0);
        $gameTemp._cbnForcedReserveExchangeActorId = 0;
        $gameTemp._cbnForcedReserveExchangePending = false;
        $gameTemp._cbnForcedReserveExchangeReady = false;
        return id;
    }

    function openForcedReserveExchange() {
        const actorId = consumeForcedActorId();
        if (actorId <= 0) {
            console.log(`${LOG_PREFIX} open force ignore: aucun actorId memorise.`);
            if (SoundManager && SoundManager.playBuzzer) SoundManager.playBuzzer();
            return false;
        }
        if (typeof window.CbnOpenReserveExchangeFromEvent !== "function") {
            console.log(`${LOG_PREFIX} CbnOpenReserveExchangeFromEvent introuvable (BattleExchange non charge?).`);
            if (SoundManager && SoundManager.playBuzzer) SoundManager.playBuzzer();
            return false;
        }
        console.log(`${LOG_PREFIX} ouverture echange force: actorId=${actorId}.`);
        window.CbnOpenReserveExchangeFromEvent(actorId);
        return true;
    }

    PluginManager.registerCommand(PLUGIN_NAME, "OpenForcedReserveExchange", function() {
        openForcedReserveExchange();
    });

    window.CbnRequestReserveExchangeForTarget = function(targetBattler, commonEventId) {
        if ($gameTemp && $gameTemp.isPrediction && $gameTemp.isPrediction()) {
            console.log(`${LOG_PREFIX} request ignoree: phase prediction.`);
            return 0;
        }
        if (!targetBattler || !targetBattler.isActor || !targetBattler.isActor()) {
            console.log(`${LOG_PREFIX} request ignoree: cible non-acteur.`);
            return 0;
        }
        const actorId = targetBattler.actorId ? Number(targetBattler.actorId() || 0) : 0;
        if (actorId <= 0) {
            console.log(`${LOG_PREFIX} request ignoree: actorId invalide.`);
            return 0;
        }
        if (!setForcedActorId(actorId)) return 0;
        const ceId = Number(commonEventId || 0);
        if ($gameTemp && $gameTemp.reserveCommonEvent && ceId > 0) {
            $gameTemp.reserveCommonEvent(ceId);
            console.log(`${LOG_PREFIX} common event reserve: id=${ceId}.`);
        }
        return 0;
    };
    globalThis.CbnRequestReserveExchangeForTarget = window.CbnRequestReserveExchangeForTarget;

    window.CbnSetForcedReserveExchangeActorId = function(actorId) {
        return setForcedActorId(actorId);
    };
    globalThis.CbnSetForcedReserveExchangeActorId = window.CbnSetForcedReserveExchangeActorId;

    window.CbnOpenForcedReserveExchange = function() {
        return openForcedReserveExchange();
    };
    globalThis.CbnOpenForcedReserveExchange = window.CbnOpenForcedReserveExchange;

    Game_BattlerBase.prototype.requestReserveExchangeForTarget = function(targetBattler, commonEventId) {
        return window.CbnRequestReserveExchangeForTarget(targetBattler, commonEventId);
    };

    const _Scene_Map_srpgAfterAction = Scene_Map.prototype.srpgAfterAction;
    Scene_Map.prototype.srpgAfterAction = function() {
        if ($gameTemp && $gameTemp._cbnForcedReserveExchangePending) {
            $gameTemp._cbnForcedReserveExchangeReady = true;
            console.log(`${LOG_PREFIX} echange force marque pret (after_action).`);
        }
        _Scene_Map_srpgAfterAction.call(this);
        // Tentative immediate apres la fin d'action, avant bascule de phase.
        tryAutoOpenForcedExchange(true);
    };

    const _Scene_Map_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function() {
        _Scene_Map_update.call(this);
        tryAutoOpenForcedExchange();
    };

    function tryAutoOpenForcedExchange(forceTry) {
        if (
            !$gameTemp ||
            !$gameTemp._cbnForcedReserveExchangePending ||
            !$gameTemp._cbnForcedReserveExchangeReady ||
            typeof window.CbnOpenReserveExchangeFromEvent !== "function"
        ) {
            return;
        }
        if (!$gameSystem || !$gameSystem.isSRPGMode || !$gameSystem.isSRPGMode()) return;
        if (!$gameSystem.isBattlePhase || !$gameSystem.isSubBattlePhase) return;

        const battlePhase = String($gameSystem.isBattlePhase() || "");
        const sub = String($gameSystem.isSubBattlePhase() || "");
        const allowedSubPhases = [
            "normal",
            "actor_command_window",
            "after_action",
            "afterAction",
            "actor_move",
            "actor_target",
            "battle_window",
            "auto_actor_command"
        ];
        const phaseAllowed = battlePhase === "actor_phase" || battlePhase === "auto_actor_phase";
        const subAllowed = allowedSubPhases.includes(sub);
        if ((!phaseAllowed || !subAllowed) && !forceTry) {
            console.log(
                `${LOG_PREFIX} auto-open en attente: battlePhase=${battlePhase} subPhase=${sub}` +
                ` pending=${$gameTemp._cbnForcedReserveExchangePending} ready=${$gameTemp._cbnForcedReserveExchangeReady}.`
            );
            return;
        }

        const actorId = Number($gameTemp._cbnForcedReserveExchangeActorId || 0);
        if (actorId <= 0) {
            $gameTemp._cbnForcedReserveExchangePending = false;
            return;
        }
        console.log(`${LOG_PREFIX} auto-open echange force: actorId=${actorId}, subPhase=${sub}.`);
        const opened = window.CbnOpenReserveExchangeFromEvent(actorId);
        if (!opened) {
            console.log(`${LOG_PREFIX} auto-open tentative non confirmee, nouvelle tentative au prochain update.`);
        }
    }

    const _Game_Action_apply = Game_Action.prototype.apply;
    Game_Action.prototype.apply = function(target) {
        _Game_Action_apply.call(this, target);
        tryMarkForcedExchangeFromAction.call(this, target);
    };

    function tryMarkForcedExchangeFromAction(target) {
        if ($gameTemp && $gameTemp.isPrediction && $gameTemp.isPrediction()) return;
        if (!$gameSystem || !$gameSystem.isSRPGMode || !$gameSystem.isSRPGMode()) return;
        if (!target || !target.isActor || !target.isActor()) return;

        const item = this.item ? this.item() : null;
        if (!item || !item.id) return;
        const skillId = Number(item.id);
        const hasMetaTag = !!(item.meta && item.meta.forceReserveExchangeOnAlly);
        const skillIsConfigured = AUTO_SKILL_IDS.includes(skillId);
        if (!hasMetaTag && !skillIsConfigured) return;

        const subject = this.subject ? this.subject() : null;
        if (!subject || !subject.isActor || !subject.isActor()) return;

        const targetId = target.actorId ? Number(target.actorId() || 0) : 0;
        if (targetId <= 0) return;

        const didSwap = tryInstantRandomReserveSwap(target);
        console.log(
            `${LOG_PREFIX} auto-detect skill=${skillId} sur allie actorId=${targetId}` +
            ` via=${hasMetaTag ? "meta" : "param"} instantSwap=${didSwap}.`
        );
    }

    function tryInstantRandomReserveSwap(targetBattler) {
        if (!$gameSystem || !$gameMap || !$gameActors || !$gameParty) return false;
        if (!targetBattler || !targetBattler.isActor || !targetBattler.isActor()) return false;
        if (!$gameSystem.ActorToEvent) return false;
        const eventId = Number($gameSystem.ActorToEvent(targetBattler.actorId()) || 0);
        if (eventId <= 0) return false;
        const targetEvent = $gameMap.event(eventId);
        if (!targetEvent || targetEvent.isErased()) return false;

        const candidates = getReserveCandidatesExcluding(targetBattler);
        if (candidates.length <= 0) {
            console.log(`${LOG_PREFIX} instant swap ignore: aucune reserve vivante.`);
            return false;
        }
        const randomIndex = Math.floor(Math.random() * candidates.length);
        const newActor = candidates[randomIndex];
        if (!newActor || !newActor.actorId) return false;

        const preservedTp = newActor.tp;
        $gameMap.changeActor(eventId, newActor.actorId());
        newActor.setTp(preservedTp);
        if (targetEvent && targetEvent.setDirection) {
            targetEvent.setDirection(targetEvent.direction());
        }
        console.log(
            `${LOG_PREFIX} instant swap succes: oldActor=${targetBattler.actorId()} -> newActor=${newActor.actorId()} eventId=${eventId}.`
        );
        return true;
    }

    function getReserveCandidatesExcluding(excludedActor) {
        if ($gameParty.getRemainingActorList) {
            if ($gameParty.initRemainingActorList) $gameParty.initRemainingActorList();
            const ids = $gameParty.getRemainingActorList();
            return ids
                .map(id => $gameActors.actor(id))
                .filter(actor => actor && actor.isAlive && actor.isAlive() && actor !== excludedActor);
        }
        const battleMembers = $gameParty.battleMembers ? $gameParty.battleMembers() : [];
        return ($gameParty.allMembers ? $gameParty.allMembers() : []).filter(actor =>
            actor &&
            actor.isAlive &&
            actor.isAlive() &&
            actor !== excludedActor &&
            !battleMembers.includes(actor)
        );
    }
})();

