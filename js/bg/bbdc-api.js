// bbdc.cn 远程消息处理（msg.type === "bbdc:*"）。
// 纯客户端逻辑见 js/shared/bbdc-client.js，供 popup 复用。
import { HOST } from "../shared/constants.js";
import { fetchJSON, buildWordPayload, fetchAllNewWords, removeNewWords } from "../shared/bbdc-client.js";

export function handleBbdc(msg, _sender, sendResponse) {
  // 登录状态检查。必须走 Service Worker（扩展顶层上下文）：查词 iframe 嵌入在
  // 网页里属第三方上下文，直接 fetch 不会带 bbdc.cn 的登录 Cookie（见 bbdc-client.js 注释）。
  if (msg.type === "bbdc:check-login") {
    fetchJSON(`${HOST}/api/check-login`)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === "bbdc:check-new-word") {
    const url = `${HOST}/api/check-new-word?word=${encodeURIComponent(msg.word)}&infoidx=100`;
    fetchJSON(url)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === "bbdc:add-new-word") {
    const form = new FormData();
    form.append("newwordlist", JSON.stringify(buildWordPayload(msg.word, msg.info)));
    fetchJSON(`${HOST}/api/user-new-word`, { method: "POST", body: form })
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === "bbdc:fetch-all-newwords") {
    fetchAllNewWords()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === "bbdc:remove-new-words") {
    removeNewWords(msg.words)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  return false;
}
