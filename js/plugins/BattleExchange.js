/*:
 * @target MZ
 * @plugindesc Ajoute une commande "Échanger" en combat pour remplacer un acteur actif par un autre hors combat. Commande plugin pour ouvrir l'échange depuis un événement commun (SRPG).
 * @author ChatGPT
 *
 * @command OpenReserveExchangeFromEvent
 * @text Échange réserve (événement)
 * @desc Ouvre la fenêtre de réserve. Met l'interprète d'événement en pause jusqu'à OK/Annuler, puis restaure la sous-phase SRPG.
 *
 * @arg actorId
 * @text ID acteur à remplacer (0 = auto)
 * @desc 0 = dernier sujet de compétence (MZ), sinon BattleManager / activeEvent SRPG.
 * @type actor
 * @default 0
 *
 * @param deferDeathExchangeToEnemyPhaseEnd
 * @text Echange mort apres phase ennemie
 * @type boolean
 * @on Oui
 * @off Non
 * @default true
 * @desc Si Oui, apres mort en phase ennemie la fenetre de remplacant ne s'ouvre qu'a la fin de la phase ennemie (srpgTurnEnd), pour eviter que la meme action ou un combo touche le remplacant.
 *
 * @param firstExchangeSwitchId
 * @text Interrupteur premier échange
 * @type switch
 * @default 116
 * @desc Passe cet interrupteur sur ON lors du premier échange manuel réussi du joueur.
 *
 * @help
 * Événement commun : commande plugin « Échange réserve (événement) ».
 * Pendant le map battle SRPG, le déroulé de l'événement est suspendu jusqu'au choix.
 * Script optionnel : CbnOpenReserveExchangeFromEvent(actorId)
 *
 * Mort d'un acteur allié après une action (phase after_battle SRPG) : si la réserve
 * n'est pas vide, le menu d'échange s'ouvre avant de retirer l'unité de la carte.
 * Avec « Echange mort apres phase ennemie » activé, si la mort survient pendant la
 * phase ennemie, l'ouverture du menu est retardée jusqu'à la fin de cette phase.
 *
 * Mort par état (poison, etc.) ou dégâts de sol : même file d'échange que les morts
 * après combat carte ; si plusieurs unités meurent dans le même cycle (ex. fin de tour)
 * et qu'il n'y a qu'un remplaçant en réserve, seul le premier défunt ouvre le menu —
 * les autres sont retirés du groupe et effacés de la carte.
 */

(() => {
    const PLUGIN_NAME = "BattleExchange";
    const bxParams = PluginManager.parameters(PLUGIN_NAME);
    const DEFER_DEATH_EXCHANGE_TO_ENEMY_PHASE_END =
        bxParams.deferDeathExchangeToEnemyPhaseEnd !== "false";
    const FIRST_EXCHANGE_SWITCH_ID = Number(bxParams.firstExchangeSwitchId || 116);
    // SRPG core utilise le symbole 'exchange' (lié à <srpgActorCommandList> avec 'swap').
    const EXCHANGE_SYMBOL = "exchange";
    const EXCHANGE_ANIMATION_ID = 40;
    const EXCHANGE_SE = { name: "Magic3", volume: 90, pitch: 100, pan: 0 };
    const EXCHANGE_SE_DELAY_MS = 300;
    const EXCHANGE_SE_META_KEY = "exchangeSe";
    const SRPG_TURN_VAR_ID = Number((PluginManager.parameters("SRPG_core_MZ") || {}).turnVarID || 3);

    function lastActionSubjectActor() {
        if ($gameTemp.lastActionData && $gameTemp.lastActionData(2) > 0) {
            return $gameActors.actor($gameTemp.lastActionData(2));
        }
        return null;
    }

    function mapEventForSubjectActor(scene) {
        const subject =
            (scene && scene._cbnExchangeSourceActor) ||
            lastActionSubjectActor() ||
            (BattleManager.actor && BattleManager.actor());
        if (subject && subject.actorId && $gameSystem.ActorToEvent) {
            const eid = $gameSystem.ActorToEvent(subject.actorId());
            if (eid) {
                const ev = $gameMap.event(eid);
                if (ev) return ev;
            }
        }
        return $gameTemp.activeEvent ? $gameTemp.activeEvent() : null;
    }

    function resolveCurrentActor(scene) {
        if (scene && scene._cbnExchangeSourceActor) {
            return scene._cbnExchangeSourceActor;
        }
        const subj = lastActionSubjectActor();
        if (subj) return subj;
        return BattleManager.actor ? BattleManager.actor() : null;
    }

    function getExchangeCandidates(currentActor) {
        // En mode SRPG (Battle Prepare), la liste "remaining actors" est la source
        // la plus fiable des unités non déjà déployées.
        if ($gameSystem && $gameSystem.isSRPGMode && $gameSystem.isSRPGMode() &&
            $gameParty.getRemainingActorList) {
            if ($gameParty.initRemainingActorList) {
                $gameParty.initRemainingActorList();
            }
            const ids = $gameParty.getRemainingActorList();
            return ids
                .map(id => $gameActors.actor(id))
                .filter(actor => actor && actor.isAlive() && actor !== currentActor);
        }

        // Fallback standard RPG Maker: membres vivants hors battleMembers.
        return $gameParty.allMembers().filter(actor =>
            actor &&
            actor.isAlive() &&
            actor !== currentActor &&
            !$gameParty.battleMembers().includes(actor)
        );
    }

    function mapActorCommandWindow(scene) {
        if (!scene) return null;
        return scene._mapSrpgActorCommandWindow || scene._actorCommandWindow || null;
    }

    function resolveCommandActor(commandWindow) {
        if (commandWindow && commandWindow._actor) {
            return commandWindow._actor;
        }
        if ($gameSystem && $gameSystem.isSRPGMode && $gameSystem.isSRPGMode() &&
            $gameTemp && $gameTemp.activeEvent && $gameTemp.activeEvent()) {
            const battlerArray = $gameSystem.EventToUnit($gameTemp.activeEvent().eventId());
            if (battlerArray && battlerArray[1]) {
                return battlerArray[1];
            }
        }
        return null;
    }

    function exchangeTurnCount() {
        if ($gameVariables && SRPG_TURN_VAR_ID > 0) {
            const turn = Number($gameVariables.value(SRPG_TURN_VAR_ID) || 0);
            if (turn > 0) return turn;
        }
        if ($gameTroop && typeof $gameTroop.turnCount === "function") {
            return $gameTroop.turnCount();
        }
        return 0;
    }

    function syncExchangeUsageWithCurrentTurn() {
        if (!$gameSystem) return;
        const turn = exchangeTurnCount();
        const data = $gameSystem._cbnExchangeUsage;
        if (!data || data.turn !== turn) {
            $gameSystem._cbnExchangeUsage = { turn, menuUsed: false, eventUsed: false };
            return;
        }
        // Ancienne sauvegarde { turn, used: true } → les deux voies considérées comme déjà utilisées ce tour
        if (data.used === true && data.menuUsed === undefined) {
            data.menuUsed = true;
            data.eventUsed = true;
            delete data.used;
        }
    }

    function isMenuExchangeUsedThisTurn() {
        if (!$gameSystem) return false;
        syncExchangeUsageWithCurrentTurn();
        const data = $gameSystem._cbnExchangeUsage;
        return data.turn === exchangeTurnCount() && data.menuUsed === true;
    }

    function isEventExchangeUsedThisTurn() {
        if (!$gameSystem) return false;
        syncExchangeUsageWithCurrentTurn();
        const data = $gameSystem._cbnExchangeUsage;
        return data.turn === exchangeTurnCount() && data.eventUsed === true;
    }

    function markMenuExchangeUsedThisTurn() {
        if (!$gameSystem) return;
        syncExchangeUsageWithCurrentTurn();
        $gameSystem._cbnExchangeUsage.menuUsed = true;
    }

    function markEventExchangeUsedThisTurn() {
        if (!$gameSystem) return;
        syncExchangeUsageWithCurrentTurn();
        $gameSystem._cbnExchangeUsage.eventUsed = true;
    }

    function markFirstPlayerExchangeSwitch() {
        if (!$gameSwitches) return;
        if (FIRST_EXCHANGE_SWITCH_ID <= 0) return;
        if ($gameSwitches.value(FIRST_EXCHANGE_SWITCH_ID)) return;
        $gameSwitches.setValue(FIRST_EXCHANGE_SWITCH_ID, true);
    }

    function canUseExchangeCommand(actor) {
        if (!$gameSystem || !$gameSystem.isSRPGMode || !$gameSystem.isSRPGMode()) return false;
        if (!$gameSystem.isBattlePhase || $gameSystem.isBattlePhase() !== "actor_phase") return false;
        if (!$gameSystem.isSubBattlePhase || $gameSystem.isSubBattlePhase() !== "actor_command_window") return false;
        if (isMenuExchangeUsedThisTurn()) return false;
        const candidates = getExchangeCandidates(actor || null);
        return candidates.length > 0;
    }

    function resetExchangeUsageForNewTurn() {
        if (!$gameSystem) return;
        $gameSystem._cbnExchangeUsage = {
            turn: exchangeTurnCount(),
            menuUsed: false,
            eventUsed: false
        };
    }

    function resolveExchangeSeForActor(actor) {
        const meta = actor && actor.actor && actor.actor().meta ? actor.actor().meta : null;
        const seName = meta && meta[EXCHANGE_SE_META_KEY] ? String(meta[EXCHANGE_SE_META_KEY]).trim() : "";
        if (!seName) return EXCHANGE_SE;
        return {
            name: seName,
            volume: EXCHANGE_SE.volume,
            pitch: EXCHANGE_SE.pitch,
            pan: EXCHANGE_SE.pan
        };
    }

    function playExchangeArrivalFx(event, actor) {
        if (EXCHANGE_ANIMATION_ID > 0 && $gameTemp && $gameTemp.requestAnimation) {
            $gameTemp.requestAnimation([event], EXCHANGE_ANIMATION_ID);
        }
        if (AudioManager && AudioManager.playSe) {
            const seData = resolveExchangeSeForActor(actor);
            setTimeout(() => {
                AudioManager.playSe(seData);
            }, EXCHANGE_SE_DELAY_MS);
        }
    }

    function ensureActorHasUsableAction(actor) {
        if (!actor) return;
        if (!actor.action || actor.action(0)) return;
        if (actor.clearActions) actor.clearActions();
        if (actor.makeActions) actor.makeActions();
        if (!actor.action(0) && actor.setAction) {
            actor.setAction(0, new Game_Action(actor));
        }
    }

    function ensureActiveSrpgActorHasUsableAction() {
        if (
            !$gameSystem || !$gameSystem.EventToUnit ||
            !$gameTemp || !$gameTemp.activeEvent || !$gameTemp.activeEvent()
        ) {
            return null;
        }
        const pair = $gameSystem.EventToUnit($gameTemp.activeEvent().eventId());
        const actor = pair && pair[1];
        ensureActorHasUsableAction(actor);
        return actor;
    }

    function refreshMapHpGaugeForEvent(scene, eventId, battler) {
        if (!scene || !scene._spriteset || !scene._spriteset._characterSprites) return;
        const sprites = scene._spriteset._characterSprites;
        for (const sprite of sprites) {
            if (!sprite || !sprite._character || !sprite._character.isEvent || !sprite._character.isEvent()) continue;
            if (!sprite._character.eventId || sprite._character.eventId() !== eventId) continue;
            if (sprite._HpGauge && sprite._HpGauge.setBattler) {
                sprite._HpGauge.setBattler(battler);
                sprite._HpGauge._requestRefresh = true;
                if (sprite._HpGauge.refresh) sprite._HpGauge.refresh();
            }
            break;
        }
    }

    function srpgExistActorVarId() {
        return Number((PluginManager.parameters("SRPG_core_MZ") || {}).existActorVarID || 1);
    }

    function srpgExistEnemyVarId() {
        return Number((PluginManager.parameters("SRPG_core_MZ") || {}).existEnemyVarID || 2);
    }

    function cbnPartyHasAnyAliveActor() {
        if (!$gameParty || !$gameParty.allMembers) return false;
        const members = $gameParty.allMembers();
        for (let i = 0; i < members.length; i++) {
            const a = members[i];
            if (a && a.isAlive && a.isAlive()) return true;
        }
        return false;
    }

    function applySrpgMapDeathErase(event, battler) {
        if (!event || !battler || event.isErased()) return;
        if (battler.isActor()) {
            $gameParty.removeActor(battler.actorId());
            if ($gameSystem.removeSrpgAllActors) {
                $gameSystem.removeSrpgAllActors(event.eventId());
            }
            $gameSystem.setEventToUnit(event.eventId(), "null", null);
            event.setType("");
        }
        event.erase();
        const valueId = battler.isActor() ? srpgExistActorVarId() : srpgExistEnemyVarId();
        const oldValue = $gameVariables.value(valueId);
        $gameVariables.setValue(valueId, oldValue - 1);
    }

    // Sortie du mode SRPG : si plus aucun acteur vivant n'existe dans le groupe, on force
    // l'entrée dans Scene_Gameover. Comme on n'est plus en SRPG, `CustomGameOverRedirect`
    // interceptera et redirigera vers le hub "comme convenu".
    if (Game_System.prototype.endSRPG) {
        const _CBN_Game_System_endSRPG_BX = Game_System.prototype.endSRPG;
        Game_System.prototype.endSRPG = function() {
            _CBN_Game_System_endSRPG_BX.call(this);
            if (!cbnPartyHasAnyAliveActor() && SceneManager && SceneManager.goto) {
                SceneManager.goto(Scene_Gameover);
            }
        };
    }

    // changeActor (SRPG_BattlePrepare) peut décaler la case via makeAppearPoint ; on revient
    // exactement sur la tuile (et la direction) de l'unité remplacée.
    function applyExchangeFinalizePosition(event, x, y, direction) {
        if (!event || !event.locate) return;
        event.locate(x, y);
        if (direction && event.setDirection) {
            event.setDirection(direction);
        }
        if ($gameMap.setEventImages) {
            $gameMap.setEventImages();
        }
    }

    /**
     * Après échange SRPG sur carte : MoveTable / moveList du déplacement de l'acteur
     * sortant restaient valides ; OK en actor_move rejouait l'ancien chemin sur le remplaçant.
     * Recalcul via srpgMakeMoveTableOriginalPos (originalPos / originalMove déjà à jour) pour
     * conserver un flux Annuler menu → actor_move avec zones de déplacement correctes.
     */
    function clearSrpgMovementStateAfterReserveSwap(activeEvent, arrivedBattler) {
        if (!$gameSystem || !$gameSystem.isSRPGMode || !$gameSystem.isSRPGMode()) return;
        if (activeEvent && activeEvent._srpgForceRoute) {
            activeEvent._srpgForceRoute = [];
        }
        if ($gameSystem.setSrpgWaitMoving) {
            $gameSystem.setSrpgWaitMoving(false);
        }
        if (arrivedBattler && arrivedBattler.setMovedStep) {
            arrivedBattler.setMovedStep(0);
        }
        if (activeEvent && $gameSystem.srpgMakeMoveTableOriginalPos) {
            $gameSystem.srpgMakeMoveTableOriginalPos(activeEvent);
        } else if ($gameTemp && $gameTemp.clearMoveTable) {
            $gameTemp.clearMoveTable();
        }
        if ($gameTemp && $gameTemp.setResetMoveList) {
            $gameTemp.setResetMoveList(true);
        }
        if ($gamePlayer && activeEvent) {
            const px = activeEvent.posX();
            const py = activeEvent.posY();
            if (typeof $gamePlayer.slideTo === "function") {
                $gamePlayer.slideTo(px, py);
            } else if ($gamePlayer.jump) {
                $gamePlayer.jump(px - $gamePlayer.x, py - $gamePlayer.y);
            }
        }
    }

    function sortExchangeBeforeWait(commandWindow) {
        if (!commandWindow || !commandWindow._list || !Array.isArray(commandWindow._list)) return;
        const list = commandWindow._list;
        const exchangeIndex = list.findIndex(cmd => cmd && cmd.symbol === EXCHANGE_SYMBOL);
        if (exchangeIndex < 0) return;
        const waitIndex = list.findIndex(cmd => cmd && cmd.symbol === "wait");
        if (waitIndex < 0 || exchangeIndex < waitIndex) return;
        const exchangeCommand = list.splice(exchangeIndex, 1)[0];
        list.splice(waitIndex, 0, exchangeCommand);
    }

    function resolveSourceActorForPlugin(actorIdArg) {
        const id = Number(actorIdArg);
        if (Number.isInteger(id) && id > 0) {
            const a = $gameActors.actor(id);
            if (a) return a;
        }
        const fromLast = lastActionSubjectActor();
        if (fromLast) return fromLast;
        if (BattleManager.actor && BattleManager.actor()) return BattleManager.actor();
        if ($gameSystem && $gameSystem.isSRPGMode && $gameSystem.isSRPGMode() &&
            $gameTemp && $gameTemp.activeEvent && $gameTemp.activeEvent()) {
            const battlerArray = $gameSystem.EventToUnit($gameTemp.activeEvent().eventId());
            if (battlerArray && battlerArray[1]) return battlerArray[1];
        }
        return null;
    }

    function clearExchangeEventWaitForScene(scene) {
        if (!scene) return;
        scene._cbnExchangeEventWaitActive = false;
        scene._cbnExchangeEventWaitInterpreter = null;
    }

    const _Game_Interpreter_updateWaitMode = Game_Interpreter.prototype.updateWaitMode;
    Game_Interpreter.prototype.updateWaitMode = function() {
        if (this._waitMode === "cbnBattleExchange") {
            const scene = SceneManager._scene;
            if (scene && scene._cbnExchangeEventWaitActive) {
                return true;
            }
            this._waitMode = "";
            return false;
        }
        return _Game_Interpreter_updateWaitMode.call(this);
    };

    // Reset du verrou 1 échange/tour à chaque nouveau tour SRPG.
    if (Game_System.prototype.srpgTurnPlus) {
        const _CBN_Game_System_srpgTurnPlus = Game_System.prototype.srpgTurnPlus;
        Game_System.prototype.srpgTurnPlus = function() {
            _CBN_Game_System_srpgTurnPlus.call(this);
            resetExchangeUsageForNewTurn();
        };
    }

    // Sécurité supplémentaire: certains flux SRPG démarrent le tour acteur
    // sans passer par le chemin attendu côté UI.
    if (Game_System.prototype.srpgStartActorTurn) {
        const _CBN_Game_System_srpgStartActorTurn = Game_System.prototype.srpgStartActorTurn;
        Game_System.prototype.srpgStartActorTurn = function() {
            _CBN_Game_System_srpgStartActorTurn.call(this);
            resetExchangeUsageForNewTurn();
            const scene = SceneManager._scene;
            if (
                scene &&
                scene._cbnTryStartNextDeathReserveExchange &&
                scene._cbnDeathExchangeQueue &&
                scene._cbnDeathExchangeQueue.length > 0
            ) {
                scene._cbnTryStartNextDeathReserveExchange();
            }
        };
    }

    // Fin de tour global : budget de remplacements pour morts simultanées (poison, etc.),
    // puis ouverture de la file d'échange (y compris après phase ennemie si file non vide).
    if (Game_System.prototype.srpgTurnEnd) {
        const _CBN_Game_System_srpgTurnEnd = Game_System.prototype.srpgTurnEnd;
        Game_System.prototype.srpgTurnEnd = function() {
            const scene = SceneManager._scene;
            if (scene instanceof Scene_Map && scene._cbnInitSlipDeathExchangeBudget) {
                scene._cbnInitSlipDeathExchangeBudget();
            }
            _CBN_Game_System_srpgTurnEnd.call(this);
            if (scene instanceof Scene_Map) {
                scene._cbnSlipDeathExchangeBudget = undefined;
            }
            if (
                scene &&
                scene._cbnTryStartNextDeathReserveExchange &&
                scene._cbnDeathExchangeQueue &&
                scene._cbnDeathExchangeQueue.length > 0
            ) {
                scene._cbnTryStartNextDeathReserveExchange();
            }
        };
    }

    Scene_Map.prototype._cbnInitSlipDeathExchangeBudget = function() {
        if (!$gameSystem.isSRPGMode || !$gameSystem.isSRPGMode()) {
            this._cbnSlipDeathExchangeBudget = 0;
            return;
        }
        let n = 0;
        if ($gameParty.initRemainingActorList) {
            $gameParty.initRemainingActorList();
        }
        if ($gameParty.getRemainingActorList) {
            const ids = $gameParty.getRemainingActorList();
            for (let i = 0; i < ids.length; i++) {
                const a = $gameActors.actor(ids[i]);
                if (a && a.isAlive()) n++;
            }
        }
        this._cbnSlipDeathExchangeBudget = n;
    };

    // Mort par dégâts de fin de tour (états HRG/slip, régénération SRPG) ou sol : même file
    // que srpgBattlerDeadAfterBattle ; le budget (init dans srpgTurnEnd) limite les remplacements
    // si plusieurs acteurs meurent dans le même cycle.
    const _CBN_Game_Battler_slipFloorAddDeath = Game_Battler.prototype.slipFloorAddDeath;
    Game_Battler.prototype.slipFloorAddDeath = function() {
        const event = this.srpgEventId && $gameMap.event(this.srpgEventId());
        if (!this.isDead() || !event || event.isErased()) {
            return _CBN_Game_Battler_slipFloorAddDeath.call(this);
        }
        if (!$gameSystem.isSRPGMode || !$gameSystem.isSRPGMode() || !this.isActor()) {
            return _CBN_Game_Battler_slipFloorAddDeath.call(this);
        }
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Map)) {
            return _CBN_Game_Battler_slipFloorAddDeath.call(this);
        }
        if (scene._cbnSlipDeathExchangeBudget === undefined || scene._cbnSlipDeathExchangeBudget === null) {
            scene._cbnInitSlipDeathExchangeBudget();
        }
        const canExchange =
            getExchangeCandidates(this).length > 0 &&
            scene._cbnSlipDeathExchangeBudget > 0;
        if (canExchange) {
            scene._cbnSlipDeathExchangeBudget--;
            SoundManager.playActorCollapse();
            if (!scene._cbnDeathExchangeQueue) {
                scene._cbnDeathExchangeQueue = [];
            }
            const eid = event.eventId();
            if (!scene._cbnDeathExchangeQueue.some(e => e.eventId === eid)) {
                scene._cbnDeathExchangeQueue.push({ eventId: eid });
            }
            scene._cbnBlockDeadAfterBattleForDeathExchange = true;
            return;
        }
        SoundManager.playActorCollapse();
        applySrpgMapDeathErase(event, this);
    };

    // ===============================
    // 🔹 AJOUT COMMANDE "ÉCHANGER"
    // ===============================
    const _Window_ActorCommand_makeCommandList = Window_ActorCommand.prototype.makeCommandList;
    Window_ActorCommand.prototype.makeCommandList = function() {
        _Window_ActorCommand_makeCommandList.call(this);
        syncExchangeUsageWithCurrentTurn();
        // SRPG core gère la création de la commande via la meta (<srpgActorCommandList>).
        // On ne touche pas à la liste ici : on intercepte juste le clic dans processOk/callOkHandler.
        try {
            if ($gameSystem && $gameSystem.isSRPGMode && $gameSystem.isSRPGMode() &&
                $gameSystem.isBattlePhase && $gameSystem.isBattlePhase() === "actor_phase") {
                const symbols = (this._list || []).map(c => c && c.symbol).filter(Boolean);
                // Certains setups SRPG reconstruisent la liste pour de nouveaux acteurs et
                // laissent tomber la commande "exchange". On la force ici pour fiabiliser
                // l'affichage sur tous les acteurs.
                if (!symbols.includes(EXCHANGE_SYMBOL)) {
                    this.addCommand("Échanger", EXCHANGE_SYMBOL, canUseExchangeCommand(this._actor));
                } else {
                    // Met à jour l'état enabled/disabled quand la commande existe déjà.
                    for (const cmd of this._list) {
                        if (cmd && cmd.symbol === EXCHANGE_SYMBOL) {
                            cmd.enabled = canUseExchangeCommand(this._actor);
                            break;
                        }
                    }
                }
                sortExchangeBeforeWait(this);
            }
        } catch (e) {
            // ignore
        }
    };

    // ===============================
    // 🔹 WINDOW EXCHANGE
    // ===============================
    class Window_ExchangeActor extends Window_Selectable {
        initialize(rect) {
            super.initialize(rect);
            this._data = [];
            this._walkPatternStep = 0;
            this._walkAnimTick = 0;
            this.refresh();
        }

        itemHeight() {
            return 48;
        }

        update() {
            super.update();
            if (!this.visible || !this.isOpen()) return;
            this._walkAnimTick += 1;
            if (this._walkAnimTick >= 12) {
                this._walkAnimTick = 0;
                this._walkPatternStep = (this._walkPatternStep + 1) % 4;
                this.refresh();
            }
        }

        setActors(actors) {
            this._data = actors;
            this.refresh();
            this.select(0);
        }

        maxItems() {
            return this._data ? this._data.length : 0;
        }

        drawHpGauge(x, y, width, rate) {
            const h = 8;
            const gaugeY = y + 2;
            const fillW = Math.max(0, Math.floor((width - 2) * Math.max(0, Math.min(1, rate))));
            const c1 = ColorManager.hpGaugeColor1();
            const c2 = ColorManager.hpGaugeColor2();
            const back = ColorManager.gaugeBackColor();
            this.contents.fillRect(x, gaugeY, width, h, back);
            this.contents.gradientFillRect(x + 1, gaugeY + 1, fillW, h - 2, c1, c2);
        }

        drawWalkingCharacter(name, index, x, y, boxSize) {
            const bitmap = ImageManager.loadCharacter(name);
            const big = ImageManager.isBigCharacter(name);
            const pw = bitmap.width / (big ? 3 : 12);
            const ph = bitmap.height / (big ? 4 : 8);
            const blockX = big ? 0 : (index % 4) * 3;
            const blockY = big ? 0 : Math.floor(index / 4) * 4;
            const pattern = [0, 1, 2, 1][this._walkPatternStep] ?? 1;
            const direction = 0; // 0 => ligne "bas" (2)
            const sx = (blockX + pattern) * pw;
            const sy = (blockY + direction) * ph;
            const scale = Math.min((boxSize - 4) / pw, (boxSize - 4) / ph, 1);
            const dw = Math.floor(pw * scale);
            const dh = Math.floor(ph * scale);
            const dx = x + Math.floor((boxSize - dw) / 2);
            const dy = y + Math.floor((boxSize - dh) / 2);
            this.contents.blt(bitmap, sx, sy, pw, ph, dx, dy, dw, dh);
        }

        drawItem(index) {
            const actor = this._data[index];
            if (!actor) return;

            const rect = this.itemLineRect(index);
            const charBoxSize = 65;
            const charX = rect.x;
            const charY = rect.y + Math.floor((rect.height - charBoxSize) / 2) - 12;
            const contentX = charX + charBoxSize + 8;
            const contentWidth = Math.max(0, rect.width - (charBoxSize + 8));
            const hpText = `${actor.hp}/${actor.mhp}`;
            const hpWidth = this.textWidth(hpText) + 16;
            const gaugeWidth = 96;
            const spacing = 8;
            const nameWidth = Math.max(0, contentWidth - hpWidth - gaugeWidth - spacing * 2);
            const gaugeX = contentX + nameWidth + spacing;
            const gaugeY = rect.y + Math.floor((rect.height - 12) / 2);
            const hpRate = actor.mhp > 0 ? actor.hp / actor.mhp : 0;

            this.drawWalkingCharacter(actor.characterName(), actor.characterIndex(), charX, charY, charBoxSize);
            this.resetTextColor();
            this.drawText(actor.name(), contentX, rect.y, nameWidth, "left");
            this.drawHpGauge(gaugeX, gaugeY, gaugeWidth, hpRate);
            this.changeTextColor(ColorManager.hpColor(actor));
            this.drawText(hpText, gaugeX + gaugeWidth + spacing, rect.y, hpWidth, "right");
            this.resetTextColor();
        }

        actor(index) {
            return this._data[index];
        }
    }

    // ===============================
    // 🔹 SCENE BATTLE : CREATE WINDOWS
    // ===============================
    const _Scene_Battle_createAllWindows = Scene_Battle.prototype.createAllWindows;
    Scene_Battle.prototype.createAllWindows = function() {
        BattleManager._sceneCandidate = this;
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
    // 🔹 BIND HANDLER (ROBUSTE)
    // ===============================
    const _Scene_Battle_createActorCommandWindow = Scene_Battle.prototype.createActorCommandWindow;
    Scene_Battle.prototype.createActorCommandWindow = function() {
        _Scene_Battle_createActorCommandWindow.call(this);
    };

    const _Window_ActorCommand_setup = Window_ActorCommand.prototype.setup;
    Window_ActorCommand.prototype.setup = function(actor) {
        _Window_ActorCommand_setup.call(this, actor);
        syncExchangeUsageWithCurrentTurn();

        // Injecte la commande "exchange" au cas où SRPG core (ou un autre plugin)
        // la ferait disparaître après une action.
        try {
            if ($gameSystem && $gameSystem.isSRPGMode && $gameSystem.isSRPGMode() &&
                $gameSystem.isBattlePhase && $gameSystem.isBattlePhase() === "actor_phase" &&
                $gameSystem.isSubBattlePhase && $gameSystem.isSubBattlePhase() === "actor_command_window") {
                const symbols = (this._list || []).map(c => c && c.symbol).filter(Boolean);
                if (!symbols.includes(EXCHANGE_SYMBOL)) {
                    this.addCommand("Échanger", EXCHANGE_SYMBOL, canUseExchangeCommand(this._actor));
                } else {
                    for (const cmd of this._list) {
                        if (cmd && cmd.symbol === EXCHANGE_SYMBOL) {
                            cmd.enabled = canUseExchangeCommand(this._actor);
                            break;
                        }
                    }
                }
                sortExchangeBeforeWait(this);
                if (this.refresh) this.refresh();
            }
        } catch (e) {
            // ignore
        }
    };

    // Fallback: si un autre plugin écrase les handlers, on force l'appel ici.
    const _Window_ActorCommand_processOk = Window_ActorCommand.prototype.processOk;
    Window_ActorCommand.prototype.processOk = function() {
        const sceneNow = SceneManager._scene;
        if (this.currentSymbol() === EXCHANGE_SYMBOL) {
            const canHandle =
                $gameSystem && $gameSystem.isSRPGMode && $gameSystem.isSRPGMode() &&
                $gameSystem.isBattlePhase && $gameSystem.isBattlePhase() === "actor_phase" &&
                $gameSystem.isSubBattlePhase && $gameSystem.isSubBattlePhase() === "actor_command_window";

            if (!canHandle) {
                _Window_ActorCommand_processOk.call(this);
                return;
            }

            if (!this.isCurrentItemEnabled()) {
                this.playBuzzerSound();
                this.updateInputData();
                return;
            }

            const sourceActor = this._actor || resolveCommandActor(this);
            if (sceneNow instanceof Scene_Map && typeof sceneNow._cbnMapBattleExchangeCommand === "function") {
                sceneNow._cbnExchangeSourceActor = sourceActor || null;
                this.playOkSound();
                this.updateInputData();
                sceneNow._cbnMapBattleExchangeCommand();
                return;
            }
            if (sceneNow instanceof Scene_Battle && typeof sceneNow._cbnBattleExchangeCommand === "function") {
                sceneNow._cbnExchangeSourceActor = sourceActor || null;
                this.playOkSound();
                this.updateInputData();
                sceneNow._cbnBattleExchangeCommand();
                return;
            }
        }
        _Window_ActorCommand_processOk.call(this);
    };

    // Fallback complémentaire: certains plugins contournent processOk,
    // mais passent toujours par callOkHandler.
    const _Window_ActorCommand_callOkHandler = Window_ActorCommand.prototype.callOkHandler;
    Window_ActorCommand.prototype.callOkHandler = function() {
        const sceneNow = SceneManager._scene;
        if (this.currentSymbol() === EXCHANGE_SYMBOL) {
            const canHandle =
                $gameSystem && $gameSystem.isSRPGMode && $gameSystem.isSRPGMode() &&
                $gameSystem.isBattlePhase && $gameSystem.isBattlePhase() === "actor_phase" &&
                $gameSystem.isSubBattlePhase && $gameSystem.isSubBattlePhase() === "actor_command_window";
            if (!canHandle) {
                _Window_ActorCommand_callOkHandler.call(this);
                return;
            }

            if (!this.isCurrentItemEnabled()) {
                this.playBuzzerSound();
                this.updateInputData();
                return;
            }

            const sourceActor = this._actor || resolveCommandActor(this);
            if (sceneNow instanceof Scene_Map && typeof sceneNow._cbnMapBattleExchangeCommand === "function") {
                sceneNow._cbnExchangeSourceActor = sourceActor || null;
                this.playOkSound();
                this.updateInputData();
                sceneNow._cbnMapBattleExchangeCommand();
                return;
            }
            if (sceneNow instanceof Scene_Battle && typeof sceneNow._cbnBattleExchangeCommand === "function") {
                sceneNow._cbnExchangeSourceActor = sourceActor || null;
                this.playOkSound();
                this.updateInputData();
                sceneNow._cbnBattleExchangeCommand();
                return;
            }
        }
        _Window_ActorCommand_callOkHandler.call(this);
    };

    // ===============================
    // 🔹 OUVERTURE FENÊTRE
    // ===============================
    Scene_Battle.prototype._cbnBattleExchangeCommand = function(options) {
        options = options || {};
        const fromEvent = !!options.eventInterpreter;
        if (fromEvent) {
            if (isEventExchangeUsedThisTurn()) {
                SoundManager.playBuzzer();
                return false;
            }
        } else {
            if (isMenuExchangeUsedThisTurn()) {
                SoundManager.playBuzzer();
                return false;
            }
        }
        if (!this._exchangeWindow) {
            this.createExchangeWindow();
        }

        const currentActor = resolveCurrentActor(this);
        const actors = getExchangeCandidates(currentActor);

        if (actors.length === 0) {
            SoundManager.playBuzzer();
            return false;
        }

        this._cbnExchangeOpenFromEvent = fromEvent;

        if (options.eventInterpreter) {
            this._cbnExchangeEventWaitInterpreter = options.eventInterpreter;
            this._cbnExchangeEventWaitActive = true;
        }

        this._exchangeWindow.setActors(actors);
        this._exchangeWindow.show();
        this._exchangeWindow.activate();
        this._exchangeWindow.select(0);

        this._actorCommandWindow.deactivate();
        return true;
    };

    // Compatibilité: garde l'ancien nom, mais redirige vers la méthode interne du plugin.
    Scene_Battle.prototype.commandExchange = function() {
        this._cbnBattleExchangeCommand();
    };

    // ===============================
    // 🔹 SCENE MAP (SRPG) SUPPORT
    // ===============================
    Scene_Map.prototype._cbnEnsureExchangeWindow = function() {
        if (this._exchangeWindow) return;
        const rect = new Rectangle(
            Graphics.boxWidth / 2 - 200,
            Graphics.boxHeight / 2 - 150,
            400,
            300
        );
        this._exchangeWindow = new Window_ExchangeActor(rect);
        this._exchangeWindow.hide();
        this._exchangeWindow.deactivate();
        this._exchangeWindow.setHandler("ok", this._cbnMapOnExchangeOk.bind(this));
        this._exchangeWindow.setHandler("cancel", this._cbnMapOnExchangeCancel.bind(this));
        this.addWindow(this._exchangeWindow);
    };

    Scene_Map.prototype._cbnMapBattleExchangeCommand = function(options) {
        options = options || {};
        const fromEvent = !!options.eventInterpreter;
        const fromDeath = !!options.fromDeath;
        if (!fromDeath) {
            if (fromEvent) {
                if (isEventExchangeUsedThisTurn()) {
                    SoundManager.playBuzzer();
                    return false;
                }
            } else {
                if (isMenuExchangeUsedThisTurn()) {
                    SoundManager.playBuzzer();
                    return false;
                }
            }
        }
        this._cbnEnsureExchangeWindow();
        this._cbnExchangePrevSubPhase = $gameSystem.isSubBattlePhase ? $gameSystem.isSubBattlePhase() : null;
        const currentActor = resolveCurrentActor(this);
        const actors = getExchangeCandidates(currentActor);
        if (actors.length === 0) {
            SoundManager.playBuzzer();
            this._cbnExchangePrevSubPhase = null;
            return false;
        }
        this._cbnExchangeOpenFromDeath = fromDeath;
        this._cbnExchangeOpenFromEvent = fromEvent && !fromDeath;

        if (options.eventInterpreter) {
            this._cbnExchangeEventWaitInterpreter = options.eventInterpreter;
            this._cbnExchangeEventWaitActive = true;
        }
        this._exchangeWindow.setActors(actors);
        this._exchangeWindow.show();
        this._exchangeWindow.activate();
        this._exchangeWindow.select(0);
        const commandWindow = mapActorCommandWindow(this);
        if (commandWindow) {
            commandWindow.deactivate();
        }
        return true;
    };

    Scene_Map.prototype._cbnMapOnExchangeOk = function() {
        const wasDeath = this._cbnExchangeOpenFromDeath;
        if (!wasDeath) {
            this._cbnDeathExchangePendingRestore = null;
        }
        const newActor = this._exchangeWindow.actor(this._exchangeWindow.index());

        const activeEvent = mapEventForSubjectActor(this);
        const deadActorId =
            wasDeath && activeEvent
                ? (() => {
                      const p = $gameSystem.EventToUnit(activeEvent.eventId());
                      return p && p[1] && p[1].isActor() ? p[1].actorId() : null;
                  })()
                : null;
        if (activeEvent && newActor) {
            let tileX;
            let tileY;
            let tileDir;
            if (wasDeath && this._cbnDeathExchangePendingRestore) {
                tileX = this._cbnDeathExchangePendingRestore.x;
                tileY = this._cbnDeathExchangePendingRestore.y;
                tileDir = this._cbnDeathExchangePendingRestore.dir;
                this._cbnDeathExchangePendingRestore = null;
            } else {
                tileX = activeEvent.posX();
                tileY = activeEvent.posY();
                tileDir = activeEvent.direction();
            }
            const preservedTp = newActor.tp;
            $gameMap.changeActor(activeEvent.eventId(), newActor.actorId());
            newActor.setTp(preservedTp);
            ensureActorHasUsableAction(newActor);
            if ($gameTemp.setActiveEvent) {
                $gameTemp.setActiveEvent(activeEvent);
            }
            // Forcer la reconstruction des fenêtres SRPG avec le nouveau battler
            // évite l'affichage de PV "fantômes" de l'acteur remplacé.
            const swappedBattlerArray = $gameSystem.EventToUnit(activeEvent.eventId());
            if (swappedBattlerArray) {
                if (!wasDeath && $gameSystem.setSrpgActorCommandWindowNeedRefresh) {
                    $gameSystem.setSrpgActorCommandWindowNeedRefresh(swappedBattlerArray);
                }
                if ($gameSystem.setSrpgActorCommandStatusWindowNeedRefresh) {
                    $gameSystem.setSrpgActorCommandStatusWindowNeedRefresh(swappedBattlerArray, true);
                }
                // Refresh immédiat (sans attendre le cycle de window-open/close SRPG).
                if (this._mapSrpgActorCommandStatusWindow &&
                    this._mapSrpgActorCommandStatusWindow.setBattler) {
                    this._mapSrpgActorCommandStatusWindow.setBattler(swappedBattlerArray[1]);
                }
                if (!wasDeath &&
                    this._mapSrpgActorCommandWindow &&
                    this._mapSrpgActorCommandWindow.setup) {
                    this._mapSrpgActorCommandWindow.setup(swappedBattlerArray[1]);
                }
            }
            applyExchangeFinalizePosition(activeEvent, tileX, tileY, tileDir);
            if (swappedBattlerArray && swappedBattlerArray[1]) {
                refreshMapHpGaugeForEvent(this, activeEvent.eventId(), swappedBattlerArray[1]);
            }
            // SRPG: originalPos sert au "retour" (annulation commande → actor_move) et aux tables de portée.
            // Sans ça, après un échange (mort ou menu) la case mémorisée reste celle d'un autre acteur / ancien tour.
            const posBattler =
                swappedBattlerArray && swappedBattlerArray[1] ? swappedBattlerArray[1] : newActor;
            if (posBattler && $gameTemp.reserveOriginalPos) {
                $gameTemp.reserveOriginalPos(
                    activeEvent.posX(),
                    activeEvent.posY(),
                    posBattler.srpgMove()
                );
            }
            clearSrpgMovementStateAfterReserveSwap(activeEvent, posBattler || newActor);
            playExchangeArrivalFx(activeEvent, newActor);
            if (wasDeath && deadActorId != null) {
                $gameParty.removeActor(deadActorId);
            }
            if (!this._cbnExchangeOpenFromDeath) {
                if (this._cbnExchangeOpenFromEvent) {
                    markEventExchangeUsedThisTurn();
                } else {
                    markMenuExchangeUsedThisTurn();
                }
                markFirstPlayerExchangeSwitch();
            }
            if ($gameParty.initRemainingActorList) {
                $gameParty.initRemainingActorList();
            }
        }

        SoundManager.playOk();
        this._exchangeWindow.hide();
        this._exchangeWindow.deactivate();
        if (!wasDeath) {
            const commandWindow = mapActorCommandWindow(this);
            if (commandWindow) {
                // On réactive juste la fenêtre de commandes d'acteur.
                if (commandWindow.activate) commandWindow.activate();
            }
            if ($gameSystem && $gameSystem.setSubBattlePhase) {
                const restore = this._cbnExchangePrevSubPhase || "actor_command_window";
                $gameSystem.setSubBattlePhase(restore);
            }
        }
        clearExchangeEventWaitForScene(this);
        if (wasDeath) {
            if (this._cbnDeathExchangeQueue && this._cbnDeathExchangeQueue.length > 0) {
                this._cbnDeathExchangeQueue.shift();
            }
            this._cbnBlockDeadAfterBattleForDeathExchange = false;
            this._cbnTryStartNextDeathReserveExchange();
        }
        this._cbnExchangeOpenFromDeath = false;
        this._cbnExchangeOpenFromEvent = false;
        this._cbnExchangeSourceActor = null;
        this._cbnExchangePrevSubPhase = null;
    };

    Scene_Map.prototype._cbnMapOnExchangeCancel = function() {
        const wasDeath = this._cbnExchangeOpenFromDeath;
        if (wasDeath && this._cbnDeathExchangeQueue && this._cbnDeathExchangeQueue.length > 0) {
            this._cbnDeathExchangePendingRestore = null;
            const head = this._cbnDeathExchangeQueue[0];
            const ev = $gameMap.event(head.eventId);
            const pair = ev ? $gameSystem.EventToUnit(head.eventId) : null;
            const bat = pair && pair[1];
            if (ev && bat && bat.isDead() && bat.isActor()) {
                applySrpgMapDeathErase(ev, bat);
            }
            this._cbnDeathExchangeQueue.shift();
            this._cbnBlockDeadAfterBattleForDeathExchange = false;
            this._cbnTryStartNextDeathReserveExchange();
        }

        this._exchangeWindow.hide();
        this._exchangeWindow.deactivate();
        const commandWindow = mapActorCommandWindow(this);
        if (commandWindow) {
            commandWindow.activate();
        }
        if ($gameSystem && $gameSystem.setSubBattlePhase) {
            const restore = this._cbnExchangePrevSubPhase || "actor_command_window";
            $gameSystem.setSubBattlePhase(restore);
        }
        clearExchangeEventWaitForScene(this);
        this._cbnExchangeOpenFromDeath = false;
        this._cbnExchangeOpenFromEvent = false;
        this._cbnExchangeSourceActor = null;
        this._cbnExchangePrevSubPhase = null;
    };

    Scene_Map.prototype._cbnTryStartNextDeathReserveExchange = function() {
        if (!this._cbnDeathExchangeQueue || this._cbnDeathExchangeQueue.length === 0) {
            this._cbnBlockDeadAfterBattleForDeathExchange = false;
            return;
        }
        if (
            $gameSystem &&
            $gameSystem.isBattlePhase &&
            $gameSystem.isBattlePhase() !== "actor_phase"
        ) {
            // Ne jamais ouvrir la sélection de remplaçant hors phase joueur.
            return;
        }
        const next = this._cbnDeathExchangeQueue[0];
        const event = $gameMap.event(next.eventId);
        if (!event || event.isErased()) {
            this._cbnDeathExchangeQueue.shift();
            this._cbnTryStartNextDeathReserveExchange();
            return;
        }
        const unit = $gameSystem.EventToUnit(event.eventId());
        const battler = unit && unit[1];
        if (!battler || !battler.isDead() || !battler.isActor()) {
            this._cbnDeathExchangeQueue.shift();
            this._cbnTryStartNextDeathReserveExchange();
            return;
        }
        if (getExchangeCandidates(battler).length === 0) {
            applySrpgMapDeathErase(event, battler);
            this._cbnDeathExchangeQueue.shift();
            this._cbnBlockDeadAfterBattleForDeathExchange = false;
            this._cbnTryStartNextDeathReserveExchange();
            return;
        }
        this._cbnBlockDeadAfterBattleForDeathExchange = true;
        this._cbnExchangeSourceActor = battler;
        if ($gameTemp.setActiveEvent) {
            $gameTemp.setActiveEvent(event);
        }
        this._cbnDeathExchangePendingRestore = {
            x: event.posX(),
            y: event.posY(),
            dir: event.direction()
        };
        if (!this._cbnMapBattleExchangeCommand({ fromDeath: true })) {
            this._cbnDeathExchangePendingRestore = null;
            applySrpgMapDeathErase(event, battler);
            this._cbnDeathExchangeQueue.shift();
            this._cbnBlockDeadAfterBattleForDeathExchange = false;
            this._cbnTryStartNextDeathReserveExchange();
        }
    };

    Scene_Map.prototype.srpgBattlerDeadAfterBattle = function() {
        if (this._cbnBlockDeadAfterBattleForDeathExchange) {
            return;
        }
        const activeEvent = $gameTemp.activeEvent();
        const targetEvent = $gameTemp.targetEvent();
        const allEvents = [activeEvent, targetEvent].concat($gameTemp.getAreaEvents());
        $gameTemp.clearAreaTargets();

        for (let i = 0; i < allEvents.length; i++) {
            const event = allEvents[i];
            if (!event) continue;
            const battlerPair = $gameSystem.EventToUnit(event.eventId());
            const battler = battlerPair && battlerPair[1];
            if (i > 0 && event === activeEvent) continue;
            if (!battler) continue;
            battler.setActionTiming(-1);
            battler.removeCurrentAction();
            battler.clearSrpgRangeListForBattle();
            if (battler.isDead() && !event.isErased()) {
                if (battler.isActor() && getExchangeCandidates(battler).length > 0) {
                    if (!this._cbnDeathExchangeQueue) {
                        this._cbnDeathExchangeQueue = [];
                    }
                    const eid = event.eventId();
                    if (!this._cbnDeathExchangeQueue.some(e => e.eventId === eid)) {
                        this._cbnDeathExchangeQueue.push({ eventId: eid });
                    }
                } else {
                    applySrpgMapDeathErase(event, battler);
                }
                continue;
            }
            if (battler && !battler.isDead() && event.isErased()) {
                event.erase();
                battler.removeState(battler.deathStateId());
                const valueId = battler.isActor() ? srpgExistActorVarId() : srpgExistEnemyVarId();
                const oldValue = $gameVariables.value(valueId);
                $gameVariables.setValue(valueId, oldValue + 1);
                const xy = event.makeAppearPoint(event, event.posX(), event.posY(), battler.srpgThroughTag());
                event.locate(xy[0], xy[1]);
                event.appear();
                $gameMap.setEventImages();
            }
        }
        const deferDeathExchange =
            DEFER_DEATH_EXCHANGE_TO_ENEMY_PHASE_END &&
            $gameSystem &&
            $gameSystem.isBattlePhase &&
            $gameSystem.isBattlePhase() === "enemy_phase";
        if (!deferDeathExchange) {
            this._cbnTryStartNextDeathReserveExchange();
        }
    };

    const _CBN_Scene_Map_srpgAfterAction = Scene_Map.prototype.srpgAfterAction;
    Scene_Map.prototype.srpgAfterAction = function() {
        if (this._cbnBlockDeadAfterBattleForDeathExchange) {
            return;
        }
        _CBN_Scene_Map_srpgAfterAction.call(this);
    };

    // Sécurité SRPG: certains flux d'échange laissent l'action active vide avant la validation
    // d'une compétence/objet, ce qui provoque un crash dans SRPG_core (actor.action(0).setXxx).
    if (Scene_Map.prototype.onSkillOk) {
        const _CBN_Scene_Map_onSkillOk = Scene_Map.prototype.onSkillOk;
        Scene_Map.prototype.onSkillOk = function() {
            ensureActiveSrpgActorHasUsableAction();
            _CBN_Scene_Map_onSkillOk.call(this);
        };
    }

    if (Scene_Map.prototype.onItemOk) {
        const _CBN_Scene_Map_onItemOk = Scene_Map.prototype.onItemOk;
        Scene_Map.prototype.onItemOk = function() {
            ensureActiveSrpgActorHasUsableAction();
            _CBN_Scene_Map_onItemOk.call(this);
        };
    }

    // ===============================
    // 🔹 VALIDATION
    // ===============================
    Scene_Battle.prototype.onExchangeOk = function() {
        const newActor = this._exchangeWindow.actor(this._exchangeWindow.index());
        const currentActor = BattleManager.actor();

        const party = $gameParty.allMembers();

        const indexA = party.indexOf(currentActor);
        const indexB = party.indexOf(newActor);

        if (indexA >= 0 && indexB >= 0) {
            $gameParty.swapOrder(indexA, indexB);
            if (this._cbnExchangeOpenFromEvent) {
                markEventExchangeUsedThisTurn();
            } else {
                markMenuExchangeUsedThisTurn();
            }
        }
        this._cbnExchangeOpenFromEvent = false;

        SoundManager.playOk();

        this._exchangeWindow.hide();
        this._exchangeWindow.deactivate();

        this._actorCommandWindow.activate();

        // 🔥 Important : refresh du combat
        BattleManager.startActorInput();
        clearExchangeEventWaitForScene(this);
    };

    // ===============================
    // 🔹 ANNULATION
    // ===============================
    Scene_Battle.prototype.onExchangeCancel = function() {
        this._exchangeWindow.hide();
        this._exchangeWindow.deactivate();
        this._actorCommandWindow.activate();
        this._cbnExchangeOpenFromEvent = false;
        clearExchangeEventWaitForScene(this);
    };

    function openReserveExchangeFromEventCommand(interpreter, args) {
        syncExchangeUsageWithCurrentTurn();
        const raw = args.actorId;
        const actorId = raw !== undefined && raw !== "" ? Number(raw) : 0;
        const scene = SceneManager._scene;

        if (scene instanceof Scene_Map) {
            scene._cbnExchangeSourceActor = resolveSourceActorForPlugin(actorId);
            if (scene._cbnMapBattleExchangeCommand({ eventInterpreter: interpreter })) {
                interpreter.setWaitMode("cbnBattleExchange");
            }
            return;
        }
        if (scene instanceof Scene_Battle) {
            scene._cbnExchangeSourceActor = resolveSourceActorForPlugin(actorId);
            if (scene._cbnBattleExchangeCommand({ eventInterpreter: interpreter })) {
                interpreter.setWaitMode("cbnBattleExchange");
            }
            return;
        }
        SoundManager.playBuzzer();
    }

    PluginManager.registerCommand(PLUGIN_NAME, "OpenReserveExchangeFromEvent", function(args) {
        openReserveExchangeFromEventCommand(this, args);
    });

    window.CbnOpenReserveExchangeFromEvent = function(actorId) {
        const inter = $gameMap._interpreter;
        if (!inter) {
            SoundManager.playBuzzer();
            return;
        }
        openReserveExchangeFromEventCommand(inter, {
            actorId: actorId !== undefined && actorId !== null ? String(actorId) : "0"
        });
    };

})();