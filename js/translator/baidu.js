// 百度翻译 (Baidu) - fanyi-api.baidu.com，appid + appkey + MD5 签名。
// 凭证优先由调用方传入（自定义翻译源流程），否则回退 storage。
import { CryptoJS } from "./crypto.js";

const BAIDU_API = "https://fanyi-api.baidu.com/api/trans/vip/translate";
const BAIDU_APPID_STORAGE_KEY = "baiduAppId";
const BAIDU_APPKEY_STORAGE_KEY = "baiduAppKey";
const BAIDU_APPID_DEFAULT = "";
const BAIDU_APPKEY_DEFAULT = "";

async function getBaiduAppId() {
  try {
    const stored = (await chrome.storage.local.get(BAIDU_APPID_STORAGE_KEY))[BAIDU_APPID_STORAGE_KEY];
    return stored || BAIDU_APPID_DEFAULT;
  } catch (_) {
    return BAIDU_APPID_DEFAULT;
  }
}

async function getBaiduAppKey() {
  try {
    const stored = (await chrome.storage.local.get(BAIDU_APPKEY_STORAGE_KEY))[BAIDU_APPKEY_STORAGE_KEY];
    return stored || BAIDU_APPKEY_DEFAULT;
  } catch (_) {
    return BAIDU_APPKEY_DEFAULT;
  }
}

// zh-CHS/ja/ko/fr/es/ar 等映射到百度语言码
const BAIDU_LANG_MAP = {
  "zh-CHS": "zh",
  "zh": "zh",
  "ja": "jp",
  "ko": "kor",
  "fr": "fra",
  "de": "de",
  "es": "spa",
  "ru": "ru",
  "pt": "pt",
  "ar": "ara",
  "it": "it",
  "vi": "vie",
  "th": "th",
  "en": "en",
};

function toBaiduLang(code) {
  return BAIDU_LANG_MAP[code] || code;
}

async function baiduTranslate(text, to = "zh", _from = "auto", credentials = null) {
  const target = toBaiduLang(to);
  const source = _from === "auto" ? "auto" : toBaiduLang(_from);

  // 加载动态凭证：优先传入的（自定义翻译源），否则回退 storage
  const appId = credentials?.appId || await getBaiduAppId();
  const appKey = credentials?.appKey || await getBaiduAppKey();

  // 生成 salt 与签名: MD5(appid + q + salt + appkey)
  const salt = String(Math.floor(Math.random() * 90000) + 10000);
  const signStr = appId + text + salt + appKey;
  const sign = CryptoJS.MD5(signStr).toString(CryptoJS.enc.Hex);

  // form-urlencoded body
  const params = new URLSearchParams();
  params.append("q", text);
  params.append("from", source);
  params.append("to", target);
  params.append("appid", appId);
  params.append("salt", salt);
  params.append("sign", sign);

  const resp = await fetch(BAIDU_API, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const result = await resp.json();

  if (result && result.trans_result && result.trans_result.length > 0) {
    // 多句分段时用换行拼接
    return result.trans_result.map((item) => item.dst).join("\n");
  }
  throw new Error(result.error_msg || "百度翻译失败: " + JSON.stringify(result));
}

export { baiduTranslate };
