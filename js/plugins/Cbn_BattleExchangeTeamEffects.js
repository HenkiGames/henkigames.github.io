/*:
 * @target MZ
 * @plugindesc Extension de BattleExchange: declenche une competence SRPG lors d'un echange d'acteur (equipe cible uniquement).
 * @author ChatGPT
 *
 * @param targetTeamId
 * @text Team ID cible
 * @type number
 * @min 1
 * @default 5
 * @desc La mecanique s'active seulement si TeamSelection retourne cet ID d'equipe.
 *
 * @param actorSkillMetaKey
 * @text Note-tag ID competence
 * @type string
 * @default battleExchangeSkillId
 * @desc Cle meta sur l'acteur. Exemple: <battleExchangeSkillId:123>
 *
 * @help
 * Place ce plugin SOUS BattleExchange.
 *
 * Fonctionnement:
 * - Lors d'un echange SRPG valide (Scene_Map), si l'equipe active == Team ID cible:
 *   - l'acteur entrant est lu dans la fenetre d'echange
 *   - son note-tag est lu pour recuperer l'ID competence
 *   - la competence est appliquee immediatement avec prise en compte du scope
 * - Le declenchement est ignore si l'echange vient d'un remplacement force apres mort.
 *
 * Note-tag acteur (dans la base de donnees):
 *   <battleExchangeSkillId:15>
 *
 * Cles meta alternatives supportees automatiquement:
 *   <BattleExchangeSkillId:15>
 *   <exchangeSkillId:15>
 */
(() => {
    "use strict";

    const PLUGIN_NAME = "Cbn_BattleExchangeTeamEffects";
    const params = PluginManager.parameters(PLUGIN_NAME);
    const TARGET_TEAM_ID = parsePositiveInt(params.targetTeamId || 5);
    const META_KEY = String(params.actorSkillMetaKey || "battleExchangeSkillId").trim();
    const LOG_PREFIX = `[${PLUGIN_NAME}]`;

    function parsePositiveInt(value) {
        const n = Number(value);
        return Number.isInteger(n) && n > 0 ? n : 0;
    }

    function extractTrailingInteger(value) {
        if (value === undefined || value === null) return 0;
        const text = String(value).trim();
        if (!text) return 0;
        const match = text.match(/(\d+)$/);
        return match ? parsePositiveInt(match[1]) : 0;
    }

    function parseTeamIdLoose(value) {
        const direct = parsePositiveInt(value);
        if (direct > 0) return direct;
        return extractTrailingInteger(value);
    }

    function currentTeamIdNumber() {
        const api = window.TeamSelection;
        if (api) {
            if (typeof api.getCurrentTeamIdAsNumber === "function") {
                const fromNumericApi = parsePositiveInt(api.getCurrentTeamIdAsNumber());
                if (fromNumericApi > 0) return fromNumericApi;
            }
            if (typeof api.getCurrentTeamId === "function") {
                const fromStringApi = parseTeamIdLoose(api.getCurrentTeamId());
                if (fromStringApi > 0) return fromStringApi;
            }
        }

        // Fallback robuste: lit la variable configurée dans TeamSelection.
        const teamSelectionParams = PluginManager.parameters("TeamSelection") || {};
        const varId = parsePositiveInt(teamSelectionParams.selectedTeamVariableId || 114);
        if (varId > 0 && $gameVariables) {
            return parseTeamIdLoose($gameVariables.value(varId));
        }
        return 0;
    }

    function isTargetTeamActive() {
        return TARGET_TEAM_ID > 0 && currentTeamIdNumber() === TARGET_TEAM_ID;
    }

    function skillIdFromActorMeta(actor) {
        if (!actor || !actor.actor || !actor.actor()) {
            console.log(`${LOG_PREFIX} lecture meta ignoree: acteur invalide.`);
            return 0;
        }
        const meta = actor.actor().meta || {};
        const raw =
            meta[META_KEY] ??
            meta.battleExchangeSkillId ??
            meta.BattleExchangeSkillId ??
            meta.exchangeSkillId;
        const skillId = parsePositiveInt(raw);
        const actorId = actor.actorId ? actor.actorId() : 0;
        const actorName = actor.name ? actor.name() : "";
        console.log(
            `${LOG_PREFIX} lecture meta acteur=${actorId}:${actorName} key="${META_KEY}" raw=`,
            raw,
            "meta=",
            meta,
            `=> skillId=${skillId}`
        );
        return skillId;
    }

    function collectAliveSrpgBattlers(type) {
        if (!$gameMap || !$gameMap.events || !$gameSystem || !$gameSystem.EventToUnit) return [];
        const out = [];
        const events = $gameMap.events();
        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            if (!ev || ev.isErased()) continue;
            const pair = $gameSystem.EventToUnit(ev.eventId());
            if (!pair || pair[0] !== type || !pair[1]) continue;
            const battler = pair[1];
            if (battler.isAlive && battler.isAlive()) {
                out.push({ battler, event: ev });
            }
        }
        return out;
    }

    function resolveTargetsByScope(subject, skill) {
        if (!subject || !skill) return [];
        const scope = Number(skill.scope || 0);
        const opponents = subject.isActor && subject.isActor()
            ? collectAliveSrpgBattlers("enemy").map(e => e.battler)
            : collectAliveSrpgBattlers("actor").map(e => e.battler);
        const friends = subject.isActor && subject.isActor()
            ? collectAliveSrpgBattlers("actor").map(e => e.battler)
            : collectAliveSrpgBattlers("enemy").map(e => e.battler);

        // Scopes MZ usuels:
        // 1: 1 ennemi, 2: tous ennemis, 7: utilisateur, 8: 1 allié, 10: tous alliés
        switch (scope) {
        case 1:
            return opponents.length > 0 ? [opponents[0]] : [];
        case 2:
            return opponents;
        case 7:
            return [subject];
        case 8:
            return [subject];
        case 10:
            return friends;
        default:
            return [subject];
        }
    }

    function applyExchangeSkill(actor, activeEvent) {
        const skillId = skillIdFromActorMeta(actor);
        if (skillId <= 0 || !$dataSkills[skillId]) {
            console.log(`${LOG_PREFIX} competence non appliquee: skillId invalide ou inexistante (${skillId}).`);
            return;
        }
        if (!actor.canUse || !actor.canUse($dataSkills[skillId])) {
            console.log(`${LOG_PREFIX} competence non applicable (canUse=false): skillId=${skillId}.`);
            return;
        }

        const skill = $dataSkills[skillId];
        const targets = resolveTargetsByScope(actor, skill);
        const targetDebug = targets.map(t => {
            if (!t) return "null";
            const name = t.name ? t.name() : "unknown";
            const isActor = t.isActor && t.isActor();
            return `${isActor ? "actor" : "enemy"}:${name}`;
        });
        console.log(
            `${LOG_PREFIX} scope skill=${skill.scope} targets=${targets.length} skillId=${skillId}.`,
            targetDebug
        );
        if (targets.length <= 0) {
            console.log(`${LOG_PREFIX} competence non appliquee: aucune cible resolue.`);
            return;
        }
        for (let i = 0; i < targets.length; i++) {
            const target = targets[i];
            const action = new Game_Action(actor);
            action.setSkill(skillId);
            action.apply(target);
            if (target.startDamagePopup) target.startDamagePopup();
            if (target.performResultEffects) target.performResultEffects();
        }
        const globalAction = new Game_Action(actor);
        globalAction.setSkill(skillId);
        globalAction.applyGlobal();
        console.log(`${LOG_PREFIX} competence appliquee: skillId=${skillId}, cibles=${targets.length}.`);

        if (activeEvent && $gameTemp && $gameTemp.requestAnimation) {
            const animationId = Number($dataSkills[skillId].animationId || 0);
            if (animationId > 0) {
                $gameTemp.requestAnimation([activeEvent], animationId);
            }
        }

    }

    const _Scene_Map_cbnMapOnExchangeOk = Scene_Map.prototype._cbnMapOnExchangeOk;
    Scene_Map.prototype._cbnMapOnExchangeOk = function() {
        const wasDeathExchange = !!this._cbnExchangeOpenFromDeath;
        const selectedActor =
            this._exchangeWindow && this._exchangeWindow.actor
                ? this._exchangeWindow.actor(this._exchangeWindow.index())
                : null;
        const activeEvent =
            typeof mapEventForSubjectActor === "function"
                ? mapEventForSubjectActor(this)
                : ($gameTemp && $gameTemp.activeEvent ? $gameTemp.activeEvent() : null);

        _Scene_Map_cbnMapOnExchangeOk.call(this);

        const currentTeam = currentTeamIdNumber();
        console.log(
            `${LOG_PREFIX} validation echange: wasDeath=${wasDeathExchange} teamCourante=${currentTeam} teamCible=${TARGET_TEAM_ID} actor=`,
            selectedActor
        );
        if (wasDeathExchange) {
            console.log(`${LOG_PREFIX} stop: echange suite a mort (ignore volontairement).`);
            return;
        }
        if (!selectedActor) {
            console.log(`${LOG_PREFIX} stop: aucun acteur selectionne dans la fenetre d'echange.`);
            return;
        }
        if (currentTeam !== TARGET_TEAM_ID) {
            console.log(`${LOG_PREFIX} stop: team non ciblee.`);
            return;
        }
        applyExchangeSkill(selectedActor, activeEvent);
    };
})();
