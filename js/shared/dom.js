// 跨页面共享的 DOM / 文本工具。
// 注意：content scripts 无法 import，其文本工具保留在 content 文件内。

// 转义 HTML 特殊字符（用于安全拼接 innerHTML）
export function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// 转义引号（原 escapeStr / transMark，二者逻辑完全相同）
export function escapeQuotes(s) {
  return s ? s.replace(/"/g, '\\"').replace(/'/g, "\\'") : "";
}

// 把完整 URL 截断为简短展示形式（去协议、限长、超长加省略号）
// max 为截断长度；省略号判据用「原始 URL 长度 > max」，与历史实现一致。
export function formatUrl(url, max = 40) {
  if (!url) return "";
  const stripped = url.replace(/^https?:\/\//, "");
  return stripped.substring(0, max) + (url.length > max ? "..." : "");
}
