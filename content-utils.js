function renderLive(raw) {
  const node = document.querySelector("#loe-root [data-live]");
  if (!node) return;
  const preview = streamPreview(raw);
  node.innerHTML = preview.map((line) => `<p>${renderAiText(line)}</p>`).join("") || "正在生成...";
  node.scrollTop = node.scrollHeight;
}

function streamPreview(raw) {
  const text = String(raw || "").slice(-3000);
  return [
    extractJsonString(text, "overall_judgement") || extractJsonString(text, "your_solution_class"),
    extractJsonString(text, "algorithm") || extractJsonString(text, "summary"),
    extractJsonString(text, "why_possible") || extractJsonString(text, "note"),
    extractJsonString(text, "complexity") || extractJsonString(text, "verify") || extractJsonString(text, "tradeoff")
  ].filter(Boolean);
}

function extractJsonString(text, key) {
  const match = text.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`));
  if (!match) return "";
  return match[1].replace(/\\"/g, "\"").replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
}

function send(message) {
  return chrome.runtime.sendMessage(message);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function renderAiText(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}
