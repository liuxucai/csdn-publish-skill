---
name: csdn-publisher
description: CSDN创作中心（mp.csdn.net）文章自动发布流程。通过 isolated-browser skill 拉起隔离 Chrome，再用 agent-browser --cdp 直连驱动完成发布。适用于 Windows + 正式版 Chrome + agent-browser 环境。触发词：CSDN发布、CSDN文章发布、发布文章到CSDN。

验证状态：✅ v2 已验证（isolated-browser 路线，2026-07-18 实战发布成功）
---

# CSDN 文章自动发布 Skill

## 浏览器启用（标准方式 · 必须）

> 本 skill 启用浏览器时，**统一调用 `isolated-browser` skill** 拉起隔离 Chrome 实例。
> 若该 skill 未安装，从以下地址安装后再使用：
>
> ```bash
> git clone https://github.com/liuxucai/isolated-browser-skill \
>   <你的工作区>/skills/isolated-browser
> ```
>
> `isolated-browser` 启动一个与用户默认浏览器完全隔离的独立 Chrome 实例，并用
> `agent-browser --cdp` 直连驱动，绕开任何安全锁；适用于所有需要“不打扰用户浏览器”的
> 发布/填表类 skill。
>
> **实现状态**：随附脚本 `scripts/lib.js` 的 `ensureChrome()` 调用 `isolated-browser` 的
> `scripts/launch.js`（隔离实例 + `--cdp` 直连），`eval / fill / press / mouse / screenshot`
> 等全部走 `agent-browser --cdp` 路线，**不再依赖 xb CLI**。

## 适用场景

- 自动化将文章发布到 CSDN 创作中心
- 一次性文章发布任务

## 环境要求

| 项目 | 要求 |
|------|------|
| 浏览器 | 正式版 Chrome（由 isolated-browser 拉起隔离实例） |
| 控制工具 | `agent-browser` CLI（全局，带 `--cdp`） |
| 依赖 skill | `isolated-browser`（提供 launch.js / connect.js） |
| 脚本语言 | Node.js（封装所有 agent-browser 调用） |
| 登录手机号 | 环境变量 `CSDN_PHONE`（**不要写死**在脚本里） |

## 核心设计

### ✅ 浏览器：隔离 Chrome 实例（isolated-browser 路线）
- 经 `isolated-browser/scripts/launch.js` 启动独立 Chrome（profile `~/.chrome_qclaw_stable`）
- 通过 `agent-browser --cdp <port>` 直连，默认端口 9222（可用 `ISOB_CDP_PORT` 覆盖）
- 不影响用户打开的浏览器或其他 CDP 连接

### ⚠️ 登录：CSDN 新版无传统密码登录
- CSDN 新版只支持微信/短信/APP 三种登录方式（**无**账号密码表单入口）
- 登录流程：手机号 + 短信验证码（有时需先完成汉字点选验证，脚本提示用户手动处理）
- 脚本自动检测登录状态，未登录则跳转验证码登录页，让用户配合完成

### ⚠️ 编辑器结构（Vue 受控组件，非纯 CKEditor）
- 当前 CSDN 编辑器是 **Vue 受控组件**：标题是 `input`（或 `#txtTitle`），正文是 `contenteditable` 区。
- 填值必须用 **原生 setter + `dispatchEvent('input')`**；正文区设置 `innerHTML` 后派发 `input` 事件。
- 旧文档里的 `CKEDITOR.instances['editor'].setData()` 在新版编辑器上**不可靠**（字数可能仍显示 0），仅作兜底。
- **发布按钮必须用真实鼠标点击**（`mouse move/down/up`），`dispatchEvent('click')` 对 Vue 的 `@click` 不生效。

### ⚠️ 发布对话框：文章标签是必填项（关键坑）
- 点「发布文章」弹出发布对话框后，**「文章标签」带红色 `*` 为必填**，封面/摘要/分类非必填。
- 空标签点「发布文章」会被**静默拦截**：无报错、无 toast、对话框不关、URL 不变。
- 必须先加标签再发布。标签入口是弹出的搜索框（`input[placeholder*='搜索']`），`fill` 输入后 `press Enter` 生成 chip。
- **绝不能用 `Escape` 关标签弹层**——`Escape` 会整体取消整个发布对话框并丢弃已加标签。

## 使用

```bash
# 方法一：完整发布（含登录检查 + 等待）
$env:CSDN_PHONE="你的手机号"
$env:CSDN_TITLE="文章标题"
$env:CSDN_BODY="文章正文"
$env:CSDN_TAGS="敬老"          # 可选，逗号分隔多个标签；不填则脚本默认加一个
node skills/csdn-publisher/scripts/publish.js

# 方法二：快速发布（假设你已登录、Chrome 已起）
node skills/csdn-publisher/scripts/quick_publish.js
```

## 文件结构

| 文件 | 说明 |
|------|------|
| `scripts/lib.js` | 核心封装库（isolated-browser 路线：launch/connect、验证码登录、标题/正文注入、加标签、真实鼠标发布） |
| `scripts/publish.js` | 完整发布脚本（含登录检查+等待） |
| `scripts/quick_publish.js` | 快速发布脚本 |
| `references/workflow.md` | 详细流程文档（含已验证案例 + 关键陷阱） |
| `references/troubleshooting.md` | 问题排查（14 类实战问题 → 根因 → 解法） |
| `references/commands.md` | agent-browser --cdp 命令参考 |
| `templates/article.txt` | 文章模板（含标题/标签/分类 frontmatter） |

## 已知限制

- CSDN 无传统账号密码登录，仅支持微信/验证码/APP 扫码
- 汉字点选验证码需要用户手动完成
- 封面设置未实现
- 标签/分类需在发布对话框内通过 UI 交互添加（不能用隐藏 checkbox 勾选）

## 已验证案例
- 2026-07-04：成功发布《世界和平：从理解开始》(944字)，文章ID 162552874（旧 CKEditor 路线）
- 2026-07-18：成功发布《敬老，是藏在三件小事里的日常修行》，文章ID 162989125（isolated-browser 路线，标签「敬老」必填已验证）
