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
 * @param ignoreCanUseCheck
 * @text Ignorer verification canUse
 * @type boolean
 * @on Oui
 * @off Non
 * @default true
 * @desc Si Oui, l'effet d'entree est applique meme si actor.canUse(skill) est false.
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
 *
 * Note-tag competence optionnel (sur la competence declenchee a l'echange):
 *   <teamCooldownReduce:1>
 * Alternative acceptees:
 *   <reduceTeamCooldown:1>
 *   <reduceTeamCooldowns:1>
 *   <allyCooldownReduce:1>
 * Effet: reduit les cooldowns de tous les allies vivants du lanceur de X.
 *
 * Portee optionnelle de la reduction:
 *   <teamCooldownScope:all>       -> tous les allies (acteurs en jeu + reserve) [defaut]
 *   <teamCooldownScope:deployed>  -> seulement les allies actuellement en jeu
 *   <teamCooldownScope:reserve>   -> seulement les allies en reserve
 */
(() => {
    "use strict";

    const PLUGIN_NAME = "Cbn_BattleExchangeTeamEffects";
    const params = PluginManager.parameters(PLUGIN_NAME);
    const TARGET_TEAM_ID = parsePositiveInt(params.targetTeamId || 5);
    const META_KEY = String(params.actorSkillMetaKey || "battleExchangeSkillId").trim();
    const IGNORE_CAN_USE_CHECK = String(params.ignoreCanUseCheck || "true") !== "false";
    const LOG_PREFIX = `[${PLUGIN_NAME}]`;
    const SRPG_EXIST_ENEMY_VAR_ID = Number((PluginManager.parameters("SRPG_core_MZ") || {}).existEnemyVarID || 2);
    const TEAM_COOLDOWN_REDUCE_TAGS = [
        "teamCooldownReduce",
        "reduceTeamCooldown",
        "reduceTeamCooldowns",
        "allyCooldownReduce"
    ];
    const TEAM_COOLDOWN_SCOPE_TAGS = [
        "teamCooldownScope",
        "cooldownScope",
        "exchangeCooldownScope"
    ];
    let _lastTriggerSignature = "";

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

    function isSrpgObstacleBattler(battler) {
        return !!(
            battler &&
            battler.isEnemy &&
            battler.isEnemy() &&
            battler.enemy &&
            battler.enemy() &&
            battler.enemy().meta &&
            battler.enemy().meta.srpgObstacle
        );
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
            if (isSrpgObstacleBattler(battler)) continue;
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

    function resolveTargetsByScope(subject, skill, activeEvent) {
        if (!subject || !skill) return [];
        const scope = Number(skill.scope || 0);
        const subjectIsActor = subject.isActor && subject.isActor();
        const opponents = collectAliveBattlersBySide(subjectIsActor, true);
        const friends = collectAliveBattlersBySide(subjectIsActor, false);
        const srpgAreaType = String((skill.meta && skill.meta.srpgAreaType) || "").trim().toLowerCase();
        const srpgAreaRange = Number((skill.meta && skill.meta.srpgAreaRange) || 0);

        if (isSrpgMapContext()) {
            const isUserScope = scope === 11;
            const isSelfCenteredAoE = (isUserScope || srpgAreaType === "self") && srpgAreaRange > 0;
            if (isSelfCenteredAoE) {
                return resolveSelfCenteredAoETargets(subject, skill, activeEvent);
            }
        }

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
        // 1: 1 ennemi, 2: tous ennemis, 7: 1 allié, 8: tous alliés, 11: utilisateur
        switch (scope) {
        case 1:
            return opponents.length > 0 ? [opponents[0]] : [];
        case 2:
            return opponents;
        case 7:
            return friends.length > 0 ? [friends[0]] : [subject];
        case 8:
            return friends;
        case 10:
            return friends;
        case 11:
            return [subject];
        default:
            return [subject];
        }
    }

    function resolveSelfCenteredAoETargets(subject, skill, activeEvent) {
        const out = [];
        const range = Math.max(1, Number((skill && skill.meta && skill.meta.srpgAreaRange) || 0));
        const minRange = Math.max(0, Number((skill && skill.meta && skill.meta.srpgAreaMinRange) || 0));
        const shape = String((skill && skill.meta && skill.meta.srpgAreaType) || "circle").trim().toLowerCase() || "circle";
        const centerEvent = activeEvent || eventForBattler(subject);
        if (!centerEvent) {
            console.log(`${LOG_PREFIX} AOE-DEBUG resolveSelfCenteredAoE: centerEvent introuvable.`);
            return out;
        }
        console.log(
            `${LOG_PREFIX} AOE-DEBUG center=${centerEvent.eventId ? centerEvent.eventId() : "?"}` +
            ` pos=(${centerEvent.posX()},${centerEvent.posY()}) range=${range} min=${minRange} shape=${shape}`
        );

        const adjacentCandidates = collectAliveSrpgBattlersBySide(false).concat(collectAliveSrpgBattlersBySide(true));
        const centerX = Number(centerEvent.posX());
        const centerY = Number(centerEvent.posY());
        const dir = centerEvent.direction ? Number(centerEvent.direction()) : 2;
        for (let i = 0; i < adjacentCandidates.length; i++) {
            const entry = adjacentCandidates[i];
            if (!entry || !entry.battler || !entry.event) continue;
            if (entry.battler === subject) continue;
            const dxRaw = Number(entry.event.posX()) - centerX;
            const dyRaw = Number(entry.event.posY()) - centerY;
            const dx = Math.abs(dxRaw);
            const dy = Math.abs(dyRaw);
            const manhattan = dx + dy;
            const name = entry.battler.name ? entry.battler.name() : "unknown";
            const side = entry.battler.isActor && entry.battler.isActor() ? "actor" : "enemy";
            const inRange = $gameMap && $gameMap.inArea
                ? $gameMap.inArea(dxRaw, dyRaw, range, minRange, shape, dir)
                : manhattan <= range;
            console.log(
                `${LOG_PREFIX} AOE-DEBUG candidat ${side}:${name}` +
                ` pos=(${entry.event.posX()},${entry.event.posY()}) dx=${dxRaw} dy=${dyRaw} d=${manhattan}` +
                ` inRange=${inRange}`
            );
            if (inRange) out.push(entry.battler);
        }
        console.log(`${LOG_PREFIX} AOE-DEBUG total cibles adjacentes=${out.length}.`);
        return out;
    }

    function eventForBattler(battler) {
        if (!battler || !battler.srpgEventId || !$gameMap) return null;
        const eventId = Number(battler.srpgEventId() || 0);
        if (eventId <= 0) return null;
        const ev = $gameMap.event(eventId);
        return ev && !ev.isErased() ? ev : null;
    }

    function applyExchangeSkill(actor, activeEvent) {
        const skillId = skillIdFromActorMeta(actor);
        if (skillId <= 0 || !$dataSkills[skillId]) {
            console.log(`${LOG_PREFIX} competence non appliquee: skillId invalide ou inexistante (${skillId}).`);
            return;
        }
        const canUse = !!(actor.canUse && actor.canUse($dataSkills[skillId]));
        if (!canUse && !IGNORE_CAN_USE_CHECK) {
            console.log(`${LOG_PREFIX} competence non applicable (canUse=false): skillId=${skillId}.`);
            return;
        }
        if (!canUse && IGNORE_CAN_USE_CHECK) {
            console.log(`${LOG_PREFIX} canUse=false ignore (param actif): skillId=${skillId}.`);
        }

        const skill = $dataSkills[skillId];
        const cooldownReduced = applyTeamCooldownReductionFromSkill(actor, skill);
        const targets = resolveTargetsByScope(actor, skill, activeEvent);
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
        if (activeEvent) {
            console.log(
                `${LOG_PREFIX} AOE-DEBUG activeEvent id=${activeEvent.eventId ? activeEvent.eventId() : "?"}` +
                ` pos=(${activeEvent.posX()},${activeEvent.posY()})`
            );
        } else {
            console.log(`${LOG_PREFIX} AOE-DEBUG activeEvent absent.`);
        }
        console.log(
            `${LOG_PREFIX} srpgAreaType=${srpgAreaType || "(none)"} srpgAreaRange=${srpgAreaRange}.`
        );
        console.log(`${LOG_PREFIX} ennemis detectes=`, opponentsDebug);
        if (targets.length <= 0) {
            if (cooldownReduced) {
                console.log(`${LOG_PREFIX} aucune cible resolue, mais reduction des cooldowns appliquee.`);
            } else {
                console.log(`${LOG_PREFIX} competence non appliquee: aucune cible resolue.`);
            }
            return;
        }
        withTemporaryAoECenter(actor, skill, activeEvent, () => {
            console.log(
                `${LOG_PREFIX} AOE-DEBUG centre temporaire area=(${typeof $gameTemp.areaX === "function" ? $gameTemp.areaX() : "?"},` +
                `${typeof $gameTemp.areaY === "function" ? $gameTemp.areaY() : "?"})`
            );
            for (let i = 0; i < targets.length; i++) {
                const target = targets[i];
                const targetName = target && target.name ? target.name() : `target#${i}`;
                const targetEvent = eventForBattler(target);
                const hpBefore = target && typeof target.hp === "number" ? target.hp : null;
                const mpBefore = target && typeof target.mp === "number" ? target.mp : null;
                const tpBefore = target && typeof target.tp === "number" ? target.tp : null;
                if (targetEvent) {
                    console.log(
                        `${LOG_PREFIX} AOE-DEBUG application sur ${targetName}` +
                        ` event=${targetEvent.eventId ? targetEvent.eventId() : "?"}` +
                        ` pos=(${targetEvent.posX()},${targetEvent.posY()})` +
                        ` distCentre=${Math.abs(targetEvent.posX() - $gameTemp.areaX()) + Math.abs(targetEvent.posY() - $gameTemp.areaY())}`
                    );
                } else {
                    console.log(`${LOG_PREFIX} AOE-DEBUG application sur ${targetName} sans event map.`);
                }
                const action = new Game_Action(actor);
                action.setSkill(skillId);
                action.apply(target);
                if (target && target.result && target.result() && !target.result().used) {
                    console.log(`${LOG_PREFIX} AOE-DEBUG fallback forceApplyAction pour ${targetName}.`);
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
        });
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

    function teamCooldownReductionAmountFromSkill(skill) {
        if (!skill || !skill.meta) return 0;
        for (let i = 0; i < TEAM_COOLDOWN_REDUCE_TAGS.length; i++) {
            const key = TEAM_COOLDOWN_REDUCE_TAGS[i];
            const value = parsePositiveInt(skill.meta[key]);
            if (value > 0) return value;
        }
        return 0;
    }

    function cooldownScopeFromSkill(skill) {
        if (!skill || !skill.meta) return "all";
        for (let i = 0; i < TEAM_COOLDOWN_SCOPE_TAGS.length; i++) {
            const key = TEAM_COOLDOWN_SCOPE_TAGS[i];
            const raw = skill.meta[key];
            if (raw === undefined || raw === null) continue;
            const text = String(raw).trim().toLowerCase();
            if (text === "all" || text === "team" || text === "party") return "all";
            if (text === "deployed" || text === "field" || text === "active" || text === "battle") return "deployed";
            if (text === "reserve" || text === "bench") return "reserve";
        }
        return "all";
    }

    function deployedActorIdsOnMap() {
        if (!$gameMap || !$gameMap.events || !$gameSystem || !$gameSystem.EventToUnit) return [];
        const ids = [];
        const events = $gameMap.events();
        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            if (!ev || ev.isErased()) continue;
            const pair = $gameSystem.EventToUnit(ev.eventId());
            const battler = pair && pair[1];
            if (!battler || !battler.isActor || !battler.isActor()) continue;
            if (!battler.actorId) continue;
            ids.push(Number(battler.actorId()));
        }
        return ids;
    }

    function reserveActorIdsFromParty(deployedIds) {
        if (
            !$gameSystem ||
            !$gameSystem.isSRPGMode ||
            !$gameSystem.isSRPGMode() ||
            !$gameParty ||
            !$gameParty.getRemainingActorList
        ) {
            return [];
        }
        if ($gameParty.initRemainingActorList) {
            $gameParty.initRemainingActorList();
        }
        const ids = $gameParty.getRemainingActorList();
        if (!Array.isArray(ids)) return [];
        const deployedSet = new Set(deployedIds || []);
        const out = [];
        for (let i = 0; i < ids.length; i++) {
            const id = Number(ids[i] || 0);
            if (id <= 0) continue;
            if (deployedSet.has(id)) continue;
            out.push(id);
        }
        return out;
    }

    function battlersFromActorIds(ids) {
        if (!$gameActors || !$gameActors.actor || !Array.isArray(ids)) return [];
        const out = [];
        for (let i = 0; i < ids.length; i++) {
            const actor = $gameActors.actor(Number(ids[i] || 0));
            if (actor) out.push(actor);
        }
        return out;
    }

    function teamMembersForCooldownReduction(subject, scope) {
        if (!subject) return [];
        const subjectIsActor = !!(subject.isActor && subject.isActor());
        if (!subjectIsActor) {
            return $gameTroop && $gameTroop.members ? $gameTroop.members() : [];
        }

        const normalizedScope = scope || "all";
        if (!$gameSystem || !$gameSystem.isSRPGMode || !$gameSystem.isSRPGMode()) {
            const allMembers = $gameParty && $gameParty.allMembers ? $gameParty.allMembers() : [];
            if (normalizedScope === "deployed") {
                return $gameParty && $gameParty.battleMembers ? $gameParty.battleMembers() : allMembers;
            }
            if (normalizedScope === "reserve") {
                const battleMembers = $gameParty && $gameParty.battleMembers ? $gameParty.battleMembers() : [];
                return allMembers.filter(member => member && !battleMembers.includes(member));
            }
            return allMembers;
        }

        const deployedIds = deployedActorIdsOnMap();
        if (normalizedScope === "deployed") {
            return battlersFromActorIds(deployedIds);
        }
        if (normalizedScope === "reserve") {
            return battlersFromActorIds(reserveActorIdsFromParty(deployedIds));
        }
        return $gameParty && $gameParty.allMembers ? $gameParty.allMembers() : [];
    }

    function reduceBattlerCooldownsBy(battler, amount) {
        if (!battler || amount <= 0) return false;
        if (!battler._skillCooldowns) return false;
        const keys = Object.keys(battler._skillCooldowns);
        if (keys.length <= 0) return false;
        let changed = false;
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const current = Number(battler._skillCooldowns[key] || 0);
            if (current <= 0) continue;
            const next = Math.max(0, current - amount);
            if (next <= 0) {
                delete battler._skillCooldowns[key];
            } else {
                battler._skillCooldowns[key] = next;
            }
            changed = true;
        }
        return changed;
    }

    function applyTeamCooldownReductionFromSkill(subject, skill) {
        const amount = teamCooldownReductionAmountFromSkill(skill);
        if (amount <= 0) return false;
        const scope = cooldownScopeFromSkill(skill);
        const members = teamMembersForCooldownReduction(subject, scope);
        if (!Array.isArray(members) || members.length <= 0) return false;
        let affectedMembers = 0;
        for (let i = 0; i < members.length; i++) {
            const battler = members[i];
            if (!battler || !battler.isAlive || !battler.isAlive()) continue;
            if (reduceBattlerCooldownsBy(battler, amount)) affectedMembers++;
        }
        console.log(
            `${LOG_PREFIX} reduction cooldown equipe: amount=${amount}, scope=${scope}, membresAffectes=${affectedMembers}.`
        );
        return true;
    }

    function withTemporaryAoECenter(subject, skill, activeEvent, callback) {
        if (!$gameTemp || typeof callback !== "function") {
            if (typeof callback === "function") callback();
            return;
        }
        const centerEvent = activeEvent || eventForBattler(subject);
        if (!centerEvent) {
            console.log(`${LOG_PREFIX} AOE-DEBUG withTemporaryAoECenter: aucun centre, execution brute.`);
            callback();
            return;
        }
        const previousAoE = $gameTemp._activeAoE || null;
        const areaRange = Number((skill && skill.meta && skill.meta.srpgAreaRange) || 0);
        const areaType = String((skill && skill.meta && skill.meta.srpgAreaType) || "circle").trim().toLowerCase() || "circle";
        const areaMin = Number((skill && skill.meta && skill.meta.srpgAreaMinRange) || 0);
        const facingDir = centerEvent.direction ? Number(centerEvent.direction()) : 2;

        $gameTemp._activeAoE = {
            x: Number(centerEvent.posX()),
            y: Number(centerEvent.posY()),
            size: Math.max(1, areaRange),
            minSize: Math.max(0, areaMin),
            shape: areaType,
            dir: facingDir
        };
        console.log(
            `${LOG_PREFIX} AOE-DEBUG set _activeAoE x=${$gameTemp._activeAoE.x} y=${$gameTemp._activeAoE.y}` +
            ` size=${$gameTemp._activeAoE.size} shape=${$gameTemp._activeAoE.shape} dir=${$gameTemp._activeAoE.dir}`
        );
        try {
            callback();
        } finally {
            $gameTemp._activeAoE = previousAoE;
            if (previousAoE) {
                console.log(
                    `${LOG_PREFIX} AOE-DEBUG restore _activeAoE x=${previousAoE.x} y=${previousAoE.y}` +
                    ` size=${previousAoE.size} shape=${previousAoE.shape}`
                );
            } else {
                console.log(`${LOG_PREFIX} AOE-DEBUG restore _activeAoE=null.`);
            }
        }
    }

    function triggerExchangeEffectOnce(actor, activeEvent, contextTag) {
        if (!actor || !actor.actorId) return;
        const frame = (Graphics && Number.isInteger(Graphics.frameCount)) ? Graphics.frameCount : 0;
        const signature = `${frame}:${actor.actorId()}`;
        if (_lastTriggerSignature === signature) {
            console.log(`${LOG_PREFIX} skip doublon trigger=${signature}.`);
            return;
        }
        _lastTriggerSignature = signature;
        applyExchangeSkill(actor, activeEvent);
    }

    function forceApplyAction(action, target) {
        if (!action || !target || !target.result) return;
        const result = target.result();
        const item = action.item ? action.item() : null;
        const damage = item && item.damage ? item.damage : null;
        result.clear();
        result.used = true;
        result.missed = Math.random() >= action.itemHit(target);
        result.evaded = !result.missed && Math.random() < action.itemEva(target);
        result.physical = action.isPhysical();
        result.drain = action.isDrain();

        if (result.isHit()) {
            if (damage && damage.type > 0) {
                result.critical = Math.random() < action.itemCri(target);
                const value = action.makeDamageValue(target, result.critical);
                action.executeDamage(target, value);
            } else if (damage && typeof action.evalDamageFormula === "function") {
                // Les skills utilitaires (damage type 0) utilisent souvent la formule
                // pour des effets de position (ex: push/pull). On force son evaluation.
                const formulaText = damage.formula || "";
                const targetSide =
                    target && target.isActor && target.isActor()
                        ? "actor"
                        : (target && target.isEnemy && target.isEnemy() ? "enemy" : "unknown");
                console.log(
                    `${LOG_PREFIX} AOE-DEBUG eval formule damageType=0 target=${targetSide}` +
                    ` formula="${String(formulaText)}"`
                );
                const formulaValue = action.evalDamageFormula(target);
                console.log(`${LOG_PREFIX} AOE-DEBUG resultat formule=${formulaValue}.`);
            }
            const effects = item && Array.isArray(item.effects) ? item.effects : [];
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
        syncSrpgExistEnemyCount();
    }

    function syncSrpgExistEnemyCount() {
        if (
            !$gameSystem ||
            !$gameSystem.isSRPGMode ||
            !$gameSystem.isSRPGMode() ||
            !$gameMap ||
            !$gameMap.events ||
            !$gameVariables ||
            SRPG_EXIST_ENEMY_VAR_ID <= 0 ||
            !$gameSystem.EventToUnit
        ) {
            return;
        }
        const events = $gameMap.events();
        let aliveEnemyCount = 0;
        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            if (!ev || ev.isErased()) continue;
            const pair = $gameSystem.EventToUnit(ev.eventId());
            const battler = pair && pair[1];
            if (!battler || !battler.isEnemy || !battler.isEnemy()) continue;
            // Compat SRPG_ObstacleGate: les obstacles enemies ne comptent pas
            // dans existEnemyVarID pour la condition de victoire.
            if (
                battler.enemy &&
                battler.enemy() &&
                battler.enemy().meta &&
                battler.enemy().meta.srpgObstacle
            ) {
                continue;
            }
            if (battler.isAlive && battler.isAlive()) {
                aliveEnemyCount++;
            }
        }
        const oldValue = Number($gameVariables.value(SRPG_EXIST_ENEMY_VAR_ID) || 0);
        if (oldValue !== aliveEnemyCount) {
            $gameVariables.setValue(SRPG_EXIST_ENEMY_VAR_ID, aliveEnemyCount);
            console.log(
                `${LOG_PREFIX} resync existEnemyVarID ${SRPG_EXIST_ENEMY_VAR_ID}: ${oldValue}=>${aliveEnemyCount}.`
            );
        }
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
        const sourceActor =
            this._cbnExchangeSourceActor && this._cbnExchangeSourceActor.isActor
                ? this._cbnExchangeSourceActor
                : null;
        const isRealDeathReplacement = !!(
            wasDeathExchange &&
            sourceActor &&
            sourceActor.isDead &&
            sourceActor.isDead()
        );
        const activeEvent =
            typeof mapEventForSubjectActor === "function"
                ? mapEventForSubjectActor(this)
                : ($gameTemp && $gameTemp.activeEvent ? $gameTemp.activeEvent() : null);

        _Scene_Map_cbnMapOnExchangeOk.call(this);

        const currentTeam = currentTeamIdNumber();
        console.log(
            `${LOG_PREFIX} validation echange: wasDeath=${wasDeathExchange} realDeath=${isRealDeathReplacement} teamCourante=${currentTeam} teamCible=${TARGET_TEAM_ID} actor=`,
            selectedActor
        );
        if (isRealDeathReplacement) {
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
        triggerExchangeEffectOnce(selectedActor, activeEvent, "scene_map_on_exchange_ok");
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
        triggerExchangeEffectOnce(selectedActor, null, "scene_battle_on_exchange_ok");
    };

    // Filet de securite: certains flux "echange reserve (evenement)" peuvent contourner
    // le hook Scene_Map selon l'ordre de plugins. On se greffe sur le swap effectif.
    const _Game_Map_changeActor_CbnExchangeFx = Game_Map.prototype.changeActor;
    Game_Map.prototype.changeActor = function(eventId, actorId) {
        _Game_Map_changeActor_CbnExchangeFx.call(this, eventId, actorId);
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Map)) return;
        const currentTeam = currentTeamIdNumber();
        if (currentTeam !== TARGET_TEAM_ID) return;
        const sourceActor =
            scene._cbnExchangeSourceActor && scene._cbnExchangeSourceActor.isActor
                ? scene._cbnExchangeSourceActor
                : null;
        const isRealDeathReplacement = !!(
            scene._cbnExchangeOpenFromDeath &&
            sourceActor &&
            sourceActor.isDead &&
            sourceActor.isDead()
        );
        if (isRealDeathReplacement) return;
        // Accepte aussi les swaps faits via evenement commun (ex: skill 235) qui
        // peuvent contourner le contexte UI de BattleExchange.
        const swappedActor = $gameActors && $gameActors.actor ? $gameActors.actor(Number(actorId || 0)) : null;
        if (!swappedActor) return;
        const inExchangeFlow = !!(scene._exchangeWindow || scene._cbnExchangeOpenFromEvent || scene._cbnExchangeOpenFromDeath);
        console.log(
            `${LOG_PREFIX} fallback changeActor hook eventId=${eventId} actorId=${actorId} inExchangeFlow=${inExchangeFlow}.`
        );
        triggerExchangeEffectOnce(swappedActor, $gameMap.event(eventId), "game_map_change_actor_fallback");
    };
})();
