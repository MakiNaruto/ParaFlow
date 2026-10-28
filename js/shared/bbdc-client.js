// bbdc.cn 远程接口的纯客户端：供 background 消息处理与 popup 复用。
//
// 不背单词接口需要会话 Cookie（JSESSIONID）。页面里嵌的 iframe 处于第三方上下文，
// 直接 fetch 不会带 Cookie，于是 check-new-word 返回 20000（请登录），「添加到生词本」
// 退化成打开生词本页面的链接。这里在 Service Worker / popup（扩展顶层上下文）里
// 统一发起带 Cookie 的请求。
import { HOST } from "./constants.js";

export async function checkLoggedIn() {
  try {
    const data = await fetchJSON(`${HOST}/api/check-login`);
    return data?.result_code === 200;
  } catch (_) {
    return false;
  }
}

const fetchJSON = async (url, options) => {
  const res = await fetch(url, { credentials: "include", ...options });
  return await res.json();
};

// 构造生词接口 payload。opcode "1"=添加, "0"=移除。
export const buildWordPayload = (word, info, opcode = "1") => ({
  word,
  course: "*",
  wordidx: "*",
  infoidx: "100",
  selection: "*",
  info: info || "",
  opcode,
});

// 生词表接口：GET /api/user-new-word?page={N}&time={ts}，page 从 0 起，每页固定 24 条。
const NEWWORD_PAGE_SIZE = 24;

// 拉取生词表全部单词，严格按原词去重（大小写不同视为不同词），保留首次出现顺序。
// 以「本页条数 < 页大小」作为末页判据（pageInfo.totalPage 字段不可靠）。
export const fetchAllNewWords = async () => {
  const seen = new Set();
  const words = [];
  for (let page = 0; page < 200; page++) {
    // page < 200 仅作兜底，防接口异常导致死循环。
    const url = `${HOST}/api/user-new-word?page=${page}&time=${Date.now()}`;
    const data = await fetchJSON(url);
    if (!data || data.result_code !== 200) {
      const eb = (data && data.error_body) || {};
      throw new Error(eb.user_message || eb.info || "获取生词失败");
    }
    const list = (data.data_body && data.data_body.wordList) || [];
    list.forEach((item) => {
      const w = item && item.word;
      if (w && !seen.has(w)) {
        seen.add(w);
        words.push(w);
      }
    });
    if (list.length < NEWWORD_PAGE_SIZE) break; // 末页
  }
  return { words, total: words.length };
};

// 删除生词。接口 POST /api/remove-user-new-word，FormData newwordlist=逗号分隔的单词。
// 接口对不存在的单词也返回 200 且不报错，故返回「请求删除数」而非实际删除数。
export const removeNewWords = async (words) => {
  const list = (Array.isArray(words) ? words : [words])
    .map((w) => (typeof w === "string" ? w.trim() : ""))
    .filter(Boolean);
  if (!list.length) return { requested: 0 };
  const form = new FormData();
  form.append("newwordlist", list.join(","));
  const data = await fetchJSON(`${HOST}/api/remove-user-new-word`, {
    method: "POST",
    body: form,
  });
  if (!data || data.result_code !== 200) {
    const eb = (data && data.error_body) || {};
    throw new Error(eb.user_message || eb.info || "删除生词失败");
  }
  return { requested: list.length };
};

// 供本地单词本添加/删除时同步到 bbdc.cn（fire-and-forget，仅记日志）。
// 内部 try/catch 吞掉错误，调用方可不 await 以保持原 fire-and-forget 语义。
async function syncWordRemote(word, info, opcode) {
  const remoteData = buildWordPayload(word, info, opcode);
  const formData = new FormData();
  formData.append("newwordlist", JSON.stringify(remoteData));
  try {
    const r = await fetch(`${HOST}/api/user-new-word`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    console.log("Remote sync status:", r.status);
  } catch (e) {
    console.log("Remote sync error", e);
  }
}

export const addWordRemote = (word, info) => syncWordRemote(word, info, "1");
export const removeWordRemote = (word, info) => syncWordRemote(word, info, "0");

// 暴露 fetchJSON 给消息处理（check-new-word / add-new-word 用）
export { fetchJSON };
