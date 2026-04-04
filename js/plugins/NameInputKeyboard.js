/*:
 * @target MZ
 * @plugindesc Permet la saisie directe au clavier physique dans la scène de nom ("Traitement saisie nom") [v1.2]
 * @author GPT
 * @help
 * Ce plugin active l'utilisation du clavier physique dans Scene_Name.
 *
 * ✅ Fonctionne avec les lettres, chiffres, Backspace.
 * ✅ Gère la longueur max définie dans "Traitement saisie nom".
 * ✅ Aucune commande plugin nécessaire.
 */

(() => {
  let currentScene = null;

  const allowedKeys = /^[a-zA-Z0-9]$/;

  function onKeyDown(event) {
    if (!currentScene || !currentScene._editWindow || !currentScene._editWindow.active) return;

    const editWindow = currentScene._editWindow;
    const key = event.key;

    // Saisie alphanumérique
    if (allowedKeys.test(key)) {
      if (editWindow._name.length < editWindow._maxLength) {
        editWindow.add(key);
        event.preventDefault();
      }
    }
    // Suppression
    else if (key === "Backspace") {
      editWindow.back();
      event.preventDefault();
    }
    // Terminer avec Entrée (optionnel)
    else if (key === "Enter") {
      currentScene.onInputOk();
      event.preventDefault();
    }
  }

  // Hook : scène active
  const _Scene_Name_create = Scene_Name.prototype.create;
  Scene_Name.prototype.create = function () {
    _Scene_Name_create.call(this);
    currentScene = this;
    window.addEventListener("keydown", onKeyDown);
  };

  // Cleanup
  const _Scene_Name_terminate = Scene_Name.prototype.terminate;
  Scene_Name.prototype.terminate = function () {
    _Scene_Name_terminate.call(this);
    window.removeEventListener("keydown", onKeyDown);
    currentScene = null;
  };
})();
