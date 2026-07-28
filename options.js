const ids = ["baseURL", "apiKey", "model", "manualOnly"];
const popupState = { recordId: "", context: null, loadedAnalysis: false };

document.addEventListener("DOMContentLoaded", async () => {
  bindTabs();
  bindSettings();
  bindAnalysis();
  await loadSettings();
});

function bindTabs() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", async () => {
      const tab = button.dataset.tab;
      document.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("is-active", item === button));
      document.querySelectorAll("[data-page]").forEach((page) => {
        page.hidden = page.dataset.page !== tab;
      });
      if (tab === "analysis" && !popupState.loadedAnalysis) {
        popupState.loadedAnalysis = true;
        await loadCurrentRecord();
      }
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

function bindAnalysis() {
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => runAction(button.dataset.action));
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

async function loadCurrentRecord() {
  const tab = await getActiveTab();
  const match = tab && tab.url && tab.url.match(/^https:\/\/(?:www\.)?luogu\.com\.cn\/record\/(\d+)/);
  if (!match) {
    disableAnalysis(true);
    setAnalysisStatus("当前页面不是洛谷提交记录页。");
    return;
  }

  popupState.recordId = match[1];
  disableAnalysis(false);
  setAnalysisStatus(`正在读取提交记录 ${popupState.recordId}...`);
  const response = await chrome.runtime.sendMessage({ type: "getContext", recordId: popupState.recordId });
  if (!response.ok) {
    disableAnalysis(true);
    setAnalysisStatus(response.error, true);
    return;
  }
  popupState.context = response.context;
  renderContext(response.context);
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => resolve(tabs[0]));
  });
}

function renderContext(context) {
  setAnalysisStatus([
    `${context.pid} ${context.title}`,
    context.score === null ? context.statusText : `${context.score}/${context.fullScore}`,
    context.isOiContest ? "可能是 OI 赛制，保持手动分析" : ""
  ].filter(Boolean).join(" · "));
  document.querySelector('[data-action="diagnose"]').disabled = context.isFullScore;
  document.querySelector('[data-action="review"]').disabled = !context.isFullScore;
  document.querySelector('[data-action="recommend"]').disabled = false;
}

async function runAction(action) {
  if (!popupState.recordId) return;
  if (action === "diagnose" || action === "review") return runStreamAction(action);

  setOutput(`<div class="loe-loading">处理中...</div>`);
  const response = await chrome.runtime.sendMessage({ type: action, recordId: popupState.recordId });
  if (!response.ok) return setOutput(`<div class="loe-error">${escapeHtml(response.error)}</div>`);
  popupState.context = response.context;
  if (action === "recommend") renderRecommendations(response.result);
}

function runStreamAction(action) {
  let raw = "";
  let pending = false;
  disableAnalysis(true);
  setOutput(`
    <div class="loe-token">Token：计算中...</div>
    <div class="loe-live" data-live>正在等待模型输出...</div>
  `);

  const port = chrome.runtime.connect({ name: "loe-stream" });
  port.postMessage({ type: "start", action, recordId: popupState.recordId });
  port.onMessage.addListener((message) => {
    if (message.type === "chunk") {
      raw += message.text;
      if (!pending) {
        pending = true;
        setTimeout(() => {
          pending = false;
          renderLive(raw);
        }, 120);
      }
      return;
    }
    if (message.type === "done") {
      popupState.context = message.context;
      renderLive(raw);
      renderContext(message.context);
      if (action === "diagnose") renderDiagnosis(message.context, message.result);
      if (action === "review") renderReview(message.result);
      port.disconnect();
      return;
    }
    if (message.type === "error") {
      if (raw) {
        renderLive(raw);
        appendOutput(`<div class="loe-error">输出中断：${escapeHtml(message.error)}</div>`);
      } else {
        setOutput(`<div class="loe-error">${escapeHtml(message.error)}</div>`);
      }
      if (popupState.context) renderContext(popupState.context);
      else disableAnalysis(false);
      port.disconnect();
    }
  });
}

function renderDiagnosis(context, result) {
  const reasons = (result.reasons || []).map((reason) => `
    <article class="loe-card">
      <b>${renderAiText(reason.type || "Unknown")} · ${renderAiText(reason.summary || "")}</b>
      <p>${renderAiText(reason.why_possible || "")}</p>
      <small>验证：${renderAiText(reason.verify || "")}</small>
      ${renderList("证据", reason.evidence)}
    </article>
  `).join("");
  setOutput(`
    <div class="loe-score">证据充分度 ${escapeHtml(result.confidence)}%</div>
    ${renderUsage(result.usage)}
    <p>${renderAiText(result.overall_judgement)}</p>
    ${reasons || "<p>证据不足，无法可靠分析。</p>"}
    ${renderList("缺少信息", result.missing_info)}
    <div class="loe-save">
      <button type="button" data-save>加入错因库</button>
    </div>
  `);
  document.querySelector("[data-save]").addEventListener("click", () => saveMistake(context, result));
}

function renderReview(result) {
  const alternatives = (result.alternative_algorithms || []).map((item) => `
    <article class="loe-card">
      <b>${renderAiText(item.name || "替代思路")}</b>
      <p>${renderAiText(item.tradeoff || "")}</p>
      <small>复杂度：${renderAiText(item.complexity)}</small>
      ${renderList("证据", item.evidence)}
    </article>
  `).join("");
  setOutput(`
    <div class="loe-score">证据充分度 ${escapeHtml(result.confidence)}%</div>
    ${renderUsage(result.usage)}
    <p>你的解法：${renderAiText(result.your_solution_class || "无法确定")}</p>
    ${result.best_solution ? renderBest(result.best_solution) : ""}
    ${alternatives || "<p>没有足够证据列出其他算法。</p>"}
    ${renderList("不确定点", result.uncertain_points)}
  `);
}

function renderBest(best) {
  return `
    <article class="loe-card">
      <b>题解最优思路：${renderAiText(best.name || "")}</b>
      <p>${renderAiText(best.note || "")}</p>
      <small>复杂度：${renderAiText(best.complexity)}</small>
      ${renderList("证据", best.evidence)}
    </article>
  `;
}

function renderRecommendations(result) {
  const problems = (result.problems || []).map((problem) => `
    <a class="loe-card loe-link" href="https://www.luogu.com.cn/problem/${encodeURIComponent(problem.pid)}" target="_blank" rel="noreferrer">
      <b>${escapeHtml(problem.pid)} ${escapeHtml(problem.title || "")}</b>
      <small>难度：${escapeHtml(problem.difficulty)}${problem.source ? ` · 来源：${escapeHtml(problem.source)}` : ""} · ${escapeHtml((problem.tags || []).join("、"))}</small>
      <p>${renderAiText(problem.reason || "")}</p>
    </a>
  `).join("");
  setOutput(`
    <p>${renderAiText(result.note || "只推荐同评级同标签题。")}</p>
    ${problems || "<p>同难度同标签候选题不足。</p>"}
  `);
}

async function saveMistake(context, result) {
  const firstReason = result.reasons && result.reasons[0];
  const response = await chrome.runtime.sendMessage({
    type: "saveMistake",
    record: {
      pid: context.pid,
      title: context.title,
      recordId: context.recordId,
      result: context.statusText || `${context.score}/${context.fullScore}`,
      errorType: firstReason && firstReason.type,
      aiConclusion: result.overall_judgement,
      userReason: firstReason && firstReason.summary || "",
      tags: [firstReason && firstReason.type, firstReason && firstReason.summary].filter(Boolean)
    }
  });
  setAnalysisStatus(response.ok ? "已加入错因库" : response.error, !response.ok);
}

function disableAnalysis(disabled) {
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.disabled = disabled;
  });
}

function setAnalysisStatus(text, isError) {
  const node = document.getElementById("analysisStatus");
  node.textContent = text;
  node.classList.toggle("loe-error-text", Boolean(isError));
}

function setText(id, text, isError) {
  const node = document.getElementById(id);
  node.textContent = text;
  node.className = isError ? "loe-error-text" : "";
}

function setOutput(html) {
  document.getElementById("analysisOutput").innerHTML = html;
}

function appendOutput(html) {
  document.getElementById("analysisOutput").insertAdjacentHTML("beforeend", html);
}

function renderList(title, items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return `<div class="loe-list"><small>${escapeHtml(title)}</small><ul>${items.map((item) => `<li>${renderAiText(item)}</li>`).join("")}</ul></div>`;
}

function renderUsage(usage) {
  if (!usage) return "";
  const prompt = usage.prompt_tokens ?? "?";
  const completion = usage.completion_tokens ?? "?";
  const total = usage.total_tokens ?? "?";
  const mark = usage.estimated ? "约 " : "";
  return `<div class="loe-token">Token：${mark}${escapeHtml(total)}（输入 ${escapeHtml(prompt)} / 输出 ${escapeHtml(completion)}）</div>`;
}

function renderLive(raw) {
  const node = document.querySelector("[data-live]");
  if (!node) return;
  const preview = streamPreview(raw);
  node.innerHTML = preview.map((line) => `<p>${renderAiText(line)}</p>`).join("") || "正在生成...";
  node.scrollTop = node.scrollHeight;
}

function streamPreview(raw) {
  const text = String(raw || "").slice(-3000);
  return [
    extractJsonString(text, "overall_judgement") || extractJsonString(text, "your_solution_class"),
    extractJsonString(text, "summary"),
    extractJsonString(text, "why_possible") || extractJsonString(text, "note"),
    extractJsonString(text, "verify") || extractJsonString(text, "tradeoff")
  ].filter(Boolean);
}

function extractJsonString(text, key) {
  const match = text.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`));
  if (!match) return "";
  return match[1].replace(/\\"/g, "\"").replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
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
