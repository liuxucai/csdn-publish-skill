/**
 * CSDN 文章发布 v3（playwright-core 直连 CDP + CKEditor 路线）
 * 2026-10-02 实战验证：文章ID 166991170（婚车租车攻略，正文插图+双标签）
 *
 * 依赖：
 *   - playwright-core（NODE_PATH 指向含 playwright-core 的 node_modules）
 *   - 隔离 Chrome 已启动并开放 CDP（isolated-browser skill 的 launch.js，默认 9222）
 *
 * 用法：
 *   node publish_pw.js --title "标题" --body-file article.html --image D:\pic\11.jpg --tags "标签1,标签2" [--publish]
 *
 * 正文文件（HTML，<p>/<h2> 等标签）中可用标记 <!--IMAGE--> 指定插图位置（段落之间）：
 *   无标记时图片追加在正文中间（前半段末尾）。
 *   不传 --publish 则只填充编辑器（标题/正文/插图/标签），不点发布。
 *
 * 环境变量：ISOB_CDP_PORT（默认 9222）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

// ---------- 参数解析 ----------
function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--title') o.title = argv[++i];
    else if (a === '--title-file') o.title = fs.readFileSync(argv[++i], 'utf8').trim();
    else if (a === '--body') o.body = argv[++i];
    else if (a === '--body-file') o.body = fs.readFileSync(argv[++i], 'utf8');
    else if (a === '--image') o.image = argv[++i];
    else if (a === '--tags') o.tags = argv[++i];
    else if (a === '--publish') o.publish = true;
  }
  return o;
}

const args = parseArgs(process.argv.slice(2));
const CDP_PORT = process.env.ISOB_CDP_PORT || '9222';
const TAGS = (args.tags || '').split(',').map(t => t.trim()).filter(Boolean);
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!args.title || !args.body) {
  console.error('用法: node publish_pw.js --title "标题" --body-file article.html [--image img.jpg] [--tags "a,b"] [--publish]');
  process.exit(1);
}

/** 按插图标记拆分正文；无标记时插在正文中段 */
function splitBody(body) {
  const MARK = '<!--IMAGE-->';
  if (body.includes(MARK)) {
    const [a, ...rest] = body.split(MARK);
    return { partA: a.trim(), partB: rest.join(MARK).trim() };
  }
  const paras = body.match(/<p>[\s\S]*?<\/p>|<h2>[\s\S]*?<\/h2>/g) || [body];
  const mid = Math.ceil(paras.length / 2);
  return {
    partA: paras.slice(0, mid).join('\n'),
    partB: paras.slice(mid).join('\n')
  };
}

/** 真实鼠标点击元素中心（Vue/受控组件必须） */
async function realClick(handle) {
  const b = await handle.boundingBox();
  if (!b) throw new Error('元素无 boundingBox，不可点击');
  const page = handle.page();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  return b;
}

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + CDP_PORT);
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find(p => p.url().includes('mp.csdn.net'));
  if (!page) {
    page = await ctx.newPage();
    await page.goto('https://mp.csdn.net/mp_blog/creation/editor', { waitUntil: 'domcontentloaded' });
  }
  await page.bringToFront();
  console.log('[page]', page.url());
  if (page.url().includes('passport.csdn.net')) {
    console.log('NEED_LOGIN: 请先在隔离浏览器中登录 CSDN（手机号+短信验证码）');
    process.exit(2);
  }
  await page.bringToFront();
  // 等待 CKEditor 就绪（新版编辑器为 CKEditor iframe，主文档无 [contenteditable]）
  await page.waitForFunction(() => window.CKEDITOR && CKEDITOR.instances && CKEDITOR.instances.editor, { timeout: 30000 });
  await sleep(2000);

  // ---- 1. 标题（#txtTitle，textarea 受控组件 → 原生 setter）----
  const titleRes = await page.evaluate((ttl) => {
    const ta = document.getElementById('txtTitle');
    if (!ta) return 'NF';
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ttl);
    ['input', 'change', 'keyup', 'blur'].forEach(e => ta.dispatchEvent(new Event(e, { bubbles: true })));
    return 'OK len=' + ta.value.length;
  }, args.title);
  console.log('[title]', titleRes);
  if (titleRes === 'NF') { console.log('标题框未找到'); process.exit(1); }

  // ---- 2. 正文（CKEditor API；有配图时按标记拆分，图片落在段落之间）----
  const { partA, partB } = splitBody(args.body);
  const setRes = await page.evaluate((html) => {
    CKEDITOR.instances.editor.setData(html);
    return 'OK len=' + CKEDITOR.instances.editor.getData().length;
  }, partA);
  console.log('[body A]', setRes);
  await sleep(2000);

  let hasImg = false;
  if (args.image && fs.existsSync(args.image)) {
    // 光标移到正文末尾（新段落将接在图片后）
    await page.evaluate(() => {
      const ed = CKEDITOR.instances.editor;
      ed.focus();
      const range = ed.createRange();
      range.moveToElementEditEnd(ed.editable());
      ed.getSelection().selectRanges([range]);
    });
    await sleep(500);
    // 插图：paste 事件（工具栏图像按钮不可点、无可靠 file input，paste 是唯一验证可行方案）
    const b64 = fs.readFileSync(args.image).toString('base64');
    await page.evaluate((data) => {
      const ed = CKEDITOR.instances.editor;
      ed.focus();
      const range = ed.createRange();
      range.moveToElementEditEnd(ed.editable());
      ed.getSelection().selectRanges([range]);
      const byteStr = atob(data);
      const bytes = new Uint8Array(byteStr.length);
      for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
      const file = new File([bytes], 'image.jpg', { type: 'image/jpeg' });
      const dt = new DataTransfer();
      dt.items.add(file);
      ed.document.$.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, b64);
    for (let i = 0; i < 45; i++) {
      await sleep(2000);
      hasImg = await page.evaluate(() => CKEDITOR.instances.editor.getData().includes('<img'));
      if (hasImg) break;
    }
    if (!hasImg) { console.log('配图上传失败'); process.exit(1); }
    // 等图片变成图床外链
    for (let i = 0; i < 20; i++) {
      const src = await page.evaluate(() => {
        const m = CKEDITOR.instances.editor.getData().match(/<img[^>]*src="([^"]+)"/);
        return m ? m[1] : '';
      });
      if (src.startsWith('http')) { console.log('[img src]', src.substring(0, 90)); break; }
      await sleep(2000);
    }
    if (partB) {
      const insRes = await page.evaluate((html) => {
        const ed = CKEDITOR.instances.editor;
        ed.focus();
        const range = ed.createRange();
        range.moveToElementEditEnd(ed.editable());
        ed.getSelection().selectRanges([range]);
        ed.insertHtml(html);
        return 'OK len=' + ed.getData().length;
      }, partB);
      console.log('[body B]', insRes);
    }
  } else if (partB) {
    // 无配图：直接追加剩余部分
    const all = partA + '\n' + partB;
    await page.evaluate((html) => {
      CKEDITOR.instances.editor.setData(html);
      return 'OK';
    }, all);
  }
  await sleep(1500);

  // ---- 3. 打开发文设置面板（顶部「发布文章」按钮，真实鼠标）----
  const pubBtn = await page.evaluateHandle(() => {
    const all = Array.from(document.querySelectorAll('div,span,button,a'));
    return all.find(e => (e.innerText || '').trim() === '发布文章' && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().y < 80);
  });
  const pe = pubBtn.asElement();
  if (!pe) { console.log('顶部「发布文章」按钮未找到'); process.exit(1); }
  await realClick(pe);
  console.log('[publish] opened settings panel');
  await sleep(2500);

  // ---- 4. 加文章标签（必填！空标签发布会被静默拦截）----
  for (const tag of TAGS) {
    const addEl = await page.evaluateHandle(() => {
      const all = Array.from(document.querySelectorAll('div,span,a,button'));
      return all.find(e => (e.innerText || '').trim() === '添加文章标签' && e.getBoundingClientRect().width > 0);
    });
    const ae = addEl.asElement();
    if (!ae) { console.log('「添加文章标签」入口未找到'); process.exit(1); }
    await ae.evaluate(el => el.scrollIntoView({ block: 'center' })); // 入口常在视口外，必须先滚动
    await sleep(800);
    await realClick(ae);
    await sleep(2000);
    // 标签弹窗搜索框：placeholder 精确含「请输入文字搜索」（勿用泛化匹配，会误中话题下拉）
    const inp = await page.evaluateHandle(() => {
      return Array.from(document.querySelectorAll('input')).find(i => (i.placeholder || '').includes('请输入文字搜索') && i.getBoundingClientRect().width > 0);
    });
    const ie = inp.asElement();
    if (!ie) { console.log('标签搜索框未找到'); process.exit(1); }
    await ie.click();
    await ie.fill('');
    await ie.type(tag, { delay: 80 });
    await sleep(800);
    await page.keyboard.press('Enter'); // Enter = 生成自定义标签 chip
    await sleep(1200);
    console.log('[tag] added:', tag);
  }
  if (TAGS.length === 0) console.log('⚠️ 未提供标签！CSDN 空标签会被静默拦截');
  await page.bringToFront();
  await page.screenshot({ path: path.join(__dirname, '..', 'csdn_filled.png'), timeout: 15000 }).catch(() => {});

  if (!args.publish) {
    console.log('DONE (未发布，--publish 可加发布步骤)');
    process.exit(0);
  }

  // ---- 5. 关闭标签弹窗（如有 × ）并点「发布博客」（面板底部橙色按钮）----
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(800);
  const pb = await page.evaluateHandle(() => {
    const all = Array.from(document.querySelectorAll('button, div, a, span'));
    return all.find(e => (e.innerText || '').trim() === '发布博客' && e.getBoundingClientRect().width > 0);
  });
  const pbe = pb.asElement();
  if (!pbe) { console.log('「发布博客」按钮未找到'); process.exit(1); }
  await pbe.evaluate(el => el.scrollIntoView({ block: 'center' })).catch(() => {});
  await sleep(500);
  await realClick(pbe);
  console.log('[publish] clicked 发布博客, waiting...');

  // ---- 6. 校验成功 ----
  let ok = false, finalUrl = '';
  for (let i = 0; i < 25; i++) {
    await sleep(3000);
    finalUrl = page.url();
    if (finalUrl.includes('/creation/success/')) { ok = true; break; }
  }
  console.log(ok ? 'SUCCESS:' + finalUrl : 'NOT_SUCCESS:' + finalUrl);
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
