//=============================================================================
// SRPG_OldCenterAnimation_MZ.js
//-----------------------------------------------------------------------------
// Play a classic (old MV-style) animation once at AoE center/origin.
//=============================================================================
/*:
 * @target MZ
 * @plugindesc SRPG helper: old animation once at AoE center/origin.
 * @author ChatGPT
 * @base SRPG_core_MZ
 * @base SRPG_AoE_MZ
 * @orderAfter SRPG_core_MZ
 * @orderAfter SRPG_AoE_MZ
 *
 * @help
 * Add one of these notetags on a skill:
 *   <SRPGCenterOldAnimation:147>
 *   <SRPGOriginOldAnimation:147>
 *   <SRPGCasterOldAnimation:147>
 *
 * Behavior:
 * - During SRPG map battle, this plays animation ID 147 once
 *   at AoE center (selected cell), not on each target.
 * - With SRPGOriginOldAnimation, the animation is played once
 *   on the clicked cell (AoE origin / cursor cell).
 * - With SRPGCasterOldAnimation, the animation is played once
 *   on the caster.
 * - The skill's normal animation is suppressed during that cast
 *   to avoid repeated per-target playback.
 *
 * Recommended setup:
 * - Keep skill animation as "None" in database,
 *   and drive the visual only via <SRPGCenterOldAnimation:x>.
 */

(function() {
    "use strict";

    function centerAnimationId(item) {
        if (!item || !item.meta) return 0;
        return Number(item.meta.SRPGCenterOldAnimation || 0);
    }

    function originAnimationId(item) {
        if (!item || !item.meta) return 0;
        return Number(item.meta.SRPGOriginOldAnimation || 0);
    }

    function casterAnimationId(item) {
        if (!item || !item.meta) return 0;
        return Number(item.meta.SRPGCasterOldAnimation || 0);
    }

    const _Scene_Map_srpgBattleStart = Scene_Map.prototype.srpgBattleStart;
    Scene_Map.prototype.srpgBattleStart = function(userArray, targetArray) {
        $gameTemp._srpgCenterOldAnimationPlayed = false;
        _Scene_Map_srpgBattleStart.call(this, userArray, targetArray);
    };

    const _Scene_Map_srpgInvokeMapSkill = Scene_Map.prototype.srpgInvokeMapSkill;
    Scene_Map.prototype.srpgInvokeMapSkill = function(data) {
        const action = data && data.action;
        const item = action && action.item ? action.item() : null;
        const centerAnimId = centerAnimationId(item);
        const originAnimId = originAnimationId(item);
        const casterAnimId = casterAnimationId(item);
        const animId = centerAnimId > 0 ? centerAnimId : (originAnimId > 0 ? originAnimId : casterAnimId);
        const user = data && data.user;
        const userEvent = user && user.srpgEventId ? $gameMap.event(user.srpgEventId()) : null;

        if (animId > 0 && data && data.phase === "start" && !$gameTemp._srpgCenterOldAnimationPlayed) {
            if (centerAnimId > 0 && $gameTemp.areaX && $gameTemp.areaY) {
                const oldX = $gamePlayer.x;
                const oldY = $gamePlayer.y;
                // Reuse player sprite as animation anchor at the AoE center.
                $gamePlayer.locate($gameTemp.areaX(), $gameTemp.areaY());
                $gameTemp.requestAnimation([$gamePlayer], centerAnimId);
                $gamePlayer.locate(oldX, oldY);
                $gameTemp._srpgCenterOldAnimationPlayed = true;
            } else if (originAnimId > 0 && $gameTemp.areaX && $gameTemp.areaY) {
                const oldX = $gamePlayer.x;
                const oldY = $gamePlayer.y;
                $gamePlayer.locate($gameTemp.areaX(), $gameTemp.areaY());
                $gameTemp.requestAnimation([$gamePlayer], originAnimId);
                $gamePlayer.locate(oldX, oldY);
                $gameTemp._srpgCenterOldAnimationPlayed = true;
            } else if (casterAnimId > 0 && userEvent) {
                $gameTemp.requestAnimation([userEvent], casterAnimId);
                $gameTemp._srpgCenterOldAnimationPlayed = true;
            }
        }

        if (animId > 0 && data && data.phase === "animation" && item) {
            const originalAnimationId = item.animationId;
            item.animationId = 0;
            const result = _Scene_Map_srpgInvokeMapSkill.call(this, data);
            item.animationId = originalAnimationId;
            return result;
        }

        return _Scene_Map_srpgInvokeMapSkill.call(this, data);
    };
})();

