# 我的博客

线上：https://shenblog.vercel.app

本地写、一键发布到 GitHub、Vercel 自动上线。零依赖，只要机器上有 `node` 就能跑。

## 目录

```
blog/
├── content/posts/       文章（唯一内容源，按年份分目录）
├── content/about.md     关于页
├── public/              样式、脚本、图片（上传的图片在 uploads/）
├── scripts/build.mjs    生成静态站点到 dist/
├── scripts/serve.mjs    本地预览站点
├── manager/             本地管理器（server.mjs + 界面 index.html/app.js）
├── site.json            站名、口号、作者、线上域名
├── 启动博客.vbs         一键打开写作窗口
└── vercel.json          Vercel 构建配置
```

## 日常写作

双击 `启动博客.vbs`：后台起服务，前台弹出一个没有地址栏、没有标签页的应用窗口（Edge/Chrome 的 `--app` 模式）。

- 左栏按年份列文章，可切「全部 / 草稿 / 已发布」，鼠标停在一行右侧出现 `×` 可直接删除。
- 标题不用写 `#`，日期和标签在标题下面一行。
- 正文是 Markdown，字体 16px；图片可以直接粘贴或拖进来。
- 停止输入 4 秒自动保存到本地文件；`Ctrl+S` 立刻保存。保存不等于发布。
- 点底栏「发布到 GitHub」：本地构建校验 → `git commit` → `git push`，Vercel 约 30–60 秒上线。
- 删除文章后同样要发布一次，线上才会消失。
- 「预览」按钮可以把右侧预览面板收起；顶栏右侧的月亮/太阳图标切换深色模式。

### 快捷键

| 键 | 作用 |
| --- | --- |
| `Ctrl+S` | 立刻保存 |
| `Ctrl+K` | 打开命令面板，输入标题直接跳转文章 |
| `Ctrl+N` | 新建文章 |
| `Ctrl+B` / `Ctrl+I` | 加粗 / 斜体 |
| `Esc` | 关闭面板或弹窗 |

## 第一次：上传到 GitHub（只做一次）

1. 在 GitHub 新建仓库，**不要**勾 Add README。
2. 双击 `首次上传到GitHub.bat`，粘贴仓库地址（`https://github.com/你的用户名/仓库名.git`）。
3. Vercel → Add New → Project → 选中这个仓库 → Deploy。

域名已在 `site.json` 里写成 `https://shenblog.vercel.app`，用于 RSS 和 sitemap 的绝对链接。换了域名就改这里。

## 文章格式

```markdown
---
title: "标题"
date: 2026-11-15
updated: 2026-11-15
tags: [随想, 沟通]
draft: false
---

正文……
```

文件名就是地址：`content/posts/2026/2026-11-15-标题.md` → `/posts/2026-11-15-标题/`。
**发布后不要手改文件名**，改了旧链接会失效。

## 常见问题

- **点 vbs 没反应**：多半是 `node` 不在系统 PATH，重装 Node 时勾选 Add to PATH，或改用 `node manager\server.mjs` 手动起服务。
- **窗口里显示「无法连接本地服务」**：服务没起来，先手动跑一次 `node manager\server.mjs` 看报错。
- **发布提示「还不是 git 仓库」**：先跑一次 `首次上传到GitHub.bat`。
- **提交报 Author identity unknown**：`git config --global user.name "名字"`、`git config --global user.email "邮箱"`。
- **push 被拒**：GitHub 上有本地没有的提交，先 `git pull --rebase`。
- **想边改样式边看效果**：双击 `本地预览网站.bat`，打开 `http://127.0.0.1:4321`。
