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

if (typeof importScripts === "function") {
  importScripts(
    "background-common.js",
    "background-luogu.js",
    "background-ai.js",
    "background-weekly.js",
    "background-recommend.js",
    "background-storage.js"
  );
}

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
