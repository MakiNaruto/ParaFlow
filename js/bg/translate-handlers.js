// 翻译与翻译源管理消息处理（msg.action）。
// 翻译委托给 translator；翻译源 CRUD 委托给 translator 的对应函数。
import {
  translateText,
  getVendors,
  setVendorOrder,
  getSelectedVendor,
  setSelectedVendor,
  getCustomVendors,
  addCustomVendor,
  updateCustomVendor,
  deleteCustomVendor,
  getAddableVendorTypes,
} from "../translator/index.js";
import { TRANS_LANG_KEY, TRANS_DEFAULT_TO } from "../shared/constants.js";
import { trySendResponse } from "../shared/messaging.js";

async function getTargetLang() {
  const stored = (await chrome.storage.local.get(TRANS_LANG_KEY))[TRANS_LANG_KEY];
  return stored || TRANS_DEFAULT_TO;
}

export function handleTranslate(msg, _sender, sendResponse) {
  if (msg.action === 'setVendorOrder') {
    setVendorOrder(msg.ids)
      .then(() => trySendResponse(sendResponse, { ok: true }))
      .catch((err) => trySendResponse(sendResponse, { ok: false, error: String(err) }));
    return true;
  }
  if (msg.action === "translate") {
    getTargetLang()
      .then((to) => translateText(msg.text, to, msg.vendor))
      .then((translation) => trySendResponse(sendResponse, { ok: true, translation }))
      .catch((err) => trySendResponse(sendResponse, { ok: false, error: String((err && err.message) || err) }));
    return true; // 异步响应
  }

  if (msg.action === "getAddableVendorTypes") {
    trySendResponse(sendResponse, { ok: true, types: getAddableVendorTypes() });
    return true;
  }

  if (msg.action === "getVendors") {
    getVendors()
      .then((vendors) => trySendResponse(sendResponse, { ok: true, vendors }))
      .catch((err) => trySendResponse(sendResponse, { ok: false, error: String(err) }));
    return true;
  }

  if (msg.action === "getSelectedVendor") {
    getSelectedVendor()
      .then((vendor) => trySendResponse(sendResponse, { ok: true, vendor }))
      .catch((err) => trySendResponse(sendResponse, { ok: false, error: String(err) }));
    return true;
  }

  if (msg.action === "setSelectedVendor") {
    setSelectedVendor(msg.vendor)
      .then(() => trySendResponse(sendResponse, { ok: true }))
      .catch((err) => trySendResponse(sendResponse, { ok: false, error: String(err) }));
    return true;
  }

  if (msg.action === "getCustomVendors") {
    getCustomVendors()
      .then((vendors) => trySendResponse(sendResponse, { ok: true, vendors }))
      .catch((err) => trySendResponse(sendResponse, { ok: false, error: String(err) }));
    return true;
  }

  if (msg.action === "addCustomVendor") {
    addCustomVendor({
      name: msg.name,
      type: msg.type,
      url: msg.url,
      appId: msg.appId,
      appKey: msg.appKey,
      // 大模型翻译字段
      protocol: msg.protocol,
      apiKey: msg.apiKey,
      model: msg.model,
      prompt: msg.prompt,
    })
      .then((vendor) => trySendResponse(sendResponse, { ok: true, vendor }))
      .catch((err) => trySendResponse(sendResponse, { ok: false, error: String(err) }));
    return true;
  }

  if (msg.action === "updateCustomVendor") {
    updateCustomVendor(msg.id, {
      name: msg.name,
      type: msg.type,
      url: msg.url,
      appId: msg.appId,
      appKey: msg.appKey,
      // 大模型翻译字段
      protocol: msg.protocol,
      apiKey: msg.apiKey,
      model: msg.model,
      prompt: msg.prompt,
    })
      .then((updated) => trySendResponse(sendResponse, { ok: true, updated }))
      .catch((err) => trySendResponse(sendResponse, { ok: false, error: String(err) }));
    return true;
  }

  if (msg.action === "deleteCustomVendor") {
    deleteCustomVendor(msg.id)
      .then((deleted) => trySendResponse(sendResponse, { ok: true, deleted }))
      .catch((err) => trySendResponse(sendResponse, { ok: false, error: String(err) }));
    return true;
  }

  return false;
}
