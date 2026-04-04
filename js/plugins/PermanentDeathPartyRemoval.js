/*:
 * @target MZ
 * @plugindesc Retire définitivement un acteur de l'équipe lorsqu'il meurt. v1.2.0
 * @author ChatGPT
 *
 * @param removeOnlyIfInParty
 * @text Seulement si dans l'equipe
 * @type boolean
 * @on Oui
 * @off Non
 * @default true
 * @desc Si Oui, l'acteur est marque seulement s'il etait dans l'equipe au moment de la mort.
 *
 * @command restoreActor
 * @text Restaurer un acteur retire
 * @desc Retire l'etat "mort permanent" d'un acteur, puis optionnellement le remet dans l'equipe.
 *
 * @arg actorId
 * @text ID Acteur
 * @type actor
 * @default 1
 *
 * @arg addToParty
 * @text Re-ajouter a l'equipe
 * @type boolean
 * @on Oui
 * @off Non
 * @default true
 *
 * @help
 * Ce plugin applique une "mort permanente" :
 * - Quand un acteur meurt (HP tombe a 0), il est retire de l'equipe.
 * - Son ID est enregistre dans une liste de "retire definitivement".
 * - Tant qu'il est dans cette liste, les commandes/events qui tentent de l'ajouter
 *   a l'equipe seront ignorees.
 *
 * Plugin Command :
 * - Restaurer un acteur retire
 *   Permet d'enlever un acteur de la liste permanente (et optionnellement
 *   de le remettre dans l'equipe).
 *
 * Notes:
 * - Ce systeme n'efface pas l'acteur de la base de donnees.
 * - Il empeche simplement sa presence dans le groupe tant qu'il est "retire".
 * - La commande de restauration reinitialise aussi les PV/MP et retire l'etat mort
 *   sur l'instance Game_Actor (sinon SRPG le considere encore comme mort au deploiement).
 *
 * Script / autre plugin (ex. CharacterCarousel) avant addActor :
 *   prepareRecruitmentAfterPermanentDeath(actorId);
 */

(() => {
    "use strict";

    const PLUGIN_NAME = "PermanentDeathPartyRemoval";
    const params = PluginManager.parameters(PLUGIN_NAME);
    const REMOVE_ONLY_IF_IN_PARTY = params.removeOnlyIfInParty !== "false";

    const getRemovedActorIds = () => {
        if (!$gameSystem._permanentDeathRemovedActorIds) {
            $gameSystem._permanentDeathRemovedActorIds = [];
        }
        return $gameSystem._permanentDeathRemovedActorIds;
    };

    const isPermanentlyRemoved = actorId => {
        if (!$gameSystem) return false;
        return getRemovedActorIds().includes(actorId);
    };

    const markPermanentlyRemoved = actorId => {
        const removed = getRemovedActorIds();
        if (!removed.includes(actorId)) {
            removed.push(actorId);
        }
    };

    const unmarkPermanentlyRemoved = actorId => {
        const removed = getRemovedActorIds();
        const index = removed.indexOf(actorId);
        if (index >= 0) {
            removed.splice(index, 1);
        }
    };

    const parseActorIdFromArgs = args => {
        if (!args) return 0;
        let raw = args.actorId;
        if (raw && typeof raw === "object" && "id" in raw) {
            raw = raw.id;
        }
        const n = Number(raw);
        return Number.isFinite(n) ? Math.floor(n) : 0;
    };

    /** Ranime l'instance Game_Actor (PV, etats, visible) — necessaire pour SRPG / formation. */
    const reviveActorForPartyReturn = actor => {
        if (!actor) return;
        if (actor.isHidden && actor.isHidden()) {
            actor.appear();
        }
        const deathId = actor.deathStateId();
        if (actor.isStateAffected(deathId)) {
            actor.removeState(deathId);
        }
        if (actor.recoverAll) {
            actor.recoverAll();
        }
        if (actor.hp <= 0 && actor.mhp > 0 && actor.setHp) {
            actor.setHp(actor.mhp);
        }
        if (actor.clearResult) {
            actor.clearResult();
        }
    };

    /**
     * Retrait de la liste mort permanente + ranimation. A appeler avant tout addActor
     * (commande evenement, carousel, script), pas seulement via la commande restoreActor.
     */
    const prepareRecruitmentAfterPermanentDeath = actorId => {
        if (actorId <= 0) return;
        unmarkPermanentlyRemoved(actorId);
        reviveActorForPartyReturn($gameActors.actor(actorId));
    };

    if (typeof window !== "undefined") {
        window.prepareRecruitmentAfterPermanentDeath = prepareRecruitmentAfterPermanentDeath;
    }

    const _Game_Actor_die = Game_Actor.prototype.die;
    Game_Actor.prototype.die = function() {
        _Game_Actor_die.call(this);

        const actorId = this.actorId();
        const inParty = $gameParty && $gameParty.members().includes(this);
        if (REMOVE_ONLY_IF_IN_PARTY && !inParty) return;

        markPermanentlyRemoved(actorId);
        if ($gameParty) {
            $gameParty.removeActor(actorId);
        }
    };

    const _Game_Party_addActor = Game_Party.prototype.addActor;
    Game_Party.prototype.addActor = function(actorId) {
        if (isPermanentlyRemoved(actorId)) {
            return;
        }
        _Game_Party_addActor.call(this, actorId);
        const a = $gameActors.actor(actorId);
        if (
            a &&
            (a.isDead() ||
                a.hp <= 0 ||
                (a.isDeathStateAffected && a.isDeathStateAffected()))
        ) {
            reviveActorForPartyReturn(a);
        }
    };

    PluginManager.registerCommand(PLUGIN_NAME, "restoreActor", args => {
        const actorId = parseActorIdFromArgs(args);
        const addToParty = args.addToParty !== "false";
        if (actorId <= 0) return;

        prepareRecruitmentAfterPermanentDeath(actorId);

        if (addToParty && $gameParty) {
            $gameParty.addActor(actorId);
        }
    });
})();
