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
