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
    const SRPG_EXIST_ENEMY_VAR_ID = Number((PluginManager.parameters("SRPG_core_MZ") || {}).existEnemyVarID || 2);

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

    function collectAliveSrpgBattlersBySide(wantActors) {
        if (!$gameMap || !$gameMap.events || !$gameSystem || !$gameSystem.EventToUnit) return [];
        const out = [];
        const events = $gameMap.events();
        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            if (!ev || ev.isErased()) continue;
            const pair = $gameSystem.EventToUnit(ev.eventId());
            if (!pair || !pair[1]) continue;
            const battler = pair[1];
            const isActor = battler.isActor && battler.isActor();
            const isEnemy = battler.isEnemy && battler.isEnemy();
            if (wantActors && !isActor) continue;
            if (!wantActors && !isEnemy) continue;
            if (battler.isAlive && battler.isAlive()) {
                out.push({ battler, event: ev });
            }
        }
        return out;
    }

    function isSrpgMapContext() {
        return !!(
            $gameSystem &&
            $gameSystem.isSRPGMode &&
            $gameSystem.isSRPGMode() &&
            $gameMap &&
            $gameMap.events
        );
    }

    function collectAliveBattlersBySide(subjectIsActor, wantOpponents) {
        if (isSrpgMapContext()) {
            if (subjectIsActor) {
                return wantOpponents
                    ? collectAliveSrpgBattlersBySide(false).map(e => e.battler)
                    : collectAliveSrpgBattlersBySide(true).map(e => e.battler);
            }
            return wantOpponents
                ? collectAliveSrpgBattlersBySide(true).map(e => e.battler)
                : collectAliveSrpgBattlersBySide(false).map(e => e.battler);
        }

        // Combat classique (Scene_Battle): on se base sur troop/party.
        if (subjectIsActor) {
            const opponents = $gameTroop && $gameTroop.aliveMembers ? $gameTroop.aliveMembers() : [];
            const friends = $gameParty && $gameParty.aliveMembers ? $gameParty.aliveMembers() : [];
            return wantOpponents ? opponents : friends;
        }
        const opponents = $gameParty && $gameParty.aliveMembers ? $gameParty.aliveMembers() : [];
        const friends = $gameTroop && $gameTroop.aliveMembers ? $gameTroop.aliveMembers() : [];
        return wantOpponents ? opponents : friends;
    }

    function resolveTargetsByScope(subject, skill) {
        if (!subject || !skill) return [];
        const scope = Number(skill.scope || 0);
        const subjectIsActor = subject.isActor && subject.isActor();
        const opponents = collectAliveBattlersBySide(subjectIsActor, true);
        const friends = collectAliveBattlersBySide(subjectIsActor, false);
        const srpgAreaType = String((skill.meta && skill.meta.srpgAreaType) || "").trim().toLowerCase();

        // Priorite aux tags SRPG de zone si presents.
        if (srpgAreaType === "allopponent") {
            return opponents;
        }
        if (srpgAreaType === "allfriend") {
            return friends;
        }
        if (srpgAreaType === "self") {
            return [subject];
        }

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
        const targetEvents = resolveEventsForTargets(targets);
        const srpgAreaType = String((skill.meta && skill.meta.srpgAreaType) || "").trim();
        const srpgAreaRange = Number((skill.meta && skill.meta.srpgAreaRange) || 0);
        const targetDebug = targets.map(t => {
            if (!t) return "null";
            const name = t.name ? t.name() : "unknown";
            const isActor = t.isActor && t.isActor();
            return `${isActor ? "actor" : "enemy"}:${name}`;
        });
        const opponentsDebug = opponentsForDebug(actor).map(t => {
            const name = t.name ? t.name() : "unknown";
            return `enemy:${name}`;
        });
        console.log(
            `${LOG_PREFIX} scope skill=${skill.scope} targets=${targets.length} skillId=${skillId}.`,
            targetDebug
        );
        console.log(
            `${LOG_PREFIX} srpgAreaType=${srpgAreaType || "(none)"} srpgAreaRange=${srpgAreaRange}.`
        );
        console.log(`${LOG_PREFIX} ennemis detectes=`, opponentsDebug);
        if (targets.length <= 0) {
            console.log(`${LOG_PREFIX} competence non appliquee: aucune cible resolue.`);
            return;
        }
        for (let i = 0; i < targets.length; i++) {
            const target = targets[i];
            const targetName = target && target.name ? target.name() : `target#${i}`;
            const hpBefore = target && typeof target.hp === "number" ? target.hp : null;
            const mpBefore = target && typeof target.mp === "number" ? target.mp : null;
            const tpBefore = target && typeof target.tp === "number" ? target.tp : null;
            const action = new Game_Action(actor);
            action.setSkill(skillId);
            action.apply(target);
            if (target && target.result && target.result() && !target.result().used) {
                forceApplyAction(action, target);
            }
            const hpAfter = target && typeof target.hp === "number" ? target.hp : null;
            const mpAfter = target && typeof target.mp === "number" ? target.mp : null;
            const tpAfter = target && typeof target.tp === "number" ? target.tp : null;
            const result = target && target.result ? target.result() : null;
            console.log(
                `${LOG_PREFIX} cible=${targetName} hp ${hpBefore}=>${hpAfter} mp ${mpBefore}=>${mpAfter} tp ${tpBefore}=>${tpAfter}` +
                ` | used=${result ? result.used : "?"}` +
                ` missed=${result ? result.missed : "?"}` +
                ` evaded=${result ? result.evaded : "?"}` +
                ` critical=${result ? result.critical : "?"}` +
                ` hpDamage=${result ? result.hpDamage : "?"}` +
                ` mpDamage=${result ? result.mpDamage : "?"}` +
                ` tpDamage=${result ? result.tpDamage : "?"}` +
                ` addedStates=${result && result.addedStateObjects ? result.addedStateObjects().map(s => s.id).join(",") : ""}`
            );
            if (target.startDamagePopup) target.startDamagePopup();
            if (target.performResultEffects) target.performResultEffects();
        }
        const globalAction = new Game_Action(actor);
        globalAction.setSkill(skillId);
        globalAction.applyGlobal();
        console.log(`${LOG_PREFIX} competence appliquee: skillId=${skillId}, cibles=${targets.length}.`);

        const animationId = Number($dataSkills[skillId].animationId || 0);
        if ($gameTemp && $gameTemp.requestAnimation && animationId > 0) {
            if (targetEvents.length > 0) {
                $gameTemp.requestAnimation(targetEvents, animationId);
                console.log(`${LOG_PREFIX} animation jouee sur ${targetEvents.length} cible(s).`);
            } else if (activeEvent) {
                $gameTemp.requestAnimation([activeEvent], animationId);
                console.log(`${LOG_PREFIX} fallback animation jouee sur lanceur (aucune cible map resolue).`);
            }
        }

        processDeathsThroughSrpgPipeline(targets);

    }

    function forceApplyAction(action, target) {
        if (!action || !target || !target.result) return;
        const result = target.result();
        result.clear();
        result.used = true;
        result.missed = Math.random() >= action.itemHit(target);
        result.evaded = !result.missed && Math.random() < action.itemEva(target);
        result.physical = action.isPhysical();
        result.drain = action.isDrain();

        if (result.isHit()) {
            if (action.item() && action.item().damage && action.item().damage.type > 0) {
                result.critical = Math.random() < action.itemCri(target);
                const value = action.makeDamageValue(target, result.critical);
                action.executeDamage(target, value);
            }
            const effects = action.item() && Array.isArray(action.item().effects) ? action.item().effects : [];
            for (let i = 0; i < effects.length; i++) {
                action.applyItemEffect(target, effects[i]);
            }
            action.applyItemUserEffect(target);
        }
        console.log(`${LOG_PREFIX} fallback forceApplyAction execute (used=true).`);
    }

    function processDeathsThroughSrpgPipeline(targets) {
        const deadTargets = (targets || []).filter(t => t && t.isDead && t.isDead());
        if (deadTargets.length <= 0) return;
        const scene = SceneManager._scene;
        if (scene && typeof scene.srpgBattlerDeadAfterBattle === "function") {
            console.log(`${LOG_PREFIX} morts detectees=${deadTargets.length}, appel pipeline SRPG natif.`);
            scene.srpgBattlerDeadAfterBattle();
        }
        cleanupDeadEnemyTargets(deadTargets);
    }

    function cleanupDeadEnemyTargets(deadTargets) {
        if (!$gameMap || !$gameSystem) return;
        for (let i = 0; i < deadTargets.length; i++) {
            const battler = deadTargets[i];
            if (!battler || !battler.isEnemy || !battler.isEnemy()) continue;
            if (!battler.srpgEventId) continue;
            const eventId = Number(battler.srpgEventId() || 0);
            if (eventId <= 0) continue;
            const ev = $gameMap.event(eventId);
            if (!ev || ev.isErased()) continue;

            // Nettoyage cible uniquement pour les ennemis morts non traités par le pipeline standard.
            if ($gameSystem.setEventToUnit) {
                $gameSystem.setEventToUnit(eventId, "null", null);
            }
            if (ev.setType) {
                ev.setType("");
            }
            ev.erase();
            if ($gameVariables && SRPG_EXIST_ENEMY_VAR_ID > 0) {
                const oldValue = Number($gameVariables.value(SRPG_EXIST_ENEMY_VAR_ID) || 0);
                $gameVariables.setValue(SRPG_EXIST_ENEMY_VAR_ID, Math.max(0, oldValue - 1));
            }
            console.log(`${LOG_PREFIX} cleanup mort ciblee: enemy eventId=${eventId}.`);
        }
    }

    function opponentsForDebug(subject) {
        const subjectIsActor = subject && subject.isActor && subject.isActor();
        return collectAliveBattlersBySide(subjectIsActor, true);
    }

    function resolveEventsForTargets(targets) {
        if (!Array.isArray(targets) || !$gameMap) return [];
        const out = [];
        for (let i = 0; i < targets.length; i++) {
            const t = targets[i];
            if (!t || !t.srpgEventId) continue;
            const eventId = Number(t.srpgEventId() || 0);
            if (eventId <= 0) continue;
            const ev = $gameMap.event(eventId);
            if (ev && !ev.isErased()) out.push(ev);
        }
        return out;
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

    const _Scene_Battle_onExchangeOk = Scene_Battle.prototype.onExchangeOk;
    Scene_Battle.prototype.onExchangeOk = function() {
        const selectedActor =
            this._exchangeWindow && this._exchangeWindow.actor
                ? this._exchangeWindow.actor(this._exchangeWindow.index())
                : null;
        const fromEvent = !!this._cbnExchangeOpenFromEvent;
        _Scene_Battle_onExchangeOk.call(this);

        const currentTeam = currentTeamIdNumber();
        console.log(
            `${LOG_PREFIX} validation echange battle: fromEvent=${fromEvent} teamCourante=${currentTeam} teamCible=${TARGET_TEAM_ID} actor=`,
            selectedActor
        );
        if (!selectedActor) {
            console.log(`${LOG_PREFIX} battle stop: aucun acteur selectionne.`);
            return;
        }
        if (currentTeam !== TARGET_TEAM_ID) {
            console.log(`${LOG_PREFIX} battle stop: team non ciblee.`);
            return;
        }
        applyExchangeSkill(selectedActor, null);
    };
})();
