# 洛谷 AI 诊断助手

一个用于洛谷提交记录页的 Chrome/Edge Manifest V3 浏览器扩展。

它会在洛谷记录页右侧加入一个安静的小面板，默认不自动分析。你点击按钮后，插件才会读取当前提交、题面、题解摘要和评测结果，并调用你配置的 OpenAI-compatible 模型生成错因诊断或满分复盘。同类练习不使用 AI，只使用洛谷题库接口和本地规则推荐。

## 功能

- **AI 诊断非满分提交**
  - 读取提交代码、题面、样例、数据范围、评测点结果和题解摘要。
  - 优先分析算法竞赛常见问题：题意误读、读入输出、建模、复杂度、边界、下标、初始化、溢出、状态转移等。
  - 流式显示模型输出，并展示本次 token 消耗。
  - 会过滤明显无关的结论，例如本次评测是 WA 时，不把未发生的 TLE/MLE/RE 当作主要错因。

- **满分复盘**
  - 满分提交默认不弹窗，点击“复盘分析”才会运行。
  - 结合 AC 代码和题解摘要，总结当前解法、题解思路、复杂度和可替代做法。
  - 题解不足时不会强行编造“最优解”。

- **同类练习**
  - 不调用 AI，不消耗 token。
  - 使用洛谷题库接口检索候选题。
  - 保持同洛谷评级，不跨难度推荐。
  - 结合当前题目的算法标签、题面/题解中推断出的算法类型，以及 CSP/NOIP/NOI/IOI/CCPC/ICPC/APIO/省选等正规比赛来源进行排序。
  - 自动排除当前题、已记录 AC 的题和最近推荐过的题。

- **个人错因库**
  - 点击“加入错因库”后，把当前题号、提交 ID、评测结果、AI 结论和主要错因保存到浏览器本地。
  - 数据保存在 `chrome.storage.local`，不会上传到额外服务器。

- **双入口**
  - 洛谷提交记录页右侧嵌入面板。
  - 浏览器右上角扩展图标弹窗，默认打开“设置”页，也可以切换到“错误分析”页。

## 安装

### 从 Release 安装

1. 下载 Release 中的 `oi-ai_error-v0.1.0.zip`。
2. 解压到一个固定目录。
3. 打开 Chrome/Edge 扩展管理页：
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
4. 打开“开发者模式”。
5. 点击“加载已解压的扩展程序”。
6. 选择刚才解压出来的目录。

### 从源码安装

1. 克隆仓库：

```powershell
git clone https://github.com/luoaowoo/oi-ai_error.git
cd oi-ai_error
```

2. 在浏览器扩展管理页选择“加载已解压的扩展程序”。
3. 选择仓库根目录。

本扩展没有构建步骤，不需要 `npm install`，也不需要打包工具。

## 配置 AI

点击浏览器右上角扩展图标，默认会打开“设置”页。

需要填写：

- `Base URL`
  - OpenAI 官方接口可填：`https://api.openai.com/v1`
  - 其他兼容接口按服务商文档填写，例如 `https://example.com/v1`

- `API Key`
  - 你的模型服务密钥。
  - 只保存在浏览器本地 `chrome.storage.local`。

- `Model`
  - 例如：`gpt-4o-mini`、`gpt-4.1-mini`，或其他 OpenAI-compatible 服务支持的模型名。

如果只使用“同类练习”，不需要配置 API Key。

## 使用方法

1. 登录洛谷。
2. 打开提交记录页，例如：

```text
https://www.luogu.com.cn/record/123456789
```

3. 页面右侧会出现“洛谷 AI 诊断助手”面板。
4. 根据提交状态点击：
   - `AI 诊断`：非满分提交使用。
   - `复盘分析`：满分提交使用。
   - `同类练习`：使用洛谷接口推荐同评级练习题，不调用 AI。

也可以点击浏览器右上角扩展图标，在弹窗里切换到“错误分析”页。

## AI 诊断策略

插件会尽量把 AI 限制在“基于证据的算法竞赛复盘”里：

- 只能根据题面、代码、评测信息和题解摘要回答。
- 每个结论都应该有证据。
- 证据不足时必须说明无法确定。
- 不允许编造题意、隐藏数据、题解或最优算法。
- 不做普通软件工程式 code review，除非代码问题直接导致竞赛错误。

诊断输出会被本地再清洗一遍，减少无关提示和明显跑偏的评测类型。

## 同类练习策略

同类练习完全本地生成，不走 AI。

大致流程：

1. 读取当前题目的洛谷评级。
2. 读取洛谷题目标签。
3. 从题面、代码和题解摘要里补充推断算法标签。
4. 使用洛谷题库接口搜索同评级题。
5. 用正规比赛来源和标签重合度排序。
6. 返回最多 5 道题。

如果洛谷接口没有给出足够候选，插件会显示候选不足，不会编造题目。

## 隐私说明

- 错因库保存在浏览器本地。
- API Key 保存在浏览器本地。
- 使用 AI 诊断或复盘时，插件会把当前提交相关材料发送给你配置的模型服务。
- 同类练习不调用 AI，只请求洛谷题库接口。
- 本项目不提供云同步，也不收集遥测数据。

## 调试和开发

修改源码后：

1. 打开 `chrome://extensions` 或 `edge://extensions`。
2. 找到本扩展。
3. 点击“重新加载”。
4. 刷新洛谷页面。

基础自检：

```powershell
node --check background.js
node --check content.js
node --check options.js
node test-selfcheck.js
```

重新打包：

```powershell
New-Item -ItemType Directory -Force -Path dist | Out-Null
Compress-Archive -Path manifest.json,background.js,content.js,options.html,options.js,styles.css,README.md -DestinationPath dist\oi-ai_error.zip -Force
```

## 文件结构

```text
.
├── manifest.json       # Chrome/Edge MV3 扩展声明
├── background.js       # 洛谷接口请求、AI 调用、推荐逻辑、存储逻辑
├── content.js          # 洛谷页面内嵌面板
├── options.html        # 扩展弹窗/设置页
├── options.js          # 弹窗设置和分析逻辑
├── styles.css          # 页面面板和弹窗样式
├── test-selfcheck.js   # 轻量自检脚本
└── README.md
```

## 已知限制

- 只支持 Chrome/Edge Manifest V3。
- 洛谷页面和非公开接口字段可能变化，接口变化时部分信息会降级或显示错误。
- AI 诊断质量取决于题面、题解摘要、提交代码和模型本身。
- 题解摘要只截取文字关键部分，避免输入过长，但仍可能遗漏某些边界证明。
- 同类练习依赖洛谷题库接口的搜索结果，不保证覆盖所有正规比赛题。

## 仓库

- GitHub: https://github.com/luoaowoo/oi-ai_error
- Release: https://github.com/luoaowoo/oi-ai_error/releases
