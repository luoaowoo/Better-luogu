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
