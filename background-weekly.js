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
