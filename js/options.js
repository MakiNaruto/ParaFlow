// ===== 设置页 =====
// 划词查词 / 触发键 / 图标模式开关 + 云端同步按钮。
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

const setSyncStatus = (text, type) => {
  const el = document.getElementById("syncStatus");
  if (!el) return;
  el.textContent = text;
  el.className = "sync-status " + (type || "");
};

const refreshControls = async () => {
  for (const k of Object.values(STORAGE_KEYS)) {
    try {
      const data = await chrome.storage.local.get(k);
      const el = document.getElementById(k);
      if (!el) continue;
      if (k === STORAGE_KEYS.MODIFIER_KEY) {
        el.value = data[k] || DEFAULT_MODIFIER_KEY;
      } else {
        el.checked = !!data[k];
      }
    } catch (e) {
      console.error(`Error refreshing control ${k}:`, e);
    }
  }
};

const initSyncButtons = () => {
  const pushBtn = document.getElementById("syncToCloudBtn");
  const pullBtn = document.getElementById("pullFromCloudBtn");
  if (!pushBtn || !pullBtn) return;

  pushBtn.addEventListener("click", async () => {
    if (!navigator.onLine) {
      setSyncStatus("当前没有网络连接，请检查网络后重试。", "error");
      return;
    }
    pushBtn.disabled = pullBtn.disabled = true;
    setSyncStatus("正在同步…", "info");
    try {
      const resp = await chrome.runtime.sendMessage({ action: "syncSettingsToCloud" });
      const ok = resp && resp.ok;
      setSyncStatus(
        ok ? "已同步到云端" : ((resp && resp.error) || "同步失败"),
        ok ? "success" : "error"
      );
    } catch (e) {
      setSyncStatus("同步失败：" + e.message, "error");
    } finally {
      pushBtn.disabled = pullBtn.disabled = false;
    }
  });

  pullBtn.addEventListener("click", async () => {
    pushBtn.disabled = pullBtn.disabled = true;
    setSyncStatus("正在拉取…", "info");
    try {
      const resp = await chrome.runtime.sendMessage({ action: "pullSettingsFromCloud" });
      const ok = resp && resp.ok;
      if (ok) {
        await refreshControls();
        setSyncStatus("已应用云端配置", "success");
      } else {
        setSyncStatus((resp && resp.error) || "拉取失败", "error");
      }
    } catch (e) {
      setSyncStatus("拉取失败：" + e.message, "error");
    } finally {
      pushBtn.disabled = pullBtn.disabled = false;
    }
  });
};

const handleDocumentLoad = () => {
  Object.values(STORAGE_KEYS).forEach((k) => {
    if (k === STORAGE_KEYS.MODIFIER_KEY) {
      initSelect(k);
    } else {
      initCheckbox(k);
    }
  });
  initSyncButtons();
};

document.addEventListener("DOMContentLoaded", handleDocumentLoad);
