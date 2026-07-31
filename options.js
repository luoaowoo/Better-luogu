const ids = ["baseURL", "apiKey", "model", "manualOnly"];

document.addEventListener("DOMContentLoaded", async () => {
  bindTabs();
  bindSettings();
  bindWeeklySummary();
  await loadSettings();
  await loadWeeklyCache();
});

function bindTabs() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.tab;
      document.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("is-active", item === button));
      document.querySelectorAll("[data-page]").forEach((page) => {
        page.hidden = page.dataset.page !== tab;
      });
      if (tab === "weekly") loadWeeklyCache();
    });
  });
}

function bindSettings() {
  document.getElementById("save").addEventListener("click", async () => {
    const settings = {};
    for (const id of ids) {
      const input = document.getElementById(id);
      settings[id] = input.type === "checkbox" ? input.checked : input.value.trim();
    }
    const response = await chrome.runtime.sendMessage({ type: "saveSettings", settings });
    setText("status", response.ok ? "已保存" : response.error, !response.ok);
  });
}

function bindWeeklySummary() {
  document.getElementById("weeklySummary").addEventListener("click", async () => {
    const button = document.getElementById("weeklySummary");
    button.disabled = true;
    setWeeklyStatus("正在整理最近 7 天训练记录...");
    setWeeklyOutput('<div class="loe-loading">生成中...</div>');
    try {
      const tab = await getActiveTab();
      const [pageRecords, userId] = await Promise.all([scrapeActiveTabRecords(tab), scrapeActiveTabUser(tab)]);
      if (pageRecords.length) setWeeklyStatus(`从当前评测记录页截取到 ${pageRecords.length} 条记录，正在生成...`);
      const response = await chrome.runtime.sendMessage({ type: "weeklySummary", pageRecords, userId });
      if (!response.ok) {
        setWeeklyStatus(response.error, true);
        setWeeklyOutput(`<div class="loe-error">${escapeHtml(response.error)}</div>`);
        return;
      }
      renderWeekly(response.data, response.result);
      const totals = response.data.totals || {};
      setWeeklyStatus(response.cached ? "已显示 5 分钟内生成的本周总结。" : totals.submissions || totals.saved_mistakes ? "已生成本周训练复盘。" : "最近 7 天暂无本地记录。");
    } catch (error) {
      const message = error.message || String(error);
      setWeeklyStatus(message, true);
      setWeeklyOutput(`<div class="loe-error">${escapeHtml(message)}</div>`);
    } finally {
      button.disabled = false;
    }
  });
}

async function loadWeeklyCache() {
  const response = await chrome.runtime.sendMessage({ type: "getWeeklySummaryCache" });
  if (!response.ok || !response.cached) return;
  renderWeekly(response.data, response.result);
  setWeeklyStatus("已显示 5 分钟内生成的本周总结。");
}

async function scrapeActiveTabRecords(tab) {
  if (!tab || !tab.id || !/^https:\/\/(?:www\.)?luogu\.com\.cn\/record/.test(tab.url || "")) return [];
  const response = await sendTabMessage(tab.id, { type: "scrapeWeeklyRecords" });
  return response && response.ok && Array.isArray(response.records) ? response.records : [];
}

async function scrapeActiveTabUser(tab) {
  if (!tab || !tab.id || !/^https:\/\/(?:www\.)?luogu\.com\.cn\//.test(tab.url || "")) return "";
  const response = await sendTabMessage(tab.id, { type: "scrapeLuoguUser" });
  return response && response.ok ? response.userId || "" : "";
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => resolve(tabs[0]));
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => resolve(chrome.runtime.lastError ? null : response));
  });
}

async function loadSettings() {
  const response = await chrome.runtime.sendMessage({ type: "getSettings" });
  if (!response.ok) return setText("status", response.error, true);
  for (const id of ids) {
    const input = document.getElementById(id);
    if (input.type === "checkbox") input.checked = Boolean(response.settings[id]);
    else input.value = response.settings[id] || "";
  }
}

function renderWeekly(data, result) {
  const totals = data.totals || {};
  setWeeklyOutput(`
    <div class="loe-weekly-grid">
      ${renderStat("提交", totals.submissions)}
      ${renderStat("题目", totals.problems)}
      ${renderStat("AC", totals.accepted)}
      ${renderStat("错误", totals.errors)}
    </div>
    <article class="loe-card">
      <b>AI 总结</b>
      <p>${renderAiText(result.overall_summary)}</p>
    </article>
    ${renderList("优势", result.strengths)}
    ${renderList("主要短板", result.weaknesses)}
    ${renderList("高频算法", result.frequent_tags)}
    ${renderList("代表题目", result.representative_problems)}
    ${renderList("错误模式", result.error_patterns)}
    ${renderList("下周计划", result.next_week_plan)}
    ${renderLocalStats(data)}
  `);
}

function renderLocalStats(data) {
  const problems = (data.problems || []).slice(0, 8).map((problem) => `
    <li>
      <a href="https://www.luogu.com.cn/problem/${encodeURIComponent(problem.pid)}" target="_blank" rel="noreferrer">
        ${escapeHtml(problem.pid)} ${escapeHtml(problem.title || "")}
      </a>
      <small>${escapeHtml(problem.difficulty)} · ${escapeHtml(problem.attempts)} 次提交 · ${escapeHtml(problem.errors)} 次错误</small>
    </li>
  `).join("");
  const mistakes = (data.mistakes || []).slice(0, 5).map((item) => `
    <li>
      <strong>${escapeHtml(item.pid || "未知题号")} ${escapeHtml(item.title || "")}</strong>
      <small>${escapeHtml(item.result || "")}${item.errorType ? ` · ${escapeHtml(item.errorType)}` : ""}</small>
      <small>${escapeHtml(item.reason || "暂无记录")}</small>
    </li>
  `).join("");
  const recommendations = (data.recommendations || []).slice(0, 5).map((problem) => `
    <li>
      <a href="https://www.luogu.com.cn/problem/${encodeURIComponent(problem.pid)}" target="_blank" rel="noreferrer">
        ${escapeHtml(problem.pid)} ${escapeHtml(problem.title || "")}
      </a>
      <small>${escapeHtml(problem.difficulty || "")} · ${escapeHtml((problem.tags || []).join("、"))}</small>
      <small>${escapeHtml(problem.reason || "同难度同标签")}</small>
    </li>
  `).join("");
  return `
    ${renderCounts("难度分布", data.difficulties)}
    ${renderCounts("标签分布", data.tags)}
    ${renderCounts("错误类型", data.verdicts)}
    <div class="loe-weekly-problems">
      <small>题目推荐</small>
      <ul>${recommendations || "<li>暂无推荐</li>"}</ul>
    </div>
    <div class="loe-weekly-problems">
      <small>本周题目</small>
      <ul>${problems || "<li>暂无记录</li>"}</ul>
    </div>
    <div class="loe-weekly-problems">
      <small>最近错因</small>
      <ul>${mistakes || "<li>暂无记录</li>"}</ul>
    </div>
  `;
}

function renderStat(label, value) {
  return `<div class="loe-weekly-stat"><small>${escapeHtml(label)}</small><b>${escapeHtml(value ?? 0)}</b></div>`;
}

function renderCounts(title, items) {
  if (!Array.isArray(items) || !items.length) return "";
  return `<div class="loe-list"><small>${escapeHtml(title)}</small><ul>${items.map((item) => `<li>${escapeHtml(item.name)}：${escapeHtml(item.count)}</li>`).join("")}</ul></div>`;
}

function renderList(title, items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return `<div class="loe-list"><small>${escapeHtml(title)}</small><ul>${items.map((item) => `<li>${renderAiText(item)}</li>`).join("")}</ul></div>`;
}

function setText(id, text, isError) {
  const node = document.getElementById(id);
  node.textContent = text;
  node.className = isError ? "loe-error-text" : "";
}

function setWeeklyStatus(text, isError) {
  const node = document.getElementById("weeklyStatus");
  node.textContent = text;
  node.classList.toggle("loe-error-text", Boolean(isError));
}

function setWeeklyOutput(html) {
  document.getElementById("weeklyOutput").innerHTML = html;
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
