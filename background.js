// ===== Service Worker (ES Module) =====
// 薄入口：注册右键菜单 + 消息路由。
// 各类消息处理见 js/bg/：bbdc-api / wordbook / translate-handlers / sync。
import { handleBbdc } from "./js/bg/bbdc-api.js";
import { handleWordbook } from "./js/bg/wordbook.js";
import { handleTranslate } from "./js/bg/translate-handlers.js";
import { handleSync } from "./js/bg/sync.js";

// Clicking the toolbar action opens the persistent browser side panel.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
  console.error("无法设置侧边栏入口", error);
});

const TRANS_MENU_ID = "xt-translate";

// 消息路由：依次尝试各 handler，首个命中者处理（返回 true 表示异步响应）。
const HANDLERS = [handleBbdc, handleWordbook, handleTranslate, handleSync];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  for (const handler of HANDLERS) {
    if (handler(msg, sender, sendResponse)) return true; // 异步响应
  }
});

// 安装时：日志 + 创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  console.log("插件安装成功");
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: TRANS_MENU_ID,
      title: "段落翻译",
      contexts: ["page", "frame", "selection", "link", "editable"],
    });
  });
});

// 右键菜单点击 -> 通知当前页 content script 翻译选区
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== TRANS_MENU_ID) return;
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { action: "translateSelection" });
  } catch (e) {
    // 页面无 content script（如 chrome:// 页面），忽略
  }
});
