const LUOGU = "https://www.luogu.com.cn";
const STORAGE_KEYS = {
  settings: "loe_settings",
  mistakes: "loe_mistakes",
  acProblems: "loe_ac_problems",
  recommended: "loe_recommended",
  readStarts: "loe_read_starts",
  trainingHistory: "loe_training_history",
  weeklySummaryCache: "loe_weekly_summary_cache"
};

const DEFAULT_SETTINGS = {
  baseURL: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  manualOnly: true
};
const CONTEST_KEYWORDS = ["CSP-J", "CSP-S", "CSP", "NOIP", "NOI", "IOI", "CCPC", "ICPC", "APIO", "CTSC", "WC", "省选"];
const ALGORITHM_PATTERNS = [
  ["动态规划", /动态规划|DP|状态|转移|背包|区间 DP|树形 DP|数位 DP/i],
  ["图论", /图论|最短路|Dijkstra|Floyd|SPFA|拓扑|强连通|tarjan|割点|割边|二分图|网络流|最小生成树/i],
  ["数据结构", /线段树|树状数组|并查集|堆|优先队列|ST 表|单调栈|单调队列|平衡树|主席树/i],
  ["搜索", /搜索|DFS|BFS|回溯|剪枝|双向搜索|IDA\*/i],
  ["贪心", /贪心|交换论证|局部最优/i],
  ["二分", /二分|二分答案|三分/i],
  ["数学", /数学|数论|组合|概率|期望|gcd|质数|素数|逆元|同余|矩阵|博弈/i],
  ["字符串", /字符串|KMP|Trie|AC 自动机|后缀数组|哈希|回文|Manacher/i],
  ["树", /树|LCA|树链剖分|重心|直径|DFS 序|树上/i],
  ["模拟", /模拟|细节|枚举|前缀和|差分|离散化|排序/i]
];
const ACTIVE_STREAMS = new Set();
const MAX_FILTER_ALL_TAGS = 8;
const WEEKLY_CACHE_TTL = 5 * 60 * 1000;
let algorithmTagsCache = null;
let tagNameCache = null;
const problemMetaCache = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: error.message || String(error) });
  });
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "loe-stream") return;
  port.onMessage.addListener((message) => {
    handleStreamMessage(port, message);
  });
});

async function handleMessage(message) {
  if (!message || !message.type) return { ok: false, error: "未知请求" };

  if (message.type === "getSettings") {
    return { ok: true, settings: await getSettings() };
  }
  if (message.type === "saveSettings") {
    await chrome.storage.local.set({ [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, ...message.settings } });
    return { ok: true };
  }
  if (message.type === "getContext") {
    const context = await collectContext(message.recordId);
    await rememberTrainingRecord(context);
    return { ok: true, context };
  }
  if (message.type === "markProblemRead") {
    return { ok: true, startedAt: await markProblemRead(message.pid) };
  }
  if (message.type === "forceProblemRead") {
    return { ok: true, startedAt: await forceProblemRead(message.pid) };
  }
  if (message.type === "diagnose") {
    const context = await collectContext(message.recordId);
    const result = await askAI(buildDiagnosisMessages(context));
    return { ok: true, context, result: normalizeDiagnosis(result, context) };
  }
  if (message.type === "review") {
    const context = await collectContext(message.recordId);
    const result = await askAI(buildReviewMessages(context));
    await rememberAc(context);
    return { ok: true, context, result: normalizeReview(result, context) };
  }
  if (message.type === "recommend") {
    const context = await collectContext(message.recordId);
    const candidates = await findSimilarProblems(context);
    const result = buildRecommendationResult(candidates);
    await rememberRecommendations(result.problems || []);
    return { ok: true, context, result };
  }
  if (message.type === "saveMistake") {
    return { ok: true, ...(await saveMistake(message.record)) };
  }
  if (message.type === "listMistakes") {
    return { ok: true, mistakes: dedupeByKey(await getArray(STORAGE_KEYS.mistakes), mistakeKey) };
  }
  if (message.type === "filteredRandomTags") {
    return { ok: true, tags: await getAlgorithmTags() };
  }
  if (message.type === "filteredRandomProblem") {
    return { ok: true, problem: await findFilteredRandomProblem(message.filters || {}) };
  }
  if (message.type === "getWeeklySummaryCache") {
    return { ok: true, ...(await getWeeklySummaryCache()) };
  }
  if (message.type === "weeklySummary") {
    const cached = await getWeeklySummaryCache();
    if (cached.cached) return { ok: true, ...cached };
    const data = await collectWeeklyTrainingData(message.pageRecords || [], message.userId);
    if (!data.totals.submissions && !data.totals.saved_mistakes) return { ok: true, data, result: emptyWeeklySummary() };
    const result = await askAI(buildWeeklySummaryMessages(data));
    await saveWeeklySummaryCache(data, result);
    return { ok: true, data, result: normalizeWeeklySummary(result, data) };
  }

  return { ok: false, error: "不支持的请求类型" };
}

async function handleStreamMessage(port, message) {
  const key = message && `${message.recordId || message.pid || message.requestId || "global"}:${message.action}`;
  try {
    if (!message || message.type !== "start") return;
    if (ACTIVE_STREAMS.has(key)) throw new Error("同一提交的相同分析正在进行中，请等待当前输出完成");
    ACTIVE_STREAMS.add(key);
    if (message.action === "optimizePost") {
      const streamed = await askAIStream(buildPostOptimizeMessages(message), (text) => {
        port.postMessage({ type: "chunk", text });
      }, { maxTokens: postOptimizeMaxTokens(message.text), idleMs: 4000 });
      port.postMessage({ type: "done", result: normalizePostOptimize(streamed.result, message), usage: streamed.usage });
      return;
    }
    const isReview = message.action === "review";
    const isHint = message.action === "hint";
    const context = isHint ? await collectProblemHintContext(message.pid) : await collectContext(message.recordId);
    if (isHint) await ensureReadEnough(message.pid);
    const messages = isHint ? buildHintMessages(context) : isReview ? buildReviewMessages(context) : buildDiagnosisMessages(context);
    const streamed = await askAIStream(messages, (text) => {
      port.postMessage({ type: "chunk", text });
    }, { maxTokens: isHint ? 700 : isReview ? 900 : 1500 });
    const result = isHint
      ? normalizeHint(streamed.result)
      : message.action === "review"
        ? normalizeReview(streamed.result, context)
        : normalizeDiagnosis(streamed.result, context);
    result.usage = streamed.usage;
    if (message.action === "review") await rememberAc(context);
    port.postMessage({ type: "done", context, result, usage: streamed.usage });
  } catch (error) {
    port.postMessage({ type: "error", error: error.message || String(error) });
  } finally {
    if (key) ACTIVE_STREAMS.delete(key);
  }
}

async function getSettings() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.settings] || {}) };
}

async function getArray(key) {
  const data = await chrome.storage.local.get(key);
  return Array.isArray(data[key]) ? data[key] : [];
}

async function luoguFetch(path) {
  const url = new URL(path, LUOGU);
  url.searchParams.set("_contentOnly", "1");
  const response = await fetch(url.toString(), {
    credentials: "include",
    headers: {
      "x-luogu-type": "content-only",
      "x-lentille-request": "content-only",
      "accept": "application/json, text/plain, */*"
    }
  });
  if (!response.ok) throw new Error(`洛谷请求失败：${response.status}`);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    if (/^\s*</.test(text)) {
      const data = parseLuoguHtmlData(text);
      if (data) return data;
      throw new Error("洛谷接口返回了网页，不是数据接口");
    }
    const match = text.match(/JSON\.parse\("(.+?)"\)/);
    if (!match) throw new Error("洛谷返回内容无法解析");
    return JSON.parse(match[1].replace(/\\"/g, "\""));
  }
}

async function collectContext(recordId) {
  if (!recordId) throw new Error("缺少提交记录 ID");
  const recordPage = await luoguFetch(`/record/${recordId}`);
  const record = pick(recordPage, ["currentData.record", "record", "data.record"]) || {};
  const pid = pick(record, ["problem.pid", "problemID", "pid"]) || findPid(recordPage);
  if (!pid) throw new Error("无法从提交记录识别题号");

  const [problemPage, solutionPage] = await Promise.allSettled([
    luoguFetch(`/problem/${pid}`),
    luoguFetch(`/problem/solution/${pid}`)
  ]);
  const problem = problemPage.status === "fulfilled"
    ? (pick(problemPage.value, ["currentData.problem", "problem", "data.problem"]) || {})
    : {};
  const solutions = solutionPage.status === "fulfilled" ? extractSolutions(solutionPage.value) : [];

  const tags = uniq([...extractTags(problem.tags), ...extractTags(record.problem && record.problem.tags)]);
  const difficulty = problem.difficulty ?? pick(record, ["problem.difficulty"]);
  const score = numberOrNull(record.score ?? record.totalScore);
  const fullScore = numberOrNull(problem.fullScore ?? pick(record, ["problem.fullScore"])) ?? 100;
  const statusText = String(record.statusText || record.status || record.result || "");
  const isFullScore = score !== null ? score >= fullScore : /Accepted|AC|通过/.test(statusText);
  const isOiContest = detectOiContest(record);
  const judgeSummary = summarizeJudgeInfo(record, { score, fullScore, statusText });
  const submittedAt = extractSubmitTime(record);

  return {
    recordId,
    pid,
    title: problem.title || problem.name || pick(problem, ["content.name", "contenu.name"]) || pick(record, ["problem.title", "problem.name"]) || pid,
    score,
    fullScore,
    isFullScore,
    isOiContest,
    language: record.language || record.lang || "",
    statusText,
    submittedAt,
    sourceCode: truncate(record.sourceCode || record.code || record.source || "", 8000),
    judgeInfo: judgeSummary.text,
    judgeSummary,
    problem: {
      pid,
      title: problem.title || problem.name || pick(problem, ["content.name", "contenu.name"]) || "",
      difficulty,
      tags,
      source: readableSource(problem.source || problem.origin || problem.provider || problem.contest),
      description: extractProblemStatement(problem)
    },
    solutions: solutions.slice(0, 8).map((solution) => ({
      title: solution.title || "",
      content: compactSolutionText(solution.content || solution.solution || solution.article || "")
    }))
  };
}

async function collectProblemHintContext(pid) {
  if (!pid) throw new Error("缺少题号");
  const [problemPage, solutionPage] = await Promise.allSettled([
    luoguFetch(`/problem/${pid}`),
    luoguFetch(`/problem/solution/${pid}`)
  ]);
  const problem = problemPage.status === "fulfilled"
    ? (pick(problemPage.value, ["currentData.problem", "problem", "data.problem"]) || {})
    : {};
  const solutions = solutionPage.status === "fulfilled" ? extractSolutions(solutionPage.value) : [];
  if (!solutions.length) throw new Error("没有读取到题解，不能可靠提示算法");
  const tags = extractTags(problem.tags);
  return {
    pid,
    title: problem.title || problem.name || pick(problem, ["content.name", "contenu.name"]) || pid,
    difficulty: problem.difficulty,
    tags,
    problem: {
      pid,
      title: problem.title || problem.name || "",
      difficulty: problem.difficulty,
      tags,
      statement: compactReviewStatement(extractProblemStatement(problem))
    },
    editorial_extracts: solutions.slice(0, 5).map((solution) => ({
      title: solution.title || "",
      content: compactSolutionText(solution.content || solution.solution || solution.article || "").slice(0, 520)
    }))
  };
}

async function markProblemRead(pid) {
  if (!pid) throw new Error("缺少题号");
  const data = await chrome.storage.local.get(STORAGE_KEYS.readStarts);
  const starts = data[STORAGE_KEYS.readStarts] || {};
  if (!starts[pid]) {
    starts[pid] = Date.now();
    await chrome.storage.local.set({ [STORAGE_KEYS.readStarts]: starts });
  }
  return starts[pid];
}

async function forceProblemRead(pid) {
  if (!pid) throw new Error("缺少题号");
  const data = await chrome.storage.local.get(STORAGE_KEYS.readStarts);
  const starts = data[STORAGE_KEYS.readStarts] || {};
  starts[pid] = Date.now() - 5 * 60 * 1000 - 1000;
  await chrome.storage.local.set({ [STORAGE_KEYS.readStarts]: starts });
  return starts[pid];
}

async function ensureReadEnough(pid) {
  const startedAt = await markProblemRead(pid);
  const left = 5 * 60 * 1000 - (Date.now() - startedAt);
  if (left > 0) throw new Error(`请先读题满 5 分钟，还剩 ${Math.ceil(left / 1000)} 秒`);
}

function parseLuoguHtmlData(html) {
  const match = String(html).match(/<script[^>]+id=["']lentille-context["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  return JSON.parse(decodeHtmlEntities(match[1].trim()));
}

function decodeHtmlEntities(text) {
  return String(text)
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function extractProblemStatement(problem) {
  const content = problem.content || problem.contenu || {};
  const sections = [
    ["题目背景", content.background || problem.background, 600, "head"],
    ["题目描述", content.description || problem.description, 1800, "head"],
    ["输入格式", content.formatI || problem.inputFormat || problem.formatI, 900, "head"],
    ["输出格式", content.formatO || problem.outputFormat || problem.formatO, 900, "head"],
    ["样例", formatSamples(problem.samples), 1200, "head"],
    ["说明/提示", content.hint || problem.hint, 2600, "tail"],
    ["限制", formatLimits(problem.limits), 400, "head"]
  ].filter(([, value]) => value);
  return sections.map(([title, value, max, mode]) => {
    const text = stripText(value);
    return `${title}：\n${truncateSection(text, max, mode)}`;
  }).join("\n\n");
}

function truncateSection(text, max, mode) {
  text = String(text || "");
  if (text.length <= max) return text;
  if (mode === "tail") return `[前文略]\n${text.slice(-max)}`;
  return `${text.slice(0, max)}\n[后文略]`;
}

function formatSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return "";
  return samples.map((sample, index) => {
    const input = Array.isArray(sample) ? sample[0] : sample.input;
    const output = Array.isArray(sample) ? sample[1] : sample.output;
    return `样例 ${index + 1} 输入：\n${input}\n样例 ${index + 1} 输出：\n${output}`;
  }).join("\n\n");
}

function formatLimits(limits) {
  if (!limits) return "";
  const time = Array.isArray(limits.time) ? Math.max(...limits.time) : limits.time;
  const memory = Array.isArray(limits.memory) ? Math.max(...limits.memory) : limits.memory;
  return [time ? `时间限制：${time} ms` : "", memory ? `内存限制：${memory} KB` : ""].filter(Boolean).join("\n");
}

function pick(object, paths) {
  for (const path of paths) {
    const value = path.split(".").reduce((current, key) => current && current[key], object);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function findPid(value) {
  const text = JSON.stringify(value);
  const match = text.match(/\b[PBU]\d+\b/);
  return match && match[0];
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function timeOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") {
    if (value > 1e12) return value;
    if (value > 1e9) return value * 1000;
    return null;
  }
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return timeOrNull(Number(text));
  const parsed = Date.parse(text.replace(/\//g, "-"));
  return Number.isFinite(parsed) ? parsed : null;
}

function extractSubmitTime(record) {
  const direct = pick(record, ["submitTime", "submittedAt", "submitAt", "createTime", "createdAt", "createdTime", "date", "time"]);
  return timeOrNull(direct);
}

function summarizeJudgeInfo(record, basics = {}) {
  const sources = [
    record.detail,
    record.testCases,
    record.judgeResult,
    record.judgeInfo,
    record.subtasks,
    record.results,
    record.tasks
  ].filter((value) => value && typeof value === "object");
  const cases = [];
  sources.forEach((source) => collectJudgeCases(source, cases, 0, ""));
  const seen = new Set();
  const uniqueCases = cases.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const failed = uniqueCases.filter((item) => item.verdict && !/^AC|Accepted|通过$/i.test(item.verdict));
  const verdicts = uniq(failed.map((item) => item.verdict));
  const shown = (failed.length ? failed : uniqueCases).slice(0, 10);
  const lines = [
    `总结果：${basics.statusText || "未知"}`,
    basics.score !== null && basics.score !== undefined ? `分数：${basics.score}/${basics.fullScore ?? 100}` : "",
    verdicts.length ? `失败类型：${verdicts.join("、")}` : "",
    uniqueCases.length ? `评测点概览：共整理到 ${uniqueCases.length} 个评测点/子任务，以下列出${failed.length ? "失败项" : "前几项"}。` : "评测点详情：洛谷页面未提供可解析的逐点详情，只能使用总结果和代码分析。"
  ].filter(Boolean);
  shown.forEach((item, index) => {
    lines.push(`${index + 1}. ${formatJudgeCase(item)}`);
  });
  return {
    text: lines.join("\n"),
    failedVerdicts: verdicts,
    failedCount: failed.length,
    caseCount: uniqueCases.length
  };
}

function collectJudgeCases(value, cases, depth, path) {
  if (!value || depth > 5) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectJudgeCases(item, cases, depth + 1, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object") return;
  if (looksLikeJudgeCase(value)) cases.push(normalizeJudgeCase(value, path));
  for (const [key, item] of Object.entries(value)) {
    if (/source|code|content|description|problem/i.test(key)) continue;
    collectJudgeCases(item, cases, depth + 1, path ? `${path}.${key}` : key);
  }
}

function looksLikeJudgeCase(item) {
  return ["status", "statusText", "result", "verdict", "score", "time", "memory", "message"].some((key) => key in item);
}

function normalizeJudgeCase(item, path) {
  const rawStatus = item.statusText ?? item.verdict ?? item.result ?? item.status ?? "";
  return {
    path,
    verdict: normalizeVerdict(rawStatus),
    rawStatus: String(rawStatus),
    score: item.score ?? item.points ?? item.subtaskScore ?? "",
    time: item.time ?? item.timeCost ?? item.usedTime ?? "",
    memory: item.memory ?? item.memoryCost ?? item.usedMemory ?? "",
    message: truncate(stripText(item.message || item.hint || item.info || item.description || ""), 180)
  };
}

function normalizeVerdict(value) {
  const text = String(value || "");
  if (/Wrong Answer|\bWA\b|答案错误/i.test(text)) return "WA";
  if (/Time Limit Exceeded|\bTLE\b|时间超限/i.test(text)) return "TLE";
  if (/Memory Limit Exceeded|\bMLE\b|内存超限/i.test(text)) return "MLE";
  if (/Runtime Error|\bRE\b|运行时错误/i.test(text)) return "RE";
  if (/Compile Error|\bCE\b|编译错误/i.test(text)) return "CE";
  if (/Output Limit Exceeded|\bOLE\b|输出超限/i.test(text)) return "OLE";
  if (/Accepted|\bAC\b|通过/i.test(text)) return "AC";
  const codeMap = { 2: "CE", 3: "OLE", 4: "MLE", 5: "TLE", 6: "WA", 7: "RE", 12: "AC" };
  return codeMap[text] || text || "Unknown";
}

function formatJudgeCase(item) {
  return [
    item.path ? `${item.path}` : "",
    item.verdict ? `结果 ${item.verdict}` : "",
    item.score !== "" ? `分数 ${item.score}` : "",
    item.time !== "" ? `时间 ${item.time}` : "",
    item.memory !== "" ? `内存 ${item.memory}` : "",
    item.message ? `信息 ${item.message}` : ""
  ].filter(Boolean).join("，");
}

function extractSolutions(page) {
  const direct = pick(page, [
    "currentData.solutions.result",
    "currentData.solutions",
    "data.solutions.result",
    "data.solutions",
    "solutions.result",
    "solutions",
    "data.articles.result",
    "data.articles",
    "articles.result",
    "articles"
  ]);
  const list = Array.isArray(direct) ? direct : findSolutionArrays(page)[0] || [];
  return list.map(normalizeSolution).filter((solution) => solution.content);
}

function findSolutionArrays(value, found = []) {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    if (value.some((item) => item && typeof item === "object" && looksLikeSolution(item))) found.push(value);
    value.forEach((item) => findSolutionArrays(item, found));
    return found;
  }
  Object.values(value).forEach((item) => findSolutionArrays(item, found));
  return found;
}

function looksLikeSolution(item) {
  return Boolean(
    item.content ||
    item.solution ||
    item.article ||
    item.title && (item.id || item.author || item.user)
  );
}

function normalizeSolution(item) {
  const article = item.article && typeof item.article === "object" ? item.article : {};
  const content = item.content || item.solution || article.content || article.solution || item.markdown || "";
  return {
    title: item.title || item.name || article.title || article.name || "",
    content
  };
}

function compactSolutionText(text) {
  const clean = stripText(text);
  if (clean.length <= 700) return clean;
  const index = clean.search(/算法|思路|复杂度|做法|状态|转移|贪心|二分|搜索|枚举|动态规划|DP|图论|最短路|树形|数据结构/i);
  if (index < 0) return clean.slice(0, 700);
  const start = Math.max(0, index - 160);
  return clean.slice(start, start + 700);
}

function extractTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.map((tag) => {
    if (typeof tag === "string") return tag;
    return readableSource(tag.name || tag.title || tag.id || tag);
  }).filter(Boolean);
}

function uniq(items) {
  return [...new Set(items.filter(Boolean))];
}

function stripText(text) {
  return String(text)
    .replace(/<pre[\s\S]*?<\/pre>/gi, " ")
    .replace(/<code[\s\S]*?<\/code>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text, max) {
  text = String(text || "");
  return text.length > max ? `${text.slice(0, max)}\n[已截断]` : text;
}

async function askAI(messages) {
  const settings = await getSettings();
  if (!settings.apiKey) throw new Error("请先在扩展选项页配置 API Key");
  const url = `${normalizeBaseURL(settings.baseURL)}/chat/completions`;

  let response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0.1,
        max_tokens: 1500,
        messages
      })
    });
    clearTimeout(timeout);
  } catch {
    throw new Error("AI 接口连接失败或超时：请检查 Base URL、网络代理，或换更快的模型");
  }
  const data = await readJsonResponse(response, "AI");
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error("AI 没有返回内容");
  return parseJsonObject(content);
}

async function askAIStream(messages, onChunk, options = {}) {
  const settings = await getSettings();
  if (!settings.apiKey) throw new Error("请先在扩展选项页配置 API Key");
  const url = `${normalizeBaseURL(settings.baseURL)}/chat/completions`;
  const payload = {
    model: settings.model,
    temperature: 0.1,
    max_tokens: options.maxTokens || 1500,
    stream: true,
    stream_options: { include_usage: true },
    messages
  };

  let response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify(payload)
    });
    clearTimeout(timeout);
  } catch {
    throw new Error("AI 接口连接失败或超时：请检查 Base URL、网络代理，或换更快的模型");
  }
  if ((response.status === 400 || response.status === 422) && payload.stream_options) {
    delete payload.stream_options;
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify(payload)
    });
  }
  if (!response.ok) throw new Error(`AI 请求失败：${response.status}`);
  if ((response.headers.get("content-type") || "").includes("text/html")) {
    throw new Error(`AI 接口返回了网页，不是 OpenAI-compatible JSON/SSE：${new URL(url).host}`);
  }
  if (!response.body) throw new Error("当前 AI 接口不支持流式响应");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let usage = null;

  while (true) {
    const { value, done } = await readStreamChunk(reader, options.idleMs || 45000);
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const text = line.trim();
      if (!text.startsWith("data:")) continue;
      const data = text.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        throw new Error("AI 流式响应不是 JSON，请检查 Base URL 和模型接口格式");
      }
      if (parsed.usage) usage = parsed.usage;
      const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content;
      if (delta) {
        content += delta;
        onChunk(delta);
      }
    }
  }

  if (!content) throw new Error("AI 没有返回内容");
  return { result: parseJsonObject(content), usage: normalizeUsage(usage, messages, content) };
}

function readStreamChunk(reader, idleMs) {
  let timeout;
  return Promise.race([
    reader.read(),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("AI 流式输出超过 45 秒没有新内容，已停止。本次材料可能太长，建议换更快模型或重试。")), idleMs);
    })
  ]).finally(() => clearTimeout(timeout));
}

async function readJsonResponse(response, label) {
  const text = await response.text();
  if (!response.ok) throw new Error(`${label} 请求失败：${response.status} ${truncate(text, 160)}`);
  try {
    return JSON.parse(text);
  } catch {
    if (/^\s*</.test(text)) {
      throw new Error(`${label} 接口返回了网页，不是 JSON：${new URL(response.url).host}`);
    }
    throw new Error(`${label} 接口返回不是 JSON：${truncate(text, 160)}`);
  }
}

function normalizeBaseURL(baseURL) {
  const value = String(baseURL || "").trim().replace(/\/+$/, "");
  if (!value) throw new Error("请先填写 AI Base URL");
  if (/\/chat\/completions$/.test(value)) return value.replace(/\/chat\/completions$/, "");
  if (/\/v\d+$/.test(value)) return value;
  return `${value}/v1`;
}

function normalizeUsage(usage, messages, content) {
  if (usage && typeof usage === "object") {
    return {
      prompt_tokens: usage.prompt_tokens ?? usage.input_tokens ?? null,
      completion_tokens: usage.completion_tokens ?? usage.output_tokens ?? null,
      total_tokens: usage.total_tokens ?? null,
      estimated: false
    };
  }
  const promptChars = JSON.stringify(messages).length;
  const outputChars = String(content).length;
  const prompt = Math.ceil(promptChars / 4);
  const completion = Math.ceil(outputChars / 4);
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    estimated: true
  };
}

function parseJsonObject(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("AI 返回不是 JSON");
    return JSON.parse(text.slice(start, end + 1));
  }
}

function commonSystemPrompt() {
  return [
    "你是一个极度保守的算法竞赛提交复盘助手，不是软件开发 code reviewer。",
    "关注题意、数据范围、读入输出、边界、复杂度、下标、初始化、溢出、状态转移、图建模、贪心正确性等竞赛问题。",
    "只能使用用户提供的题面、样例、数据范围、代码、评测信息、题解摘要回答；不能编造隐藏数据、题解或最优算法。",
    "每个结论必须有来自输入材料的证据；证据不足就明确说无法确定。",
    "不要评价代码风格、工程结构、命名、可维护性，除非它直接导致竞赛错误。",
    "输出必须是一个 JSON 对象，不要 Markdown，不要额外解释。"
  ].join("\n");
}

function buildDiagnosisMessages(context) {
  const payload = buildDiagnosisPayload(context);
  return [
    { role: "system", content: commonSystemPrompt() },
    {
      role: "user",
      content: [
        "任务：诊断这次非满分提交，只给最可能的 1 到 3 个真实错因。",
        "顺序：先读题面和数据范围，再读提交代码，再用题解摘要对照正确思路，最后结合本次评测结果下结论。",
        "必须引用本次实际评测结果。没有出现在评测结果里的 TLE/RE/MLE 不要写进任何输出字段；复杂度只在会解释本次错误时才写。",
        "如果评测结果是 WA，重点找题意、建模、读入、边界、转移、下标、溢出等导致输出错误的代码位置；不要泛泛说可能。",
        "输出适中：overall_judgement 不超过 120 字；每个原因 summary 不超过 60 字，why_possible 不超过 220 字，verify 不超过 120 字。",
        "confidence 表示输入材料对结论的证据充分度，不是答案正确率；题解/报错/代码证据越直接分数越高。",
        "优先检查：题意是否误读、样例/边界是否覆盖、读入输出是否符合题面、复杂度是否满足数据范围、数组下标/初始化/溢出是否会炸。",
        "回答要像竞赛教练复盘，不要输出工程开发建议。",
        "do_not_do 默认给空数组；只有能避免具体错误修改时才写，不要写“不要归因为某评测类型”这类元提示。",
        "固定 JSON 格式：",
        "{\"confidence\":0,\"overall_judgement\":\"\",\"reasons\":[{\"type\":\"WA|RE|TLE|MLE|CE|Unknown\",\"summary\":\"\",\"evidence\":[\"\"],\"why_possible\":\"\",\"verify\":\"\"}],\"missing_info\":[],\"do_not_do\":[]}",
        "材料：",
        JSON.stringify(payload)
      ].join("\n")
    }
  ];
}

function buildReviewMessages(context) {
  const payload = buildReviewPayload(context);
  return [
    { role: "system", content: commonSystemPrompt() },
    {
      role: "user",
      content: [
        "任务：基于题解摘要和 AC 代码做满分复盘。题解优先；题解没有依据时 best_solution 必须为 null。",
        "输出要短：your_solution_class 不超过 40 字；每个算法说明不超过 120 字，替代算法最多 2 个。",
        "confidence 表示输入材料对复盘结论的证据充分度，不是答案正确率；题解依据越直接分数越高。",
        "题解材料是多篇短摘录，只能提炼摘录中明确出现的算法关键词和思路，不要补全摘录外的证明。",
        "不要把“题解摘要被截断/材料不完整”当作输出内容；如果题解不足，就基于题面和 AC 代码给出能确认的算法分类。",
        "confidence 至少按这些证据给分：题面+AC代码能确认算法时不低于 45；题解也支持时不低于 70；只有题解明确冲突或完全缺失才低分。",
        "每个 best_solution 和 alternative_algorithms 都必须填写 complexity。题解没写复杂度时，你必须根据代码循环、状态数量、图规模或题面数据范围自行推导。",
        "重点只写算法思想、复杂度、数据范围为什么允许；不要写长证明。",
        "不要讨论代码工程质量、模块化、可维护性。",
        "固定 JSON 格式：",
        "{\"confidence\":0,\"your_solution_class\":\"\",\"best_solution\":null,\"alternative_algorithms\":[{\"name\":\"\",\"complexity\":\"\",\"evidence\":[\"\"],\"tradeoff\":\"\"}],\"uncertain_points\":[]}",
        "材料：",
        JSON.stringify(payload)
      ].join("\n")
    }
  ];
}

function buildHintMessages(context) {
  return [
    { role: "system", content: commonSystemPrompt() },
    {
      role: "user",
      content: [
        "任务：给正在写题的选手一个被动算法提示。算法方向必须来自题解摘录，不能只凭模型猜。",
        "不要给完整代码，不要直接复述完整题解。只提示算法类别、关键观察和实现坑点。",
        "输出短一些：algorithm 不超过 30 字；每条 hint 不超过 80 字；implementation_notes 最多 3 条。",
        "如果题解摘录没有明确算法，algorithm 写“题解证据不足”，hints 给读题观察，不要编算法。",
        "固定 JSON 格式：",
        "{\"confidence\":0,\"algorithm\":\"\",\"hints\":[\"\"],\"implementation_notes\":[\"\"],\"complexity\":\"\",\"evidence\":[\"\"]}",
        "材料：",
        JSON.stringify(context)
      ].join("\n")
    }
  ];
}

function buildPostOptimizeMessages(message) {
  const maxLength = Number(message.maxLength) > 0 ? Number(message.maxLength) : 1000;
  return [
    {
      role: "system",
      content: [
        "你是洛谷社区的保守文字校对器，让发帖更清楚、精炼、有逻辑。",
        "只做必要润色；不要替用户重新写，不回答原文里的问题。",
        "表达可稍微更学术、更有条理，但必须保留洛谷社区自然语气。",
        "禁止新增事实、结论、例子、情绪、寒暄、标题、解释。",
        "保留原意、信息量、语气强弱、题号、算法名、代码、链接、@用户名、公式含义。",
        "优先处理：删冗余口癖、合并重复意思、调整语序、补必要连接词，让逻辑顺序更清楚。",
        "再处理：错别字、病句、中文标点、换行、Markdown、$...$、$$...$$、复杂度格式。",
        "例：“我就是我想的就是大概就是你好”可改为“我想说的是：大概就是你好。”",
        "不要删除“啊啊啊”“！！！”“？？？”这类情绪强调；除非原文多次重复同一句完整意思。",
        "只有原文确实有多个独立要点时，才整理为 Markdown 编号列表：1. 2. 3.，每点单独换行。",
        "短文本不要扩写；通顺文本只修格式。",
        "不确定的公式、代码、链接、专有名词保持原样。",
        "若没有可靠优化空间，optimized_text 直接返回原文。",
        "输出固定 JSON，无额外解释。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "{\"optimized_text\":\"\",\"format_fixes\":[\"\"]}",
        "format_fixes 最多 2 条，每条不超过 18 字。",
        "optimized_text 长度不得超过原文 110%，除非只是增加换行/列表序号。",
        "修改幅度越小越好，重点是去冗余、理顺逻辑、修格式。",
        `输入框最大长度：${maxLength}`,
        String(message.text || "").slice(0, maxLength)
      ].join("\n")
    }
  ];
}

function postOptimizeMaxTokens(text) {
  const length = String(text || "").length;
  return Math.max(48, Math.min(160, Math.ceil(length * 0.25) + 42));
}

function buildDiagnosisPayload(context) {
  return {
    submission: {
      recordId: context.recordId,
      pid: context.pid,
      title: context.title,
      score: context.score,
      fullScore: context.fullScore,
      language: context.language,
      statusText: context.statusText,
      judgeInfo: context.judgeInfo
    },
    problem: context.problem,
    submitted_code: context.sourceCode,
    editorial_extracts: context.solutions
  };
}

function buildReviewPayload(context) {
  const problem = context.problem || {};
  return {
    submission: {
      recordId: context.recordId,
      pid: context.pid,
      title: context.title,
      language: context.language
    },
    problem: {
      pid: problem.pid,
      title: problem.title,
      difficulty: problem.difficulty,
      tags: problem.tags,
      source: problem.source,
      statement: compactReviewStatement(problem.description)
    },
    inferred_algorithm_tags: inferAlgorithmTags(context),
    accepted_code: plainLimit(context.sourceCode, 4500),
    editorial_extracts: (context.solutions || []).slice(0, 4).map((solution) => ({
      title: solution.title || "",
      content: plainLimit(solution.content || "", 450)
    }))
  };
}

function compactReviewStatement(text) {
  text = String(text || "");
  const dataIndex = text.search(/数据范围|说明\/提示|限制|Constraints|Hint/i);
  const head = text.slice(0, 1600);
  const tail = dataIndex >= 0 ? text.slice(dataIndex, dataIndex + 1200) : text.slice(-900);
  return plainLimit(`${head}\n${tail}`, 2600);
}

function plainLimit(text, max) {
  text = String(text || "");
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeDiagnosis(result, context) {
  const failed = new Set((context && context.judgeSummary && context.judgeSummary.failedVerdicts || []).map(String));
  const rawReasons = Array.isArray(result.reasons) ? result.reasons.slice(0, 3) : [];
  const reasons = failed.size
    ? rawReasons.filter((reason) => {
      const type = String(reason && reason.type || "");
      return !type || type === "Unknown" || failed.has(type);
    })
    : rawReasons;
  return {
    confidence: clampScore(result.confidence),
    overall_judgement: String(result.overall_judgement || "证据不足，无法可靠判断"),
    reasons: reasons.length ? reasons : rawReasons.slice(0, 1),
    missing_info: cleanDiagnosisNotes(result.missing_info),
    do_not_do: cleanDiagnosisNotes(result.do_not_do)
  };
}

function cleanDiagnosisNotes(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => {
    const text = String(item || "");
    return text && !/不要.*归|不要.*TLE|不要.*RE|不要.*MLE|本次.*评测|评测结果.*WA|不是.*TLE|没有.*TLE|复杂度风险/.test(text);
  }).slice(0, 3);
}

function normalizeReview(result, context) {
  const hasProblemAndCode = Boolean(context && context.problem && context.problem.description && context.sourceCode);
  const hasSolutions = Boolean(context && Array.isArray(context.solutions) && context.solutions.length);
  const floor = hasSolutions ? 70 : hasProblemAndCode ? 45 : 0;
  const fallbackComplexity = inferComplexity(context);
  return {
    confidence: Math.max(clampScore(result.confidence), floor),
    your_solution_class: String(result.your_solution_class || "无法确定"),
    best_solution: result.best_solution ? withComplexity(result.best_solution, fallbackComplexity) : null,
    alternative_algorithms: Array.isArray(result.alternative_algorithms)
      ? result.alternative_algorithms.slice(0, 2).map((item) => withComplexity(item, fallbackComplexity))
      : [],
    uncertain_points: cleanUncertainPoints(result.uncertain_points),
    source_priority: Array.isArray(result.source_priority) ? result.source_priority : ["题解", "题面", "代码", "模型推断"]
  };
}

function normalizeHint(result) {
  return {
    confidence: clampScore(result.confidence),
    algorithm: String(result.algorithm || "题解证据不足"),
    hints: Array.isArray(result.hints) ? result.hints.slice(0, 3) : [],
    implementation_notes: Array.isArray(result.implementation_notes) ? result.implementation_notes.slice(0, 3) : [],
    complexity: String(result.complexity || ""),
    evidence: Array.isArray(result.evidence) ? result.evidence.slice(0, 3) : []
  };
}

async function rememberTrainingRecord(context) {
  if (!context || !context.recordId || !context.pid) return;
  const data = await chrome.storage.local.get(STORAGE_KEYS.trainingHistory);
  const history = data[STORAGE_KEYS.trainingHistory] || {};
  const now = Date.now();
  const time = timeOrNull(context.submittedAt) || now;
  history[context.recordId] = {
    recordId: context.recordId,
    pid: context.pid,
    title: context.title || context.pid,
    difficulty: context.problem && context.problem.difficulty,
    tags: Array.isArray(context.problem && context.problem.tags) ? context.problem.tags.slice(0, 12) : [],
    score: context.score,
    fullScore: context.fullScore,
    statusText: context.statusText || "",
    isFullScore: Boolean(context.isFullScore),
    verdicts: context.judgeSummary && context.judgeSummary.failedVerdicts || [],
    submittedAt: time,
    time
  };
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  const entries = Object.entries(history)
    .filter(([, item]) => item && item.time >= cutoff)
    .sort((a, b) => b[1].time - a[1].time)
    .slice(0, 1000);
  await chrome.storage.local.set({ [STORAGE_KEYS.trainingHistory]: Object.fromEntries(entries) });
}

async function fetchWeeklyRecordList(cutoff, fallbackUserId) {
  const userId = fallbackUserId || await getCurrentUserId();
  if (!userId) return [];
  const pages = await Promise.allSettled(Array.from({ length: 8 }, (_, index) =>
    luoguFetch(`/record/list?user=${encodeURIComponent(userId)}&page=${index + 1}`)
  ));
  return mergeWeeklyRecords(pages
    .flatMap((page) => page.status === "fulfilled" ? extractRecordList(page.value) : [])
    .map(normalizeRecordListItem)
    .filter((record) => record && record.time && record.time >= cutoff));
}

async function getWeeklySummaryCache() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.weeklySummaryCache);
  const cache = data[STORAGE_KEYS.weeklySummaryCache];
  if (!cache || Date.now() - Number(cache.time || 0) > WEEKLY_CACHE_TTL) return { cached: false };
  return { cached: true, data: cache.data, result: cache.result, time: cache.time };
}

async function saveWeeklySummaryCache(data, result) {
  const normalized = normalizeWeeklySummary(result, data);
  await chrome.storage.local.set({
    [STORAGE_KEYS.weeklySummaryCache]: {
      time: Date.now(),
      data,
      result: normalized
    }
  });
}

async function getCurrentUserId() {
  const page = await luoguFetch("/");
  const user = pick(page, [
    "currentData.user",
    "currentData.currentUser",
    "data.user",
    "data.currentUser",
    "user",
    "currentUser"
  ]) || {};
  return pick(user, ["uid", "id", "userId"]) || pick(page, ["currentData.uid", "data.uid"]);
}

function extractRecordList(page) {
  const direct = pick(page, [
    "currentData.records.result",
    "currentData.records.records",
    "currentData.records",
    "data.records.result",
    "data.records.records",
    "data.records",
    "records.result",
    "records.records",
    "records",
    "currentData.recordList.result",
    "currentData.recordList.records",
    "data.recordList.result"
  ]);
  if (Array.isArray(direct)) return direct;
  return findRecordArrays(page)[0] || [];
}

function findRecordArrays(value, found = []) {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    if (value.some(looksLikeRecordListItem)) found.push(value);
    value.forEach((item) => findRecordArrays(item, found));
    return found;
  }
  Object.values(value).forEach((item) => findRecordArrays(item, found));
  return found;
}

function looksLikeRecordListItem(item) {
  return item && typeof item === "object" && (
    item.problem || item.problemID || item.pid || item.problemId
  ) && (
    item.score !== undefined || item.status !== undefined || item.statusText || item.result !== undefined
  );
}

function normalizeRecordListItem(record) {
  if (!record) return null;
  const problem = record.problem || {};
  const pid = pick(record, ["problem.pid", "problemID", "problemId", "pid"]);
  if (!pid) return null;
  const time = extractSubmitTime(record);
  const score = numberOrNull(record.score ?? record.totalScore);
  const fullScore = numberOrNull(problem.fullScore ?? record.fullScore) ?? 100;
  const statusText = String(record.statusText || record.status || record.result || "");
  const verdict = normalizeVerdict(statusText);
  return {
    recordId: record.id || record.rid || record.recordId || "",
    pid,
    title: problem.title || problem.name || pid,
    difficulty: problem.difficulty,
    tags: extractTags(problem.tags),
    score,
    fullScore,
    statusText,
    isFullScore: score !== null ? score >= fullScore : verdict === "AC",
    verdicts: verdict && verdict !== "AC" ? [verdict] : [],
    submittedAt: time,
    time
  };
}

async function collectWeeklyTrainingData(pageRecords = [], userId = "") {
  const now = Date.now();
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  const [historyData, mistakes] = await Promise.all([
    chrome.storage.local.get(STORAGE_KEYS.trainingHistory),
    getArray(STORAGE_KEYS.mistakes)
  ]);
  const apiRecords = await fetchWeeklyRecordList(cutoff, userId).catch(() => []);
  const records = (await enrichWeeklyRecords(mergeWeeklyRecords([
    ...Object.values(historyData[STORAGE_KEYS.trainingHistory] || {}),
    ...apiRecords,
    ...pageRecords
  ]).filter((item) => item && item.time >= cutoff)))
    .sort((a, b) => b.time - a.time);
  const weeklyMistakes = dedupeByKey(mistakes.filter((item) => item && item.time >= cutoff), mistakeKey);
  const tagMap = await getTagNameMap().catch(() => new Map());
  const problems = new Map();
  const tagCounts = {};
  const difficultyCounts = {};
  const verdictCounts = {};
  let ac = 0;
  records.forEach((record) => {
    const tags = normalizeWeeklyTags(record.tags, tagMap);
    if (record.isFullScore) ac++;
    count(difficultyCounts, difficultyLabel(record.difficulty));
    tags.forEach((tag) => count(tagCounts, tag));
    const verdicts = record.isFullScore ? ["AC"] : (record.verdicts && record.verdicts.length ? record.verdicts : [record.statusText || "未满分"]);
    if (!record.isFullScore) verdicts.forEach((verdict) => count(verdictCounts, verdict));
    const item = problems.get(record.pid) || {
      pid: record.pid,
      title: record.title || record.pid,
      difficulty: difficultyLabel(record.difficulty),
      tags: [],
      attempts: 0,
      ac: 0,
      errors: 0,
      bestScore: null,
      latestStatus: "",
      lastTime: 0,
      verdicts: {}
    };
    item.attempts++;
    item.ac += record.isFullScore ? 1 : 0;
    item.errors += record.isFullScore ? 0 : 1;
    item.bestScore = Math.max(item.bestScore ?? -Infinity, Number(record.score ?? 0));
    item.latestStatus = record.statusText || (record.isFullScore ? "AC" : "未满分");
    item.lastTime = Math.max(item.lastTime, record.time || 0);
    tags.forEach((tag) => { if (!item.tags.includes(tag)) item.tags.push(tag); });
    verdicts.forEach((verdict) => count(item.verdicts, verdict));
    problems.set(record.pid, item);
  });
  const recommendationProblems = await findWeeklyRecommendations(records, tagCounts, tagMap);
  return {
    period: { start: new Date(cutoff).toISOString(), end: new Date(now).toISOString() },
    totals: {
      submissions: records.length,
      problems: problems.size,
      accepted: ac,
      errors: records.length - ac,
      saved_mistakes: weeklyMistakes.length
    },
    difficulties: topCounts(difficultyCounts, 8),
    tags: topCounts(tagCounts, 12),
    verdicts: topCounts(verdictCounts, 8),
    problems: [...problems.values()]
      .sort((a, b) => b.errors - a.errors || b.attempts - a.attempts || b.lastTime - a.lastTime)
      .slice(0, 18)
      .map((item) => ({ ...item, tags: item.tags.slice(0, 8), verdicts: topCounts(item.verdicts, 5) })),
    recommendations: recommendationProblems,
    mistakes: weeklyMistakes.slice(0, 10).map((item) => ({
      pid: item.pid,
      title: item.title,
      result: item.result,
      errorType: item.errorType,
      reason: item.userReason || item.aiConclusion || ""
    }))
  };
}

function normalizeWeeklyRecord(record) {
  if (!record || !record.pid) return null;
  const score = numberOrNull(record.score);
  const fullScore = numberOrNull(record.fullScore) ?? 100;
  const statusText = String(record.statusText || record.result || "");
  const isFullScore = record.isFullScore !== undefined
    ? Boolean(record.isFullScore)
    : score !== null
      ? score >= fullScore
      : /Accepted|AC|通过/.test(statusText);
  return {
    recordId: record.recordId || "",
    pid: String(record.pid),
    title: record.title || record.pid,
    difficulty: record.difficulty,
    tags: Array.isArray(record.tags) ? record.tags.slice(0, 12) : [],
    score,
    fullScore,
    statusText,
    isFullScore,
    verdicts: Array.isArray(record.verdicts) ? record.verdicts : [],
    time: timeOrNull(record.submittedAt ?? record.time) || Date.now()
  };
}

function mergeWeeklyRecords(records) {
  const merged = new Map();
  records.map(normalizeWeeklyRecord).filter(Boolean).forEach((record) => {
    const key = weeklyRecordKey(record);
    const old = merged.get(key);
    if (!old) return merged.set(key, record);
    merged.set(key, {
      ...old,
      ...record,
      title: record.title && record.title !== record.pid ? record.title : old.title,
      difficulty: record.difficulty ?? old.difficulty,
      tags: record.tags.length ? record.tags : old.tags,
      verdicts: record.verdicts.length ? record.verdicts : old.verdicts,
      time: Math.min(old.time || record.time, record.time || old.time)
    });
  });
  return [...merged.values()];
}

function weeklyRecordKey(record) {
  return record.recordId
    ? `rid:${record.recordId}`
    : [record.pid, record.time, record.score ?? "", record.statusText].join("|");
}

async function enrichWeeklyRecords(records) {
  const pids = uniq(records
    .filter((record) => !record.tags.length || record.difficulty === undefined || record.difficulty === null || record.title === record.pid)
    .map((record) => record.pid))
    .slice(0, 40);
  const metas = await Promise.allSettled(pids.map((pid) => getProblemMeta(pid)));
  const metaMap = new Map();
  metas.forEach((item) => {
    if (item.status === "fulfilled" && item.value) metaMap.set(item.value.pid, item.value);
  });
  return records.map((record) => {
    const meta = metaMap.get(record.pid) || {};
    return {
      ...record,
      title: record.title && record.title !== record.pid ? record.title : meta.title || record.title,
      difficulty: record.difficulty ?? meta.difficulty,
      tags: record.tags.length ? record.tags : meta.tags || []
    };
  });
}

async function getProblemMeta(pid) {
  if (problemMetaCache.has(pid)) return problemMetaCache.get(pid);
  const page = await luoguFetch(`/problem/${pid}`);
  const problem = pick(page, ["currentData.problem", "problem", "data.problem"]) || {};
  const meta = {
    pid,
    title: problem.title || problem.name || pick(problem, ["content.name", "contenu.name"]) || pid,
    difficulty: problem.difficulty,
    tags: extractTags(problem.tags)
  };
  problemMetaCache.set(pid, meta);
  return meta;
}

function normalizeWeeklyTags(tags, tagMap) {
  return uniq((Array.isArray(tags) ? tags : [])
    .map((tag) => {
      const value = String(tag || "").trim();
      return tagMap.get(value) || value;
    })
    .filter(Boolean));
}

async function findWeeklyRecommendations(records, tagCounts, tagMap) {
  if (!records.length) return [];
  const topTags = topCounts(tagCounts, 5).map((item) => item.name);
  const difficulties = uniq(records.map((record) => record.difficulty).filter((value) => value !== undefined && value !== null)).slice(0, 3);
  if (!topTags.length || !difficulties.length) return [];
  const blocked = new Set([
    ...records.map((record) => record.pid),
    ...await getArray(STORAGE_KEYS.acProblems)
  ]);
  const pages = await Promise.allSettled(difficulties.flatMap((difficulty) =>
    topTags.slice(0, 3).flatMap((tag) => [1, 2].map((page) => listProblems({ difficulty, keyword: tag, page })))
  ));
  return uniqByPid(pages.flatMap((page) => page.status === "fulfilled" ? extractProblemList(page.value) : []))
    .map((problem) => {
      const item = normalizeProblem(problem);
      item.tags = normalizeWeeklyTags(item.tags, tagMap);
      return item;
    })
    .filter((problem) => problem.pid && !blocked.has(problem.pid) && difficulties.some((difficulty) => String(difficulty) === String(problem.difficulty)))
    .filter((problem) => commonTags(topTags, problem.tags).length || topTags.some((tag) => problemSearchText(problem).includes(tag.toLowerCase())))
    .sort((a, b) => scoreCandidate(b, topTags) - scoreCandidate(a, topTags))
    .slice(0, 5)
    .map((problem) => ({
      pid: problem.pid,
      title: problem.title,
      difficulty: difficultyLabel(problem.difficulty),
      tags: problem.tags.slice(0, 5),
      reason: recommendationReason(problem, topTags)
    }));
}

function buildWeeklySummaryMessages(data) {
  return [
    {
      role: "system",
      content: [
        "你是算法竞赛训练复盘教练，只总结用户最近 7 天的训练数据。",
        "只能根据输入统计回答，不能编造题目、标签、提交、错误原因或训练量。",
        "重点关注题目、算法标签、难度分布、错误次数、重复卡点和下周训练建议。",
        "输出必须是 JSON 对象，不要 Markdown，不要额外解释。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "请基于以下周训练数据做复盘。建议要像算法竞赛训练教练，不要写软件工程建议。",
        "固定 JSON：",
        "{\"overall_summary\":\"\",\"strengths\":[\"\"],\"weaknesses\":[\"\"],\"frequent_tags\":[\"\"],\"representative_problems\":[\"\"],\"error_patterns\":[\"\"],\"next_week_plan\":[\"\"]}",
        "数据：",
        JSON.stringify(data)
      ].join("\n")
    }
  ];
}

function normalizeWeeklySummary(result) {
  return {
    overall_summary: String(result.overall_summary || "最近 7 天训练记录较少，暂时无法形成稳定趋势。"),
    strengths: cleanSummaryItems(result.strengths, 4),
    weaknesses: cleanSummaryItems(result.weaknesses, 4),
    frequent_tags: cleanSummaryItems(result.frequent_tags, 5),
    representative_problems: cleanSummaryItems(result.representative_problems, 5),
    error_patterns: cleanSummaryItems(result.error_patterns, 5),
    next_week_plan: cleanSummaryItems(result.next_week_plan, 5)
  };
}

function emptyWeeklySummary() {
  return normalizeWeeklySummary({
    overall_summary: "最近 7 天还没有记录到提交记录。打开洛谷提交记录页后，插件会自动记录到本地周报。",
    next_week_plan: ["先正常刷题并打开提交记录页，积累一周数据后再生成总结。"]
  });
}

function cleanSummaryItems(items, limit) {
  return Array.isArray(items) ? items.map(String).filter(Boolean).slice(0, limit) : [];
}

function count(target, key) {
  key = String(key || "未知");
  target[key] = (target[key] || 0) + 1;
}

function topCounts(target, limit) {
  return Object.entries(target)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function difficultyLabel(value) {
  const labels = ["暂无评定", "入门", "普及-", "普及/提高-", "普及+/提高", "提高+/省选-", "省选/NOI-", "NOI/NOI+/CTSC"];
  return labels[Number(value)] || String(value ?? "未知");
}

function normalizePostOptimize(result, message) {
  const maxLength = Number(message.maxLength) > 0 ? Number(message.maxLength) : Infinity;
  const original = String(message.text || "");
  const optimized = cleanRepeatedText(String(result.optimized_text || ""));
  const compactOriginal = original.replace(/\s+/g, "");
  const compactOptimized = optimized.replace(/\s+/g, "");
  const tooLong = compactOriginal && compactOptimized.length > Math.max(compactOriginal.length * 1.18, compactOriginal.length + 8);
  return {
    optimized_text: (tooLong ? original : optimized).slice(0, maxLength),
    format_fixes: tooLong ? ["改动过大，已保留原文"] : Array.isArray(result.format_fixes) ? result.format_fixes.slice(0, 4).map(String) : []
  };
}

function cleanRepeatedText(text) {
  return String(text || "")
    .replace(/(就是|然后|那个|这个|大概|我觉得|我想说的)(?:[，,、\s]*\1)+/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
}

function withComplexity(item, fallback) {
  return {
    ...item,
    complexity: usefulComplexity(item && item.complexity) ? String(item.complexity) : fallback
  };
}

function usefulComplexity(value) {
  return value && !/未知|unknown|不确定|无法/.test(String(value));
}

function inferComplexity(context) {
  const code = String(context && context.sourceCode || "");
  const problem = String(context && context.problem && context.problem.description || "");
  const loops = (code.match(/\b(for|while)\b/g) || []).length;
  if (/dp|动态规划|状态|转移/i.test(code + problem)) return "按状态数估算，通常为 O(状态数 × 转移数)，需结合题面变量确认";
  if (/priority_queue|heap|dijkstra|最短路/i.test(code + problem)) return "通常为 O((n+m) log n)，按图规模估算";
  if (/sort\s*\(|排序/.test(code + problem)) return "通常为 O(n log n)，按主要排序规模估算";
  if (loops >= 3) return "按嵌套循环估算，约 O(n^3) 或更高，需对应题面变量确认";
  if (loops === 2) return "按双重循环估算，约 O(n^2)";
  if (loops === 1) return "按单次遍历估算，约 O(n)";
  return "按代码和题面估算：常数或线性级别，需人工确认具体变量";
}

function cleanUncertainPoints(points) {
  if (!Array.isArray(points)) return [];
  return points.filter((point) => {
    const text = String(point || "");
    return !/截断|摘录|摘要|材料不完整|无法完整确认|题解不足/.test(text);
  }).slice(0, 3);
}

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

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

async function rememberAc(context) {
  if (!context.isFullScore) return;
  const acProblems = await getArray(STORAGE_KEYS.acProblems);
  if (!acProblems.includes(context.pid)) {
    await chrome.storage.local.set({ [STORAGE_KEYS.acProblems]: [...acProblems, context.pid].slice(-1000) });
  }
}

async function rememberRecommendations(problems) {
  const recommended = await getArray(STORAGE_KEYS.recommended);
  const next = [
    ...recommended,
    ...problems.map((problem) => ({ pid: problem.pid, time: Date.now() }))
  ].slice(-200);
  await chrome.storage.local.set({ [STORAGE_KEYS.recommended]: next });
}

async function saveMistake(record) {
  const mistakes = await getArray(STORAGE_KEYS.mistakes);
  const entry = {
    pid: record.pid || "",
    title: record.title || "",
    recordId: record.recordId || "",
    result: record.result || "",
    errorType: record.errorType || "",
    aiConclusion: record.aiConclusion || "",
    userReason: record.userReason || "",
    tags: Array.isArray(record.tags) ? record.tags : [],
    time: Date.now()
  };
  entry.key = mistakeKey(entry);
  const uniqueMistakes = dedupeByKey(mistakes, mistakeKey);
  if (uniqueMistakes.some((item) => mistakeKey(item) === entry.key)) {
    await chrome.storage.local.set({ [STORAGE_KEYS.mistakes]: uniqueMistakes.slice(0, 500) });
    return { duplicate: true };
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.mistakes]: [entry, ...uniqueMistakes].slice(0, 500) });
  return { duplicate: false };
}

function mistakeKey(record) {
  if (record && record.key) return record.key;
  if (record && record.recordId) return `rid:${record.recordId}`;
  return [
    record && record.pid,
    record && record.result,
    record && record.errorType,
    record && (record.userReason || record.aiConclusion || "")
  ].map((item) => String(item || "").trim()).join("|");
}

function dedupeByKey(items, getKey) {
  const seen = new Set();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
