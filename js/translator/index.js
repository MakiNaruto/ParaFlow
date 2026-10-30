// 多翻译源引擎 - 注册表 + 自定义翻译源 CRUD + 公共 API。
// 各引擎实现见同目录下的 youdao.js / alibaba.js / baidu.js / libre.js。
import { CryptoJS } from "./crypto.js";
import { youdaoTranslate } from "./youdao.js";
import { alibabaTranslate, alibabaFreeTranslate } from "./alibaba.js";
import { baiduTranslate } from "./baidu.js";
import { libreTranslate } from "./libre.js";
import { llmTranslate } from "./llm.js";
import { VENDOR_STORAGE_KEY, DEFAULT_VENDOR, CUSTOM_VENDORS_KEY } from "../shared/constants.js";

// ---- 内置翻译源（免费 / 免配置） ----
const VENDORS = {
  youdao: { id: "youdao", name: "有道翻译", translate: youdaoTranslate },
  alibabaFree: { id: "alibabaFree", name: "阿里翻译(免费)", translate: alibabaFreeTranslate },
  libre: { id: "libre", name: "LibreTranslate", translate: libreTranslate },
};
const BUILTIN_SETTINGS_KEY = 'xtBuiltinVendorSettings';
const VENDOR_ORDER_KEY = 'xtVendorOrder';

async function getBuiltinSettings() {
  return (await chrome.storage.local.get(BUILTIN_SETTINGS_KEY))[BUILTIN_SETTINGS_KEY] || {};
}

// ---- 可添加的翻译源类型（用户经弹窗作为自定义翻译源添加）----
// 即「传统机器翻译」类 API，需用户提供凭证。
const ADDABLE_VENDOR_TYPES = {
  alibaba: {
    id: "alibaba",
    name: "阿里翻译",
    category: "traditional",
    translate: alibabaTranslate,
    defaultUrl: "https://mt.cn-hangzhou.aliyuncs.com/api/translate/web/ecommerce",
    configFields: [
      { key: "appId", label: "AccessKey ID", placeholder: "阿里云访问控制台获取", type: "text", required: true },
      { key: "appKey", label: "AccessKey Secret", placeholder: "阿里云访问控制台获取", type: "password", required: true },
    ],
  },
  baidu: {
    id: "baidu",
    name: "百度翻译",
    category: "traditional",
    translate: baiduTranslate,
    defaultUrl: "https://fanyi-api.baidu.com/api/trans/vip/translate",
    configFields: [
      { key: "appId", label: "APP ID", placeholder: "在百度翻译开放平台申请", type: "text", required: true },
      { key: "appKey", label: "API Key", placeholder: "在百度翻译开放平台申请", type: "password", required: true },
    ],
  },
};

// 大模型翻译统一类型定义（内置可添加的 LLM 大类）。
// 具体协议（openai/anthropic）、url/apiKey/model/prompt 存于自定义翻译源记录中，
// 由 translateText 的 llm 分支按记录内容分发，详见 llm.js。
const LLM_VENDOR_TYPE = {
  id: "llm",
  name: "大模型翻译",
  category: "llm",
  translate: llmTranslate,
};

/** 获取可添加的翻译源类型定义列表（传统机器翻译；大模型翻译为内置大类）。 */
export function getAddableVendorTypes() {
  return Object.values(ADDABLE_VENDOR_TYPES).map((v) => ({
    id: v.id,
    name: v.name,
    category: v.category,
    configFields: v.configFields,
  }));
}

// ---- 自定义翻译源（用户经弹窗添加）的 CRUD ----

/**
 * 读取全部自定义翻译源。
 * @returns {Promise<Array<{id,name,url,appId,appKey,createdAt,updatedAt}>>}
 */
export async function getCustomVendors() {
  try {
    const stored = (await chrome.storage.local.get(CUSTOM_VENDORS_KEY))[CUSTOM_VENDORS_KEY];
    return stored || [];
  } catch (_) {
    return [];
  }
}

/**
 * 新增自定义翻译源。
 * 若指定了已知 type（如 "alibaba"/"baidu"），未提供 url 时从 type 的 defaultUrl 自动填充。
 */
export async function addCustomVendor(vendorData) {
  const vendors = await getCustomVendors();
  const now = Date.now();

  let url = vendorData.url;
  const vendorType = vendorData.type;
  const typeDef = vendorType ? ADDABLE_VENDOR_TYPES[vendorType] : null;
  if (typeDef && !url) {
    url = typeDef.defaultUrl;
  }

  const newVendor = {
    id: "cv_" + now + "_" + Math.random().toString(36).slice(2, 6),
    name: vendorData.name.trim(),
    type: vendorType || "",
    url: (url || "").trim(),
    appId: (vendorData.appId || "").trim(),
    appKey: (vendorData.appKey || "").trim(),
    // 大模型翻译字段（非大模型源时为空）
    protocol: (vendorData.protocol || "").trim(),
    apiKey: (vendorData.apiKey || "").trim(),
    model: (vendorData.model || "").trim(),
    prompt: (vendorData.prompt || "").trim(),
    createdAt: now,
    updatedAt: now,
  };
  vendors.push(newVendor);
  await chrome.storage.local.set({ [CUSTOM_VENDORS_KEY]: vendors });
  return newVendor;
}

/** 更新已有的自定义翻译源；不存在返回 false。 */
export async function updateCustomVendor(id, vendorData) {
  if (Object.hasOwn(VENDORS, id)) {
    const settings = await getBuiltinSettings();
    if (settings[id]?.deleted) return false;
    settings[id] = { name: vendorData.name.trim() };
    await chrome.storage.local.set({ [BUILTIN_SETTINGS_KEY]: settings });
    return true;
  }
  const vendors = await getCustomVendors();
  const idx = vendors.findIndex((v) => v.id === id);
  if (idx === -1) return false;
  vendors[idx].name = vendorData.name.trim();

  // 若指定 type 且未提供 url，则从 type 的 defaultUrl 自动填充
  let url = vendorData.url;
  const vendorType = vendorData.type;
  const typeDef = vendorType ? ADDABLE_VENDOR_TYPES[vendorType] : null;
  if (typeDef && !url) {
    url = typeDef.defaultUrl;
  }

  vendors[idx].type = vendorType || vendors[idx].type || "";
  vendors[idx].url = (url || "").trim();
  vendors[idx].appId = (vendorData.appId || "").trim();
  vendors[idx].appKey = (vendorData.appKey || "").trim();

  // 大模型翻译字段：仅在调用方提供时更新（兼容旧调用方不覆盖已有值）
  if (vendorData.protocol !== undefined) vendors[idx].protocol = String(vendorData.protocol).trim();
  if (vendorData.apiKey !== undefined) vendors[idx].apiKey = String(vendorData.apiKey).trim();
  if (vendorData.model !== undefined) vendors[idx].model = String(vendorData.model).trim();
  if (vendorData.prompt !== undefined) vendors[idx].prompt = String(vendorData.prompt).trim();

  vendors[idx].updatedAt = Date.now();
  await chrome.storage.local.set({ [CUSTOM_VENDORS_KEY]: vendors });
  return true;
}

/** 删除自定义翻译源；不存在返回 false。 */
export async function deleteCustomVendor(id) {
  if (Object.hasOwn(VENDORS, id)) {
    const settings = await getBuiltinSettings();
    if (settings[id]?.deleted) return false;
    settings[id] = { ...settings[id], deleted: true };
    await chrome.storage.local.set({ [BUILTIN_SETTINGS_KEY]: settings });
    await getSelectedVendor();
    return true;
  }
  let vendors = await getCustomVendors();
  const before = vendors.length;
  vendors = vendors.filter((v) => v.id !== id);
  if (vendors.length === before) return false;
  await chrome.storage.local.set({ [CUSTOM_VENDORS_KEY]: vendors });
  await getSelectedVendor();
  return true;
}

/**
 * 通用自定义翻译源翻译：百度兼容的 POST（form-urlencoded + MD5 签名）。
 * 用于未知 type 的自定义源。
 */
async function customVendorTranslate(text, to, _from, config) {
  const target = to === "zh-CHS" ? "zh" : to;
  const source = _from === "auto" ? "auto" : (_from === "zh-CHS" ? "zh" : _from);
  const salt = String(Math.floor(Math.random() * 90000) + 10000);
  const signStr = config.appId + text + salt + config.appKey;
  const sign = CryptoJS.MD5(signStr).toString(CryptoJS.enc.Hex);

  const params = new URLSearchParams();
  params.append("q", text);
  params.append("from", source);
  params.append("to", target);
  params.append("appid", config.appId);
  params.append("salt", salt);
  params.append("sign", sign);

  const resp = await fetch(config.url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const result = await resp.json();
  if (result && result.trans_result && result.trans_result.length > 0) {
    return result.trans_result.map((item) => item.dst).join("\n");
  }
  throw new Error(result.error_msg || "自定义翻译源失败");
}

// ---- 公共 API ----

/** 获取可用翻译源列表（内置 + 自定义）。 */
export async function getVendors() {
  const settings = await getBuiltinSettings();
  const builtin = Object.values(VENDORS).filter((v) => !settings[v.id]?.deleted).map((v) => ({
    id: v.id, name: settings[v.id]?.name || v.name, isBuiltin: true,
  }));
  const custom = await getCustomVendors();
  const customMapped = custom.map((v) => ({ id: v.id, name: v.name, isBuiltin: false }));
  const vendors = builtin.concat(customMapped);
  const order = (await chrome.storage.local.get(VENDOR_ORDER_KEY))[VENDOR_ORDER_KEY] || [];
  const ranks = new Map(order.map((id, index) => [id, index]));
  return vendors.sort((a, b) => (ranks.get(a.id) ?? order.length) - (ranks.get(b.id) ?? order.length));
}

export async function setVendorOrder(ids) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new Error('无效的翻译源顺序');
  const vendors = await getVendors();
  const available = new Set(vendors.map((v) => v.id));
  const order = [...new Set(ids)].filter((id) => available.has(id));
  vendors.forEach((v) => { if (!order.includes(v.id)) order.push(v.id); });
  await chrome.storage.local.set({ [VENDOR_ORDER_KEY]: order });
}

/** 获取当前选中的翻译源 id（内置或自定义）。 */
export async function getSelectedVendor() {
  const stored = (await chrome.storage.local.get(VENDOR_STORAGE_KEY))[VENDOR_STORAGE_KEY];
  const vendors = await getVendors();
  if (vendors.some((v) => v.id === stored)) return stored;
  const fallback = vendors.find((v) => v.id === DEFAULT_VENDOR)?.id || vendors[0]?.id || '';
  await chrome.storage.local.set({ [VENDOR_STORAGE_KEY]: fallback });
  return fallback;
}

/** 设置当前选中的翻译源。 */
export async function setSelectedVendor(vendorId) {
  if (!vendorId) throw new Error("Invalid vendor ID");
  // 接受自定义翻译源 id（cv_ 前缀）而无需校验 VENDORS
  if (!(await getVendors()).some((v) => v.id === vendorId)) {
    throw new Error("Unknown translation vendor: " + vendorId);
  }
  await chrome.storage.local.set({ [VENDOR_STORAGE_KEY]: vendorId });
}

/**
 * 翻译文本。支持内置与自定义翻译源。
 * @param {string} text - 待翻译文本
 * @param {string} [to="zh-CHS"] - 目标语言
 * @param {string} [vendor] - 翻译源 id；省略时用 storage 中选中的源
 */
export async function translateText(text, to = "zh-CHS", vendor) {
  const vendorId = vendor || await getSelectedVendor();
  if (!vendorId) throw new Error('请先添加翻译源');

  // 自定义翻译源（cv_ 前缀）
  if (vendorId.startsWith("cv_")) {
    const customVendors = await getCustomVendors();
    let config = null;
    for (let i = 0; i < customVendors.length; i++) {
      if (customVendors[i].id === vendorId) {
        config = customVendors[i];
        break;
      }
    }
    if (!config) throw new Error("自定义翻译源不存在或已被删除: " + vendorId);

    // 大模型翻译源（type === "llm"）：协议/接口/密钥/模型/提示词全在记录里
    if (config.type === LLM_VENDOR_TYPE.id) {
      return LLM_VENDOR_TYPE.translate(text, to, "auto", config);
    }

    // 已知可添加类型（如 alibaba/baidu）走对应翻译函数，
    // 直接传入存储的凭证（避免读到错误的 storage key）
    if (config.type && ADDABLE_VENDOR_TYPES[config.type]) {
      return ADDABLE_VENDOR_TYPES[config.type].translate(text, to, "auto", {
        appId: config.appId,
        appKey: config.appKey,
      });
    }

    // 兜底: 通用自定义源翻译（百度兼容 form-urlencoded）
    return customVendorTranslate(text, to, "auto", config);
  }

  // 内置翻译源
  const v = VENDORS[vendorId];
  if (!v) throw new Error("Unknown translation vendor: " + vendorId);
  const settings = await getBuiltinSettings();
  if (settings[vendorId]?.deleted) throw new Error('翻译源已被删除，请重新选择');
  return v.translate(text, to, "auto");
}

/** 获取翻译源显示名（内置或自定义）。 */
export async function getVendorName(vendorId) {
  // 内置翻译源
  if (VENDORS[vendorId]) return (await getBuiltinSettings())[vendorId]?.name || VENDORS[vendorId].name;
  // 自定义翻译源
  if (vendorId.startsWith("cv_")) {
    const custom = await getCustomVendors();
    for (let i = 0; i < custom.length; i++) {
      if (custom[i].id === vendorId) return custom[i].name;
    }
  }
  return vendorId;
}

// 向后兼容的默认导出
export { translateText as default };
