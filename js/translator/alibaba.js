// 阿里翻译
//  - alibabaTranslate: 阿里云机器翻译 API（HMAC-SHA1 签名），需 AccessKey 凭证
//  - alibabaFreeTranslate: translate.alibaba.com 的 CSRF 免费接口，无需凭证
// 凭证优先由调用方传入（自定义翻译源流程），否则回退到 storage。
import { CryptoJS } from "./crypto.js";

const ALIBABA_APPID_STORAGE_KEY = "alibabaAppId";
const ALIBABA_APPKEY_STORAGE_KEY = "alibabaAppKey";

async function getAlibabaAppId() {
  try {
    const stored = (await chrome.storage.local.get(ALIBABA_APPID_STORAGE_KEY))[ALIBABA_APPID_STORAGE_KEY];
    return stored || "";
  } catch (_) {
    return "";
  }
}

async function getAlibabaAppKey() {
  try {
    const stored = (await chrome.storage.local.get(ALIBABA_APPKEY_STORAGE_KEY))[ALIBABA_APPKEY_STORAGE_KEY];
    return stored || "";
  } catch (_) {
    return "";
  }
}

function rfc1123Date() {
  return new Date().toUTCString();
}

function contentMd5(bodyStr) {
  return CryptoJS.MD5(bodyStr).toString(CryptoJS.enc.Base64);
}

async function alibabaTranslate(text, to = "zh", _from = "auto", credentials = null) {
  // 加载凭证：优先传入的凭证（自定义翻译源），否则回退 storage
  const accessKeyId = credentials?.appId || await getAlibabaAppId();
  const accessKeySecret = credentials?.appKey || await getAlibabaAppKey();
  if (!accessKeyId || !accessKeySecret) {
    throw new Error("阿里翻译需要配置 AccessKey ID 和 AccessKey Secret，请在弹窗中设置");
  }

  // 语言码映射: "zh-CHS" -> "zh"
  const tgtLang = to === "zh-CHS" ? "zh" : to;
  const srcLang = _from === "zh-CHS" ? "zh" : _from;

  const host = "mt.cn-hangzhou.aliyuncs.com";
  // Note: only "ecommerce" + scene "title" works; "general" returns 10004 parameter error
  const version = "ecommerce";
  const path = "/api/translate/web/" + version;
  const endpoint = "https://" + host + path;

  // 构建请求体 - 对齐 Python 的 json.dumps(ensure_ascii=False, separators=(',',':'))
  // JavaScript JSON.stringify 默认紧凑分隔且不转义非 ASCII 字符（等同 ensure_ascii=False）。
  const body = {
    FormatType: "text",
    SourceLanguage: srcLang === "auto" ? "auto" : srcLang,
    TargetLanguage: tgtLang,
    SourceText: text,
    Scene: "title",
  };
  const bodyStr = JSON.stringify(body);

  // 签名 headers
  const accept = "application/json";
  const contentType = "application/json; charset=UTF-8";
  const date = rfc1123Date();
  const md5 = contentMd5(bodyStr);

  // 阿里云 Common Request（x-acs-date）的待签名字符串:
  //   POST\n{accept}\n{content-md5}\n{content-type}\n{date}\n{canonicalizedHeaders}{path}
  // fetch() 会静默丢弃 Date 头（Fetch 规范禁止），故改用 x-acs-date 头。
  // stringToSign 的 Date 行仍含日期值（非空 - 经服务端错误响应验证）。
  // canonicalizedHeaders 末尾不加 \n（join 会加）。
  const canonicalizedHeaders = "x-acs-date:" + date;  // NO trailing \n - join adds it
  const stringToSign = [
    "POST",
    accept,
    md5,
    contentType,
    date,                         // server expects the date value here, NOT empty
    canonicalizedHeaders,
    path,
  ].join("\n");

  // HMAC-SHA1 签名 - 对齐 Python: hmac.new(key, msg, hashlib.sha1).digest() -> base64
  const signature = CryptoJS.HmacSHA1(stringToSign, accessKeySecret).toString(CryptoJS.enc.Base64);
  const authorization = "acs " + accessKeyId + ":" + signature;

  // 用 x-acs-date 替代 Date（fetch 静默丢弃 Date 头）
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Accept": accept,
      "Content-MD5": md5,
      "Content-Type": contentType,
      "x-acs-date": date,
      "Authorization": authorization,
    },
    body: bodyStr,
  });

  // 错误时附带响应体便于排查
  let responseBody = null;
  try {
    responseBody = await resp.clone().text();
  } catch (_) { /* ignore parse error */ }

  if (!resp.ok) {
    const detail = responseBody ? " " + responseBody.substring(0, 500) : "";
    throw new Error("阿里翻译请求失败: HTTP " + resp.status + " " + resp.statusText + detail);
  }

  const result = JSON.parse(responseBody || "{}");
  if (result && (result.Code === "OK" || result.Code === "200") && result.Data) {
    return result.Data.Translated || "";
  }
  throw new Error(result?.Message || "阿里翻译失败: " + JSON.stringify(result).substring(0, 500));
}

// 阿里翻译免费接口 (translate.alibaba.com 的 CSRF 方式)，无需凭证
const ALIBABA_FREE_API = "https://translate.alibaba.com/api/translate";

async function alibabaFreeTranslate(text, to = "zh", _from = "auto") {
  // 语言码映射: "zh-CHS" -> "zh"
  const tgtLang = to === "zh-CHS" ? "zh" : to;
  const srcLang = _from === "zh-CHS" ? "zh" : _from;

  // Step 1: 获取 CSRF token
  const csrfResp = await fetch(`${ALIBABA_FREE_API}/csrftoken`, {
    method: "GET",
    credentials: "include",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Origin": "https://translate.alibaba.com",
      "Referer": "https://translate.alibaba.com/",
    },
  });
  const csrf = await csrfResp.json();
  const csrfToken = csrf.token;
  const csrfHeaderName = csrf.headerName;

  // Step 2: 翻译
  const formData = new FormData();
  formData.append("query", text);
  formData.append("srcLang", srcLang);
  formData.append("tgtLang", tgtLang);
  formData.append("_csrf", csrfToken);
  formData.append("domain", "general");

  const transResp = await fetch(`${ALIBABA_FREE_API}/text`, {
    method: "POST",
    credentials: "include",
    body: formData,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Origin": "https://translate.alibaba.com",
      "Referer": "https://translate.alibaba.com/",
      "X-Requested-With": "XMLHttpRequest",
      [csrfHeaderName]: csrfToken,
    },
  });
  const result = await transResp.json();
  if (result?.success && result?.data?.translateText) {
    return result.data.translateText;
  }
  throw new Error(result?.msg || `阿里翻译(免费)失败: ${JSON.stringify(result)}`);
}

export { alibabaTranslate, alibabaFreeTranslate };
