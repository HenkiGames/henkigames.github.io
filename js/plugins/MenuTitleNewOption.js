/*:
 * @target MZ
 * @plugindesc Ajoute une option personnalisée au menu de titre pour lancer une map spécifique (comme une arène).
 * @author Pascal
 *
 * @param ArenaCommandName
 * @text Nom du bouton
 * @desc Le texte affiché pour l'option dans le menu titre
 * @default Arena
 *
 * @param ArenaMapId
 * @text ID de la Map
 * @desc L'ID de la map à charger quand le joueur sélectionne l'option Arena
 * @type number
 * @default 5
 *
 * @param ArenaX
 * @text Position X
 * @desc Coordonnée X du joueur sur la map d'arène
 * @type number
 * @default 10
 *
 * @param ArenaY
 * @text Position Y
 * @desc Coordonnée Y du joueur sur la map d'arène
 * @type number
 * @default 10
 */

(() => {
  const parameters = PluginManager.parameters("MenuTitleNewOption");
  const arenaCommandName = parameters["ArenaCommandName"] || "Arena";
  const arenaMapId = Number(parameters["ArenaMapId"] || 5);
  const arenaX = Number(parameters["ArenaX"] || 10);
  const arenaY = Number(parameters["ArenaY"] || 10);

  // Ajouter la commande personnalisée au menu
  const _Window_TitleCommand_makeCommandList = Window_TitleCommand.prototype.makeCommandList;
  Window_TitleCommand.prototype.makeCommandList = function () {
    _Window_TitleCommand_makeCommandList.call(this);
    this.addCommand(arenaCommandName, "arena");
  };

  // Ajouter le handler pour la commande "arena"
  const _Scene_Title_createCommandWindow = Scene_Title.prototype.createCommandWindow;
  Scene_Title.prototype.createCommandWindow = function () {
    _Scene_Title_createCommandWindow.call(this);
    this._commandWindow.setHandler("arena", this.commandArena.bind(this));
  };

  // Comportement de la commande "arena"
  Scene_Title.prototype.commandArena = function () {
    DataManager.setupNewGame(); // initialise les données de jeu comme une nouvelle partie
    $gamePlayer.reserveTransfer(arenaMapId, arenaX, arenaY, 2, 0);
    SceneManager.goto(Scene_Map);
  };
})();
