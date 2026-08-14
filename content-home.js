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
  if (!firstGroup || document.getElementById(FRIEND_LINK_ID) || friendBox.querySelector('a[href="https://next.tboj.cn"]')) return;
  const paragraph = document.createElement("p");
  paragraph.id = FRIEND_LINK_ID;
  const heading = document.createElement("strong");
  heading.textContent = "🐂 🍺 的oj";
  const link = document.createElement("a");
  link.href = "https://next.tboj.cn";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "ZYZOJ";
  paragraph.append(heading, document.createElement("br"), link);
  firstGroup.insertAdjacentElement("afterend", paragraph);
}

function mountFilteredRandom() {
  const target = findHomeProblemJump();
  if (!target || document.getElementById(FILTER_ROOT_ID)) return;
  const root = document.createElement("div");
  root.id = FILTER_ROOT_ID;
  root.innerHTML = `<button type="button" class="loe-filter-random-button">筛选随机题</button>`;
  const button = root.querySelector("button");
  copyNativeButtonStyle(target.random, button);
  button.classList.add("loe-filter-random-button");
  button.addEventListener("click", () => openFilteredRandomModal());
  target.row.classList.add("loe-filter-random-row");
  target.row.appendChild(root);
}

function findHomeProblemJump() {
  const random = [...document.querySelectorAll("button, a")]
    .find((node) => (node.innerText || node.textContent || "").includes("随机跳题"));
  if (!random) return null;
  let row = random.parentElement;
  while (row && row !== document.body) {
    const text = row.innerText || "";
    const rect = row.getBoundingClientRect();
    if (text.includes("跳转") && text.includes("随机跳题") && rect.height <= 120) break;
    row = row.parentElement;
  }
  return { random, row: row && row !== document.body ? row : random.parentElement };
}

async function openFilteredRandomModal() {
  const modal = ensureFilteredRandomModal();
  modal.hidden = false;
  renderFilteredRandomModal();
  try {
    await loadFilterPrefs();
    if (!filterTags.length) {
      const response = await send({ type: "filteredRandomTags" });
      if (!response.ok) throw new Error(response.error);
      filterTags = response.tags || [];
    }
    renderFilteredRandomModal();
  } catch (error) {
    setFilterStatus(error.message || String(error), true);
  }
}

function ensureFilteredRandomModal() {
  let modal = document.getElementById(FILTER_MODAL_ID);
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = FILTER_MODAL_ID;
  modal.hidden = true;
  modal.innerHTML = `
    <div class="loe-filter-backdrop" data-filter-action="close"></div>
    <div class="loe-filter-dialog">
      <div class="loe-filter-head">
        <strong>筛选随机题</strong>
        <button type="button" data-filter-action="close">×</button>
      </div>
      <section>
        <small>难度</small>
        <div class="loe-filter-chips" data-filter-difficulties></div>
      </section>
      <section>
        <div class="loe-filter-section-title">
          <small>算法</small>
          <button type="button" data-filter-action="select-all-tags">全选算法</button>
        </div>
        <input type="search" data-filter-search placeholder="搜索算法标签">
        <div class="loe-filter-chips loe-filter-tag-list" data-filter-tags></div>
      </section>
      <label class="loe-filter-check"><input type="checkbox" data-filter-exclude> 排除已通过题目</label>
      <label class="loe-filter-check"><input type="checkbox" data-filter-all> 多个算法必须同时包含</label>
      <button type="button" class="loe-filter-submit" data-filter-action="random">随机跳题</button>
      <div class="loe-filter-status" data-filter-status></div>
    </div>
  `;
  modal.addEventListener("click", onFilterModalClick);
  modal.addEventListener("input", (event) => {
    if (event.target.matches("[data-filter-search]")) renderFilterTags(event.target.value);
  });
  modal.addEventListener("wheel", trapFilterWheel, { passive: false });
  modal.addEventListener("change", (event) => {
    if (event.target.matches("[data-filter-exclude]")) filterPrefs.excludeAc = event.target.checked;
    if (event.target.matches("[data-filter-all]")) filterPrefs.requireAllTags = event.target.checked;
    saveFilterPrefs();
  });
  document.body.appendChild(modal);
  return modal;
}

async function onFilterModalClick(event) {
  const action = event.target.closest("[data-filter-action]")?.dataset.filterAction;
  if (action === "close") {
    document.getElementById(FILTER_MODAL_ID).hidden = true;
    return;
  }
  if (action === "select-all-tags") {
    if (!filterTags.length) return setFilterStatus("算法标签还没加载完", true);
    const selected = new Set(filterPrefs.tagIds || []);
    const allSelected = filterTags.every((tag) => selected.has(String(tag.id)));
    filterPrefs.tagIds = allSelected ? [] : filterTags.map((tag) => String(tag.id));
    if (!allSelected) filterPrefs.requireAllTags = false;
    renderFilteredRandomModal();
    saveFilterPrefs();
    return;
  }
  const diff = event.target.closest("[data-filter-diff]")?.dataset.filterDiff;
  if (diff !== undefined) {
    toggleFilterValue("difficulties", diff);
    renderFilterDifficulties();
    saveFilterPrefs();
    return;
  }
  const tag = event.target.closest("[data-filter-tag]")?.dataset.filterTag;
  if (tag !== undefined) {
    toggleFilterValue("tagIds", tag);
    renderFilteredRandomModal();
    saveFilterPrefs();
    return;
  }
  if (action === "random") runFilteredRandom();
}

function renderFilteredRandomModal() {
  renderFilterDifficulties();
  renderFilterTags(document.querySelector(`#${FILTER_MODAL_ID} [data-filter-search]`)?.value || "");
  const exclude = document.querySelector(`#${FILTER_MODAL_ID} [data-filter-exclude]`);
  const all = document.querySelector(`#${FILTER_MODAL_ID} [data-filter-all]`);
  const selectAll = document.querySelector(`#${FILTER_MODAL_ID} [data-filter-action="select-all-tags"]`);
  if (exclude) exclude.checked = filterPrefs.excludeAc !== false;
  if (all) all.checked = Boolean(filterPrefs.requireAllTags);
  if (selectAll) {
    const selected = new Set(filterPrefs.tagIds || []);
    selectAll.textContent = filterTags.length && filterTags.every((tag) => selected.has(String(tag.id))) ? "取消全选" : "全选算法";
  }
  setFilterStatus(filterTags.length ? "" : "正在读取洛谷算法标签...");
}

function renderFilterDifficulties() {
  const box = document.querySelector(`#${FILTER_MODAL_ID} [data-filter-difficulties]`);
  if (!box) return;
  const selected = new Set(filterPrefs.difficulties || []);
  box.innerHTML = DIFFICULTIES.map((item) => `
    <button type="button" class="loe-filter-chip loe-difficulty-${item.value}${selected.has(item.value) ? " is-active" : ""}" data-filter-diff="${item.value}">
      ${escapeHtml(item.label)}
    </button>
  `).join("");
}

function renderFilterTags(query = "") {
  const box = document.querySelector(`#${FILTER_MODAL_ID} [data-filter-tags]`);
  if (!box) return;
  const selected = new Set(filterPrefs.tagIds || []);
  const keyword = query.trim().toLowerCase();
  const tags = filterTags
    .filter((tag) => selected.has(String(tag.id)) || !keyword || tag.name.toLowerCase().includes(keyword))
    .slice(0, 80);
  box.innerHTML = tags.map((tag) => `
    <button type="button" class="loe-filter-chip${selected.has(String(tag.id)) ? " is-active" : ""}" data-filter-tag="${escapeHtml(tag.id)}">
      ${escapeHtml(tag.name)}
    </button>
  `).join("") || `<span class="loe-filter-empty">没有匹配的算法标签</span>`;
}

async function runFilteredRandom() {
  const modal = document.getElementById(FILTER_MODAL_ID);
  const submit = modal && modal.querySelector("[data-filter-action='random']");
  if (!filterPrefs.difficulties.length) return setFilterStatus("先选择至少一个难度", true);
  if (!filterPrefs.tagIds.length) return setFilterStatus("先选择至少一个算法标签", true);
  if (submit) {
    submit.disabled = true;
    submit.textContent = "筛选中...";
  }
  setFilterStatus("正在从洛谷题库筛选...");
  await saveFilterPrefs();
  const response = await send({ type: "filteredRandomProblem", filters: filterPrefs });
  if (submit) {
    submit.disabled = false;
    submit.textContent = "随机跳题";
  }
  if (!response.ok) return setFilterStatus(response.error, true);
  location.href = `/problem/${response.problem.pid}`;
}

function toggleFilterValue(key, value) {
  const set = new Set((filterPrefs[key] || []).map(String));
  set.has(value) ? set.delete(value) : set.add(value);
  filterPrefs[key] = [...set];
}

function trapFilterWheel(event) {
  const scroller = event.target.closest(".loe-filter-tag-list, .loe-filter-dialog");
  if (!scroller) return event.preventDefault();
  const canScroll = scroller.scrollHeight > scroller.clientHeight;
  const atTop = scroller.scrollTop <= 0;
  const atBottom = Math.ceil(scroller.scrollTop + scroller.clientHeight) >= scroller.scrollHeight;
  if (!canScroll || event.deltaY < 0 && atTop || event.deltaY > 0 && atBottom) event.preventDefault();
  event.stopPropagation();
}

async function loadFilterPrefs() {
  const data = await chrome.storage.local.get(FILTER_PREFS_KEY);
  const saved = data[FILTER_PREFS_KEY] || {};
  filterPrefs = {
    difficulties: Array.isArray(saved.difficulties) ? saved.difficulties.map(String) : [],
    tagIds: Array.isArray(saved.tagIds) ? saved.tagIds.map(String) : [],
    excludeAc: saved.excludeAc !== false,
    requireAllTags: Boolean(saved.requireAllTags)
  };
}

function saveFilterPrefs() {
  return chrome.storage.local.set({ [FILTER_PREFS_KEY]: filterPrefs });
}

function setFilterStatus(text, isError = false) {
  const node = document.querySelector(`#${FILTER_MODAL_ID} [data-filter-status]`);
  if (!node) return;
  node.textContent = text || "";
  node.classList.toggle("loe-error-text", Boolean(isError));
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
