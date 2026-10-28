// 大模型翻译 (LLM) - 支持 OpenAI 兼容协议与 Anthropic 协议。
// 用户经弹窗添加「大模型翻译」自定义翻译源，可自填接口地址 / API Key / 模型 / 提示词。
// 凭证与提示词保存在自定义翻译源记录（xtCustomVendors）中；apiKey 不进云端同步。

// ---- 各协议的默认值（新增源时预填） ----
export const LLM_PROTOCOL_LABELS = {
  openai: "OpenAI 兼容协议",
  anthropic: "Anthropic 协议",
};

export const LLM_DEFAULTS = {
  openai: {
    url: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    urlHint: "Base URL，如 https://api.openai.com/v1（支持 DeepSeek / Kimi / GLM 等 OpenAI 兼容服务）",
  },
  anthropic: {
    url: "https://api.anthropic.com",
    model: "claude-sonnet-4-20250514",
    urlHint: "如 https://api.anthropic.com（或其它 Anthropic 兼容服务）",
  },
};

// 默认翻译提示词。{targetLang}/{targetLangNative} 会被替换为目标语言名（英文/中文）。
// 注意：选区内联代码会被 content script 掩码为 {{XT_n}}，译文需原样保留以便还原。
export const DEFAULT_LLM_PROMPT = [
  "You are a professional, accurate translation engine.",
  "",
  "Rules:",
  "1. Detect the language of the user's text, then translate it into {targetLang} ({targetLangNative}).",
  "2. Output ONLY the translated text. Do not include explanations, notes, quotes, preambles or language names.",
  "3. Keep the line breaks and paragraph structure of the source text.",
  "4. Preserve inline placeholders exactly as-is, e.g. {{XT_0}} — they represent code or markup and must not be translated, removed or reordered.",
  "5. Keep URLs, numbers, file paths and proper nouns unchanged unless translating them is natural in context.",
].join("\n");

// 目标语言名（英文名 / 中文名），用于编译提示词
const TARGET_LANG_NAMES = {
  "zh-CHS": ["Simplified Chinese", "简体中文"],
  "zh": ["Simplified Chinese", "简体中文"],
  en: ["English", "英语"],
  ja: ["Japanese", "日语"],
  ko: ["Korean", "韩语"],
  fr: ["French", "法语"],
  de: ["German", "德语"],
  es: ["Spanish", "西班牙语"],
  ru: ["Russian", "俄语"],
  pt: ["Portuguese", "葡萄牙语"],
  it: ["Italian", "意大利语"],
  vi: ["Vietnamese", "越南语"],
  th: ["Thai", "泰语"],
};

function compilePrompt(template, target) {
  const [enName, nativeName] = TARGET_LANG_NAMES[target] || [target, target];
  return (template || DEFAULT_LLM_PROMPT)
    .split("{targetLang}").join(enName)
    .split("{targetLangNative}").join(nativeName)
    .trim();
}

/** 补全为可调用的完整接口 URL。base 可为 Base URL，也可已是完整接口地址。 */
function resolveEndpoint(base, protocol) {
  const url = String(base || "").trim().replace(/\/+$/, "");
  if (protocol === "anthropic") {
    if (/\/v1\/messages(\/|\?|$)/.test(url)) return url;
    if (/\/v1$/.test(url)) return url + "/messages";
    return url + "/v1/messages";
  }
  // openai 兼容
  if (/\/chat\/completions(\/|\?|$)/.test(url)) return url;
  if (/\/v1$/.test(url)) return url + "/chat/completions";
  return url + "/v1/chat/completions";
}

async function parseResponse(resp) {
  let data = null;
  let raw = "";
  try {
    raw = await resp.text();
  } catch (_) { /* ignore */ }
  try {
    data = JSON.parse(raw);
  } catch (_) { /* 非 JSON 响应（HTML 错误页等） */ }
  return { data, raw };
}

function describeError(resp, data, raw) {
  let message = "";
  if (data && typeof data === "object") {
    message =
      (data.error && (data.error.message || data.error.type)) ||
      (data.message) ||
      "";
  }
  if (!message && raw) message = raw.substring(0, 300);
  return "HTTP " + resp.status + (message ? ": " + message : "");
}

// ---- OpenAI 兼容协议: POST {base}/chat/completions ----
async function callOpenAI(text, config, prompt) {
  const base = (config && (config.url || "")) || LLM_DEFAULTS.openai.url;
  const apiKey = config && config.apiKey;
  if (!apiKey) throw new Error("未配置 API Key，请在弹窗中编辑该大模型翻译源");

  const model = (config && config.model) || LLM_DEFAULTS.openai.model;
  const endpoint = resolveEndpoint(base, "openai");

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey,
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: text },
      ],
      stream: false,
    }),
  });

  const { data, raw } = await parseResponse(resp);
  if (!resp.ok) {
    throw new Error("OpenAI 接口调用失败: " + describeError(resp, data, raw));
  }
  const out = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!out) throw new Error("模型未返回翻译结果: " + JSON.stringify(data).substring(0, 300));
  return out.trim();
}

// ---- Anthropic 协议: POST {base}/v1/messages ----
async function callAnthropic(text, config, prompt) {
  const base = (config && (config.url || "")) || LLM_DEFAULTS.anthropic.url;
  const apiKey = config && config.apiKey;
  if (!apiKey) throw new Error("未配置 API Key，请在弹窗中编辑该大模型翻译源");

  const model = (config && config.model) || LLM_DEFAULTS.anthropic.model;
  const endpoint = resolveEndpoint(base, "anthropic");

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 4096,
      system: prompt,
      messages: [{ role: "user", content: text }],
    }),
  });

  const { data, raw } = await parseResponse(resp);
  if (!resp.ok) {
    throw new Error("Anthropic 接口调用失败: " + describeError(resp, data, raw));
  }
  const block = data && data.content && data.content.find(function (b) { return b && b.type === "text" && b.text; });
  const out = block && block.text;
  if (!out) throw new Error("模型未返回翻译结果: " + JSON.stringify(data).substring(0, 300));
  return out.trim();
}

/**
 * 大模型翻译统一入口。
 * @param {string} text - 待翻译文本
 * @param {string} [to="zh-CHS"] - 目标语言
 * @param {string} [_from] - 源语言（忽略，由模型自动识别）
 * @param {object} [config] - 自定义翻译源记录：{ protocol, url, apiKey, model, prompt }
 */
export async function llmTranslate(text, to = "zh-CHS", _from = "auto", config) {
  const protocol = (config && config.protocol) === "anthropic" ? "anthropic" : "openai";
  const prompt = compilePrompt(config && config.prompt, to);
  if (protocol === "anthropic") {
    return callAnthropic(text, config, prompt);
  }
  return callOpenAI(text, config, prompt);
}
