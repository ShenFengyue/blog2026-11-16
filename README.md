# 我的博客

本地写、一键发布到 GitHub、Vercel 自动上线的个人博客。零依赖：不需要 `npm install`，只要能跑 `node` 就行。

## 目录

```
blog/
├── content/posts/       文章（唯一内容源，按年份分目录）
├── content/about.md     关于页
├── public/              样式、脚本、图片（图片会自动存到 uploads/）
├── scripts/build.mjs    生成静态站点到 dist/
├── scripts/serve.mjs    本地预览
├── manager/             本地管理器（server.mjs + 网页界面）
├── site.json            站名、口号、作者、线上域名
└── vercel.json          Vercel 构建配置
```

## 第一次：上传到 GitHub（只做一次）

1. 在 GitHub 网页上新建一个仓库，名字随意，**不要**勾选 Add README。
2. 双击 `首次上传到GitHub.bat`，把仓库地址粘进去（`https://github.com/你的用户名/仓库名.git`）。
3. 在 Vercel 里点 **Add New → Project**，选中这个仓库，直接 Deploy。

之后每次发布，Vercel 会自动重新构建，不需要再手动点。

## 日常写作

双击 `启动管理器.bat`，浏览器会打开 `http://127.0.0.1:5178`：

- 左边选文章，中间写正文，右边是发布后长什么样的实时预览。
- `Ctrl+S` 保存（只是存到本地文件，还没上传）。
- 点 **发布到 GitHub**：先本地构建校验，再 `git commit` + `git push`，Vercel 约 30–60 秒后上线。
- 「草稿」勾上后不会出现在线上站点，但本地预览仍然可见。

想看站点本地效果：双击 `本地预览网站.bat`，打开 `http://127.0.0.1:4321`。

## 文章格式

```markdown
---
title: "标题"
date: 2026-11-15
updated: 2026-11-15
tags: [随想, 沟通]
summary: 一句话摘要，留空则自动取正文前 90 字
draft: false
---

正文……
```

文件名就是文章地址：`content/posts/2026/2026-11-15-标题.md` → `/posts/2026-11-15-标题/`。
**发布后不要改文件名**，改了旧链接就失效了。

## 常见问题

- **发布时提示「还不是 git 仓库」**：先跑一次 `首次上传到GitHub.bat`。
- **提交失败提示 Author identity unknown**：设置一次
  `git config --global user.name "你的名字"` 和 `git config --global user.email "你的邮箱"`。
- **push 被拒（non-fast-forward）**：说明 GitHub 上有本地没有的提交，先在命令行 `git pull --rebase` 再发布。
- **改了 `site.json` 的 url**：RSS 和 sitemap 里的域名会跟着变。
- **图片**：在管理器里直接粘贴或拖进正文，会自动存到 `public/uploads/年-月/` 并插入链接。
