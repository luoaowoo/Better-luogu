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

for (const file of ["background.js", "content.js", "options.js", "styles.css", "options.html"]) {
  assert(fs.existsSync(file), `${file} missing`);
}

for (const file of ["background.js", "content.js", "options.js"]) {
  new vm.Script(fs.readFileSync(file, "utf8"), { filename: file });
}

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
vm.runInContext(fs.readFileSync("background.js", "utf8"), backgroundContext);
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

console.log("selfcheck ok");
