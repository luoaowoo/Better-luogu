(function () {
  const ROOT_ID = "loe-root";
  let lastUrl = "";
  let state = {};

  init();
  setInterval(() => {
    if (location.href !== lastUrl) init();
    const root = document.getElementById(ROOT_ID);
    if (root) placeRoot(root);
  }, 1000);

  function init() {
    lastUrl = location.href;
    const recordId = getRecordId();
    const existing = document.getElementById(ROOT_ID);
    if (!recordId) {
      if (existing) existing.remove();
      return;
    }
    if (existing && state.recordId === recordId) return;
    if (existing) existing.remove();
    state = { recordId, context: null, lastResult: null };
    mount(recordId);
    loadContext(recordId);
  }

  function getRecordId() {
    const match = location.pathname.match(/\/record\/(\d+)/);
    return match && match[1];
  }

  function mount(recordId) {
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = `
      <section class="loe-panel">
        <header class="loe-header">
          <strong>洛谷 AI 诊断助手</strong>
        </header>
        <div class="loe-status">正在读取提交记录 ${escapeHtml(recordId)}...</div>
        <div class="loe-actions">
          <button type="button" data-action="diagnose">AI 诊断</button>
          <button type="button" data-action="review">复盘分析</button>
          <button type="button" data-action="recommend">同类练习</button>
        </div>
        <div class="loe-output"></div>
      </section>
    `;
    placeRoot(root);

    root.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", () => runAction(button.dataset.action));
    });
  }

  function placeRoot(root) {
    const target = findRecordSidebarCard();
    if (target && root.previousElementSibling !== target) {
      target.insertAdjacentElement("afterend", root);
      return;
    }
    if (!root.isConnected) document.body.appendChild(root);
  }

  function findRecordSidebarCard() {
    const nodes = [...document.querySelectorAll("aside, section, div")];
    return nodes.filter((node) => {
      if (node.id === ROOT_ID || node.closest(`#${ROOT_ID}`)) return false;
      const text = node.innerText || "";
      if (!text.includes("所属题目") || !text.includes("评测状态") || !text.includes("提交时间")) return false;
      const rect = node.getBoundingClientRect();
      return rect.width >= 240 && rect.width <= 520 && rect.height >= 120 && rect.height <= 360;
    }).sort((a, b) => (a.innerText || "").length - (b.innerText || "").length)[0];
  }

  async function loadContext(recordId) {
    const response = await send({ type: "getContext", recordId });
    if (!response.ok) return setStatus(response.error, true);
    state.context = response.context;
    updateForContext(response.context);
  }

  function updateForContext(context) {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    setStatus([
      `${context.pid} ${context.title}`,
      context.score === null ? context.statusText : `${context.score}/${context.fullScore}`,
      context.isOiContest ? "检测到可能是 OI 赛制，已保持手动模式" : "默认隐藏，点击按钮后分析"
    ].filter(Boolean).join(" · "));
    root.querySelector('[data-action="diagnose"]').disabled = context.isFullScore;
    root.querySelector('[data-action="review"]').disabled = !context.isFullScore;
    root.querySelector('[data-action="recommend"]').disabled = false;
  }

  async function runAction(action) {
    if (!state.recordId) return;
    compactRecordSidebar();
    if (action === "diagnose" || action === "review") return runStreamAction(action);

    setOutput(`<div class="loe-loading">处理中...</div>`);
    const response = await send({ type: action, recordId: state.recordId });
    if (!response.ok) return setOutput(`<div class="loe-error">${escapeHtml(response.error)}</div>`);
    state.context = response.context;
    state.lastResult = response.result;
    if (action === "recommend") renderRecommendations(response.result);
  }

  function compactRecordSidebar() {
    const card = findRecordSidebarCard();
    if (!card) return;
    card.dataset.loeCompact = "1";
    card.classList.add("loe-compact-native");

    const blocks = visibleChildBlocks(card);
    ["所属题目", "评测分数"].forEach((label) => {
      const block = blocks.find((item) => (item.innerText || "").includes(label)) || findCompactBlock(card, new RegExp(label));
      if (block) hideNativeBlock(block);
    });
  }

  function hideNativeBlock(node) {
    node.classList.add("loe-hidden-native");
    let previous = node.previousSibling;
    while (previous && previous.nodeName && previous.nodeName.toUpperCase() === "BR") {
      previous.classList.add("loe-hidden-native");
      previous = previous.previousSibling;
    }
    let next = node.nextSibling;
    while (next && next.nodeName && next.nodeName.toUpperCase() === "BR") {
      next.classList.add("loe-hidden-native");
      next = next.nextSibling;
    }
  }

  function visibleChildBlocks(card) {
    return [...card.children].filter((child) => {
      if (child.id === ROOT_ID || child.closest(`#${ROOT_ID}`)) return false;
      const rect = child.getBoundingClientRect();
      return rect.width > 80 && rect.height > 10;
    });
  }

  function findCompactBlock(card, pattern) {
    return [...card.querySelectorAll("div")].filter((node) => {
      const text = node.innerText || "";
      const rect = node.getBoundingClientRect();
      return pattern.test(text) && rect.width > 160 && rect.height >= 20 && rect.height <= 80;
    }).sort((a, b) => (a.innerText || "").length - (b.innerText || "").length)[0];
  }

  function runStreamAction(action) {
    let raw = "";
    let pending = false;
    disableActions(true);
    setOutput(`
      <div class="loe-token">Token：计算中...</div>
      <div class="loe-live" data-live>正在等待模型输出...</div>
    `);

    const port = chrome.runtime.connect({ name: "loe-stream" });
    port.postMessage({ type: "start", action, recordId: state.recordId });
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
        state.context = message.context;
        state.lastResult = message.result;
        renderLive(raw);
        updateForContext(message.context);
        if (action === "diagnose") renderDiagnosis(message.context, message.result);
        if (action === "review") renderReview(message.context, message.result);
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
        if (state.context) updateForContext(state.context);
        else disableActions(false);
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
      ${reasons || '<p>证据不足，无法可靠分析。</p>'}
      ${renderList("缺少信息", result.missing_info)}
      <div class="loe-save">
        <button type="button" data-save>加入错因库</button>
      </div>
    `);
    document.querySelector("#loe-root [data-save]").addEventListener("click", () => saveMistake(context, result));
  }

  function renderReview(context, result) {
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
      <a class="loe-card loe-link" href="/problem/${encodeURIComponent(problem.pid)}" target="_blank" rel="noreferrer">
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
    const response = await send({
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
    setStatus(response.ok ? "已加入错因库" : response.error, !response.ok);
  }

  function setStatus(text, isError) {
    const node = document.querySelector("#loe-root .loe-status");
    if (!node) return;
    node.textContent = text;
    node.classList.toggle("loe-error-text", Boolean(isError));
  }

  function setOutput(html) {
    const node = document.querySelector("#loe-root .loe-output");
    if (node) node.innerHTML = html;
  }

  function appendOutput(html) {
    const node = document.querySelector("#loe-root .loe-output");
    if (node) node.insertAdjacentHTML("beforeend", html);
  }

  function disableActions(disabled) {
    document.querySelectorAll("#loe-root [data-action]").forEach((button) => {
      button.disabled = disabled;
    });
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
})();
