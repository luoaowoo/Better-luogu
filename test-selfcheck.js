const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));

assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ["storage", "tabs"]);
assert(manifest.host_permissions.includes("https://www.luogu.com.cn/*"));
assert(manifest.host_permissions.includes("https://luogu.com.cn/*"));
assert(manifest.host_permissions.includes("https://*/*"));
assert.equal(manifest.background.service_worker, "background.js");
assert.equal(manifest.options_page, "options.html");
assert.equal(manifest.action.default_popup, "options.html");

const backgroundFiles = [
  "background-common.js",
  "background-luogu.js",
  "background-ai.js",
  "background-weekly.js",
  "background-recommend.js",
  "background-storage.js",
  "background.js"
];
const contentFiles = [
  "content-core.js",
  "content-utils.js",
  "content-home.js",
  "content-record.js",
  "content-problem.js",
  "content-scrape.js",
  "content.js"
];
assert.deepEqual(manifest.content_scripts[0].js, contentFiles);

for (const file of [...backgroundFiles, ...contentFiles, "options.js", "styles.css", "options.html"]) {
  assert(fs.existsSync(file), `${file} missing`);
}

for (const file of [...backgroundFiles, ...contentFiles, "options.js"]) {
  new vm.Script(fs.readFileSync(file, "utf8"), { filename: file });
}

const optionsHtml = fs.readFileSync("options.html", "utf8");
const optionsSource = fs.readFileSync("options.js", "utf8");
assert(optionsHtml.includes("本周总结"));
assert(!optionsHtml.includes("错误分析"));
assert(optionsSource.includes("weeklySummary"));
assert(optionsSource.includes("scrapeActiveTabRecords"));
assert(optionsSource.includes("loadWeeklyCache"));
assert(optionsSource.includes("题目推荐"));

const backgroundContext = {
  chrome: {
    runtime: {
      onMessage: { addListener() {} },
      onConnect: { addListener() {} }
    }
  },
  console,
  URL,
  TextDecoder
};
vm.createContext(backgroundContext);
for (const file of backgroundFiles) {
  vm.runInContext(fs.readFileSync(file, "utf8"), backgroundContext, { filename: file });
}
const backgroundSource = backgroundFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");

const importScriptsContext = {
  chrome: backgroundContext.chrome,
  console,
  URL,
  TextDecoder
};
vm.createContext(importScriptsContext);
importScriptsContext.importScripts = (...files) => {
  for (const file of files) {
    vm.runInContext(fs.readFileSync(file, "utf8"), importScriptsContext, { filename: file });
  }
};
vm.runInContext(fs.readFileSync("background.js", "utf8"), importScriptsContext, { filename: "background.js" });
const htmlData = backgroundContext.parseLuoguHtmlData('<script id="lentille-context" type="application/json">{"data":{"problem":{"content":{"description":"题面"}}}}</script>');
assert.equal(htmlData.data.problem.content.description, "题面");
const solutions = backgroundContext.extractSolutions({ data: { articles: [{ title: "题解一", content: "二分答案" }] } });
assert.equal(solutions[0].title, "题解一");
assert.equal(solutions[0].content, "二分答案");
assert(backgroundContext.compactSolutionText("前言".repeat(400) + "动态规划思路：状态转移").includes("动态规划"));
assert(!backgroundContext.compactSolutionText("前言".repeat(400) + "动态规划思路：状态转移").includes("题解摘录"));
assert.equal(backgroundContext.cleanUncertainPoints(["题解摘要被截断", "复杂度没有直接给出"]).length, 1);
const review = backgroundContext.normalizeReview({ confidence: 1, alternative_algorithms: [{ name: "DP", complexity: "" }] }, { sourceCode: "for(int i=0;i<n;i++){}", problem: { description: "状态转移" }, solutions: [] });
assert(review.alternative_algorithms[0].complexity.includes("状态数"));
const statement = backgroundContext.extractProblemStatement({ content: { description: "描述".repeat(2000), hint: "提示".repeat(2000) + "100% 数据范围 n<=100000" } });
assert(statement.includes("100% 数据范围 n<=100000"));
assert(backgroundContext.commonSystemPrompt().includes("算法竞赛"));
assert(backgroundContext.inferAlgorithmTags({ problem: { description: "用线段树维护区间最大值" }, solutions: [] }).includes("数据结构"));
assert(backgroundContext.recommendationReason({ title: "[CSP-S 2020] 函数调用", tags: ["图论"], source: "" }, ["图论"]).includes("CSP-S"));
assert.equal(backgroundContext.cleanDiagnosisNotes(["不要把本次归为 TLE", "先修读入解析"]).length, 1);
const localRecommendations = backgroundContext.buildRecommendationResult([{ pid: "P1000", title: "A+B", difficulty: 1, tags: ["模拟"], reason: "同评级" }]);
assert.equal(localRecommendations.problems.length, 1);
assert(localRecommendations.note.includes("洛谷题库接口"));
assert.deepEqual(backgroundContext.cleanFilterIds(["2", "x", "2", ""]), ["2"]);
assert.deepEqual(backgroundContext.problemTagIds({ tags: [3, { id: 45 }, null] }), ["3", "45"]);
assert(backgroundContext.algorithmTagRank({ name: "模拟" }) < backgroundContext.algorithmTagRank({ name: "线段树" }));
assert(backgroundContext.algorithmTagRank({ name: "线段树" }) < backgroundContext.algorithmTagRank({ name: "网络流" }));
assert(backgroundContext.algorithmTagRank({ name: "数组" }) < backgroundContext.algorithmTagRank({ name: "树状数组" }));
assert(backgroundContext.algorithmTagRank({ name: "模拟" }) < backgroundContext.algorithmTagRank({ name: "模拟退火" }));
assert.equal(backgroundContext.normalizeFilteredProblem({ pid: "P1", name: "T", difficulty: 2, tags: [3] }, new Map([["3", "动态规划 DP"]]), ["3"], false, 7).selectedTags[0], "动态规划 DP");
assert.equal(backgroundContext.readableSource({ name: "CSP-S 2024" }), "CSP-S 2024");
assert.equal(backgroundContext.normalizeProblem({ pid: "P1", title: "T", difficulty: 3, source: { name: "NOIP" }, tags: [{ name: "数学" }] }, 3).source, "NOIP");
const reviewPayload = backgroundContext.buildReviewPayload({
  recordId: "R1",
  pid: "P1",
  title: "T",
  language: "C++",
  sourceCode: "int main(){}".repeat(1000),
  problem: { description: "题面".repeat(2000) + "数据范围 n<=100000", tags: ["动态规划"] },
  solutions: Array.from({ length: 8 }, (_, i) => ({ title: `题解${i}`, content: "复杂度 O(n)".repeat(200) }))
});
assert(reviewPayload.accepted_code.length <= 4500);
assert(reviewPayload.editorial_extracts.length <= 4);
assert(reviewPayload.problem.statement.length <= 2600);
assert(backgroundContext.buildHintMessages({ editorial_extracts: [{ content: "题解写明使用动态规划" }] })[1].content.includes("算法方向必须来自题解摘录"));
assert.equal(backgroundContext.normalizeHint({ confidence: 80, algorithm: "DP", hints: [1, 2, 3, 4], implementation_notes: [1, 2, 3, 4], evidence: [1, 2, 3, 4] }).hints.length, 3);
assert(backgroundContext.buildWeeklySummaryMessages({ totals: { submissions: 1 }, problems: [] })[0].content.includes("训练复盘"));
assert.equal(backgroundContext.normalizeWeeklySummary({ overall_summary: "ok", strengths: [1, 2, 3, 4, 5] }).strengths.length, 4);
assert(backgroundContext.emptyWeeklySummary().overall_summary.includes("最近 7 天"));
assert.equal(backgroundContext.difficultyLabel(4), "普及+/提高");
const mergedWeekly = backgroundContext.mergeWeeklyRecords([
  { recordId: "1", pid: "P1000", title: "P1000", time: 1000, tags: [] },
  { recordId: "1", pid: "P1000", title: "A+B", difficulty: 1, tags: ["模拟"], time: 2000 }
]);
assert.equal(mergedWeekly.length, 1);
assert.equal(mergedWeekly[0].title, "A+B");
assert.deepEqual(backgroundContext.dedupeByKey([{ recordId: "1" }, { recordId: "1" }], backgroundContext.mistakeKey).length, 1);
assert.deepEqual(backgroundContext.normalizeWeeklyTags(["82", "DP"], new Map([["82", "动态规划"]])), ["动态规划", "DP"]);
assert(backgroundSource.includes("getTagNameMap"));
assert(backgroundContext.timeOrNull("1720000000") > 0);
assert.equal(backgroundContext.extractRecordList({ currentData: { records: { result: [{ problem: { pid: "P1000" }, score: 100, status: 12, time: 1720000000 }] } } }).length, 1);
assert.equal(backgroundContext.extractRecordList({ data: { records: { records: [{ problem: { pid: "P1001" }, score: 0, status: 6, time: 1720000000 }] } } }).length, 1);
assert.equal(backgroundContext.normalizeRecordListItem({ problem: { pid: "P1000", title: "A+B" }, score: 100, status: 12, time: 1720000000 }).isFullScore, true);

const contentSource = contentFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
const contentContext = {
  chrome: {
    runtime: {
      sendMessage() { return Promise.resolve({ ok: true }); },
      connect() { return { onMessage: { addListener() {} }, postMessage() {}, disconnect() {} }; },
      onMessage: { addListener() {} }
    },
    storage: { local: { get() { return Promise.resolve({}); }, set() { return Promise.resolve(); } } }
  },
  document: {
    body: { innerText: "" },
    documentElement: { innerHTML: "" },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  },
  location: { href: "https://www.luogu.com.cn/discuss", pathname: "/discuss" },
  window: { addEventListener() {}, innerWidth: 1200, innerHeight: 800, scrollX: 0, scrollY: 0 },
  setInterval() {},
  Date,
  console
};
vm.createContext(contentContext);
for (const file of contentFiles) {
  vm.runInContext(fs.readFileSync(file, "utf8"), contentContext, { filename: file });
}
assert(contentSource.includes("scrapeWeeklyRecords"));
assert(contentSource.includes("parseRecordListTime"));
assert(contentSource.includes("scrapeLuoguUser"));
assert(contentSource.includes("findUserId"));
assert(backgroundSource.includes("WEEKLY_CACHE_TTL"));
assert(contentSource.includes("button.disabled = false;"));
assert(contentSource.includes('button.textContent = button.matches(":hover")'));
assert(contentSource.includes("if (state.hintLoading)"));
assert(contentSource.includes("showProblemPopover();"));
assert(contentSource.includes("dataset.postOptimize"));
assert(contentSource.includes("mountArticleOptimizer"));
assert(contentSource.includes("mountFriendLink"));
assert(contentSource.includes("mountFilteredRandom"));
assert(contentSource.includes("filteredRandomProblem"));
assert(contentSource.includes("select-all-tags"));
assert(contentSource.includes("allSelected ? [] : filterTags.map"));
assert(contentSource.includes("if (!allSelected) filterPrefs.requireAllTags = false"));
assert(contentSource.includes("trapFilterWheel"));
assert(contentSource.includes("取消全选"));
assert(contentSource.includes("多个算法必须同时包含"));
assert(!contentSource.includes("filterTags.indexOf(a) - filterTags.indexOf(b)"));
assert(!contentSource.includes("已选择全部"));
assert(backgroundSource.includes("MAX_FILTER_ALL_TAGS = 8"));
assert(contentSource.includes("https://next.tboi.cn"));
assert(contentSource.includes("🐂 🍺 的oj"));
assert(contentSource.includes("findArticleEditor"));
assert(contentSource.includes('location.pathname === "/article/_new"'));
assert(contentSource.includes('.cm-editor .cm-content[contenteditable="true"]'));
assert(contentSource.includes('document.execCommand("insertText"'));
assert(contentSource.includes('ARTICLE_OPTIMIZE_LABEL = "AI 优化\\n(改为学术风格)"'));
assert(contentSource.includes("CodeMirror"));
assert(contentSource.includes('composer.getValue() !== state.postOriginal'));
assert(contentSource.includes('["post", "article"].includes(state.mode)'));
assert(contentSource.includes("function diffHtml"));
assert(contentSource.includes("loe-diff-del"));
assert(contentSource.includes("loe-diff-ins"));
assert(contentSource.includes('contenteditable="true"'));
assert(contentSource.includes("function postResultText"));
assert(backgroundContext.buildPostOptimizeMessages({ text: "P1000 用dp 复杂度O(nlogn)", maxLength: 200 })[0].content.includes("更清楚、精炼、有逻辑"));
assert(backgroundContext.buildPostOptimizeMessages({ text: "我就是我想的就是你好", maxLength: 200 })[0].content.includes("删冗余口癖"));
assert(backgroundContext.buildPostOptimizeMessages({ text: "a b c", maxLength: 200 })[0].content.includes("Markdown 编号列表"));
assert(backgroundContext.buildPostOptimizeMessages({ text: "啊啊啊", maxLength: 200 })[0].content.includes("不要删除“啊啊啊”"));
assert.equal(backgroundContext.normalizePostOptimize({ optimized_text: "abcdef", format_fixes: ["a", "b", "c", "d", "e"] }, { maxLength: 3 }).optimized_text, "abc");
assert.equal(backgroundContext.normalizePostOptimize({ optimized_text: "这是一大段完全新增的解释内容解释内容解释内容", format_fixes: [] }, { text: "你好", maxLength: 200 }).optimized_text, "你好");
assert.equal(backgroundContext.cleanRepeatedText("就是就是你好啊啊啊"), "就是你好啊啊啊");
assert(backgroundContext.postOptimizeMaxTokens("你好") <= 60);

console.log("selfcheck ok");
