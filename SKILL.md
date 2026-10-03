---
name: csdn-publisher
description: CSDN创作中心（mp.csdn.net）文章自动发布流程 v3。通过 isolated-browser skill 拉起隔离 Chrome（CDP 9222），再用 playwright-core 直连驱动 + CKEditor API 完成发布，支持正文插图（paste 事件上传）与多标签。适用于 Windows + 正式版 Chrome + Node.js 环境。触发词：CSDN发布、CSDN文章发布、发布文章到CSDN。

验证状态：✅ v3 已验证（playwright-core + CKEditor 路线，2026-10-02 实战发布成功，含正文插图+双标签）
---

# CSDN 文章自动发布 Skill

## 浏览器启用（标准方式 · 必须）

> 本 skill 启用浏览器时，**统一调用 `isolated-browser` skill** 拉起隔离 Chrome 实例（CDP 端口 9222）。
> 后台保活方式（沙箱会回收 detached 子进程）：
>
> ```bash
> # 必须用 run_in_background 跑，命令末尾 sleep 保活
> node <isolated-browser>/scripts/launch.js "https://mp.csdn.net/mp_blog/creation/editor" && sleep 7200
> ```

## 适用场景

- 自动化将文章发布到 CSDN 创作中心（支持标题、正文、段落间插图、多标签）

## 环境要求

| 项目 | 要求 |
|------|------|
| 浏览器 | 正式版 Chrome（由 isolated-browser 拉起隔离实例，profile `~/.chrome_qclaw_stable`） |
| 驱动方式 | **playwright-core 直连 CDP**（`chromium.connectOverCDP('http://127.0.0.1:9222')`） |
| 依赖 skill | `isolated-browser`（提供 launch.js） |
| Node 依赖 | playwright-core（本机位于 `~/.workbuddy/binaries/node/workspace/node_modules`，运行时设 `NODE_PATH`） |
| 登录手机号 | 环境变量思路 `CSDN_PHONE`（不要写死在脚本里） |

## 核心设计（2026-10-02 编辑器改版后）

### ✅ 编辑器：CKEditor + iframe（旧 [contenteditable] 路线已失效）
- 主文档中 `[contenteditable]` 数量为 **0**，正文编辑区在 iframe（`cke_wysiwyg_frame`）内
- 填正文统一走 **`window.CKEDITOR.instances.editor`** API：
  - `editor.setData(html)` 整体写入；`editor.insertHtml(html)` 在光标处追加
  - 等待就绪：`page.waitForFunction(() => window.CKEDITOR?.instances?.editor)`
- 标题仍是 `#txtTitle`（textarea 受控组件 → 原生 setter + `dispatchEvent('input')`）

### ✅ 正文插图：paste 事件（唯一验证可行方案）
- 工具栏「图像」按钮 getBoundingClientRect 全为 0，**不可点击**
- 唯一可靠方案：构造 `File → DataTransfer → ClipboardEvent('paste')` 派发到
  `CKEDITOR.instances.editor.document.$.body`，CSDN 自动上传为 `i-blog.csdnimg.cn` 图床外链
- 插在段落之间：`setData(上半部分)` → 光标 `moveToElementEditEnd` → paste 图片 → `insertHtml(下半部分)`

### ⚠️ 发布 UI：内联设置面板（无 modal）
- 「发布文章」按钮在**顶部工具栏**（y<80），点击展开**内联发文设置面板**——没有 `.publish-article-modal__footer`
- 最终发布按钮是面板底部的**「发布博客」**（橙色）
- 右侧 **AI助手面板会遮挡设置面板**，其下方元素点击会被拦截（"intercepts pointer events"）——必要时先关 AI 面板
- 视口外元素（如标签入口 y≈1156）必须先 `scrollIntoView` 再真实鼠标点击

### ⚠️ 文章标签是必填项（关键坑）
- 「文章标签」带红色 `*`，空标签点发布会被**静默拦截**（无报错、无 toast、URL 不变）
- 标签流程：点「添加文章标签」（先滚动到可见）→ 弹「标签」对话框 → 搜索框
  （placeholder=`请输入文字搜索，Enter键可添加自定义标签`）输入标签词 → `Enter` 生成 chip（可加多个）→ 对话框 × 关闭
- ⚠️ 搜索框匹配必须用 placeholder 含「请输入文字搜索」，泛化匹配 `input[type=text]` 会误中「创作话题」下拉（`el_mcm-select__input`）

## 使用

```bash
# 前置：启动隔离 Chrome（run_in_background 保活）
node ~/.workbuddy/skills/isolated-browser/scripts/launch.js "https://mp.csdn.net/mp_blog/creation/editor" && sleep 7200

# 发布（正文 HTML 文件中用 <!--IMAGE--> 标记插图位置）
NODE_PATH=~/.workbuddy/binaries/node/workspace/node_modules \
node scripts/publish_pw.js \
  --title "文章标题" \
  --body-file article.html \
  --image "D:/path/pic.jpg" \
  --tags "标签1,标签2" \
  --publish
```

## 文件结构

| 文件 | 说明 |
|------|------|
| `scripts/publish_pw.js` | 核心发布脚本 v3（playwright-core 直连 CDP：标题/正文/插图/标签/发布，实战验证） |
| `references/workflow.md` | 详细流程文档（v3 CKEditor 路线全流程 + 已验证案例） |
| `references/troubleshooting.md` | 问题排查（实战踩坑 → 根因 → 解法，2026-10-02 全量更新） |
| `templates/article.txt` | 正文文件模板（含 `<!--IMAGE-->` 插图标记用法） |

## 已知限制

- CSDN 无传统账号密码登录，仅支持微信/验证码/APP 扫码；汉字点选验证码需用户手动完成
- 标签/分类需在设置面板内通过 UI 交互添加（不能用隐藏 checkbox 勾选）
- 封面会自动取正文第一张图；分类专栏、话题等未自动化（非必填）

## 已验证案例
- 2026-07-04：《世界和平：从理解开始》(944字)，文章ID 162552874（旧 CKEditor 路线）
- 2026-07-18：《敬老，是藏在三件小事里的日常修行》，文章ID 162989125（agent-browser 路线，已废弃）
- **2026-10-02：《婚车租车怎么选才不踩坑？头车、车队、价格全攻略》，文章ID 166991170（v3 playwright-core+CKEditor 路线：正文插图 i-blog.csdnimg.cn 外链 + 双标签「婚庆用车/婚庆婚车车队」）**
