# CSDN 发布流程（isolated-browser 路线，已实战验证 2026-07-18）

## 0. 前置：启动隔离 Chrome
`scripts/lib.js` 的 `ensureChrome()` 会调用 `isolated-browser/scripts/launch.js` 拉起独立 Chrome（profile `~/.chrome_qclaw_stable`），随后所有操作经 `agent-browser --cdp 9222` 驱动。**不要**用 xb CLI。

## 1. 打开编辑器
导航至 `https://mp.csdn.net/mp_blog/creation/editor`

## 2. 检查登录
- 已登录（页面存在 `contenteditable` 或标题 input）→ 直接进入第 3 步
- 未登录（URL 含 passport.csdn.net）→ 调 `doLogin()`：
  - `navigateTo` 到 `https://passport.csdn.net/account/login`
  - **真实鼠标**点「验证码登录」tab（别点成页面头部文字）
  - 原生 setter 填手机号（React 受控组件）
  - 如有汉字点选验证 → 提示用户手动完成（插→邦→万→木）
  - **真实鼠标**点「获取验证码」→ 短信到手机
  - 用户填入 6 位验证码登录

## 3. 填标题
Vue 受控组件，用原生 setter + input 事件：

```javascript
var ta = document.getElementById('txtTitle')
  || document.querySelector('input.article-title-input, input[placeholder*="标题"]');
var proto = ta.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
setter.call(ta, '文章标题');
['input','change','keyup','blur'].forEach(e => ta.dispatchEvent(new Event(e, {bubbles:true})));
```

## 4. 填正文（关键步骤）
编辑器正文区是 `contenteditable`（Vue 受控组件）：

```javascript
var editable = document.querySelector('[contenteditable]');
editable.innerHTML = '<p>段落1</p><p>段落2</p>';
editable.dispatchEvent(new Event('input', {bubbles:true}));
```

- ⚠️ 旧文档里的 `CKEDITOR.instances['editor'].setData()` 在新版编辑器上**不可靠**（字数可能仍显示 0），仅作兜底。
- ❌ 不要直接 `document.querySelector('[contenteditable]').innerHTML = ...` 后**不**派发 `input` 事件（Vue 读不到）。
- HTML 换行：段落用 `<p>`，段内换行用 `<br>`。

## 5. 发布（两步，真实鼠标）
### 5.1 打开发布对话框
真实鼠标点编辑器底部状态栏的「发布文章」按钮（中心约视口 `(713,577)`，但实际请用 `getBoundingClientRect()` 取实时中心）。对话框出现 `.publish-article-modal__footer`。

### 5.2 加标签（必填！否则静默拦截）
```javascript
// 真实鼠标点「添加文章标签」
// 弹层搜索框 input[placeholder*='搜索'] 用 agent-browser fill 输入标签词
// 再 press Enter 生成 chip（弹层不关闭、也不要按 Escape）
```
- ⚠️ **「文章标签」是必填**（红色 `*`）。空标签点发布会被**静默拦截**：无报错、无 toast、对话框不关、URL 不变。
- ⚠️ **不要按 `Escape`** 关标签弹层——`Escape` 会整体取消整个发布对话框并丢弃已加标签。
- ⚠️ 标签入口是弹出的搜索框（自定义标签 + Enter），不是隐藏 checkbox（`.tag__option-chk` 勾选无效）。

### 5.3 点最终发布
真实鼠标点发布对话框 footer 最右的「发布文章」按钮（中心约 `(913,577)`，实际取实时中心）。标签弹层开着也不影响点击 footer 按钮。

## 6. 判定发布成功
- URL 变为 `https://mp.csdn.net/mp_blog/creation/success/{articleId}`
- 页面显示「发布成功！正在审核中」
- 文章链接：`https://blog.csdn.net/<uid>/article/details/{articleId}`（从成功页「查看文章」拿）

## 7. 关键陷阱（实战踩过）
1. **Vue/React 受控组件**：填值用原生 setter + `dispatchEvent('input')`；按钮用**真实鼠标**点击。`dispatchEvent('click')` 对 Vue `@click` 无效。
2. **点击坐标取中心**：`getBoundingClientRect()` 的 `left/top` 是左上角，点中心要 `x+width/2, y+height/2`。
3. **多 tab 跑错 eval**：若曾 `open` 过管理页 tab，eval/click 会作用在错误 tab，造成「对话框没开」假象。操作前确认激活的是编辑器 tab。
4. **视口坐标漂移**：多 tab / 窗口切换后固定坐标会漂移，每次点击前重新取实时坐标。
5. **标签必填静默拦截**：空标签点发布无任何反应，必须先加标签。
6. **Escape 误取消对话框**：加完标签直接点发布即可，别按 Escape。
7. **标签 picker 行为**：`Enter` 提交标签后弹层不自动关闭，这是正常的，无需额外处理。

## 8. 已验证案例
- 2026-07-04：成功发布《世界和平：从理解开始》(944字)，文章ID 162552874（旧 CKEditor 路线）
- 2026-07-18：成功发布《敬老，是藏在三件小事里的日常修行》，文章ID 162989125（isolated-browser 路线，标签「敬老」必填已验证）
