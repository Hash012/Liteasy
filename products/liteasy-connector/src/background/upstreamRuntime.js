/* Liteasy transport boundary, installed before Zotero.initGlobal().
 * Only translation, proxy detection and snapshot primitives are reused.
 * Zotero desktop/library/account mutations are intentionally unavailable.
 */
(() => {
  const unavailable = () => {
    const error = new Error("Liteasy Connector 仅保存到 Liteasy。");
    error.status = 0;
    return Promise.reject(error);
  };
  Zotero.Connector.callMethod = unavailable;
  Zotero.Connector.saveSingleFile = unavailable;
  Zotero.Connector.checkIsOnline = async () => false;
  Zotero.Connector.reportActiveURL = () => {};
  Zotero.Connector.ping = unavailable;
  Zotero.API.createItem = unavailable;
  Zotero.API.uploadAttachment = unavailable;
  Zotero.API.authorize = unavailable;
  Zotero.ContentTypeHandler.init = () => {};
  const bundle = fetch(chrome.runtime.getURL("translators/catalogue.json")).then(response => {
    if (!response.ok) throw new Error("站点规则包缺失，请重新安装扩展。");
    return response.json();
  });
  Zotero.Repo.getTranslatorMetadataFromServer = async () => (await bundle).translators;
  Zotero.Repo.getTranslatorCode = async id => {
    if (!(await bundle).translators.some(translator => translator.translatorID === id)) throw new Error("此站点规则未包含在当前版本中。");
    const response = await fetch(chrome.runtime.getURL(`translators/${encodeURIComponent(id)}.js`));
    if (!response.ok) throw new Error("此站点规则未包含在当前版本中。");
    return response.text();
  };
  const initTranslators = Zotero.Translators.init.bind(Zotero.Translators);
  let ready;
  Zotero.Translators.init = () => ready ||= (async () => {
    const catalogue = await bundle;
    const key = "liteasy:translator-bundle";
    if ((await chrome.storage.local.get(key))[key] !== catalogue.version) {
      await Zotero.Prefs.removeAllCachedTranslators();
      await chrome.storage.local.set({ [key]: catalogue.version });
    }
    await Zotero.Prefs.set("translatorMetadata", catalogue.translators);
    return initTranslators();
  })();
})();
