// 有道翻译 (Youdao) - 动态密钥 + AES 解密。
// 预共享密钥与签名逻辑保持不变。
import { CryptoJS } from "./crypto.js";
import { SECRET_STORAGE_KEY } from "../shared/constants.js";

const PREFIX = "https://luna-ai.youdao.com";
const V1_SECRET = `${PREFIX}/extension/trans/v1/secret`;
const V1_YD = `${PREFIX}/extension/trans/v1/yd`;
const KEY_ID = "ai-extension-trans";
const SECRET_ENDPOINT_KEY_ID = "ai-extension-trans-pre";
const SECRET_ENDPOINT_SIGN_KEY = "U2FsdGVkX18kMtp4uS6mPmglALZSexyDhlQuQ";
const EXTENSION_TRANS_KEY = "secret:/key/U2FsdGVkX19CnGVGgVHvKu83u66lpYNVbLms7sLVER7N/MaK2tG6Ax/YQqoFM4sA";
const EXTENSION_TRANS_IV = "secret:/iv/GV@u19thDh/14HQ2Gjzk67OU5tTBHOGOTEJqPvKXJiTTIf7dcz0TSAZWcMV";
const API_CLIENT = "dynamicTransPlugin";

let cachedSecret = "";

function genSign(signData, signSecretKey) {
  const data = { ...signData };
  Object.keys(data).forEach((k) => {
    if (data[k] === "") delete data[k];
  });
  const sortedKeys = Object.keys(data).sort().filter((k) => data[k] !== undefined);
  const signKeys = [...sortedKeys, "key"];
  const signText = signKeys
    .map((k) => `${k}=${k === "key" ? signSecretKey : data[k]}`)
    .join("&");
  return {
    sign: CryptoJS.MD5(signText).toString(CryptoJS.enc.Hex),
    pointParam: sortedKeys.join(","),
  };
}

function stringifyDefinedParams(data) {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)])
  );
}

function genParamV3(requestData, signSecretKey, keyId, product = API_CLIENT) {
  const appVersion = 1;
  const signData = {
    ...requestData,
    product,
    appVersion,
    client: API_CLIENT,
    keyfrom: `${product}.${appVersion}.${API_CLIENT}`,
    mid: 1,
    vendor: "web",
    screen: 1,
    model: 1,
    imei: 1,
    network: "wifi",
    keyid: keyId,
    mysticTime: Date.now(),
    yduuid: "abcdefg",
  };
  return { ...stringifyDefinedParams(signData), ...genSign(signData, signSecretKey) };
}

function normalizeBase64(value) {
  const b = value.replace(/-/g, "+").replace(/_/g, "/");
  return b.padEnd(Math.ceil(b.length / 4) * 4, "=");
}

function aesDecrypt(encrypted) {
  try {
    const key = CryptoJS.MD5(EXTENSION_TRANS_KEY);
    const iv = CryptoJS.MD5(EXTENSION_TRANS_IV);
    return CryptoJS.AES.decrypt(normalizeBase64(encrypted), key, {
      iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    }).toString(CryptoJS.enc.Utf8);
  } catch {
    return "";
  }
}

async function getSecretKey(force = false) {
  if (!force && cachedSecret) return cachedSecret;
  if (!force) {
    try {
      const stored = (await chrome.storage.local.get(SECRET_STORAGE_KEY))[SECRET_STORAGE_KEY];
      if (stored) {
        cachedSecret = stored;
        return stored;
      }
    } catch (_) { /* storage unavailable */ }
  }
  const signData = genParamV3(
    { targetkeyId: KEY_ID },
    SECRET_ENDPOINT_SIGN_KEY,
    SECRET_ENDPOINT_KEY_ID
  );
  const url = `${V1_SECRET}?${new URLSearchParams(signData).toString()}`;
  const result = await fetch(url, { method: "GET" }).then((r) => r.json());
  const secretKey = result?.data?.secretKey ? aesDecrypt(result.data.secretKey) : "";
  if (!secretKey) throw new Error("获取翻译密钥失败");
  cachedSecret = secretKey;
  try { await chrome.storage.local.set({ [SECRET_STORAGE_KEY]: secretKey }); } catch (_) {}
  return secretKey;
}

async function postTranslation(data, secretKey) {
  const signData = genParamV3(data, secretKey, KEY_ID);
  const form = new FormData();
  for (const [k, v] of Object.entries(signData)) form.append(k, v);
  return fetch(V1_YD, { method: "POST", body: form }).then((r) => r.json());
}

export async function youdaoTranslate(text, to = "zh-CHS", _from = "auto") {
  const data = {
    i: encodeURIComponent(text),
    to,
    from: "auto",
    modelName: "llmLite",
  };
  let result = await postTranslation(data, await getSecretKey()).catch(() => null);
  if (!result || result.code !== 0) {
    result = await postTranslation(data, await getSecretKey(true));
  }
  if (result?.code !== 0) {
    throw new Error(result?.msg || `翻译失败: ${result?.code}`);
  }
  let translation = result?.data?.translation || "";
  if (typeof translation === "string" && translation) {
    const dec = aesDecrypt(translation);
    if (dec) translation = dec;
  }
  return translation;
}
