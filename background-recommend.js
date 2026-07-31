async function findSimilarProblems(context) {
  const difficulty = context.problem.difficulty;
  if (difficulty === undefined || difficulty === null) return [];
  const tags = uniq([...(context.problem.tags || []), ...inferAlgorithmTags(context)]);
  const keywords = uniq([...tags.slice(0, 5), ...relatedContestKeywords(context), ...CONTEST_KEYWORDS]);

  const [acProblems, recommended] = await Promise.all([
    getArray(STORAGE_KEYS.acProblems),
    getArray(STORAGE_KEYS.recommended)
  ]);
  const blocked = new Set([context.pid, ...acProblems, ...recommended.slice(-30).map((item) => item.pid || item)]);
  const searches = keywords.slice(0, 18).flatMap((keyword) => [
    listProblems({ difficulty, keyword, page: 1 }),
    listProblems({ difficulty, keyword, page: 2 })
  ]);
  const pages = await Promise.allSettled(searches);

  const problems = pages.flatMap((page) => {
    if (page.status !== "fulfilled") return [];
    return extractProblemList(page.value);
  });

  return uniqByPid(problems).filter((problem) => {
    const item = normalizeProblem(problem, difficulty);
    const pid = item.pid;
    const text = problemSearchText(item);
    return pid && !blocked.has(pid) &&
      String(item.difficulty) === String(difficulty) &&
      (commonTags(tags, item.tags).length || CONTEST_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase())));
  }).map((problem) => normalizeProblem(problem, difficulty))
    .sort((a, b) => scoreCandidate(b, tags) - scoreCandidate(a, tags))
    .slice(0, 12)
    .map((problem) => ({
      pid: problem.pid,
      title: problem.title,
      difficulty,
      tags: problem.tags,
      source: problem.source,
      reason: recommendationReason(problem, tags)
    }));
}

function listProblems({ difficulty, keyword, tag, page }) {
  const params = new URLSearchParams();
  if (difficulty !== undefined && difficulty !== null && difficulty !== "") params.set("difficulty", difficulty);
  if (keyword) params.set("keyword", keyword);
  if (tag !== undefined && tag !== null && tag !== "") params.set("tag", tag);
  if (page) params.set("page", page);
  return luoguFetch(`/problem/list?${params.toString()}`);
}

async function getAlgorithmTags() {
  if (algorithmTagsCache) return algorithmTagsCache;
  const data = await luoguFetch("/_lfe/tags/zh-CN");
  algorithmTagsCache = (data.tags || [])
    .filter((tag) => tag && Number(tag.id) > 0 && Number(tag.type) === 2)
    .map((tag) => ({ id: String(tag.id), name: String(tag.name || tag.id), rank: algorithmTagRank(tag) }))
    .sort((a, b) => a.rank - b.rank || Number(a.id) - Number(b.id) || a.name.localeCompare(b.name, "zh-CN"));
  return algorithmTagsCache;
}

async function getTagNameMap() {
  if (tagNameCache) return tagNameCache;
  const data = await luoguFetch("/_lfe/tags/zh-CN");
  tagNameCache = new Map((data.tags || [])
    .filter((tag) => tag && tag.id !== undefined && tag.id !== null)
    .map((tag) => [String(tag.id), String(tag.name || tag.id)]));
  return tagNameCache;
}

function algorithmTagRank(tag) {
  const name = String(tag.name || "");
  const rules = [
    [/语言入门|顺序结构|分支结构|循环结构|^数组$|函数与递归|字符串（入门）/, 0],
    [/^模拟$|^枚举$|^排序$|^递归$|^递推$|^前缀和$|^差分$|^二分$|双指针|高精度|STL|^字符串$/, 10],
    [/^贪心$|^搜索$|DFS|BFS|剪枝|记忆化|广度优先|深度优先/, 20],
    [/数学|数论|素数|gcd|进制|组合|排列|Fibonacci|Catalan|概率|期望/, 30],
    [/动态规划|DP|背包|线性 DP|区间 DP|树形 DP|状压/, 40],
    [/数据结构|栈|队列|并查集|堆|单调|ST 表|哈希|树状数组|线段树|平衡树|树形数据结构|字典树/, 50],
    [/图论|图遍历|拓扑|最短路|生成树|二分图|网络流|Tarjan|连通|LCA|树论|树链剖分|差分约束/, 60],
    [/KMP|Trie|AC 自动机|后缀|Manacher|PAM|Z 函数/, 70],
    [/计算几何|极角排序|矩阵|线性代数|多项式|FFT|NTT|博弈|SG 函数|生成函数|模拟退火|反悔贪心|组合优化|斜率|cdq|莫队|分块|可持久化/, 80]
  ];
  return (rules.find((rule) => rule[0].test(name)) || [null, 100])[1];
}

async function findFilteredRandomProblem(filters) {
  const difficulties = cleanFilterIds(filters.difficulties);
  const tagIds = cleanFilterIds(filters.tagIds);
  if (!difficulties.length) throw new Error("请选择至少一个难度");
  if (!tagIds.length) throw new Error("请选择至少一个算法标签");

  const requireAllTags = Boolean(filters.requireAllTags);
  if (requireAllTags && tagIds.length > MAX_FILTER_ALL_TAGS) {
    throw new Error(`同时包含模式最多选择 ${MAX_FILTER_ALL_TAGS} 个算法标签；全选时请关闭“多个算法必须同时包含”。`);
  }
  const selectedTagIds = requireAllTags ? tagIds : [randomItem(tagIds)];
  const [tags, acProblems] = await Promise.all([
    getAlgorithmTags(),
    filters.excludeAc === false ? [] : getArray(STORAGE_KEYS.acProblems)
  ]);
  const tagMap = new Map(tags.map((tag) => [tag.id, tag.name]));
  const blocked = new Set(acProblems);
  const pages = await Promise.allSettled(difficulties.flatMap((difficulty) =>
    selectedTagIds.flatMap((tag) => [1, 2, 3].map((page) => listProblems({ difficulty, tag, page })))
  ));
  const candidates = uniqByPid(pages.flatMap((page) =>
    page.status === "fulfilled" ? extractProblemList(page.value) : []
  )).filter((problem) => {
    const pid = problem && (problem.pid || problem.id);
    const problemTags = problemTagIds(problem);
    return pid &&
      !blocked.has(pid) &&
      difficulties.includes(String(problem.difficulty)) &&
      (requireAllTags ? tagIds.every((tag) => problemTags.includes(tag)) : problemTags.includes(selectedTagIds[0]));
  });
  if (!candidates.length) throw new Error("没有找到符合条件的题目，可以减少算法标签或放宽难度。");
  return normalizeFilteredProblem(randomItem(candidates), tagMap, selectedTagIds, requireAllTags, candidates.length);
}

function cleanFilterIds(values) {
  return uniq((Array.isArray(values) ? values : []).map(String).filter((value) => /^-?\d+$/.test(value)));
}

function problemTagIds(problem) {
  if (!problem || !Array.isArray(problem.tags)) return [];
  return problem.tags
    .map((tag) => tag && typeof tag === "object" ? tag.id : tag)
    .filter((tag) => tag !== undefined && tag !== null && tag !== "")
    .map(String);
}

function normalizeFilteredProblem(problem, tagMap, selectedTagIds, requireAllTags, count) {
  const tagIds = problemTagIds(problem);
  return {
    pid: problem.pid || problem.id || "",
    title: problem.title || problem.name || "",
    difficulty: problem.difficulty,
    tags: tagIds.map((tag) => tagMap.get(tag) || tag),
    selectedTags: selectedTagIds.map((tag) => tagMap.get(tag) || tag),
    requireAllTags,
    candidateCount: count
  };
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function extractProblemList(page) {
  const direct = pick(page, [
    "currentData.problems.result",
    "currentData.problems",
    "data.problems.result",
    "data.problems",
    "problems.result",
    "problems"
  ]);
  if (Array.isArray(direct)) return direct;
  return findProblemArrays(page)[0] || [];
}

function findProblemArrays(value, found = []) {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    if (value.some((item) => item && typeof item === "object" && (item.pid || item.id) && (item.title || item.name))) found.push(value);
    value.forEach((item) => findProblemArrays(item, found));
    return found;
  }
  Object.values(value).forEach((item) => findProblemArrays(item, found));
  return found;
}

function normalizeProblem(problem, fallbackDifficulty) {
  const source = readableSource(problem.source || problem.contest || problem.provider || problem.origin);
  const tags = uniq([...extractTags(problem.tags), ...inferAlgorithmTags({ problem, solutions: [] })]);
  return {
    pid: problem.pid || problem.id || "",
    title: problem.title || problem.name || "",
    difficulty: problem.difficulty ?? fallbackDifficulty,
    tags,
    source
  };
}

function readableSource(value) {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(readableSource).filter(Boolean).join("、");
  if (typeof value === "object") {
    return readableSource(value.name || value.title || value.source || value.contest || value.provider || value.origin || value.id);
  }
  return "";
}

function inferAlgorithmTags(context) {
  const problem = context.problem || {};
  const text = [
    problem.title,
    problem.name,
    problem.description,
    problem.content && JSON.stringify(problem.content),
    context.sourceCode,
    ...(context.solutions || []).map((solution) => `${solution.title || ""} ${solution.content || ""}`)
  ].filter(Boolean).join("\n");
  return ALGORITHM_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag);
}

function relatedContestKeywords(context) {
  const text = problemSearchText({
    title: context.title,
    source: context.problem && context.problem.source || ""
  });
  return CONTEST_KEYWORDS.filter((keyword) => text.includes(keyword.toLowerCase()));
}

function problemSearchText(problem) {
  return `${problem.pid || ""} ${problem.title || ""} ${problem.source || ""} ${(problem.tags || []).join(" ")}`.toLowerCase();
}

function scoreCandidate(problem, tags) {
  const text = problemSearchText(problem);
  return commonTags(tags, problem.tags).length * 10 +
    (CONTEST_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase())) ? 5 : 0);
}

function recommendationReason(problem, tags) {
  const overlap = commonTags(tags, problem.tags);
  const source = problem.source || CONTEST_KEYWORDS.find((keyword) => problemSearchText(problem).includes(keyword.toLowerCase())) || "";
  return [
    overlap.length ? `算法标签：${overlap.join("、")}` : "",
    source ? `正规比赛来源：${source}` : "",
    "同洛谷评级"
  ].filter(Boolean).join("；");
}

function detectOiContest(record) {
  const contest = record.contest || record.contestData || record.contestMeta || {};
  const values = [
    contest.ruleType,
    contest.rule,
    contest.type,
    contest.contestType,
    contest.scoreType,
    contest.name
  ].map((value) => String(value || ""));
  return values.some((value) => /\b(?:OI|IOI)\b|OI赛制|oi赛制/.test(value));
}

function uniqByPid(problems) {
  const seen = new Set();
  return problems.filter((problem) => {
    const pid = problem && (problem.pid || problem.id);
    if (!pid || seen.has(pid)) return false;
    seen.add(pid);
    return true;
  });
}

function commonTags(a, b) {
  return a.filter((item) => b.includes(item));
}

function buildRecommendationResult(candidates) {
  if (candidates.length === 0) {
    return { confidence: 100, problems: [], note: "同评级、同类标签或正规比赛来源候选题不足，没有编造推荐。" };
  }
  return {
    confidence: 100,
    problems: candidates.slice(0, 5).map((problem) => ({
      ...problem,
      reason: `同评级，标签/来源匹配：${problem.reason || "未知"}`
    })),
    note: "使用洛谷题库接口按同评级、算法标签和正规比赛来源推荐。"
  };
}
