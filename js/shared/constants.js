// 单一来源：所有 storage key、host URL、默认值。
// 注意：content scripts 无法 import 本文件，须在 content 文件内保留所需副本并注释指向此处。
// 切勿改动 key 字符串本身——已发布扩展的历史数据依赖这些键名。

// ---- Hosts ----
export const HOST = "https://bbdc.cn";
export const LANGEASY_HOST = "https://langeasy.com.cn";
export const AUDIO_CDN = "https://audio2.beingfine.cn";

// ---- 划词查词设置 ----
export const LS_KEYS = {
  GET_WORD: "langeasyIsGetWord",
  MODIFIER_ENABLED: "langeasyIsModifierEnabled",
  MODIFIER_KEY: "langeasyModifierKey",
  MINI_MODE: "langeasyIsMiniMode",
  LOOKUP_FALLBACK: "langeasyLookupFallbackEnabled",
};

export const DEFAULT_MODIFIER_KEY = "ctrl";

// ---- 单词本 / 例句 ----
export const STORAGE_KEYS = {
  WORDBOOK: "bbdc_wordbook",
  SENTENCES: "bbdc_sentences",
};

// ---- 翻译 ----
export const TRANS_LANG_KEY = "xtTargetLang";
export const TRANS_DEFAULT_TO = "zh-CHS";
export const VENDOR_STORAGE_KEY = "xtTranslateVendor";
export const DEFAULT_VENDOR = "youdao";
export const CUSTOM_VENDORS_KEY = "xtCustomVendors";
export const SECRET_STORAGE_KEY = "xtSecret";

// 翻译目标语言列表（popup 语言选择器用）
export const TRANS_LANGS = [
  { value: "zh-CHS", label: "中文" },
  { value: "en", label: "英文" },
  { value: "ja", label: "日文" },
  { value: "ko", label: "韩文" },
  { value: "fr", label: "法文" },
  { value: "de", label: "德文" },
  { value: "es", label: "西班牙文" },
  { value: "ru", label: "俄文" },
  { value: "pt", label: "葡萄牙文" },
  { value: "it", label: "意大利文" },
  { value: "vi", label: "越南文" },
  { value: "th", label: "泰文" },
];
