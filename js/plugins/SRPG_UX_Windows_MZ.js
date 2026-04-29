//-----------------------------------------------------------------------------
// SRPG_UX_Windows_MZ.js
// Copyright (c) 2020 SRPG Team. All rights reserved.
// Released under the MIT license.
// http://opensource.org/licenses/mit-license.php
//=============================================================================

/*:
 * @target MZ
 * @plugindesc SRPG window improvements, edited by OhisamaCraft.
 * @author Dr. Q
 * @base SRPG_core_MZ
 * @orderAfter SRPG_core_MZ
 *
 * @param Hide No Rewards
 * @desc Don't show the window if you don't get anything
 * @type boolean
 * @default true
 * 
 * @param srpgBattleResultWindowCount
 * @parent BattleExtensionParam
 * @desc The time to wait for the reward window (-1 waits until a key is entered, it will not close automatically).
 * @type number
 * @min -1
 * @default 90
 *
 * @param Hide Self Target
 * @desc Hide the target window when self-targeting
 * @type boolean
 * @default false
 * 
 * @param srpgChangeStatusWindowColor
 * @desc Change the color of the status window based on Actor or Enemy(true / false)
 * @type boolean
 * @default true
 * 
 * @param srpgActorStatusWindowColor
 * @parent srpgChangeStatusWindowColor
 * @desc Specify the color of the actor's status window([R, G, B]). split ','
 * @type string
 * @default -32, -32, 96
 * 
 * @param srpgEnemyStatusWindowColor
 * @parent srpgChangeStatusWindowColor
 * @desc Specify the color of the enemy's status window([R, G, B]). split ','
 * @type string
 * @default 96, -32, -32
 * 
 * @param srpgAutoOpenActorCommandStatusWindow
 * @desc Whether to automatically display the status bar when the cursor is on a unit.(true / false)
 * @type boolean
 * @default true
 *
 * @help
 * copyright 2020 SRPG Team. all rights reserved.
 * Released under the MIT license.
 * ============================================================================
 * Minor improvements to the behavior of windows
 * 
 * Options:
 * - Hide No Rewards: Don't show the rewards window for
 *   battles that didn't grant exp, gold, or items.
 *
 * - Hide Self Target: Only shows one status window for
 *   skills that target the user.
 * 
 * - add a feature to color-code the status windows of actors and enemies.
 *
 * Automatic changes:
 * - Status windows can also be closed with cancel/menu
 * - Skills are correctly disabled in the menu when not usable
 * 
 * ============================================================================
 * Settings via Tags (Notes)
 * ============================================================================
 * === Actor Notes ===
 * <hideHpMp:true> # HP, MP, and TP will be displayed as '???'.
 * 
 * === Enemy Notes ===
 * <hideHpMp:true> # HP, MP, and TP will be displayed as '???'.
 * 
 * === State Notes ===
 * <showHpMp:true> # While in this state, the <hideHpMp> tag is disabled.
 *
 */

/*:ja
 * @target MZ
 * @plugindesc SRPGでのウィンドウを改善します（おひさまクラフトによる改変）。
 * @author Dr. Q
 * @base SRPG_core_MZ
 * @orderAfter SRPG_core_MZ
 *
 * @param Hide No Rewards
 * @desc 何も報酬を入手しなかった場合、ウィンドウを表示しません。
 * @type boolean
 * @default true
 * 
 * @param srpgBattleResultWindowCount
 * @parent BattleExtensionParam
 * @desc リザルトウィンドウを閉じるまでの待ち時間 (-1 にするとキー入力があるまで閉じません).
 * @type number
 * @min -1
 * @default 90
 *
 * @param Hide Self Target
 * @desc 自分を対象にするとき、対象選択ウィンドウを表示しません。
 * @type boolean
 * @default false
 * 
 * @param srpgChangeStatusWindowColor
 * @desc ステータスウィンドウの色を敵味方で変化させるか。(true / false)
 * @type boolean
 * @default true
 * 
 * @param srpgActorStatusWindowColor
 * @parent srpgChangeStatusWindowColor
 * @desc アクターのステータスウィンドウの色を指定します(R, G, B)。 ',(カンマ)'で区切ります。
 * @type string
 * @default -32, -32, 96
 * 
 * @param srpgEnemyStatusWindowColor
 * @parent srpgChangeStatusWindowColor
 * @desc エネミーのステータスウィンドウの色を指定します(R, G, B)。 ',(カンマ)'で区切ります。
 * @type string
 * @default 96, -32, -32
 * 
 * @param srpgAutoOpenActorCommandStatusWindow
 * @desc カーソルが合った時に自動でステータスバーを表示するか。(true / false)
 * @type boolean
 * @default true
 *
 * @help
 * copyright 2020 SRPG Team. all rights reserved.
 * Released under the MIT license.
 * ============================================================================
 * ウィンドウに関する細かな挙動を改善します。
 * 
 * オプション:
 * - Hide No Rewards: 経験値、お金、アイテムを入手しなかった戦闘では、
 *   報酬獲得ウィンドウを表示しません。
 *
 * - Hide Self Target: 使用者自身を対象にするスキル使用時、ステータス
 *   ウィンドウが一つのみ表示されるようになります。
 * 
 * - 敵味方のステータスウィンドウを色分けする機能を追加します。
 *
 * 自動適用:
 * - キャンセル/メニューボタンでもステータスウィンドウを閉じることが可能になります。
 * - メニューにて使用できないスキルが、適切に無効化されます。
 * 
 * ============================================================================
 * タグ（メモ）による設定
 * ============================================================================
 * === アクターのメモ ===
 *   <hideHpMp:true> # HP, MP, TPの表示が'???'になります。
 * 
 * === エネミーのメモ ===
 *   <hideHpMp:true> # HP, MP, TPの表示が'???'になります。
 * 
 * === ステートのメモ ===
 *   <showHpMp:true> # このステートになっている間、<hideHpMp>タグが無効化されます。
 *
 */


(function(){
	// parameters
	var parameters = PluginManager.parameters('SRPG_UX_Windows_MZ');
	var _hideNoReward = !!eval(parameters['Hide No Rewards'] || true);
	var _srpgBattleResultWindowCount = Number(parameters['srpgBattleResultWindowCount'] || 90);
	var _hideSelfTarget = !!eval(parameters['Hide Self Target'] || true);
	var _srpgChangeStatusWindowColor = !!eval(parameters['srpgChangeStatusWindowColor'] || true);
	var _srpgActorStatusWindowColor = parameters['srpgActorStatusWindowColor'] || "-32, -32, 96";
	var _srpgEnemyStatusWindowColor = parameters['srpgEnemyStatusWindowColor'] || "96, -32, -32";
	var _srpgAutoOpenActorCommandStatusWindow = !!eval(parameters['srpgAutoOpenActorCommandStatusWindow'] || true);

	var coreParameters = PluginManager.parameters('SRPG_core_MZ');
	var _rewardSe = coreParameters['rewardSound'] || 'Item3';

	function cbnParseTypeListMetaValue(rawValue) {
		if (rawValue == null) return [];
		return String(rawValue)
			.split(',')
			.map(function(value) { return String(value || '').trim(); })
			.filter(function(value) { return value.length > 0; });
	}

	function cbnResolveElementIdByTypeNameLoose(typeName) {
		var needle = String(typeName || '').trim().toLowerCase();
		if (!needle || !$dataSystem || !$dataSystem.elements) return 0;
		for (var i = 1; i < $dataSystem.elements.length; i++) {
			var dbName = String($dataSystem.elements[i] || '').trim();
			if (!dbName) continue;
			if (dbName.toLowerCase() === needle) return i;
		}
		return 0;
	}

	function cbnTypeIconIndexFromRawType(rawType) {
		var text = String(rawType || '').trim();
		if (!text) return 0;
		var iconIndex = 0;
		if (/^\d+$/.test(text)) {
			var elementId = Number(text);
			if (window.CbnTypeIcons && typeof window.CbnTypeIcons.iconByElementId === 'function') {
				iconIndex = Number(window.CbnTypeIcons.iconByElementId(elementId) || 0);
			}
		} else {
			var resolvedId = cbnResolveElementIdByTypeNameLoose(text);
			if (resolvedId > 0) {
				if (window.CbnTypeIcons && typeof window.CbnTypeIcons.iconByElementId === 'function') {
					iconIndex = Number(window.CbnTypeIcons.iconByElementId(resolvedId) || 0);
				}
			} else if (window.CbnTypeIcons && typeof window.CbnTypeIcons.iconByTypeName === 'function') {
				iconIndex = Number(window.CbnTypeIcons.iconByTypeName(text) || 0);
			}
		}
		return iconIndex > 0 ? iconIndex : 0;
	}

	function cbnBattlerWeakTypeIconsText(battler) {
		if (!battler) return 'Faible contre: -';
		var rawMetaValue = '';
		if (battler.isActor && battler.isActor()) {
			var actorClass = battler.currentClass ? battler.currentClass() : null;
			if (actorClass && actorClass.meta && actorClass.meta.typeFaibleContre != null) {
				rawMetaValue = actorClass.meta.typeFaibleContre;
			} else if (battler.actor && battler.actor() && battler.actor().meta && battler.actor().meta.typeFaibleContre != null) {
				rawMetaValue = battler.actor().meta.typeFaibleContre;
			}
		} else if (battler.isEnemy && battler.isEnemy()) {
			var enemyData = battler.enemy ? battler.enemy() : null;
			if (enemyData && enemyData.meta && enemyData.meta.typeFaibleContre != null) {
				rawMetaValue = enemyData.meta.typeFaibleContre;
			}
		}
		var values = cbnParseTypeListMetaValue(rawMetaValue);
		if (!values.length) return 'Faible contre: -';
		var icons = values
			.map(cbnTypeIconIndexFromRawType)
			.filter(function(iconId) { return iconId > 0; });
		if (!icons.length) return 'Faible contre: -';
		var iconText = icons.map(function(iconId) {
			return '\\I[' + iconId + ']';
		}).join(', ');
		return 'Faible contre: ' + iconText;
	}

	Window_Base.prototype.drawCbnWeakTypeIconsOnly = function(battler, x, y, width) {
		var line = cbnBattlerWeakTypeIconsText(battler);
		this.resetTextColor();
		this.drawTextEx(line, x, y, width || 0);
	};
//====================================================================
// don't show exp rewards if you didn't get any
//====================================================================

	// rewritten victory processing, optionally skips reward window if there's no rewards
	BattleManager.processSrpgVictory = function() {
		if ($gameTroop.members()[0] && $gameTroop.isAllDead()) {
			$gameParty.performVictory();
		}
		this.makeRewards();
		// only show the rewards if there's something to show
		if (!_hideNoReward || this._rewards.exp > 0 || this._rewards.gold > 0 || this._rewards.items.length > 0) {
			var actor = $gameParty.aliveMembers()[0];
			const requiredExp = actor.nextRequiredExp();
			const anyActorLeveledUp = $gameTroop.expTotal() >= requiredExp;	
			this._srpgBattleResultWindow.setRewards(this._rewards);
			var se = {};
			se.name = _rewardSe;
			se.pan = 0;
			se.pitch = 100;
			se.volume = 90;
			AudioManager.playSe(se);
			this._srpgBattleResultWindow.open();
			this._srpgBattleResultWindowCount = anyActorLeveledUp ? -1 : _srpgBattleResultWindowCount;
			this.gainRewards();
		}
		// otherwise, skip right to the end
		else {
			this.endBattle(3);
		}
	};

	Scene_Map.prototype.processSrpgVictory = function() {
		var members = $gameParty.aliveMembers();
        if (members.length > 0) {
			this.makeRewards();
            if (this.hasRewards()) {
				var actor = members[0];
				const requiredExp = actor.nextRequiredExp();
				const anyActorLeveledUp = $gameTroop.expTotal() >= requiredExp;
                this._srpgBattleResultWindow.setBattler(members[0]);
                this._srpgBattleResultWindow.setRewards(this._rewards);
                var se = {};
                se.name = _rewardSe;
                se.pan = 0;
                se.pitch = 100;
                se.volume = 90;
                AudioManager.playSe(se);
				this._logWindow.clear();
        		this._logWindow.hide();
                this._srpgBattleResultWindow.open();
                this._srpgBattleResultWindowCount = anyActorLeveledUp ? -1 : _srpgBattleResultWindowCount;
                this.gainRewards();
                //this.initRewards();
                return true;
            }
        }
        return false;
	};
//====================================================================
// only show one window when self-targeting
//====================================================================

	// hide the second status window for self-target actions
	var _SRPG_SceneMap_update = Scene_Map.prototype.update;
	Scene_Map.prototype.update = function() {
		_SRPG_SceneMap_update.call(this);
		if (!_hideSelfTarget) return;
		var flag = $gameSystem.srpgBattleWindowNeedRefresh();
		if (flag[0] && flag[1][1] == flag[2][1]) {
			if (this._mapSrpgTargetWindow.isOpen() || this._mapSrpgTargetWindow.isOpening()) {
				this._mapSrpgTargetWindow.close();
			}
		}
	}

	// cancel movement or target, plus quick targeting
	/*
	var _updateCallMenu = Scene_Map.prototype.updateCallMenu;
	Scene_Map.prototype.updateCallMenu = function() {
		if ($gameSystem.isSRPGMode() && !$gameSystem.srpgWaitMoving()) {
			// close status windows with cancel
			if ($gameSystem.isSubBattlePhase() === 'status_window' && this.isMenuCalled()) {
				$gameSystem.clearSrpgStatusWindowNeedRefresh();
				SoundManager.playCancel();
				$gameTemp.clearActiveEvent();
				$gameSystem.setSubBattlePhase('normal');
				$gameTemp.clearMoveTable();
				return;
			}
		}
		_updateCallMenu.call(this);
	};
	*/

//====================================================================
// correctly handle enabled / disabled options in the menu
//====================================================================

	// don't allow non-usable skills to be used during battle
	Window_BattleSkill.prototype.isEnabled = function(item) {
		return this._actor && this._actor.canUse(item);
	};

//====================================================================
// change status window color
//====================================================================
	// ●Window_Base
	const srpgUXWindows_Window_Base_initialize = Window_Base.prototype.initialize;
	Window_Base.prototype.initialize = function(rect) {
		srpgUXWindows_Window_Base_initialize.call(this, rect);
		this._srpgWindowTone = null;
	};

	const srpgUXWindows_Window_Base_updateTone = Window_Base.prototype.updateTone;
	Window_Base.prototype.updateTone = function() {
		if ($gameSystem.isSRPGMode() && _srpgChangeStatusWindowColor) {
			const tone = this._srpgWindowTone || $gameSystem.windowTone();
    		this.setTone(tone[0], tone[1], tone[2]);
		} else {
			srpgUXWindows_Window_Base_updateTone.call(this);
		}
	};

	Window_Base.prototype.setSrpgWindowTone = function(type) {
		let rgb = [];
        if (type === 'actor') {
			rgb = _srpgActorStatusWindowColor.split(',')
        } else if (type === 'enemy') {
            rgb = _srpgEnemyStatusWindowColor.split(',')
        }
		const r = Number(rgb[0]);
		const g = Number(rgb[1]);
		const b = Number(rgb[2]);
        return [r, g, b, 0];
	};

	// ●Window_SrpgStatus
    // ユニットのセット
	const srpgUXWindows_Window_StatusBase_setBattler = Window_SrpgStatus.prototype.setBattler;
    Window_SrpgStatus.prototype.setBattler = function(data, flip) {
		srpgUXWindows_Window_StatusBase_setBattler.call(this, data, flip);
		if (this._battler) this._srpgWindowTone = this.setSrpgWindowTone(this._type);
        this.refresh();
    };

	// ●Window_SrpgBattleStatus
	// ユニットのセット
	const srpgUXWindows_Window_SrpgBattleStatus_setBattler = Window_SrpgBattleStatus.prototype.setBattler;
    Window_SrpgBattleStatus.prototype.setBattler = function(battler) {
		srpgUXWindows_Window_SrpgBattleStatus_setBattler.call(this, battler);
        if (this._battler) this._srpgWindowTone = this.setSrpgWindowTone(this._type);
        this.refresh();
    };

//====================================================================
// Immediately open the status window when the cursor is on a unit.
//====================================================================
	Window_StatusBase.prototype.drawEnemySimpleStatusSrpg = function(enemy, x, y) {
        const lineHeight = this.lineHeight();
        const x2 = x + 180;
        this.drawActorName(enemy, x, y);
        this.drawEnemyLevel(enemy, x, y + lineHeight * 1);
        this.drawActorIcons(enemy, x, y + lineHeight * 2);
        this.drawEnemyClass(enemy, x2, y);
        this.placeBasicGaugesSrpg(enemy, x2, y + lineHeight);
    };

	// ●Window_SrpgActorCommandStatus
	// 初期化
	const _srpgUxWindows_Window_SrpgActorCommandStatus_initialize = Window_SrpgActorCommandStatus.prototype.initialize;
    Window_SrpgActorCommandStatus.prototype.initialize = function(rect) {
        this._type = null;
		_srpgUxWindows_Window_SrpgActorCommandStatus_initialize.call(this, rect);
    };

	// ユニットのセット
	const srpgUXWindows_Window_SrpgActorCommandStatus_setBattler = Window_SrpgActorCommandStatus.prototype.setBattler;
    Window_SrpgActorCommandStatus.prototype.setBattler = function(battler) {
		if (battler) {
			if (battler.isActor() === true) {
				this._type = 'actor';
			} else if (battler.isEnemy() === true) {
				this._type = 'enemy';
			}
			this._srpgWindowTone = this.setSrpgWindowTone(this._type);
		}
		srpgUXWindows_Window_SrpgActorCommandStatus_setBattler.call(this, battler);
    };

	// ステータスの描画
    Window_SrpgActorCommandStatus.prototype.drawItem = function() {
		if (this._type === 'actor') {
			this.drawContentsActor();
		} else if (this._type === 'enemy') {
			this.drawContentsEnemy();
		}
    };

	Window_SrpgActorCommandStatus.prototype.cbnWeakAgainstAnchor = function(x, y) {
		var drawFn = Window_StatusBase.prototype.drawActorSimpleStatusSrpg;
		var source = drawFn ? String(drawFn) : '';
		var usesVanillaLayout = source.indexOf('x2 = x + 180') >= 0;
		if (usesVanillaLayout) {
			var vanillaGaugeX = x + 180;
			var vanillaGaugeY = y + this.lineHeight();
			return { x: vanillaGaugeX + 128 + 8, y: vanillaGaugeY - 6 };
		}
		// Layout compact (plugins de preview custom) :
		// y3 = y + step*2 + iconHeight + 6 avec step=22
		var compactGaugeX = x;
		var compactGaugeY = y + 22 * 2 + ImageManager.iconHeight + 6;
		return { x: compactGaugeX + 128 + 8, y: compactGaugeY - 6 };
	};

	// アクターのステータスの描画
    Window_SrpgActorCommandStatus.prototype.drawContentsActor = function() {
        this.drawActorItemImage();
        this.drawActorItemStatus();
    };
    
    Window_SrpgActorCommandStatus.prototype.drawActorItemImage = function() {
        const width = ImageManager.faceWidth;
        const height = this.fittingHeight(2) - 8;
        this.drawActorFace(this._battler, 1, 1, width, height);
    };
    
    Window_SrpgActorCommandStatus.prototype.drawActorItemStatus = function() {
        const x = 180;
        const y = 0;
		const anchor = this.cbnWeakAgainstAnchor(x, y);
		const desiredWeakIconsX = anchor.x;
		const minRightWidth = 220;
		const maxWeakIconsX = Math.max(0, this.contentsWidth() - minRightWidth);
		const weakIconsX = Math.min(desiredWeakIconsX, maxWeakIconsX);
        this.drawActorSimpleStatusSrpg(this._battler, x, y);
		this.drawCbnWeakTypeIconsOnly(this._battler, weakIconsX, anchor.y, this.contentsWidth() - weakIconsX);
    };

    // エネミーのステータスの描画
    Window_SrpgActorCommandStatus.prototype.drawContentsEnemy = function() {
        this.drawEnemyItemImage();
        this.drawEnemyItemStatus();
    };

	Window_SrpgActorCommandStatus.prototype.drawEnemyItemImage = function() {
        const width = ImageManager.faceWidth;
        const height = this.fittingHeight(2) - 8;
        this.drawEnemyFace(this._battler, 1, 1, width, height);
    };
    
    Window_SrpgActorCommandStatus.prototype.drawEnemyItemStatus = function() {
        const x = 180;
        const y = 0;
		const anchor = this.cbnWeakAgainstAnchor(x, y);
		const desiredWeakIconsX = anchor.x;
		const minRightWidth = 220;
		const maxWeakIconsX = Math.max(0, this.contentsWidth() - minRightWidth);
		const weakIconsX = Math.min(desiredWeakIconsX, maxWeakIconsX);
        this.drawEnemySimpleStatusSrpg(this._battler, x, y);
		this.drawCbnWeakTypeIconsOnly(this._battler, weakIconsX, anchor.y, this.contentsWidth() - weakIconsX);
    };

	// prévoir plus de place sur la fenêtre basse (survol)
	const srpgUXWindows_Scene_Map_srpgActorCommandStatusWindowRect = Scene_Map.prototype.srpgActorCommandStatusWindowRect;
	Scene_Map.prototype.srpgActorCommandStatusWindowRect = function() {
		var rect = srpgUXWindows_Scene_Map_srpgActorCommandStatusWindowRect.call(this);
		rect.height = this.calcWindowHeight(5, false);
		rect.y = Graphics.boxHeight - rect.height;
		return rect;
	};

	// prévoir 1 ligne supplémentaire en haut pour afficher "Faible contre"
	const srpgUXWindows_Scene_Map_srpgStatusWindowRect = Scene_Map.prototype.srpgStatusWindowRect;
	Scene_Map.prototype.srpgStatusWindowRect = function(target) {
		var rect = srpgUXWindows_Scene_Map_srpgStatusWindowRect.call(this, target);
		rect.height = this.calcWindowHeight(11, false);
		return rect;
	};

	const srpgUXWindows_Window_SrpgStatus_drawSrpgParameters = Window_SrpgStatus.prototype.drawSrpgParameters;
	Window_SrpgStatus.prototype.drawSrpgParameters = function(x, y) {
		srpgUXWindows_Window_SrpgStatus_drawSrpgParameters.call(this, x, y);
		this.drawCbnWeakTypeIconsOnly(this.battler(), x, y + this.lineHeight(), this.contentsWidth() - x);
	};

	// fenêtres de statut en scène de combat : +1 ligne
	const srpgUXWindows_Scene_Battle_srpgBattleStatusWindowRect = Scene_Battle.prototype.srpgBattleStatusWindowRect;
	Scene_Battle.prototype.srpgBattleStatusWindowRect = function(pos) {
		var rect = srpgUXWindows_Scene_Battle_srpgBattleStatusWindowRect.call(this, pos);
		rect.height = Window_Base.prototype.fittingHeight(5);
		rect.y = Graphics.boxHeight - rect.height;
		return rect;
	};

	const srpgUXWindows_Window_SrpgBattleStatus_drawBasicInfo = Window_SrpgBattleStatus.prototype.drawBasicInfo;
	Window_SrpgBattleStatus.prototype.drawBasicInfo = function(x, y) {
		srpgUXWindows_Window_SrpgBattleStatus_drawBasicInfo.call(this, x, y);
		this.drawCbnWeakTypeIconsOnly(this._battler, x, y + this.lineHeight() * 3, this.contentsWidth() - x);
	};

	// カーソル移動時の処理
	const srpgUXWindows_Scene_Map_srpgMovementExtension = Scene_Map.prototype.srpgMovementExtension;
    Scene_Map.prototype.srpgMovementExtension = function() {
        srpgUXWindows_Scene_Map_srpgMovementExtension.call(this);
		if (_srpgAutoOpenActorCommandStatusWindow) {
			if ($gameSystem.isBattlePhase() === 'actor_phase' &&
				$gameSystem.isSubBattlePhase() === 'normal'){
				let clearFlag = true;
				$gameMap.eventsXy($gamePlayer.x, $gamePlayer.y).forEach(function(event) {
					if (!event.isErased()) {
						if (event.isType() === 'actor' || event.isType() === 'enemy') {
							var battlerArray = $gameSystem.EventToUnit(event.eventId());
							$gameSystem.setSrpgActorCommandStatusWindowNeedRefresh(battlerArray, true);
							clearFlag = false;
						}
					}
				});
				if (clearFlag === true) $gameSystem.clearSrpgActorCommandStatusWindowNeedRefresh();
			}
		}
    };

//====================================================================
// Do not display HP/MP based on the tag.
//====================================================================
	Game_BattlerBase.prototype.srpgHideHpMp = function() {
		return false;
	};

    Game_Actor.prototype.srpgHideHpMp = function() {
		let value = false;
		this.states().forEach(function(state) {
            if (state && state.meta.showHpMp === 'true') value = true;
        }, this);
		if (value === true) return false;
		if (this.actor().meta.hideHpMp === 'true') return true;
		return false;
    };

	Game_Enemy.prototype.srpgHideHpMp = function() {
		let value = false;
		this.states().forEach(function(state) {
            if (state && state.meta.showHpMp === 'true') value = true;
        }, this);
		if (value === true) return false;
		if (this.enemy().meta.hideHpMp === 'true') return true;
		return false;
    };

	const srpgUXWindows_ColorManager_hpColor = ColorManager.hpColor;
	ColorManager.hpColor = function(actor) {
		if (actor && $gameSystem.isSRPGMode() && actor.srpgHideHpMp()) {
			return this.normalColor();
		} else {
			return srpgUXWindows_ColorManager_hpColor.call(this, actor);
		}
	};

	const srpgUXWindows_Sprite_Gauge_currentValue = Sprite_Gauge.prototype.currentValue;
	Sprite_Gauge.prototype.currentValue = function() {
		if (this._battler) {
			if ($gameSystem.isSRPGMode() && this._battler.srpgHideHpMp() && this._statusType !== "exp") {
				return 100;
			} else {
				return srpgUXWindows_Sprite_Gauge_currentValue.call(this);
			}
		}
		return NaN;
	};
	
	const srpgUXWindows_Sprite_Gauge_currentMaxValue = Sprite_Gauge.prototype.currentMaxValue;
	Sprite_Gauge.prototype.currentMaxValue = function() {
		if (this._battler) {
			if ($gameSystem.isSRPGMode() && this._battler.srpgHideHpMp() && this._statusType !== "exp") {
				return 100;
			} else {
				return srpgUXWindows_Sprite_Gauge_currentMaxValue.call(this);
			}
		}
		return NaN;
	};

	const srpgUXWindows_Sprite_Gauge_drawValue = Sprite_Gauge.prototype.drawValue;
	Sprite_Gauge.prototype.drawValue = function() {
		if ($gameSystem.isSRPGMode() && this._battler && this._battler.srpgHideHpMp() && this._statusType !== "exp") {
			const currentValue = '???';
    		const width = this.bitmapWidth();
    		const height = this.textHeight();
    		this.setupValueFont();
    		this.bitmap.drawText(currentValue, 0, 0, width, height, "right");
		} else {
			srpgUXWindows_Sprite_Gauge_drawValue.call(this);
		}
	};

})();