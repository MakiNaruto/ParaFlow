// 云端设置同步（chrome.storage.sync）。
// 推送：把本地设置打包写入 sync；拉取：校验版本后合并到本地。
// 自定义翻译源的凭证（appId/appKey/apiKey）不进云端（sanitize 剥离），拉取时从本地回填。
// 非敏感的大模型配置（protocol/model/prompt）随记录同步。提示词模板可能较长，
// 若超过 chrome.storage.sync 配额（SYNC_MAX_BYTES）会提示精简后再同步。
import {
  SYNC_BUNDLE_KEY,
  SYNC_META_KEY,
  SYNC_ATTEMPT_KEY,
  SYNC_MAX_BYTES,
  SYNC_CLOCK_SKEW_MS,
  SYNC_SETTINGS_KEYS,
  CUSTOM_VENDORS_KEY,
} from "../shared/constants.js";
import { trySendResponse } from "../shared/messaging.js";

// 剥离自定义翻译源的凭证字段（不进云端）
function sanitizeCustomVendors(vendors) {
  return (vendors || []).map((v) => ({
    id: v.id,
    name: v.name,
    type: v.type,
    url: v.url,
    protocol: v.protocol,
    model: v.model,
    prompt: v.prompt,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  }));
}

// 合并云端与本地翻译源：用本地的凭证（appId/appKey/apiKey）回填到云端条目
function mergeCustomVendors(syncedVendors, localVendors) {
  const localMap = new Map((localVendors || []).map((v) => [v.id, v]));
  return (syncedVendors || []).map((sv) => {
    const local = localMap.get(sv.id);
    return {
      ...sv,
      appId: local ? local.appId : "",
      appKey: local ? local.appKey : "",
      apiKey: local ? local.apiKey : "",
    };
  });
}

async function buildSyncPayload() {
  const local = await chrome.storage.local.get(SYNC_SETTINGS_KEYS);
  const payload = { syncedAt: Date.now() };
  for (const key of SYNC_SETTINGS_KEYS) {
    if (key === CUSTOM_VENDORS_KEY) {
      payload[key] = sanitizeCustomVendors(local[key]);
    } else if (local[key] !== undefined) {
      payload[key] = local[key];
    }
  }
  return payload;
}

export function handleSync(msg, _sender, sendResponse) {
  if (msg.action === "syncSettingsToCloud") {
    (async () => {
      const attemptAt = Date.now();
      try {
        // 记录本次同步尝试时间，供后续拉取判断上次是否成功
        await chrome.storage.local.set({ [SYNC_ATTEMPT_KEY]: attemptAt });

        const payload = await buildSyncPayload();
        const size = new Blob([JSON.stringify(payload)]).size;
        if (size > SYNC_MAX_BYTES) {
          trySendResponse(sendResponse, {
            ok: false,
            error: "配置过大（接近 8KB），请减少自定义翻译源数量后再试。",
          });
          return;
        }
        await chrome.storage.sync.set({ [SYNC_BUNDLE_KEY]: payload });

        // 校验写入是否成功且一致
        const verify = await chrome.storage.sync.get(SYNC_BUNDLE_KEY);
        const written = verify[SYNC_BUNDLE_KEY];
        if (!written || written.syncedAt !== payload.syncedAt) {
          trySendResponse(sendResponse, {
            ok: false,
            error: "同步写入验证失败，请检查 Chrome 同步是否已开启。",
          });
          return;
        }

        // 记录成功同步时间
        await chrome.storage.local.set({ [SYNC_META_KEY]: payload.syncedAt });
        trySendResponse(sendResponse, { ok: true, syncedAt: payload.syncedAt });
      } catch (e) {
        trySendResponse(sendResponse, {
          ok: false,
          error: "同步失败：" + ((e && e.message) ? e.message : String(e)),
        });
      }
    })();
    return true;
  }

  if (msg.action === "pullSettingsFromCloud") {
    (async () => {
      try {
        const result = await chrome.storage.sync.get(SYNC_BUNDLE_KEY);
        const bundle = result[SYNC_BUNDLE_KEY];
        if (!bundle || typeof bundle !== "object") {
          trySendResponse(sendResponse, {
            ok: false,
            error: "云端没有配置，请先执行「同步到云端」。",
          });
          return;
        }
        if (!bundle.syncedAt || typeof bundle.syncedAt !== "number") {
          trySendResponse(sendResponse, {
            ok: false,
            error: "云端配置无效，请重新执行「同步到云端」。",
          });
          return;
        }

        // 若本机曾尝试同步，确保上次尝试已成功（云端数据至少不早于上次本地尝试）
        const localMeta = await chrome.storage.local.get([SYNC_META_KEY, SYNC_ATTEMPT_KEY]);
        const lastLocalSync = localMeta[SYNC_META_KEY];
        const lastLocalAttempt = localMeta[SYNC_ATTEMPT_KEY];
        if (lastLocalAttempt && (!lastLocalSync || lastLocalSync < lastLocalAttempt - SYNC_CLOCK_SKEW_MS)) {
          trySendResponse(sendResponse, {
            ok: false,
            error: "上次同步尚未成功，请重新执行「同步到云端」后再拉取。",
          });
          return;
        }
        // 若本机曾同步过，确保云端数据来自那次或更新
        if (lastLocalSync && bundle.syncedAt < lastLocalSync - SYNC_CLOCK_SKEW_MS) {
          trySendResponse(sendResponse, {
            ok: false,
            error: "云端配置不是最新版本，请先执行「同步到云端」。",
          });
          return;
        }

        const local = await chrome.storage.local.get(SYNC_SETTINGS_KEYS);
        const toApply = {};
        for (const key of SYNC_SETTINGS_KEYS) {
          if (key === CUSTOM_VENDORS_KEY) {
            toApply[key] = mergeCustomVendors(bundle[key], local[key]);
          } else if (bundle[key] !== undefined) {
            toApply[key] = bundle[key];
          }
        }
        await chrome.storage.local.set(toApply);
        trySendResponse(sendResponse, { ok: true, appliedKeys: Object.keys(toApply) });
      } catch (e) {
        trySendResponse(sendResponse, {
          ok: false,
          error: "拉取失败：" + ((e && e.message) ? e.message : String(e)),
        });
      }
    })();
    return true;
  }

  return false;
}
