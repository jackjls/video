# FTvideo

> **团队内部的 AI 财经视频工作台。** 在网页里选内容类型，和 agent 对话生成分镜文案，一键 AI 配音，本地渲染导出 MP4。内置三套财经早晚报主题模板，全流程跑在自己电脑上，没有按次付费，没有平台水印。

## 能做什么

- **财经早晚报视频**：8 条热点 / 行情数据 / 分镜旁白，选一套主题模板直接出片
- **其他内容类型**：单帧标题卡、多帧预告片、数据大字报、概念解说短片
- **粘链接生成**：丢一篇文章链接或 GitHub repo，agent 读完自动写成分镜
- **AI 配音**：MiniMax TTS 合成旁白，音画自动对齐
- **本地导出**：真 MP4，1080p，导完就能发

## 三套主题模板

| 模板 | 风格 |
|---|---|
| AI Finance Brief · 黑金商务 | 纯黑底 + 亮金 + 宋体大标题，庄重商务 |
| AI Finance Brief · 深蓝数据终端 | 深藏青 + 青色扫描线 + 等宽数字，终端感 |
| AI Finance Brief · 米白编辑部 | 米白纸底 + 墨字 + 编辑部红，报纸版式 |

三套模板槽位完全一致，同一份文案可随时互换主题。

## 环境要求

| 依赖 | 要求 |
|---|---|
| Node.js | ≥ 20（建议 22+） |
| pnpm | ≥ 9（`npm i -g pnpm`） |
| ffmpeg | macOS：`brew install ffmpeg` |
| Chrome / Chromium | 已安装即可 |
| Agent CLI | Claude Code 或 Codex CLI，至少装一个并登录 |

## 快速开始

```bash
git clone https://github.com/jackjls/video.git ftvideo
cd ftvideo
pnpm install
pnpm -r build

# 自检（各项应为 ok）
./packages/cli/dist/bin.js doctor

# 启动
node packages/cli/dist/bin.js studio --port 3071
```

浏览器打开 http://127.0.0.1:3071 ，点 **+ New** 开始。

详细使用流程和常见问题见 **[docs/FTvideo-安装使用指南.md](docs/FTvideo-安装使用指南.md)**。

## 使用流程

1. **+ New** 新建项目 → 直接弹出「想做哪种内容？」选择卡
2. 选类型（如财经早晚报），按提问补充素材或粘文章链接
3. 顶部 TEMPLATE 选一套主题
4. 生成后右侧 FRAME TEXT 面板可直接改每帧文字
5. 底部合成配音（首次在 ⚙️ 设置里填 MiniMax key）
6. 右上角 **Export MP4** 导出

## 项目结构

```
ftvideo/
├── packages/
│   ├── cli/              CLI + studio 服务端
│   ├── core/             项目编排 / 模板注册表 / 导出
│   ├── adapter-hyperframes/  HTML→视频渲染引擎（基座）
│   ├── adapter-remotion/     Remotion 数据动画增强
│   └── project-studio/   Web UI（静态文件）
├── templates/            主题模板（三套财经 + Remotion 引擎模板）
└── docs/                 安装使用指南
```

## 致谢与许可

基于开源项目 [html-video](https://github.com/nexu-io/html-video)（nexu-io，Apache-2.0）定制。原项目及其依赖的许可信息见 [LICENSE](LICENSE) 与 [ATTRIBUTIONS.md](ATTRIBUTIONS.md)。
