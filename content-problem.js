async function mountProblem(pid) {
  const root = document.createElement("div");
  root.id = PROBLEM_ROOT_ID;
  root.innerHTML = `
    <button type="button" class="loe-hint-button" data-problem-hint disabled>读题 5:00 后提示算法</button>
    <div id="${PROBLEM_POPOVER_ID}" class="loe-hint-popover" hidden>
      <div class="loe-hint-toolbar">
        <strong>算法提示</strong>
        <div class="loe-hint-tools">
          <button type="button" data-hint-reload>重新加载</button>
          <button type="button" data-hint-collapse>收回</button>
        </div>
      </div>
      <div class="loe-hint-body">
        <div class="loe-token">Token：计算中...</div>
        <div class="loe-live" data-live>正在等待模型输出...</div>
      </div>
    </div>
  `;
  placeProblemRoot(root);
  const popover = root.querySelector(".loe-hint-popover");
  const hintButton = root.querySelector("[data-problem-hint]");
  hintButton.addEventListener("click", () => toggleProblemHint(pid));
  hintButton.addEventListener("mouseenter", updateProblemGate);
  hintButton.addEventListener("mouseleave", updateProblemGate);
  popover.querySelector("[data-hint-reload]").addEventListener("click", () => runProblemHint(pid, { force: true }));
  popover.querySelector("[data-hint-collapse]").addEventListener("click", () => hideProblemPopover());
  document.body.appendChild(popover);
  const response = await send({ type: "markProblemRead", pid });
  if (response.ok) state.startedAt = response.startedAt;
  updateProblemGate();
  window.addEventListener("scroll", positionProblemPopover, true);
  window.addEventListener("resize", positionProblemPopover, true);
  bindDebugShortcut();
}

function placeProblemRoot(root) {
  const target = findProblemActionBar();
  if (target) {
    const button = root.querySelector("[data-problem-hint]");
    const nativeClass = target.first.getAttribute("class");
    if (button && nativeClass) button.className = `${nativeClass} loe-hint-button`;
    if (button) for (const attr of target.first.attributes) {
      if (attr.name.startsWith("data-v-")) button.setAttribute(attr.name, attr.value);
    }
  }
  if (target && root.parentElement !== target.parent) {
    target.parent.classList.add("loe-problem-actions-host");
    target.parent.insertBefore(root, target.first);
    return;
  }
  if (!root.isConnected) document.body.appendChild(root);
}

function findProblemActionBar() {
  const buttons = [...document.querySelectorAll("button, a")];
  const first = buttons.find((node) => (node.innerText || "").includes("加入题单"));
  if (!first) return null;
  let parent = first.parentElement;
  while (parent && parent !== document.body) {
    if (parent.id === PROBLEM_ROOT_ID || parent.closest(`#${PROBLEM_ROOT_ID}`)) return null;
    const text = parent.innerText || "";
    const rect = parent.getBoundingClientRect();
    if (text.includes("加入题单") && text.includes("复制题目") && rect.height <= 90) return { parent, first };
    parent = parent.parentElement;
  }
  return null;
}

function updateProblemGate() {
  if (state.mode !== "problem") return;
  const root = document.getElementById(PROBLEM_ROOT_ID);
  if (!root) return;
  placeProblemRoot(root);
  const popover = getProblemPopover();
  const button = root.querySelector("[data-problem-hint]");
  if (!button || !state.startedAt) return;
  const left = Math.max(0, READ_MS - (Date.now() - state.startedAt));
  if (state.hintLoading) {
    button.disabled = false;
    button.textContent = button.matches(":hover") ? (popover && !popover.hidden ? "收起" : "打开") : "加载中...";
  } else {
    button.disabled = left > 0;
    button.textContent = left > 0 ? `读题 ${formatLeft(left)}` : popover && !popover.hidden ? "收回" : "算法提示";
  }
  button.title = left > 0 ? `还剩 ${formatLeft(left)}` : "点击查看或收回题解算法提示";
}

function formatLeft(ms) {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function toggleProblemHint(pid) {
  const root = document.getElementById(PROBLEM_ROOT_ID);
  const popover = getProblemPopover();
  if (!root || !popover) return;
  if (!popover.hidden) {
    hideProblemPopover();
    return;
  }
  if (state.hintLoading) {
    showProblemPopover();
    return;
  }
  if (state.hintLoaded) {
    showProblemPopover();
    updateProblemGate();
    return;
  }
  runProblemHint(pid);
}

function runProblemHint(pid, options = {}) {
  const root = document.getElementById(PROBLEM_ROOT_ID);
  const popover = getProblemPopover();
  if (!root || !popover) return;
  if (state.hintLoading) return;
  let raw = "";
  let pending = false;
  state.hintLoading = true;
  state.hintLoaded = false;
  showProblemPopover();
  setProblemOutput(`
    <div class="loe-token">Token：计算中...</div>
    <div class="loe-live" data-live>正在等待模型输出...</div>
  `);
  const button = root.querySelector("[data-problem-hint]");

  const port = chrome.runtime.connect({ name: "loe-stream" });
  port.postMessage({ type: "start", action: "hint", pid });
  port.onMessage.addListener((message) => {
    if (message.type === "chunk") {
      raw += message.text;
      if (!pending) {
        pending = true;
        setTimeout(() => {
          pending = false;
          renderProblemLive(raw);
        }, 120);
      }
      return;
    }
    if (message.type === "done") {
      renderProblemLive(raw);
      renderHint(message.result);
      state.hintLoading = false;
      state.hintLoaded = true;
      if (button) button.disabled = false;
      updateProblemGate();
      port.disconnect();
      return;
    }
    if (message.type === "error") {
      setProblemOutput(`<div class="loe-error">${escapeHtml(message.error)}</div>`);
      state.hintLoading = false;
      if (button) button.disabled = false;
      updateProblemGate();
      port.disconnect();
    }
  });
}

function bindDebugShortcut() {
  if (debugShortcutBound) return;
  debugShortcutBound = true;
  document.addEventListener("keydown", async (event) => {
    if (state.mode !== "problem") return;
    if (event.key !== "Control" || event.repeat) return;
    const now = Date.now();
    if (now - (state.lastCtrlAt || 0) > DEBUG_CTRL_WINDOW) {
      state.ctrlCount = 0;
    }
    state.lastCtrlAt = now;
    state.ctrlCount = (state.ctrlCount || 0) + 1;
    if (state.ctrlCount < DEBUG_CTRL_LIMIT) return;
    state.ctrlCount = 0;
    const response = await send({ type: "forceProblemRead", pid: state.pid });
    if (response.ok) {
      state.startedAt = response.startedAt;
      updateProblemGate();
    }
  }, true);
}

function renderHint(result) {
  setProblemOutput(`
    <div class="loe-score">证据充分度 ${escapeHtml(result.confidence)}%</div>
    ${renderUsage(result.usage)}
    <article class="loe-card">
      <b>算法：${renderAiText(result.algorithm || "题解证据不足")}</b>
      ${result.complexity ? `<small>复杂度：${renderAiText(result.complexity)}</small>` : ""}
      ${renderList("提示", result.hints)}
      ${renderList("实现提醒", result.implementation_notes)}
      ${renderList("题解证据", result.evidence)}
    </article>
  `);
}

function setProblemOutput(html) {
  const node = document.querySelector(`#${PROBLEM_POPOVER_ID} .loe-hint-body`);
  if (node) node.innerHTML = html;
}

function renderProblemLive(raw) {
  const node = document.querySelector(`#${PROBLEM_POPOVER_ID} [data-live]`);
  if (!node) return;
  const preview = streamPreview(raw);
  node.innerHTML = preview.map((line) => `<p>${renderAiText(line)}</p>`).join("") || "正在生成...";
}

function showProblemPopover() {
  const popover = getProblemPopover();
  if (popover) popover.hidden = false;
  positionProblemPopover();
  updateProblemGate();
}

function hideProblemPopover() {
  const popover = getProblemPopover();
  if (popover) popover.hidden = true;
  updateProblemGate();
}

function getProblemPopover() {
  return document.getElementById(PROBLEM_POPOVER_ID);
}

function positionProblemPopover() {
  const popover = getProblemPopover();
  const button = document.querySelector(`#${PROBLEM_ROOT_ID} [data-problem-hint]`);
  if (!popover || popover.hidden || !button) return;
  const rect = button.getBoundingClientRect();
  const gap = 10;
  const margin = 16;
  const width = Math.min(420, window.innerWidth - margin * 2);
  popover.style.width = `${width}px`;
  popover.style.left = `${Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin)}px`;
  popover.style.top = `${Math.min(rect.bottom + gap, window.innerHeight - 160)}px`;
}
