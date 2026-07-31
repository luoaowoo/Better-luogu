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
