# agent-browser --cdp 命令参考（CSDN 发布相关）

> 本 skill 统一走 **isolated-browser** 路线：`agent-browser --cdp <port>` 直连隔离 Chrome。
> 旧文档里的 `xb` CLI（`xb.cjs run --browser default ...`）已废弃，请勿使用。

## 基础调用格式

所有命令都带 `--cdp <port>`（默认 9222，可用环境变量 `ISOB_CDP_PORT` 覆盖）：

```bash
agent-browser --cdp 9222 <command> [args]
```

## 常用命令

### 打开页面
```bash
agent-browser --cdp 9222 open "https://mp.csdn.net/mp_blog/creation/editor"
```

### 等待页面加载
```bash
agent-browser --cdp 9222 wait --load networkidle
```

### 获取当前 URL
```bash
agent-browser --cdp 9222 get url
```

### 截图
```bash
agent-browser --cdp 9222 screenshot "C:\Users\XXX\.qclaw\csdn_editor.png"
```
截图路径需存在，不存在先创建。

### 获取快照（可访问性树）
```bash
agent-browser --cdp 9222 snapshot -i   # 含 iframe
agent-browser --cdp 9222 snapshot -d 2 # 限制深度
```

### 执行 JavaScript
```bash
# 直接字符串（简单表达式）
agent-browser --cdp 9222 eval "document.title"

# base64 编码（复杂脚本 + 中文，强烈推荐）
agent-browser --cdp 9222 eval --base64 <base64>
```
**重要**：
- 顶层 `return` 会报错 → 用 IIFE 包装 `(function(){ ... return x; })()`
- 中文和特殊字符**必须** base64 编码（Node：`Buffer.from(js,'utf8').toString('base64')`）

### 真实输入 / 键盘
```bash
# fill 真实填写（对 Vue/React 受控组件有效，走真實输入）
agent-browser --cdp 9222 fill "input[placeholder*='搜索']" "敬老"

# 按键
agent-browser --cdp 9222 press Enter
agent-browser --cdp 9222 press Escape   # ⚠️ 发布对话框内不要用（会取消整个对话框）
```

### 真实鼠标（点击 Vue @click 按钮必须用这个）
```bash
# 移动 + 按下 + 抬起（模拟真实点击）
agent-browser --cdp 9222 mouse move 913 577
agent-browser --cdp 9222 mouse down
agent-browser --cdp 9222 mouse up
```
- 坐标必须取**元素中心**：`getBoundingClientRect()` 的 `x+width/2, y+height/2`。
- CSDN 发布按钮：编辑器底部状态栏「发布文章」≈(713,577)，对话框 footer「发布文章」≈(913,577)。

## 典型序列（发布一篇带标签的文章）

```bash
# 1. 打开编辑器
agent-browser --cdp 9222 open "https://mp.csdn.net/mp_blog/creation/editor"

# 2. 等待加载
agent-browser --cdp 9222 wait --load networkidle

# 3. 填标题（用 base64 eval + 原生 setter，见 lib.js fillTitle）
# 4. 填正文（contenteditable + input 事件，见 lib.js fillBody）

# 5. 点编辑器底部「发布文章」打开对话框（真实鼠标，中心坐标实时取）
agent-browser --cdp 9222 mouse move <cx> <cy>
agent-browser --cdp 9222 mouse down
agent-browser --cdp 9222 mouse up

# 6. 加标签：点「添加文章标签」→ fill 搜索框 → Enter
# 7. 点对话框 footer「发布文章」（真实鼠标，标签弹层保持打开不影响）

# 8. 确认成功：URL 变为 .../creation/success/<id>
agent-browser --cdp 9222 get url
```

## 已知不可行的方法（请勿再用）
- ❌ `xb` CLI 任何命令
- ❌ `dispatchEvent('click')` 点 Vue 发布按钮（合成事件不生效）
- ❌ `CKEDITOR.instances['editor'].setData()` 作为正文主方案（新版不可靠，仅兜底）
- ❌ 勾选隐藏 `.tag__option-chk` checkbox 加标签
- ❌ 发布对话框内按 `Escape` 关标签弹层（会取消整个对话框）
