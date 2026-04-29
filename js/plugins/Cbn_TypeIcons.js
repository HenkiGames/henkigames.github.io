/*:
 * @target MZ
 * @plugindesc Associe une icone aux types BDD + editeur visuel d'assignation.
 * @author Carbonne Arena
 *
 * @command OpenTypeIconManager
 * @text Ouvrir gestionnaire type/icone
 * @desc Ouvre une scene pour assigner une icone a chaque type de la BDD.
 *
 * @param mappings
 * @text Correspondances type -> icone
 * @type struct<TypeIconMapping>[]
 * @default []
 * @desc Liste des correspondances. Vous pouvez remplir elementId OU typeName.
 *
 * @param fallbackIconIndex
 * @text Icone fallback
 * @type number
 * @min 0
 * @default 0
 * @desc Icone renvoyee si aucun mapping n'est trouve. 0 = aucune icone.
 *
 * @param caseInsensitive
 * @text Comparaison non sensible a la casse
 * @type boolean
 * @on Oui
 * @off Non
 * @default true
 * @desc Si Oui, "Feu", "feu" et "FEU" sont consideres identiques.
 *
 * @help
 * Ce plugin ne change pas vos calculs de resistances/faiblesses.
 * Il ajoute juste un mapping "type (texte) -> icone" utilisable en script.
 *
 * Source des types:
 * - Le plugin lit automatiquement les types dans $dataSystem.elements (BDD > Types).
 * - Le gestionnaire affiche donc toujours la liste reelle de la BDD.
 *
 * Utilisation recommandee:
 * 1) Lancez en jeu la commande plugin:
 *    "Ouvrir gestionnaire type/icone"
 * 2) Selectionnez un type dans la liste de gauche.
 * 3) Choisissez une icone dans la grille de droite.
 * 4) Validation: l'assignation est enregistree globalement pour tout le projet.
 *
 * Notes:
 * - Les parametres "Correspondances type -> icone" servent de base initiale.
 * - Les choix faits dans le gestionnaire passent en priorite.
 * - Fichier global utilise: data/CbnTypeIcons.json
 *
 * API script exposee:
 * - CbnTypeIcons.getElementTypes()
 *   -> [{ id, name }, ...] depuis la BDD.
 *
 * - CbnTypeIcons.iconByElementId(elementId)
 *   -> index d'icone (number)
 *
 * - CbnTypeIcons.iconByTypeName(typeName)
 *   -> index d'icone (number)
 *
 * - CbnTypeIcons.textWithIconByTypeName(typeName)
 *   -> "\\I[n]NomType" si icone trouvee, sinon "NomType"
 *
 * Alias globaux pratiques:
 * - CbnGetTypeIcon(typeName)
 * - CbnGetElementIcon(elementId)
 */

/*~struct~TypeIconMapping:
 * @param elementId
 * @text Element ID
 * @type number
 * @min 0
 * @default 0
 * @desc ID du type dans BDD > Types. Prioritaire sur typeName si > 0.
 *
 * @param typeName
 * @text Nom du type
 * @type string
 * @default
 * @desc Nom du type (si vous ne voulez pas utiliser elementId).
 *
 * @param iconIndex
 * @text Icone
 * @type icon
 * @default 0
 * @desc Index de l'icone (comme pour une competence).
 */

(() => {
    "use strict";

    const PLUGIN_NAME = "Cbn_TypeIcons";
    const GLOBAL_DATA_FILE = "CbnTypeIcons.json";
    const GLOBAL_STORAGE_KEY = `${PLUGIN_NAME}:globalMappings`;
    const params = PluginManager.parameters(PLUGIN_NAME) || {};
    const fallbackIconIndex = parseNonNegativeInt(params.fallbackIconIndex, 0);
    const caseInsensitive = String(params.caseInsensitive || "true") !== "false";

    function parseNonNegativeInt(value, fallback) {
        const n = Number(value);
        return Number.isInteger(n) && n >= 0 ? n : fallback;
    }

    function normalizeTypeName(value) {
        const text = String(value || "").trim();
        return caseInsensitive ? text.toLowerCase() : text;
    }

    function parseMappings(raw) {
        let arr = [];
        try {
            arr = JSON.parse(raw || "[]");
            if (!Array.isArray(arr)) arr = [];
        } catch (_e) {
            arr = [];
        }

        return arr.map(item => {
            let obj = {};
            try {
                obj = JSON.parse(item || "{}");
            } catch (_e) {
                obj = {};
            }

            return {
                elementId: parseNonNegativeInt(obj.elementId, 0),
                typeName: String(obj.typeName || "").trim(),
                iconIndex: parseNonNegativeInt(obj.iconIndex, 0)
            };
        });
    }

    const entries = parseMappings(params.mappings);
    const iconByElementId = new Map();
    const iconByTypeName = new Map();
    const runtimeIconsByElementId = new Map();
    let runtimeLoaded = false;
    let globalLoaded = false;

    function mapElementNameById(elementId) {
        if (!$dataSystem || !$dataSystem.elements || elementId <= 0) return "";
        return String($dataSystem.elements[elementId] || "").trim();
    }

    function rebuildCache() {
        iconByElementId.clear();
        iconByTypeName.clear();

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const iconIndex = parseNonNegativeInt(entry.iconIndex, 0);

            if (entry.elementId > 0) {
                iconByElementId.set(entry.elementId, iconIndex);
                const dbTypeName = mapElementNameById(entry.elementId);
                if (dbTypeName) {
                    iconByTypeName.set(normalizeTypeName(dbTypeName), iconIndex);
                }
                continue;
            }

            const normalized = normalizeTypeName(entry.typeName);
            if (normalized) {
                iconByTypeName.set(normalized, iconIndex);
            }
        }

        runtimeIconsByElementId.forEach((iconIndex, elementId) => {
            iconByElementId.set(elementId, iconIndex);
            const dbTypeName = mapElementNameById(elementId);
            if (dbTypeName) {
                iconByTypeName.set(normalizeTypeName(dbTypeName), iconIndex);
            }
        });
    }

    function hasNodeFs() {
        return !!(Utils && Utils.isNwjs && Utils.isNwjs() && typeof require === "function");
    }

    function makeRuntimeTableObject() {
        const out = {};
        runtimeIconsByElementId.forEach((iconIndex, elementId) => {
            out[elementId] = iconIndex;
        });
        return out;
    }

    function applyRuntimeTableObject(table) {
        runtimeIconsByElementId.clear();
        if (!table || typeof table !== "object") return;
        const keys = Object.keys(table);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const elementId = parseNonNegativeInt(key, 0);
            const iconIndex = parseNonNegativeInt(table[key], 0);
            if (elementId > 0) {
                runtimeIconsByElementId.set(elementId, iconIndex);
            }
        }
    }

    function loadGlobalMappings() {
        if (globalLoaded) return;
        globalLoaded = true;
        let table = null;

        if (hasNodeFs()) {
            try {
                const fs = require("fs");
                const path = require("path");
                const baseDir = path.dirname(process.mainModule.filename);
                const filePath = path.join(baseDir, "data", GLOBAL_DATA_FILE);
                if (fs.existsSync(filePath)) {
                    const raw = fs.readFileSync(filePath, { encoding: "utf8" });
                    table = JSON.parse(raw || "{}");
                }
            } catch (_e) {
                table = null;
            }
        }

        if (!table) {
            try {
                const raw = localStorage.getItem(GLOBAL_STORAGE_KEY);
                if (raw) table = JSON.parse(raw);
            } catch (_e) {
                table = null;
            }
        }

        if (table && typeof table === "object") {
            applyRuntimeTableObject(table);
            rebuildCache();
        }
    }

    function saveGlobalMappings() {
        const table = makeRuntimeTableObject();

        if (hasNodeFs()) {
            try {
                const fs = require("fs");
                const path = require("path");
                const baseDir = path.dirname(process.mainModule.filename);
                const dataDir = path.join(baseDir, "data");
                const filePath = path.join(dataDir, GLOBAL_DATA_FILE);
                if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
                fs.writeFileSync(filePath, JSON.stringify(table, null, 2), { encoding: "utf8" });
            } catch (_e) {
                // fallback localStorage ci-dessous
            }
        }

        try {
            localStorage.setItem(GLOBAL_STORAGE_KEY, JSON.stringify(table));
        } catch (_e) {
            // Ignorer si indisponible.
        }
    }

    function getElementTypes() {
        if (!$dataSystem || !$dataSystem.elements) return [];
        const result = [];
        for (let id = 1; id < $dataSystem.elements.length; id++) {
            const name = String($dataSystem.elements[id] || "").trim();
            if (!name) continue;
            result.push({ id, name });
        }
        return result;
    }

    function iconForElementId(elementId) {
        if (iconByElementId.size === 0 && iconByTypeName.size === 0) rebuildCache();

        const id = parseNonNegativeInt(elementId, 0);
        if (id > 0 && iconByElementId.has(id)) {
            return iconByElementId.get(id);
        }

        const dbName = mapElementNameById(id);
        if (dbName) {
            const byName = iconForTypeName(dbName);
            if (byName > 0) return byName;
        }

        return fallbackIconIndex;
    }

    function iconForTypeName(typeName) {
        if (iconByElementId.size === 0 && iconByTypeName.size === 0) rebuildCache();
        const normalized = normalizeTypeName(typeName);
        if (normalized && iconByTypeName.has(normalized)) {
            return iconByTypeName.get(normalized);
        }
        return fallbackIconIndex;
    }

    function textWithIconByTypeName(typeName) {
        const name = String(typeName || "");
        const icon = iconForTypeName(name);
        if (icon > 0) return `\\I[${icon}]${name}`;
        return name;
    }

    function setupRuntimeIconMapFromSave() {
        if (runtimeLoaded) return;
        runtimeLoaded = true;
        loadGlobalMappings();
        if (!$gameSystem || !$gameSystem._cbnTypeIconByElementId) return;
        const table = $gameSystem._cbnTypeIconByElementId;
        const keys = Object.keys(table);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const elementId = parseNonNegativeInt(key, 0);
            const iconIndex = parseNonNegativeInt(table[key], 0);
            if (elementId > 0) runtimeIconsByElementId.set(elementId, iconIndex);
        }
        rebuildCache();
    }

    function saveRuntimeIconsToGameSystem() {
        if (!$gameSystem) return;
        const out = {};
        runtimeIconsByElementId.forEach((iconIndex, elementId) => {
            out[elementId] = iconIndex;
        });
        $gameSystem._cbnTypeIconByElementId = out;
    }

    function setIconForElementId(elementId, iconIndex) {
        const id = parseNonNegativeInt(elementId, 0);
        const icon = parseNonNegativeInt(iconIndex, 0);
        if (id <= 0) return;
        runtimeIconsByElementId.set(id, icon);
        saveRuntimeIconsToGameSystem();
        saveGlobalMappings();
        rebuildCache();
    }

    function iconPickerMaxIcons() {
        const iconSet = ImageManager.loadSystem("IconSet");
        const pw = ImageManager.iconWidth || 32;
        const ph = ImageManager.iconHeight || 32;
        const cols = iconSet.width > 0 ? Math.floor(iconSet.width / pw) : 16;
        const rows = iconSet.height > 0 ? Math.floor(iconSet.height / ph) : 32;
        return Math.max(0, cols * rows);
    }

    function openTypeIconManager() {
        if (!$dataSystem) return;
        setupRuntimeIconMapFromSave();
        SceneManager.push(Scene_CbnTypeIconManager);
    }

    const _DataManager_onLoad = DataManager.onLoad;
    DataManager.onLoad = function(object) {
        _DataManager_onLoad.call(this, object);
        if (object === $dataSystem) {
            rebuildCache();
        }
    };

    const _DataManager_extractSaveContents = DataManager.extractSaveContents;
    DataManager.extractSaveContents = function(contents) {
        _DataManager_extractSaveContents.call(this, contents);
        runtimeLoaded = false;
        setupRuntimeIconMapFromSave();
    };

    const _DataManager_createGameObjects = DataManager.createGameObjects;
    DataManager.createGameObjects = function() {
        _DataManager_createGameObjects.call(this);
        runtimeLoaded = false;
        globalLoaded = false;
        loadGlobalMappings();
        rebuildCache();
    };

    PluginManager.registerCommand(PLUGIN_NAME, "OpenTypeIconManager", () => {
        openTypeIconManager();
    });

    function CbnTypeIconManagerLayout() {
        const gw = Graphics.boxWidth;
        const gh = Graphics.boxHeight;
        const helpHeight = 72;
        const listWidth = 360;
        const iconWindowX = listWidth;
        const iconWindowY = helpHeight;
        return {
            helpRect: new Rectangle(0, 0, gw, helpHeight),
            listRect: new Rectangle(0, helpHeight, listWidth, gh - helpHeight),
            iconRect: new Rectangle(iconWindowX, iconWindowY, gw - iconWindowX, gh - iconWindowY)
        };
    }

    function Window_CbnTypeList() {
        this.initialize(...arguments);
    }

    Window_CbnTypeList.prototype = Object.create(Window_Selectable.prototype);
    Window_CbnTypeList.prototype.constructor = Window_CbnTypeList;

    Window_CbnTypeList.prototype.initialize = function(rect) {
        Window_Selectable.prototype.initialize.call(this, rect);
        this._data = [];
        this.refresh();
        this.select(0);
    };

    Window_CbnTypeList.prototype.maxItems = function() {
        return this._data ? this._data.length : 0;
    };

    Window_CbnTypeList.prototype.makeItemList = function() {
        this._data = getElementTypes();
    };

    Window_CbnTypeList.prototype.item = function() {
        return this._data && this.index() >= 0 ? this._data[this.index()] : null;
    };

    Window_CbnTypeList.prototype.refresh = function() {
        this.makeItemList();
        Window_Selectable.prototype.refresh.call(this);
    };

    Window_CbnTypeList.prototype.drawItem = function(index) {
        const item = this._data[index];
        if (!item) return;
        const rect = this.itemLineRect(index);
        const icon = iconForElementId(item.id);
        if (icon > 0) this.drawIcon(icon, rect.x, rect.y + 2);
        const textX = rect.x + (icon > 0 ? ImageManager.iconWidth + 8 : 0);
        this.drawText(item.name, textX, rect.y, rect.width - (textX - rect.x));
    };

    function Window_CbnIconPicker() {
        this.initialize(...arguments);
    }

    Window_CbnIconPicker.prototype = Object.create(Window_Selectable.prototype);
    Window_CbnIconPicker.prototype.constructor = Window_CbnIconPicker;

    Window_CbnIconPicker.prototype.initialize = function(rect) {
        Window_Selectable.prototype.initialize.call(this, rect);
        this._maxIcons = 512;
        this.refresh();
    };

    Window_CbnIconPicker.prototype.maxCols = function() {
        return 8;
    };

    Window_CbnIconPicker.prototype.maxItems = function() {
        return this._maxIcons;
    };

    Window_CbnIconPicker.prototype.setMaxIcons = function(value) {
        const max = Math.max(1, parseNonNegativeInt(value, 0));
        if (this._maxIcons !== max) {
            this._maxIcons = max;
            this.refresh();
        }
    };

    Window_CbnIconPicker.prototype.drawItem = function(index) {
        const rect = this.itemRect(index);
        const iconX = rect.x + Math.floor((rect.width - ImageManager.iconWidth) / 2);
        const iconY = rect.y + Math.floor((rect.height - ImageManager.iconHeight) / 2);
        this.drawIcon(index, iconX, iconY);
    };

    Window_CbnIconPicker.prototype.itemHeight = function() {
        return Math.max(Window_Selectable.prototype.itemHeight.call(this), 40);
    };

    function Scene_CbnTypeIconManager() {
        this.initialize(...arguments);
    }

    Scene_CbnTypeIconManager.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CbnTypeIconManager.prototype.constructor = Scene_CbnTypeIconManager;

    Scene_CbnTypeIconManager.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        setupRuntimeIconMapFromSave();
        this.createWindows();
    };

    Scene_CbnTypeIconManager.prototype.createWindows = function() {
        const layout = CbnTypeIconManagerLayout();
        this._helpWindow = new Window_Help(layout.helpRect);
        this._helpWindow.setText("Choisissez un type a gauche, puis selectionnez une icone a droite.");
        this.addWindow(this._helpWindow);

        this._typeWindow = new Window_CbnTypeList(layout.listRect);
        this._typeWindow.setHandler("ok", this.onTypeOk.bind(this));
        this._typeWindow.setHandler("cancel", this.popScene.bind(this));
        this._typeWindow.setHandler("pagedown", this.onTypeClearIcon.bind(this));
        this._typeWindow.activate();
        this.addWindow(this._typeWindow);

        this._iconWindow = new Window_CbnIconPicker(layout.iconRect);
        this._iconWindow.setMaxIcons(iconPickerMaxIcons());
        this._iconWindow.setHandler("ok", this.onIconOk.bind(this));
        this._iconWindow.setHandler("cancel", this.onIconCancel.bind(this));
        this._iconWindow.deactivate();
        this._iconWindow.hide();
        this.addWindow(this._iconWindow);
    };

    Scene_CbnTypeIconManager.prototype.onTypeOk = function() {
        const type = this._typeWindow.item();
        if (!type) return;
        this._iconWindow.select(iconForElementId(type.id));
        this._iconWindow.show();
        this._iconWindow.activate();
        this._helpWindow.setText(`Type: ${type.name} | Entree: assigner, Echap: retour.`);
    };

    Scene_CbnTypeIconManager.prototype.onTypeClearIcon = function() {
        const type = this._typeWindow.item();
        if (!type) return;
        setIconForElementId(type.id, 0);
        this._typeWindow.refresh();
        this._helpWindow.setText(`Type: ${type.name} | Icône retiree.`);
    };

    Scene_CbnTypeIconManager.prototype.onIconOk = function() {
        const type = this._typeWindow.item();
        if (!type) return;
        const iconIndex = this._iconWindow.index();
        setIconForElementId(type.id, iconIndex);
        this._iconWindow.deactivate();
        this._iconWindow.hide();
        this._typeWindow.refresh();
        this._typeWindow.activate();
        this._helpWindow.setText(`Type: ${type.name} | Icône ${iconIndex} assignee.`);
    };

    Scene_CbnTypeIconManager.prototype.onIconCancel = function() {
        this._iconWindow.deactivate();
        this._iconWindow.hide();
        this._typeWindow.activate();
        this._helpWindow.setText("Choisissez un type a gauche, puis selectionnez une icone a droite.");
    };

    window.CbnTypeIcons = {
        getElementTypes,
        iconByElementId: iconForElementId,
        iconByTypeName: iconForTypeName,
        textWithIconByTypeName,
        setIconByElementId: setIconForElementId,
        openManagerScene: openTypeIconManager
    };

    window.CbnGetTypeIcon = function(typeName) {
        return iconForTypeName(typeName);
    };

    window.CbnGetElementIcon = function(elementId) {
        return iconForElementId(elementId);
    };
})();
