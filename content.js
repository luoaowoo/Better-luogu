(function () {
  const ROOT_ID = "loe-root";
  const PROBLEM_ROOT_ID = "loe-problem-root";
  const PROBLEM_POPOVER_ID = "loe-problem-popover";
  const POST_ROOT_ID = "loe-post-root";
  const ARTICLE_ROOT_ID = "loe-article-root";
  const FRIEND_LINK_ID = "loe-friend-link";
  const OPTIMIZE_LABEL = "AI 优化(改为学术风格)";
  const ARTICLE_OPTIMIZE_LABEL = "AI 优化\n(改为学术风格)";
  const READ_MS = 5 * 60 * 1000;
  const DEBUG_CTRL_LIMIT = 10;
  const DEBUG_CTRL_WINDOW = 1400;
  let lastUrl = "";
  let state = {};
  let debugShortcutBound = false;

  init();
  setInterval(() => {
    if (location.href !== lastUrl) init();
    const root = document.getElementById(ROOT_ID);
    if (root) placeRoot(root);
    if (isHomePage() && !document.getElementById(POST_ROOT_ID)) mountPostOptimizer();
    if (isHomePage() && !document.getElementById(FRIEND_LINK_ID)) mountFriendLink();
    if (isArticleEditorPage() && !document.getElementById(ARTICLE_ROOT_ID)) mountArticleOptimizer();
    updateProblemGate();
    positionProblemPopover();
  }, 1000);

  function init() {
    lastUrl = location.href;
    const recordId = getRecordId();
    const pid = getProblemId();
    const isHome = isHomePage();
    const isArticle = isArticleEditorPage();
    const existing = document.getElementById(ROOT_ID);
    const problemExisting = document.getElementById(PROBLEM_ROOT_ID);
    const problemPopoverExisting = document.getElementById(PROBLEM_POPOVER_ID);
    const postExisting = document.getElementById(POST_ROOT_ID);
    const articleExisting = document.getElementById(ARTICLE_ROOT_ID);
    if (!recordId) {
      if (existing) existing.remove();
    }
    if (!pid) {
      if (problemExisting) problemExisting.remove();
      if (problemPopoverExisting) problemPopoverExisting.remove();
    }
    if (!isHome && postExisting) postExisting.remove();
    if (!isArticle && articleExisting) articleExisting.remove();
    if (!isHome && !isArticle) document.querySelector(".loe-post-preview")?.remove();
    if (!recordId && !pid && !isHome && !isArticle) return;
    if (recordId) {
      if (problemExisting) problemExisting.remove();
      if (problemPopoverExisting) problemPopoverExisting.remove();
      if (existing && state.recordId === recordId) return;
      if (existing) existing.remove();
      state = { mode: "record", recordId, context: null, lastResult: null };
      mount(recordId);
      loadContext(recordId);
      return;
    }
    if (isHome) {
      if (existing) existing.remove();
      if (problemExisting) problemExisting.remove();
      if (problemPopoverExisting) problemPopoverExisting.remove();
      if (state.mode !== "post") document.querySelector(".loe-post-preview")?.remove();
      if (postExisting && state.mode === "post") return;
      state = { mode: "post", postOriginal: "", postLoading: false, postDone: false, postStale: false };
      mountPostOptimizer();
      return;
    }
    if (isArticle) {
      if (existing) existing.remove();
      if (problemExisting) problemExisting.remove();
      if (problemPopoverExisting) problemPopoverExisting.remove();
      if (state.mode !== "article") document.querySelector(".loe-post-preview")?.remove();
      if (articleExisting && state.mode === "article") return;
      state = { mode: "article", postOriginal: "", postLoading: false, postDone: false, postStale: false };
      mountArticleOptimizer();
      return;
    }
    if (problemExisting && state.pid === pid) return;
    if (problemExisting) problemExisting.remove();
    state = { mode: "problem", pid, startedAt: 0, ctrlCount: 0, lastCtrlAt: 0, hintLoaded: false, hintLoading: false };
    mountProblem(pid);
  }

  function getRecordId() {
    const match = location.pathname.match(/\/record\/(\d+)/);
    return match && match[1];
  }

  function getProblemId() {
    const match = location.pathname.match(/^\/problem\/([A-Z]\d+)/);
    return match && match[1];
  }

  function isHomePage() {
    return location.pathname === "/" || location.pathname === "";
  }

  function isArticleEditorPage() {
    const isEditorPath = location.pathname === "/article/_new" || /^\/article\/[^/]+\/edit\/?$/.test(location.pathname);
    return isEditorPath && document.body && document.body.innerText.includes("文章内容");
  }

  function mountPostOptimizer() {
    const composer = findPostComposer();
    if (!composer || document.getElementById(POST_ROOT_ID)) return;
    const button = document.createElement("button");
    button.id = POST_ROOT_ID;
    button.type = "button";
    button.dataset.postOptimize = "1";
    button.textContent = OPTIMIZE_LABEL;
    copyNativeButtonStyle(composer.submit, button);
    button.classList.add("loe-post-button");
    button.style.backgroundColor = "#3498db";
    button.style.borderColor = "#3498db";
    button.style.color = "#fff";
    button.addEventListener("click", () => runPostOptimize());
    composer.submit.insertAdjacentElement("afterend", button);
    matchPostButtonGap(composer.submit, button);
  }

  function mountFriendLink() {
    const friendBox = [...document.querySelectorAll(".lg-article")]
      .find((node) => node.querySelector("h2")?.textContent.trim() === "友情链接");
    const firstGroup = friendBox && friendBox.querySelector("p");
    if (!firstGroup || document.getElementById(FRIEND_LINK_ID) || friendBox.querySelector('a[href="https://next.tboi.cn"]')) return;
    const paragraph = document.createElement("p");
    paragraph.id = FRIEND_LINK_ID;
    const heading = document.createElement("strong");
    heading.textContent = "🐂 🍺 的oj";
    const link = document.createElement("a");
    link.href = "https://next.tboi.cn";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "ZYZOJ";
    paragraph.append(heading, document.createElement("br"), link);
    firstGroup.insertAdjacentElement("afterend", paragraph);
  }

  function mountArticleOptimizer() {
    const composer = findArticleComposer();
    if (!composer || document.getElementById(ARTICLE_ROOT_ID)) return;
    const root = document.createElement("div");
    root.id = ARTICLE_ROOT_ID;
    root.innerHTML = `<button type="button" class="loe-article-button"></button>`;
    const button = root.querySelector("button");
    button.dataset.idleLabel = ARTICLE_OPTIMIZE_LABEL;
    button.textContent = ARTICLE_OPTIMIZE_LABEL;
    button.addEventListener("click", () => runPostOptimize(findArticleComposer, ARTICLE_ROOT_ID));
    composer.row.classList.add("loe-article-row");
    composer.label.insertAdjacentElement("afterend", root);
  }

  function matchPostButtonGap(submit, button) {
    const parentStyle = getComputedStyle(submit.parentElement);
    const nativeGap = parentStyle.columnGap || parentStyle.gap;
    if ((parentStyle.display || "").includes("flex") && nativeGap && nativeGap !== "normal" && nativeGap !== "0px") return;
    button.style.marginLeft = "8px";
  }

  function findPostComposer() {
    const submit = [...document.querySelectorAll("button, a")]
      .find((node) => (node.innerText || "").includes("发射犇犇"));
    if (!submit) return null;
    let container = submit.closest("form") || submit.parentElement;
    while (container && container !== document.body && !container.querySelector("textarea")) {
      container = container.parentElement;
    }
    const textarea = container && container.querySelector("textarea");
    return textarea ? {
      submit,
      container,
      previewHost: textarea,
      maxLength: textarea.maxLength || 0,
      getValue: () => textarea.value,
      setValue: (value) => {
        textarea.value = value;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
      },
      onInput: (handler) => textarea.addEventListener("input", handler, { once: true })
    } : null;
  }

  function findArticleComposer() {
    const label = findSmallTextNode("文章内容");
    const editor = findArticleEditor();
    if (!label || !editor) return null;
    return {
      label,
      row: label.closest(".l-form-layout.row") || label.parentElement,
      container: editor.container,
      previewHost: editor.previewHost || editor.container,
      maxLength: 0,
      getValue: editor.getValue,
      setValue: editor.setValue,
      onInput: editor.onInput
    };
  }

  function findSmallTextNode(text) {
    return [...document.querySelectorAll("label, div, span")]
      .filter((node) => (node.innerText || "").trim() === text)
      .sort((a, b) => (a.innerText || "").length - (b.innerText || "").length)[0];
  }

  function findArticleEditor() {
    const codeMirror = [...document.querySelectorAll(".CodeMirror")]
      .filter((node) => node.CodeMirror && node.getBoundingClientRect().height > 180)[0];
    if (codeMirror) {
      return {
        container: codeMirror,
        getValue: () => codeMirror.CodeMirror.getValue(),
        setValue: (value) => codeMirror.CodeMirror.setValue(value),
        onInput: (handler) => codeMirror.CodeMirror.on("change", handler)
      };
    }
    const cm6Content = document.querySelector('.cm-editor .cm-content[contenteditable="true"]');
    if (cm6Content) {
      const cm6Editor = cm6Content.closest(".cm-editor");
      return {
        container: cm6Editor,
        previewHost: cm6Editor.closest(".casket") || cm6Editor,
        getValue: () => [...cm6Content.querySelectorAll(".cm-line")].map((line) => line.textContent || "").join("\n"),
        setValue: (value) => {
          cm6Content.focus();
          document.execCommand("selectAll", false);
          if (!document.execCommand("insertText", false, value)) throw new Error("无法写回文章编辑器");
        },
        onInput: (handler) => cm6Content.addEventListener("input", handler, { once: true })
      };
    }
    const textarea = [...document.querySelectorAll("textarea")]
      .filter((node) => node.getBoundingClientRect().height > 120)
      .sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
    if (!textarea) return null;
    return {
      container: textarea,
      getValue: () => textarea.value,
      setValue: (value) => {
        textarea.value = value;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
      },
      onInput: (handler) => textarea.addEventListener("input", handler, { once: true })
    };
  }

  function copyNativeButtonStyle(from, to) {
    const nativeClass = from.getAttribute("class");
    if (nativeClass) to.className = nativeClass;
    for (const attr of from.attributes) {
      if (attr.name.startsWith("data-v-")) to.setAttribute(attr.name, attr.value);
    }
  }

  function ensurePostPreview(composer) {
    let preview = document.querySelector(".loe-post-preview");
    if (preview) return preview;
    preview = document.createElement("div");
    preview.className = "loe-post-preview";
    preview.innerHTML = `
      <div class="loe-post-preview-head">
        <strong>优化预览</strong>
        <span data-post-status></span>
        <div>
          <button type="button" title="确认更改" data-post-accept>✓</button>
          <button type="button" title="取消" data-post-cancel>×</button>
        </div>
      </div>
      <div class="loe-post-diff" data-post-result contenteditable="true"></div>
      <small data-post-fixes></small>
    `;
    composer.previewHost.insertAdjacentElement("afterend", preview);
    preview.querySelector("[data-post-accept]").addEventListener("click", () => acceptPostOptimize());
    preview.querySelector("[data-post-cancel]").addEventListener("click", () => preview.remove());
    return preview;
  }

  function runPostOptimize(findComposer = findPostComposer, buttonId = POST_ROOT_ID) {
    const composer = findComposer();
    if (!composer || state.postLoading) return;
    const text = composer.getValue().trim();
    if (!text) return;
    const preview = ensurePostPreview(composer);
    const buttonRoot = document.getElementById(buttonId);
    const button = buttonRoot && (buttonRoot.matches("button") ? buttonRoot : buttonRoot.querySelector("button"));
    const resultBox = preview.querySelector("[data-post-result]");
    const status = preview.querySelector("[data-post-status]");
    const fixes = preview.querySelector("[data-post-fixes]");
    const requestId = String(Date.now());
    let raw = "";
    let pending = false;
    state = { ...state, mode: buttonId === ARTICLE_ROOT_ID ? "article" : "post", postLoading: true, postDone: false, postStale: false, postOriginal: composer.getValue(), postRequestId: requestId };
    resultBox.textContent = "";
    fixes.textContent = "";
    status.textContent = "生成中...";
    if (button) button.textContent = "优化中...";
    composer.onInput(markPostStale);

    const port = chrome.runtime.connect({ name: "loe-stream" });
    port.postMessage({ type: "start", action: "optimizePost", text: composer.getValue(), maxLength: composer.maxLength || 0, requestId });
    port.onMessage.addListener((message) => {
      if (message.type === "chunk") {
        raw += message.text;
        if (!pending) {
          pending = true;
          setTimeout(() => {
            pending = false;
            renderPostLive(raw);
          }, 120);
        }
        return;
      }
      if (message.type === "done") {
        state.postLoading = false;
        state.postDone = true;
        resultBox.dataset.cleanText = message.result.optimized_text || "";
        renderPostDiff(message.result.optimized_text || "");
        fixes.textContent = (message.result.format_fixes || []).join("；");
        status.textContent = state.postStale ? "原文已改动" : "待确认";
        if (button) button.textContent = button.dataset.idleLabel || OPTIMIZE_LABEL;
        port.disconnect();
        return;
      }
      if (message.type === "error") {
        state.postLoading = false;
        status.textContent = message.error || "优化失败";
        if (button) button.textContent = button.dataset.idleLabel || OPTIMIZE_LABEL;
        port.disconnect();
      }
    });
  }

  function markPostStale() {
    if (!["post", "article"].includes(state.mode) || !state.postLoading && !state.postDone) return;
    state.postStale = true;
    const status = document.querySelector(".loe-post-preview [data-post-status]");
    if (status) status.textContent = "原文已改动";
  }

  function renderPostLive(raw) {
    const box = document.querySelector(".loe-post-preview [data-post-result]");
    if (!box) return;
    const text = extractJsonString(raw, "optimized_text");
    if (text) {
      box.dataset.cleanText = text;
      renderPostDiff(text);
    }
  }

  function renderPostDiff(optimized) {
    const node = document.querySelector(".loe-post-preview [data-post-result]");
    if (!node) return;
    node.innerHTML = diffHtml(state.postOriginal || "", optimized || "");
  }

  function diffHtml(oldText, newText) {
    const oldTokens = diffTokens(oldText);
    const newTokens = diffTokens(newText);
    if (oldTokens.length * newTokens.length > 90000) {
      return `<span class="loe-diff-ins">${markPunctuation(newText)}</span>`;
    }
    const dp = Array.from({ length: oldTokens.length + 1 }, () => Array(newTokens.length + 1).fill(0));
    for (let i = oldTokens.length - 1; i >= 0; i--) {
      for (let j = newTokens.length - 1; j >= 0; j--) {
        dp[i][j] = oldTokens[i] === newTokens[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    let html = "";
    while (i < oldTokens.length || j < newTokens.length) {
      if (i < oldTokens.length && j < newTokens.length && oldTokens[i] === newTokens[j]) {
        html += markPunctuation(oldTokens[i]);
        i++;
        j++;
      } else if (j < newTokens.length && (i === oldTokens.length || dp[i][j + 1] >= dp[i + 1][j])) {
        html += `<span class="loe-diff-ins">${markPunctuation(newTokens[j])}</span>`;
        j++;
      } else {
        html += `<span class="loe-diff-del">${escapeHtml(oldTokens[i])}</span>`;
        i++;
      }
    }
    return html || "暂无预览";
  }

  function diffTokens(text) {
    return String(text || "").match(/\s+|[A-Za-z0-9_@#/:.?=&%-]+|[\u4e00-\u9fa5]|[^\sA-Za-z0-9_\u4e00-\u9fa5]/g) || [];
  }

  function markPunctuation(text) {
    const escaped = escapeHtml(text);
    if (/^[\sA-Za-z0-9_@#/:=&%-]+$/.test(text)) return escaped;
    return escaped.replace(/([，。！？；：、,.!?;:()[\]{}<>《》“”‘’`"'$])/g, '<span class="loe-diff-punc">$1</span>');
  }

  function acceptPostOptimize() {
    const composer = state.mode === "article" ? findArticleComposer() : findPostComposer();
    const preview = document.querySelector(".loe-post-preview");
    if (!composer || !preview) return;
    const status = preview.querySelector("[data-post-status]");
    if (composer.getValue() !== state.postOriginal) {
      if (status) status.textContent = "原文已改动，未覆盖";
      return;
    }
    composer.setValue(postResultText(preview.querySelector("[data-post-result]")));
    preview.remove();
  }

  function postResultText(node) {
    if (!node) return "";
    const clone = node.cloneNode(true);
    clone.querySelectorAll(".loe-diff-del").forEach((item) => item.remove());
    return clone.innerText || clone.textContent || node.dataset.cleanText || "";
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
    button.title = left > 0 ? `还剩 ${formatLeft(left)}，调试时可连按 10 次 Ctrl 直接跳过` : "点击查看或收回题解算法提示";
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
})();
