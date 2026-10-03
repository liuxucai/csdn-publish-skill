# CSDN Publisher 问题排查（v3 playwright-core + CKEditor 路线实战版）

> 2026-10-02 发布《婚车租车攻略》（文章ID 166991170）全量踩坑整理。
> 已删除失效方法：xb CLI、agent-browser 路线、主文档 [contenteditable] 注入、旧发布弹窗选择器。

---

## 一、环境与连接

### Q1: waitForSelector('[contenteditable]') 超时（2026-10-02 最大变化）
**现象**：老脚本等主文档 `[contenteditable]` 30 秒超时；检查发现 `document.querySelectorAll('[contenteditable]').length === 0`。
**根因**：CSDN 编辑器已改版为 **CKEditor + iframe**（`cke_wysiwyg_frame`），正文不在主文档。
**解决**：改用 `page.waitForFunction(() => window.CKEDITOR?.instances?.editor)`；正文读写全走 CKEditor API（`setData` / `insertHtml` / `getData`）。

### Q2: 连接后操作跑错页面（profile 残留旧 tab）
**现象**：隔离 profile 里残留 B 站等旧 tab（如 `member.bilibili.com`），`pages()[0]` 不是 CSDN。
**解决**：`ctx.pages().find(p => p.url().includes('mp.csdn.net'))`，找不到再新建 page 并导航。

### Q3: page.screenshot 永久挂起
**现象**：对被遮挡/后台 tab 截图超时（等待 fonts/render 永不完成），导致整个脚本卡死。
**解决**：截图前先 `page.bringToFront()`；调试优先用 DOM eval（`evaluate`）代替截图。

### Q4: 沙箱回收 detached Chrome 子进程
**现象**：脚本里 spawn 的隔离 Chrome（detached+unref）在命令结束后被杀。
**解决**：launch 命令用后台任务跑并 `&& sleep 7200` 保活。

---

## 二、编辑器填充阶段

### Q5: 正文 innerHTML + input 事件方案失效
**现象**：旧方案对主文档 `[contenteditable]` 设 innerHTML——如今根本没有该元素。
**解决**：`CKEDITOR.instances.editor.setData(html)`（整体）/ `insertHtml(html)`（光标处追加）。标题不受影响，仍是 `#txtTitle`（textarea 受控组件，原生 setter + input 事件）。

### Q6: 工具栏「图像」按钮不可点
**现象**：`.cke_button__image` 有 2 个实例，但 `getBoundingClientRect()` 全为 `{0,0,0,0}`（offsetParent 为 null），boundingBox 为 null，真实鼠标点击落空。
**解决**：放弃按钮路线，改 paste 事件插图（见 Q7）。

### Q7: 正文插图无可靠上传入口
**现象**：CKEditor 图片上传对话框打不开 / 无可直接 `setInputFiles` 且插入位置可控的 `input[type=file]`。
**解决（唯一验证可行）**：**paste 事件**——
```js
// base64 → Uint8Array → File → DataTransfer → ClipboardEvent('paste')
ed.document.$.body.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles:true, cancelable:true}));
```
CSDN 自动上传为图床外链（`i-blog.csdnimg.cn/direct/xxx.jpeg`），轮询 `getData().includes('<img')` 确认（约 1~2 分钟）。

### Q8: 图片插入位置控制（要落在段落之间）
**解决**：`setData(上半部分)` → 光标 `moveToElementEditEnd` → paste 图片 → 光标再移末尾 → `insertHtml(下半部分)`。三步拼接后图片正好夹在中间段落。

---

## 三、发布面板阶段（新 UI）

### Q9: `.publish-article-modal__footer` 不存在 / 底部没有发布按钮
**现象**：点击「发布文章」后等旧 modal 选择器超时；底部状态栏也没有发布按钮。
**根因**：发布 UI 改版——「发布文章」按钮移到**顶部工具栏**（y<80），点击展开**内联发文设置面板**（非弹窗）。
**解决**：真实鼠标点顶部「发布文章」→ 在面板内操作 → 最终点面板底部**「发布博客」**橙色按钮。

### Q10: 设置面板元素点击被拦截（element intercepts pointer events）
**现象**：点击「添加文章标签」后搜索框输入时，click 报 `el_mcm-select__selected-item ... intercepts pointer events`。
**根因**：右侧 **AI助手面板**覆盖在发文设置面板上方。
**解决**：先关闭 AI 助手面板；或用 `scrollIntoView` + 真实鼠标点击目标元素实时中心。

### Q11: 「添加文章标签」点击无反应
**现象**：元素 offsetParent 非 null（可见），但 boundingBox y≈1156 超出视口（视口高约 610），点击落空。
**解决**：先 `el.scrollIntoView({block:'center'})`，等 800ms，再取实时中心真实鼠标点击。

### Q12: 标签词打进了错误输入框（话题下拉）
**现象**：泛化匹配 `input[type=text]` 命中 `el_mcm-select__input`（「创作话题」下拉），输入失败且点击被拦截。
**解决**：标签弹窗搜索框用 placeholder 精确匹配：`(i.placeholder||'').includes('请输入文字搜索')`。

### Q13: 标签是必填项，空标签被静默拦截（历史坑，仍有效）
**现象**：面板开着、点击正确，但点发布后无报错、无 toast、URL 不变。
**根因**：「文章标签」带红色 `*` 必填；封面/摘要/分类非必填。
**解决**：先加标签再发布；脚本在无标签时打印警告。

### Q14: 标签弹窗关闭方式
**现象**：Enter 加完标签弹窗不自动关；担心 Escape 误取消。
**解决**：点对话框右上角 **×** 关闭；或直接进行下一步（滚动到「发布博客」点击）。注意：`Escape` 在旧版会取消整个发布对话框，避免使用。

---

## 四、验证与收尾

### Q15: 如何判定发布成功
**解决**：URL 跳转 `mp.csdn.net/mp_blog/creation/success/{articleId}`；页面显示「发布成功！正在审核中」；文章链接 `blog.csdn.net/<uid>/article/details/{articleId}`。
（2026-10-02 实例：`/creation/success/166991170`）

### Q16: 草稿横幅干扰
**现象**：编辑器顶部显示历史草稿（如「小米扫地机器人…继续编辑」），担心误操作。
**解决**：编辑器为空（`getData().length === 0`）即可放心写入新文；草稿横幅无需处理，不影响填充与发布。

---

## 通用注意事项
- 驱动统一 **playwright-core 直连 CDP 9222**（`NODE_PATH` 指向含 playwright-core 的 node_modules）。
- 受控组件（Vue/React/textarea）一律原生 setter + 事件派发；按钮一律**真实鼠标**点元素中心。
- 视口外元素先 `scrollIntoView`；坐标每次重新测量，不记死。
- 空标签 = 静默拦截；正文截图前先 `bringToFront()`。
