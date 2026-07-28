# 洛谷 AI 诊断助手

一个无构建步骤的 Chrome/Edge Manifest V3 扩展，用于在洛谷提交记录页按需生成 AI 诊断、满分复盘、同类题练习建议和本地错因库。

## 使用

1. 打开 Chrome/Edge 的扩展管理页。
2. 开启开发者模式。
3. 选择“加载已解压的扩展程序”，目录选本仓库。
4. 打开扩展选项页，填写 OpenAI-compatible 的 `baseURL`、`apiKey`、`model`。
5. 打开 `https://www.luogu.com.cn/record/{提交ID}`，点击右下角按钮。

## 检查

```powershell
node test-selfcheck.js
```

## 说明

- 插件默认不自动弹窗，只有点击后才请求 AI。
- 题目难度直接使用洛谷评级，同类练习只推荐同评级题。
- 错因库保存在浏览器本地 `chrome.storage.local`。
- 洛谷页面接口如果变化，插件会降级显示错误提示，不影响原页面。
