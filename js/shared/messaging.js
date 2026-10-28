// chrome.runtime 通信的共享工具：Promise 包装的 sendMessage + 安全回包。

// Promise 包装的 sendMessage：端口已关闭或出错时 resolve(null)，永不 reject。
export function sendMsg(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(resp);
    });
  });
}

// 忽略端口已关闭等错误的安全回包（弹窗关闭等场景下 sendResponse 会抛错）。
export function trySendResponse(sendResponse, data) {
  try {
    sendResponse(data);
  } catch (_) {
    // 端口可能已关闭（弹窗关闭等），无害
  }
}
