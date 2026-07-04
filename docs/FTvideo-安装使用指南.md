# FTvideo Studio 安装使用指南（内部）

FTvideo 是团队内部的 AI 财经视频生成工作台：在网页里选内容类型 → 和 agent 对话生成分镜 → 一键配音 → 导出 MP4。内置三套财经早晚报主题模板（黑金商务 / 深蓝数据终端 / 米白编辑部）。

## 环境要求

| 依赖 | 要求 | 说明 |
|---|---|---|
| Node.js | ≥ 20 | 建议 22+，https://nodejs.org |
| pnpm | ≥ 9 | `npm i -g pnpm` |
| ffmpeg | 任意近期版本 | macOS：`brew install ffmpeg` |
| Chrome / Chromium | 已安装即可 | 渲染视频用 |
| Agent CLI | Claude Code 或 Codex CLI 至少装一个并完成登录 | 生成分镜/文案的大脑 |

## 安装（装一次）

```bash
git clone https://github.com/jackjls/video.git ftvideo
cd ftvideo
pnpm install
pnpm -r build
```

装完自检一下（各项应为 ok）：

```bash
./packages/cli/dist/bin.js doctor
```

## 启动

```bash
node packages/cli/dist/bin.js studio --port 3071
```

浏览器打开 http://127.0.0.1:3071 。

## 日常使用流程

1. 左上角 **+ New** 新建项目，会直接弹出「想做哪种内容？」选择卡
2. 选 **财经早晚报**（或其他类型），按 agent 的提问补充内容素材（也可以直接粘文章链接）
3. 顶部 **TEMPLATE** 下拉选一套主题：黑金商务 / 深蓝数据终端 / 米白编辑部（三套槽位一致，可随时互换）
4. 生成后在右侧 **FRAME TEXT** 面板直接改每帧文字
5. 底部 **Add background music & narration** 合成配音（首次需在 ⚙️ 设置里填 MiniMax API key）
6. 右上角 **Export MP4** 导出成片

## 配音（可选）

配音走 MiniMax TTS：⚙️ 设置 → 填入 `API Key` 和 `Group ID`（在 https://platform.minimaxi.com 创建）。不配 key 其他功能不受影响，只是没有配音。

## 常见问题

- **doctor 报 ffmpeg 缺失**：`brew install ffmpeg`（Windows：`winget install ffmpeg`）
- **agent 下拉是灰的**：本机没装 Claude Code / Codex CLI，装一个并登录后点下拉里的刷新
- **导出很慢**：首次渲染要冷启动浏览器内核，之后会快
- **模板列表为空**：确认是从仓库根目录启动的（templates/ 目录要在工作目录下）
