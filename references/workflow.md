# CSDN 发布流程（playwright-core + CKEditor 路线，2026-10-02 实战验证）

> 旧路线（agent-browser --cdp + 主文档 [contenteditable] + .publish-article-modal__footer 弹窗）**已失效**，相关方法已删除。

## 0. 前置：启动隔离 Chrome

用 isolated-browser skill 的 launch.js 拉起独立 Chrome（CDP 9222）。沙箱会回收 detached 子进程，**必须后台运行并 sleep 保活**：

```bash
node ~/.workbuddy/skills/isolated-browser/scripts/launch.js "https://mp.csdn.net/mp_blog/creation/editor" && sleep 7200   # run_in_background
```

依赖：playwright-core（`~/.workbuddy/binaries/node/workspace/node_modules`，运行时设 `NODE_PATH`）。

## 1. 连接与定位页面

```js
const { chromium } = require('playwright-core');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
// ⚠️ profile 里可能有残留 tab（B站等），必须按 URL 过滤，不能取 pages()[0]
const page = ctx.pages().find(p => p.url().includes('mp.csdn.net'));
await page.bringToFront();   // 被遮挡 tab 的 screenshot 会挂起，先置前
```

- 登录检查：URL 含 `passport.csdn.net` → 需手动登录（手机号+短信验证码；偶有汉字点选验证需用户完成）

## 2. 等待编辑器就绪（CKEditor）

```js
await page.waitForFunction(() => window.CKEDITOR && CKEDITOR.instances && CKEDITOR.instances.editor, { timeout: 30000 });
```

⚠️ 主文档 `[contenteditable]` 数量为 0（编辑器已改版），正文全走 CKEditor API。

## 3. 填标题

`#txtTitle`（textarea，受控组件 → 原生 setter + input/change/keyup/blur 事件）：

```js
const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
setter.call(ta, title);
['input','change','keyup','blur'].forEach(e => ta.dispatchEvent(new Event(e, {bubbles:true})));
```

## 4. 填正文 + 插图（段落之间）

```js
// 4.1 上半部分
CKEDITOR.instances.editor.setData(partA);
// 4.2 光标移末尾
const ed = CKEDITOR.instances.editor; ed.focus();
const range = ed.createRange(); range.moveToElementEditEnd(ed.editable());
ed.getSelection().selectRanges([range]);
// 4.3 paste 插图（base64 → File → DataTransfer → ClipboardEvent）
const byteStr = atob(b64); /* → Uint8Array → File('image.jpg', {type:'image/jpeg'}) */
const dt = new DataTransfer(); dt.items.add(file);
ed.document.$.body.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles:true, cancelable:true}));
// 4.4 轮询 ed.getData().includes('<img')（约 1~2 分钟内上传完成，src 变 i-blog.csdnimg.cn 外链）
// 4.5 光标再移末尾，ed.insertHtml(partB)  ← 图片即落在段落之间
```

❌ 不可行：工具栏「图像」按钮（boundingBox 全 0）、`input[type=file]` 直填（CKEditor 上传对话框不可靠）。

## 5. 打开发文设置面板

- 真实鼠标点击**顶部工具栏**「发布文章」（`getBoundingClientRect().y < 80`，取元素中心）
- 展开的是**内联设置面板**（无 modal、无 `.publish-article-modal__footer`）
- ⚠️ 右侧 AI助手面板可能遮挡设置面板 → 其下方元素点击报 "intercepts pointer events"，先关 AI 面板

## 6. 加文章标签（必填！）

1. 点「添加文章标签」——入口常在视口外（y≈1156），**先 `scrollIntoView({block:'center'})` 再真实鼠标点击**
2. 弹「标签」对话框，搜索框 placeholder=`请输入文字搜索，Enter键可添加自定义标签`
   ⚠️ 用 placeholder 含「请输入文字搜索」精确匹配；泛化匹配 `input[type=text]` 会误中「创作话题」下拉
3. `click → fill('') → type(标签词) → Enter` 生成 chip；重复加多个标签
4. 验证：文档标签行出现 chip（如 `婚庆用车 ×`）；完成后对话框 × 关闭

❌ 不可行：隐藏 `.tag__option-chk` checkbox（假入口）；`Escape` 关弹层。

## 7. 发布

- 滚动到面板底部，真实鼠标点**「发布博客」**（橙色按钮）
- 成功判定：URL 跳转 `mp.csdn.net/mp_blog/creation/success/{articleId}`；页面提示「发布成功！正在审核中」
- 文章链接：`blog.csdn.net/<uid>/article/details/{articleId}`

## 8. 已验证案例

- **2026-10-02：《婚车租车怎么选才不踩坑？头车、车队、价格全攻略》，文章ID 166991170**
  （814 字 + 宾利婚车配图插在第二/三节之间 + 标签「婚庆用车、婚庆婚车车队」；publish_pw.js 全流程跑通）
