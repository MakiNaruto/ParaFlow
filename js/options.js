// ===== 设置页 =====
// 划词查词 / 触发键 / 图标模式 / 查词兜底开关。
// storage key 与默认触发键来自 shared/constants.js。
import { LS_KEYS as STORAGE_KEYS, DEFAULT_MODIFIER_KEY } from "./shared/constants.js";

const handleCheckChange = async (key, val) => {
  try {
    await chrome.storage.local.set({ [key]: val });
  } catch (e) {
    console.error(`Error setting storage for ${key}:`, e);
  }
};

const initCheckbox = async (key) => {
  try {
    const data = await chrome.storage.local.get(key);
    const el = document.getElementById(key);
    if (!el) return;
    if (data[key] === undefined) {
      await chrome.storage.local.set({ [key]: true });
      el.checked = true;
    } else {
      el.checked = data[key];
    }
    el.addEventListener("change", (e) => handleCheckChange(key, e.target.checked));
  } catch (e) {
    console.error(`Error initializing checkbox ${key}:`, e);
  }
};

const initSelect = async (key) => {
  try {
    const data = await chrome.storage.local.get(key);
    const el = document.getElementById(key);
    if (!el) return;
    if (data[key] === undefined) {
      await chrome.storage.local.set({ [key]: DEFAULT_MODIFIER_KEY });
      el.value = DEFAULT_MODIFIER_KEY;
    } else {
      el.value = data[key];
    }
    el.addEventListener("change", (e) => handleCheckChange(key, e.target.value));
  } catch (e) {
    console.error(`Error initializing select ${key}:`, e);
  }
};

const handleDocumentLoad = () => {
  Object.values(STORAGE_KEYS).forEach((k) => {
    if (k === STORAGE_KEYS.MODIFIER_KEY) {
      initSelect(k);
    } else {
      initCheckbox(k);
    }
  });
};

document.addEventListener("DOMContentLoaded", handleDocumentLoad);
