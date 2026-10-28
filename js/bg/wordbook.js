// 本地单词本 + 例句的 CRUD（chrome.storage.local）。
// 处理 source 为 langeasyLookup / langeasyPopup / langeasyManage 的消息，按 method 分发。
// 添加/删除单词时同步到 bbdc.cn（fire-and-forget）；例句与单词相互独立（设计决策 #8）。
import { STORAGE_KEYS } from "../shared/constants.js";
import { addWordRemote, removeWordRemote, checkLoggedIn } from "../shared/bbdc-client.js";

const SOURCES = new Set(["langeasyLookup", "langeasyPopup", "langeasyManage"]);

// 简单唯一 ID
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function handleWordbook(msg, _sender, sendResponse) {
  if (!SOURCES.has(msg.source)) return false;

  // 检查单词是否已在本地单词本
  if (msg.method === "checkNewWord") {
    chrome.storage.local.get(STORAGE_KEYS.WORDBOOK, (data) => {
      const wordbook = data[STORAGE_KEYS.WORDBOOK] || {};
      const exists = !!wordbook[msg.word];
      sendResponse({
        method: "checkNewWordResult",
        word: msg.word,
        data: { exists },
      });
    });
    return true;
  }

  // 添加单词到本地单词本（并同步到 bbdc.cn）
  if (msg.method === "addNewWord") {
    (async () => {
      try {
        if (!await checkLoggedIn()) {
          sendResponse({ method: "addNewWordResult", word: msg.word, error: true, loginRequired: true });
          return;
        }
        const data = await chrome.storage.local.get(STORAGE_KEYS.WORDBOOK);
        const wordbook = data[STORAGE_KEYS.WORDBOOK] || {};
        if (!wordbook[msg.word]) {
          wordbook[msg.word] = { word: msg.word, addedAt: Date.now() };
        }
        await chrome.storage.local.set({ [STORAGE_KEYS.WORDBOOK]: wordbook });
        // 同步到 bbdc.cn 远程（fire-and-forget）
        await addWordRemote(msg.word, msg.info);
        sendResponse({ method: "addNewWordResult", word: msg.word });
      } catch (e) {
        console.log("addNewWord error", e);
        sendResponse({ method: "addNewWordResult", word: msg.word, error: true });
      }
    })();
    return true;
  }

  // 从本地单词本删除单词（例句保留，不级联删除）
  if (msg.method === "removeWord") {
    (async () => {
      try {
        const data = await chrome.storage.local.get(STORAGE_KEYS.WORDBOOK);
        const wordbook = data[STORAGE_KEYS.WORDBOOK] || {};
        delete wordbook[msg.word];
        await chrome.storage.local.set({ [STORAGE_KEYS.WORDBOOK]: wordbook });
        // 同步删除到 bbdc.cn 远程（fire-and-forget）
        await removeWordRemote(msg.word, msg.info);
        sendResponse({ method: "removeWordResult", word: msg.word });
      } catch (e) {
        console.log("removeWord error", e);
        sendResponse({ method: "removeWordResult", word: msg.word, error: true });
      }
    })();
    return true;
  }

  // 添加例句
  if (msg.method === "addSentence") {
    chrome.storage.local.get(STORAGE_KEYS.SENTENCES, (data) => {
      const sentences = data[STORAGE_KEYS.SENTENCES] || [];
      // 检查是否已存在完全相同的例句
      const exists = sentences.some((s) => s.word === msg.word && s.text === msg.sentence);
      if (!exists) {
        const newSentence = {
          id: genId(),
          word: msg.word,
          text: msg.sentence,
          url: msg.url || "",
          addedAt: Date.now(),
        };
        sentences.push(newSentence);
        chrome.storage.local.set({ [STORAGE_KEYS.SENTENCES]: sentences }, () => {
          sendResponse({ method: "addSentenceResult", word: msg.word, sentence: newSentence });
        });
      } else {
        sendResponse({
          method: "addSentenceResult",
          word: msg.word,
          sentence: null,
          alreadyExists: true,
        });
      }
    });
    return true;
  }

  // 只删除该单词的全部例句，不修改本地或远程生词本。
  if (msg.method === "removeWordSentences") {
    chrome.storage.local.get(STORAGE_KEYS.SENTENCES, (data) => {
      const sentences = (data[STORAGE_KEYS.SENTENCES] || []).filter((s) => s.word !== msg.word);
      chrome.storage.local.set({ [STORAGE_KEYS.SENTENCES]: sentences }, () => {
        sendResponse({ method: "removeWordSentencesResult", word: msg.word });
      });
    });
    return true;
  }

  // 按 id 删除例句
  if (msg.method === "removeSentence") {
    chrome.storage.local.get(STORAGE_KEYS.SENTENCES, (data) => {
      let sentences = data[STORAGE_KEYS.SENTENCES] || [];
      sentences = sentences.filter((s) => s.id !== msg.sentenceId);
      chrome.storage.local.set({ [STORAGE_KEYS.SENTENCES]: sentences }, () => {
        sendResponse({ method: "removeSentenceResult", sentenceId: msg.sentenceId });
      });
    });
    return true;
  }

  // 按 word + text 删除例句（上下文匹配）
  if (msg.method === "removeSentenceByContext") {
    chrome.storage.local.get(STORAGE_KEYS.SENTENCES, (data) => {
      let sentences = data[STORAGE_KEYS.SENTENCES] || [];
      sentences = sentences.filter((s) => !(s.word === msg.word && s.text === msg.sentence));
      chrome.storage.local.set({ [STORAGE_KEYS.SENTENCES]: sentences }, () => {
        sendResponse({ method: "removeSentenceByContextResult", word: msg.word, removed: true });
      });
    });
    return true;
  }

  // 检查特定例句上下文是否已存在（用于按钮状态）
  if (msg.method === "checkSentenceContext") {
    chrome.storage.local.get(STORAGE_KEYS.SENTENCES, (data) => {
      const sentences = data[STORAGE_KEYS.SENTENCES] || [];
      const exists = sentences.some((s) => s.word === msg.word && s.text === msg.sentence);
      sendResponse({ method: "checkSentenceContextResult", word: msg.word, exists });
    });
    return true;
  }

  // 获取某单词的全部例句
  if (msg.method === "getWordSentences") {
    chrome.storage.local.get(STORAGE_KEYS.SENTENCES, (data) => {
      const sentences = data[STORAGE_KEYS.SENTENCES] || [];
      const wordSentences = sentences.filter((s) => s.word === msg.word);
      sendResponse({ method: "getWordSentencesResult", word: msg.word, sentences: wordSentences });
    });
    return true;
  }

  // 获取全部单词和例句（管理页用）
  if (msg.method === "getAllWordsAndSentences") {
    chrome.storage.local.get([STORAGE_KEYS.WORDBOOK, STORAGE_KEYS.SENTENCES], (data) => {
      const wordbook = data[STORAGE_KEYS.WORDBOOK] || {};
      const sentences = data[STORAGE_KEYS.SENTENCES] || [];
      sendResponse({
        method: "getAllWordsAndSentencesResult",
        wordbook,
        sentences,
      });
    });
    return true;
  }

  // 按 URL 获取例句（用于恢复下划线）
  if (msg.method === "getSentencesByUrl") {
    chrome.storage.local.get(STORAGE_KEYS.SENTENCES, (data) => {
      const sentences = data[STORAGE_KEYS.SENTENCES] || [];
      const urlSentences = sentences.filter((s) => s.url === msg.url);
      sendResponse({ method: "getSentencesByUrlResult", url: msg.url, sentences: urlSentences });
    });
    return true;
  }

  return false;
}
