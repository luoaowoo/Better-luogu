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
