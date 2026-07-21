# CSDN Publisher 问题排查（isolated-browser 路线实战版）

> 本文件基于 2026-07-18 实战发布《敬老，是藏在三件小事里的日常修行》的真实踩坑整理。
> 路线：isolated-browser 拉起隔离 Chrome + `agent-browser --cdp 9222` 驱动。旧 xb CLI 路线的方法已删除。

---

## 一、登录阶段

### Q1: iframe src 显示 passport.csdn.net（未登录）
**现象**：打开编辑器页后，被跳到登录页。
**解决**：脚本自动检测登录状态；未登录 → `doLogin()` 进入验证码登录流程；登录后刷新编辑器即可。

### Q2: CSDN 登录无账号密码入口
**现象**：登录页只有微信/验证码/APP 三种方式。
**原因**：CSDN 新版已彻底移除账号密码表单。
**解决**：
- 用「手机号 + 短信验证码」登录（`CSDN_PHONE` 环境变量提供手机号）。
- 偶尔出现汉字点选验证（插→邦→万→木），脚本提示用户手动完成。
- 不要找 `login-third-passwd` 元素，不存在。

### Q3: 验证码登录 tab 点击失败（点了没反应 / 短信没发）
**现象**：脚本点「获取验证码」后短信没真正发送——实际命中了页面头部文字而非「验证码登录」tab。
**解决**：点「验证码登录」必须用**真实鼠标**点击（见 Q7），且先确认点中的是 tab 而不是页面其它同名文字。

### Q4: 登录页手机号填不进（React 受控组件）
**现象**：`agent-browser fill` / `keyboard type` 偶尔不生效，值没进模型。
**解决**：用原生 setter 注入（React/原生受控组件通用）：
```js
var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
setter.call(input, '手机号');
input.dispatchEvent(new Event('input', { bubbles: true }));
```

---

## 二、填表与发布阶段（核心卡点）

### Q5: 发布按钮用 dispatchEvent 点了没反应
**现象**：检出对话框已开，但 `dispatchEvent('click')` 点发布按钮，对话框不关、无成功提示。
**原因**：CSDN 是 Vue 受控组件，Vue 的 `@click` 监听器不吃合成事件。
**解决**：必须用**真实鼠标坐标点击**（`mouse move/down/up`），不能用 JS 事件派发。

### Q6: 坐标取成左上角导致点空
**现象**：脚本取出的坐标是 `getBoundingClientRect()` 的 `left/top`（元素左上角），点击未命中按钮。
**解决**：点击坐标必须取**元素中心** `(x+width/2, y+height/2)`。
- 编辑器底部状态栏「发布文章」中心 ≈ (713,577)
- 发布对话框 footer 最右「发布文章」中心 ≈ (913,577)

### Q7: 多 tab 切换导致 eval 跑错 tab（最大干扰源）
**现象**：曾 `open` 过「文章管理页」tab，之后 `eval`/`click` 作用在管理页而非编辑器，造成「对话框没开」「坐标命中管理页元素」等假象。
**解决**：操作前确认 `agent-browser` 当前激活 tab 就是编辑器 tab（应只剩编辑器 tab）；必要时切回编辑器 tab。

### Q8: 视口坐标漂移
**现象**：多次 `open`/切换窗口后，固定坐标 (913,577) 漂移，真实点击落空。
**解决**：每次点击前**重新 `getBoundingClientRect()` 取实时中心坐标**，再 `mouse` 点击，不依赖记忆坐标。

### Q9: 发布被静默拦截（标签必填，最关键卡点）
**现象**：对话框开着、tab 正确、坐标正确、真实鼠标点击——但对话框不关、无成功/失败提示、无任何报错。
**原因**：发布对话框里 **「文章标签」是必填项（红色 `*`）**，空标签时会被静默拦截；封面/摘要/分类均为非必填。
**解决**：先加标签再发布——
1. 点「添加文章标签」
2. 弹出的搜索框 `input[placeholder*='搜索']` 用 `fill` 输入标签词
3. `press Enter` 生成标签 chip
4. 再真实坐标点击对话框 footer 的「发布文章」→ 成功跳转成功页

### Q10: 误把标签词打进标题框（选择器误匹配）
**现象**：遍历 `input` 找标签框时误匹配到标题输入框（placeholder 含"输入"二字），把标签词写进了标题。
**解决**：改用精准选择器 `input[placeholder*='搜索']` 定位标签搜索框；若标题被污染，用 setter 还原标题。

### Q11: 标签 picker 弹层行为踩坑
**现象**：
- 搜索框 `Enter` 提交标签后，picker 弹层**不会自动关闭**；
- 按 `Escape` 关闭 picker，结果**整个发布对话框被取消**，已加标签也丢了。
**解决**：**不要按 `Escape`**。picker 开着时直接点 footer 的「发布文章」按钮即可（发布按钮在 picker 下方，坐标仍可见可点）。

### Q12: 隐藏 checkbox 是假入口
**现象**：DOM 里存在 `.tag__option-chk`（值：生活/数据库/面试题/Go…），但都是隐藏元素，勾选无效；真正的入口是弹出的搜索框。
**解决**：放弃勾隐藏 checkbox，改用真实交互路径——点「添加文章标签」打开 picker，在搜索框 `fill` + `Enter` 添加自定义标签。

### Q13: 正文字数显示 0 / 内容不生效
**现象**：填完正文后字数统计显示「共 0 字」，或正文空白。
**原因**：只改了 `innerHTML` 没派发 `input` 事件（Vue 读不到）；或误用了不可靠的 `CKEDITOR.setData()` 兜底。
**解决**：对 `contenteditable` 设 `innerHTML` 后必须 `dispatchEvent(new Event('input',{bubbles:true}))`。当前编辑器是 Vue 受控组件，`CKEDITOR` 仅作兜底，优先用 contenteditable 方案。

---

## 三、验证与收尾

### Q14: 如何判定发布成功
**现象**：点了发布后不确定到底成没成。
**解决**：成功的三重判定——
- URL 跳转到 `mp.csdn.net/mp_blog/creation/success/<id>`
- 页面提示「发布成功！正在审核中」
- 文章链接 `blog.csdn.net/<uid>/article/details/<id>`（从成功页「查看文章」拿到）

---

## 通用注意事项
- 所有浏览器操作走 `agent-browser --cdp 9222`，**不要用 xb CLI**（旧路线已废弃）。
- 移动/点击/输入一律走真实底层事件，受控组件不认合成事件。
- 多 tab 场景先确认激活 tab 是目标页面。
- 坐标类操作每次重新测量，别记死。
- 不显示字数（正文）= 必失败信号；空标签 = 静默拦截。
