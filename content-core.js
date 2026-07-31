const ROOT_ID = "loe-root";
const PROBLEM_ROOT_ID = "loe-problem-root";
const PROBLEM_POPOVER_ID = "loe-problem-popover";
const POST_ROOT_ID = "loe-post-root";
const ARTICLE_ROOT_ID = "loe-article-root";
const FRIEND_LINK_ID = "loe-friend-link";
const FILTER_ROOT_ID = "loe-filter-random-root";
const FILTER_MODAL_ID = "loe-filter-random-modal";
const FILTER_PREFS_KEY = "loe_filtered_random";
const OPTIMIZE_LABEL = "AI 优化(改为学术风格)";
const ARTICLE_OPTIMIZE_LABEL = "AI 优化\n(改为学术风格)";
const DIFFICULTIES = [
  { value: "0", label: "暂无评定" },
  { value: "1", label: "入门" },
  { value: "2", label: "普及-" },
  { value: "3", label: "普及/提高-" },
  { value: "4", label: "普及+/提高" },
  { value: "5", label: "提高+/省选-" },
  { value: "6", label: "省选/NOI-" },
  { value: "7", label: "NOI/NOI+/CTSC" }
];
const READ_MS = 5 * 60 * 1000;
const DEBUG_CTRL_LIMIT = 10;
const DEBUG_CTRL_WINDOW = 1400;
let lastUrl = "";
let state = {};
let debugShortcutBound = false;
let filterTags = [];
let filterPrefs = { difficulties: [], tagIds: [], excludeAc: true, requireAllTags: false };

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
  const filterExisting = document.getElementById(FILTER_ROOT_ID);
  const filterModalExisting = document.getElementById(FILTER_MODAL_ID);
  if (!recordId) {
    if (existing) existing.remove();
  }
  if (!pid) {
    if (problemExisting) problemExisting.remove();
    if (problemPopoverExisting) problemPopoverExisting.remove();
  }
  if (!isHome && postExisting) postExisting.remove();
  if (!isHome && filterExisting) filterExisting.remove();
  if (!isHome && filterModalExisting) filterModalExisting.remove();
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
    mountFriendLink();
    mountFilteredRandom();
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
