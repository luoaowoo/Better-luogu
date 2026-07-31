chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !["scrapeWeeklyRecords", "scrapeLuoguUser"].includes(message.type)) return;
  try {
    if (message.type === "scrapeWeeklyRecords") sendResponse({ ok: true, records: scrapeWeeklyRecords() });
    if (message.type === "scrapeLuoguUser") sendResponse({ ok: true, userId: scrapeLuoguUserId() });
  } catch (error) {
    sendResponse({ ok: false, error: error.message || String(error) });
  }
});

function scrapeLuoguUserId() {
  const context = readLentilleContext();
  const id = findUserId(context);
  if (id) return id;
  const topLink = [...document.querySelectorAll('a[href*="/user/"]')]
    .map((link) => ({ link, rect: link.getBoundingClientRect(), match: link.href.match(/\/user\/(\d+)/) }))
    .find((item) => item.match && item.rect.top >= 0 && item.rect.top < 180 && item.rect.left > window.innerWidth * 0.35);
  if (topLink) return topLink.match[1];
  const match = document.documentElement.innerHTML.match(/\/user\/(\d+)/);
  return match ? match[1] : "";
}

function readLentilleContext() {
  const node = document.getElementById("lentille-context");
  if (!node) return null;
  try {
    return JSON.parse(node.textContent || "{}");
  } catch {
    return null;
  }
}

function findUserId(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 5) return "";
  for (const key of ["currentUser", "loginUser", "me", "user"]) {
    const user = value[key];
    const id = user && (user.uid || user.id || user.userId);
    if (id) return String(id);
  }
  for (const item of Object.values(value)) {
    const id = findUserId(item, depth + 1);
    if (id) return id;
  }
  return "";
}

function scrapeWeeklyRecords() {
  if (!location.pathname.startsWith("/record")) return [];
  const rows = new Set();
  return [...document.querySelectorAll('a[href*="/problem/"]')]
    .map((anchor) => {
      const pid = extractRecordPid(`${anchor.href} ${anchor.textContent}`);
      const row = pid && findRecordListRow(anchor);
      if (!row || rows.has(row)) return null;
      rows.add(row);
      return parseRecordListRow(row, anchor, pid);
    })
    .filter(Boolean)
    .slice(0, 80);
}

function findRecordListRow(anchor) {
  const direct = anchor.closest("tr, li, article");
  if (direct && parseRecordListTime(direct.innerText || "")) return direct;
  let node = anchor.parentElement;
  while (node && node !== document.body) {
    const text = node.innerText || "";
    const rect = node.getBoundingClientRect();
    if (parseRecordListTime(text) && extractRecordListStatus(text) && rect.width >= 280 && rect.height >= 28 && rect.height <= 150) return node;
    node = node.parentElement;
  }
  return anchor.parentElement;
}

function parseRecordListRow(row, anchor, pid) {
  const text = row.innerText || "";
  const statusText = extractRecordListStatus(text);
  const submittedAt = parseRecordListTime(text);
  if (!statusText && !submittedAt) return null;
  const recordMatch = row.innerHTML.match(/\/record\/(\d+)/);
  return {
    recordId: recordMatch ? recordMatch[1] : "",
    pid,
    title: normalizeRecordTitle(anchor.textContent || pid),
    score: extractRecordListScore(text, statusText),
    statusText,
    submittedAt,
    verdicts: statusText && !/Accepted|AC|通过/.test(statusText) ? [statusText] : []
  };
}

function extractRecordPid(text) {
  const match = String(text || "").match(/\b[PBU]\d+\b/);
  return match && match[0];
}

function normalizeRecordTitle(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function extractRecordListStatus(text) {
  const match = String(text || "").match(/Accepted|Unaccepted|Wrong Answer|Runtime Error|Compile Error|Time Limit Exceeded|Memory Limit Exceeded|Output Limit Exceeded|\bAC\b|\bWA\b|\bRE\b|\bCE\b|\bTLE\b|\bMLE\b|\bOLE\b|通过|答案错误|运行时错误|编译错误|时间超限|内存超限/);
  return match ? match[0] : "";
}

function extractRecordListScore(text, statusText) {
  if (!statusText) return null;
  const escaped = statusText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(text || "").match(new RegExp(`${escaped}\\s+(\\d{1,4})(?:\\s|$)`));
  if (match) return Number(match[1]);
  return /Accepted|AC|通过/.test(statusText) ? 100 : null;
}

function parseRecordListTime(text) {
  text = String(text || "");
  let match = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] || 0)).getTime();
  match = text.match(/(\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const now = new Date();
  const date = new Date(now.getFullYear(), Number(match[1]) - 1, Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5] || 0));
  if (date.getTime() > Date.now() + 24 * 60 * 60 * 1000) date.setFullYear(date.getFullYear() - 1);
  return date.getTime();
}
