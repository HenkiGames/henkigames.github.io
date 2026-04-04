/*:
 * @target MZ
 * @plugindesc Affiche un message personnalisé dans le menu si un switch est activé, avec fond noir opaque et bouton "J'ai compris". 🖤📋
 * @author Toi :)
 *
 * @param SwitchID
 * @text ID du Switch
 * @desc ID du switch qui déclenche l’affichage du message
 * @type switch
 * @default 87
 *
 * @param MessageText
 * @text Texte du message
 * @desc Texte à afficher (utilise \n pour aller à la ligne)
 * @type multiline_string
 * @default Bienvenue dans le menu !\nAppuie sur "J'ai compris" pour fermer ce message.
 */

(() => {
    const pluginName = document.currentScript.src.match(/([^\/]+)\.js$/)[1];
    const params = PluginManager.parameters(pluginName);

    const switchId = Number(params["SwitchID"] || 87);
    const messageText = String(params["MessageText"] || "Message par défaut");

    const _Scene_Menu_create = Scene_Menu.prototype.create;
    Scene_Menu.prototype.create = function() {
        _Scene_Menu_create.call(this);

        if ($gameSwitches.value(switchId)) {
            if (!Scene_Menu._customMessageAlreadyShown) {
                Scene_Menu._customMessageAlreadyShown = true;

                const lines = messageText.split("\\n");
                const lineHeight = 36;
                const padding = 36;
                const width = Math.floor(Graphics.boxWidth * 0.8);
                const height = (lines.length * lineHeight) + padding;

                const x = (Graphics.boxWidth - width) / 2;
                const y = (Graphics.boxHeight - height) / 2;

                // Créer un fond noir opaque
                const messageSprite = new Sprite(new Bitmap(width, height));
                messageSprite.bitmap.fillAll("#000000"); // fond noir
                messageSprite.x = x;
                messageSprite.y = y;

                // Texte blanc avec police du jeu
                const bitmap = messageSprite.bitmap;
                bitmap.fontFace = $gameSystem.mainFontFace();
                bitmap.fontSize = $gameSystem.mainFontSize();
                bitmap.textColor = "#FFFFFF";

                for (let i = 0; i < lines.length; i++) {
                    bitmap.drawText(lines[i], padding, i * lineHeight + 10, width - padding * 2, lineHeight, "center");
                    //bitmap.drawText(lines[i], padding, y, width - padding * 2, lineHeight, "left");
                }

                this._customTextSprite = messageSprite;
                this.addChild(messageSprite);

                // Créer le bouton "J'ai compris"
                // const buttonWidth = 160;
                // const buttonHeight = 40;
                // const buttonX = x + (width - buttonWidth) / 2;
                // const buttonY = y + height + 16;

                // const button = new Sprite(new Bitmap(buttonWidth, buttonHeight));
                // button.bitmap.fillAll("#000000"); // fond gris
                // button.bitmap.textColor = "#FFFFFF";
                // button.bitmap.fontFace = $gameSystem.mainFontFace();
                // button.bitmap.fontSize = 20;
                // button.bitmap.drawText("J'ai compris", 0, 0, buttonWidth, buttonHeight, 'center');

                // button.x = buttonX;
                // button.y = buttonY;

                // this.addChild(button);

                // Gestion du clic
                // this._customTextButton = button;
                this._updateCustomTextButton = () => {
                    if (TouchInput.isTriggered()) {
                        // const x = TouchInput.x;
                        // const y = TouchInput.y;
                        this.removeChild(messageSprite);
                        // if (x >= button.x && x <= button.x + buttonWidth &&
                        //     y >= button.y && y <= button.y + buttonHeight) {
                        //     this.removeChild(button);
                        //     this._updateCustomTextButton = null;
                        //     this.removeChild(messageSprite);
                        // }
                    }
                };

                // Injecter dans update
                const _update = this.update;
                this.update = function() {
                    _update.call(this);
                    if (this._updateCustomTextButton) {
                        this._updateCustomTextButton();
                    }
                };
            }
        }
    };
})();
