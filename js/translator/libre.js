// LibreTranslate - 可配置 API 端点（默认 translate.moep.tv）。

const LIBRE_URL_KEY = "xtLibreUrl";
const DEFAULT_LIBRE_URL = "https://translate.moep.tv";

async function getLibreUrl() {
  try {
    const stored = (await chrome.storage.local.get(LIBRE_URL_KEY))[LIBRE_URL_KEY];
    return stored || DEFAULT_LIBRE_URL;
  } catch (_) {
    return DEFAULT_LIBRE_URL;
  }
}

async function libreTranslate(text, to = "zh", _from = "auto") {
  // 语言码映射: "zh-CHS" -> "zh"
  const target = to === "zh-CHS" ? "zh" : to;
  const source = _from === "zh-CHS" ? "zh" : _from;
  const baseUrl = await getLibreUrl();

  const resp = await fetch(`${baseUrl}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      q: text,
      source: source === "auto" ? "auto" : source,
      target,
      format: "text",
      alternatives: 1,
      api_key: "",
    }),
  });
  const result = await resp.json();
  if (result && result.translatedText) {
    return result.translatedText;
  }
  throw new Error(result?.error || "LibreTranslate 翻译失败");
}

export { libreTranslate };
