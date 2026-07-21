/**
 * CSDN Publisher - isolated-browser 路线封装（B 路线，已实战验证 2026-07-18）
 *
 * 浏览器启动：isolated-browser/scripts/launch.js（独立隔离 Chrome 实例）
 * 浏览器驱动：agent-browser --cdp <port>（经 isolated-browser/scripts/connect.js）
 * 不再依赖 xb CLI。
 *
 * 关键点（来自实战）：
 *  - 编辑器是 Vue 受控组件：填值用原生 setter + dispatchEvent('input')；正文区设 innerHTML + input 事件。
 *  - 发布按钮必须用「真实鼠标」点击（mouse move/down/up），dispatchEvent('click') 对 Vue 无效。
 *  - 发布对话框中「文章标签」为必填（红色 *），空标签会被静默拦截（无报错、对话框不关）。
 *    必须先在弹出的搜索框里 fill + Enter 加标签，再点发布。
 *  - 标签弹层绝对不要按 Escape（会整体取消发布对话框并丢弃已加标签）。
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// ---- isolated-browser 路径（相对本文件解析，避免硬编码）----
// 本文件位于 <skills>/csdn-publisher/scripts/lib.js
const ISOB_DIR = path.resolve(__dirname, '..', '..', 'isolated-browser');
const connect = require(path.join(ISOB_DIR, 'scripts', 'connect.js'));

const WORKSPACE = process.env.WORKSPACE_DIR || path.join(os.homedir(), '.qclaw');
const STATUS_FILE = path.join(WORKSPACE, 'csdn_status.txt');

const EDITOR_URL = 'https://mp.csdn.net/mp_blog/creation/editor';

// CDP 端口与 isolated-browser 保持一致（默认 9222，可用 ISOB_CDP_PORT 覆盖）
const CDP_PORT = process.env.ISOB_CDP_PORT || 9222;

// 登录手机号：请通过环境变量 CSDN_PHONE 提供；为空则登录流程会提示
const PHONE = process.env.CSDN_PHONE || '';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function writeStatus(msg) {
  try { fs.writeFileSync(STATUS_FILE, msg, 'utf8'); } catch (e) {}
}

// ==================== agent-browser 基础封装 ====================

/** 执行 JS eval（base64 规避中文乱码），返回求值结果字符串。 */
function evalJS(js, timeout) {
  timeout = timeout || 15000;
  var r = connect.ab(['eval', '--base64', Buffer.from(js, 'utf8').toString('base64')], { cdpPort: CDP_PORT, timeout });
  if (r.code !== 0) return '';
  var out = (r.out || '').trim();
  if (!out) return '';
  try {
    var j = JSON.parse(out);
    if (j && typeof j === 'object') {
      if ('result' in j) return j.result == null ? '' : String(j.result);
      if ('value' in j) return j.value == null ? '' : String(j.value);
      if (j.data && 'result' in j.data) return j.data.result == null ? '' : String(j.data.result);
    }
    return out;
  } catch (e) { return out; }
}

async function simpleEval(js, timeout) { return evalJS(js, timeout); }

/** 真实鼠标点击指定视口坐标（Vue @click 只认真实鼠标事件）。 */
async function mouseClick(cx, cy) {
  connect.ab(['mouse', 'move', String(cx)], { cdpPort: CDP_PORT, timeout: 8000 });
  connect.ab(['mouse', 'down'], { cdpPort: CDP_PORT, timeout: 8000 });
  connect.ab(['mouse', 'up'], { cdpPort: CDP_PORT, timeout: 8000 });
  await sleep(300);
}

/** fill：经 agent-browser 真实输入（对 Vue 受控组件有效）。 */
async function fill(sel, text) {
  return connect.ab(['fill', sel, text], { cdpPort: CDP_PORT, timeout: 10000 }).code === 0 ? 'OK' : 'FAIL';
}

async function press(key) {
  return connect.ab(['press', key], { cdpPort: CDP_PORT, timeout: 8000 }).code === 0 ? 'OK' : 'FAIL';
}

/**
 * 找到文本匹配的可视元素中心坐标，并用真实鼠标点击。
 * 返回 'OK cx,cy' 或 'NF'。
 */
async function clickTextReal(textMatch) {
  var js = '(function(){var a=document.querySelectorAll("*");for(var i=0;i<a.length;i++){var t=(a[i].innerText||"").trim();if(t===' + JSON.stringify(textMatch) + '||t.indexOf(' + JSON.stringify(textMatch) + ')>=0){var r=a[i].getBoundingClientRect();if(r.width>0&&r.height>0)return JSON.stringify({cx:Math.round(r.x+r.width/2),cy:Math.round(r.y+r.height/2)});}}return "NF";})()';
  var s = await simpleEval(js);
  if (!s || s === 'NF') return 'NF';
  try {
    var o = JSON.parse(s);
    await mouseClick(o.cx, o.cy);
    return 'OK ' + o.cx + ',' + o.cy;
  } catch (e) { return 'PARSE_ERR:' + s; }
}

// ==================== 独立 Chrome 管理 ====================

async function ensureChrome() {
  console.log('[Chrome] 通过 isolated-browser 拉起独立 Chrome 实例（port ' + CDP_PORT + '）...');

  if (connect.isConnected(CDP_PORT)) {
    console.log('[Chrome] 已连接既有独立实例');
    return;
  }

  var launchJs = path.join(ISOB_DIR, 'scripts', 'launch.js');
  if (!fs.existsSync(launchJs)) {
    throw new Error('未找到 isolated-browser/launch.js，请先安装：https://github.com/liuxucai/isolated-browser-skill');
  }

  console.log('[Chrome] 启动 launch.js ...');
  var { spawn } = require('child_process');
  var child = spawn('node', [launchJs, EDITOR_URL], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  child.on('error', function (e) { console.error('[Chrome] 启动失败:', e.message); });

  for (var i = 0; i < 15; i++) {
    await sleep(2000);
    if (connect.isConnected(CDP_PORT)) {
      console.log('[Chrome] 连接成功');
      return;
    }
    if (i % 5 === 4) console.log('[Chrome] 等待实例启动... (' + ((i + 1) * 2) + 's)');
  }
  throw new Error('无法启动/连接独立 Chrome（port ' + CDP_PORT + '）');
}

// ==================== 页面操作 ====================

async function getUrl() {
  var r = connect.ab(['get', 'url'], { cdpPort: CDP_PORT, timeout: 8000 });
  return (r.out || '').trim();
}

async function navigateTo(url, label) {
  label = label || '';
  console.log('[Nav] ' + (label || url.substring(0, 60)));
  connect.open(url, CDP_PORT);
  connect.ab(['wait', '--load', 'networkidle'], { cdpPort: CDP_PORT, timeout: 25000 });
  await sleep(2000);
  return await getUrl();
}

async function checkLogin() {
  console.log('[Login] 检查登录状态...');
  await sleep(2000);
  try {
    var url = await simpleEval('window.location.href');
    if (!url || url.includes('passport.csdn.net')) return { ok: false, reason: 'NEED_LOGIN' };
    if (!url.includes('mp.csdn.net')) return { ok: false, reason: 'WRONG_PAGE' };

    var hasEditable = await simpleEval('(function(){return document.querySelector("[contenteditable]")?"YES":"NO"})()');
    var hasTitle = await simpleEval('(function(){return document.querySelector("input.article-title-input, input[placeholder*=\\"标题\\"]")?"YES":"NO"})()');
    if (hasEditable === 'YES' || hasTitle === 'YES') return { ok: true };
    return { ok: false, reason: 'UNKNOWN' };
  } catch (e) {
    return { ok: false, reason: 'ERROR', error: e.message };
  }
}

// ==================== 登录（短信验证码）====================

async function doLogin() {
  if (!PHONE) {
    console.log('\n⚠️ 未设置登录手机号！请通过环境变量 CSDN_PHONE 提供你的 CSDN 手机号。');
    writeStatus('NEED_PHONE');
    throw new Error('缺失 CSDN_PHONE 环境变量');
  }

  console.log('[Login] 打开登录页...');
  writeStatus('NEED_USER_LOGIN');
  await navigateTo('https://passport.csdn.net/account/login', '登录页');
  await sleep(3000);

  // 点击「验证码登录」tab（用真实鼠标，避免点击命中头部文字而非 tab）
  var r = await clickTextReal('验证码登录');
  console.log('[Login] 点击验证码登录: ' + r);
  await sleep(2000);

  // 用原生 setter 填手机号（React 受控组件）
  var setPhone = await simpleEval('(function(){var a=document.querySelectorAll("input");for(var i=0;i<a.length;i++){if(a[i].type==="tel"||a[i].type==="text"||(a[i].placeholder||"").indexOf("手机")>=0){var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;s.call(a[i],' + JSON.stringify(PHONE) + ');a[i].dispatchEvent(new Event("input",{bubbles:true}));return "OK";}}return "NF";})()');
  console.log('[Login] 填手机号: ' + setPhone);
  await sleep(1500);

  // 汉字点选验证（如有）
  var hasCaptcha = await simpleEval('(function(){var els=document.querySelectorAll("*");for(var i=0;i<els.length;i++){if((els[i].innerText||"").trim()==="请完成安全验证")return "YES";}return "NO";})()');
  if (hasCaptcha === 'YES') {
    console.log('\n⚠️ 检测到安全验证弹框，请在浏览器中按顺序点击【插→邦→万→木】完成验证');
    console.log('完成后回复「验证完成」继续。');
    writeStatus('NEED_CAPTCHA');
    var capWait = 0;
    while (capWait < 42) {
      await sleep(10000); capWait++;
      if (fs.existsSync(path.join(WORKSPACE, 'csdn_captcha_ok.txt'))) break;
      if (capWait % 3 === 0) console.log('[Login] 等待用户完成汉字点选验证... (' + (capWait * 10) + 's)');
    }
  }

  // 点击「获取验证码」（真实鼠标）—— 注意：别点成页面头部文字
  var codeClick = await clickTextReal('获取验证码');
  console.log('[Login] 获取验证码: ' + codeClick);

  console.log('\n📱 短信已发送到 ' + PHONE + '，请在浏览器查看并输入验证码登录。');
  writeStatus('WAITING_SMS');

  for (var i = 0; i < 60; i++) {
    await sleep(5000);
    var st = await checkLogin();
    if (st.ok) { console.log('[Login] 登录成功！'); writeStatus('LOGIN_OK'); return; }
    if (i % 12 === 0) console.log('[Login] 等待中 (' + ((i + 1) * 5) + 's)...');
  }
  writeStatus('LOGIN_TIMEOUT');
}

// ==================== 编辑器操作 ====================

async function openEditor() {
  console.log('[Editor] 打开编辑器...');
  writeStatus('OPENING_EDITOR');
  await navigateTo(EDITOR_URL, '编辑器');
  await sleep(3000);
  writeStatus('EDITOR_READY');
}

/** 填标题：Vue 受控组件，用原生 setter + input 事件。 */
async function fillTitle(title) {
  console.log('[Editor] 填标题: ' + title.substring(0, 40));
  var js = `(function(){
    var ta = document.getElementById('txtTitle');
    if(!ta){var all=document.querySelectorAll('textarea, input.article-title-input, input[placeholder*="标题"]');for(var i=0;i<all.length;i++){if((all[i].placeholder||'').indexOf('标题')>=0){ta=all[i];break;}}}
    if(!ta) return 'NF';
    var proto = ta.tagName==='TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto,'value').set;
    setter.call(ta, ${JSON.stringify(title)});
    ['input','change','keyup','blur'].forEach(function(evt){ta.dispatchEvent(new Event(evt,{bubbles:true,cancelable:true}));});
    return 'OK len=' + ta.value.length;
  })()`;
  var r = await simpleEval(js);
  console.log('[Editor] 标题: ' + r);
  return r;
}

/** 填正文：contenteditable 区设 innerHTML + input 事件（Vue 受控组件）。 */
async function fillBody(content, isHtml) {
  isHtml = isHtml || false;
  console.log('[Editor] 填正文(' + content.length + '字符, isHtml=' + isHtml + ')');
  var htmlContent = isHtml ? content
    : '<p>' + content.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
  htmlContent = htmlContent.replace(/<p><\/p>/g, '');

  var js = `(function(){
    var html = ${JSON.stringify(htmlContent)};
    // 当前编辑器是 Vue 受控组件，正文区为 contenteditable
    var editable = document.querySelector('[contenteditable]');
    if (editable) {
      editable.innerHTML = html;
      editable.dispatchEvent(new Event('input', {bubbles:true}));
      return 'EDITABLE_OK len=' + (editable.innerText||'').length;
    }
    return 'NO_EDITOR_FOUND';
  })()`;
  var r = await simpleEval(js);
  console.log('[Editor] 正文: ' + r);
  return r;
}

// ==================== 发布对话框 + 标签 ====================

/** 点编辑器底部状态栏「发布文章」按钮，打开发布对话框。 */
async function openPublishDialog() {
  console.log('[Publish] 点击「发布文章」打开发布对话框...');
  var r = await clickTextReal('发布文章');
  console.log('[Publish] open dialog: ' + r);
  await sleep(2500);
  var open = await simpleEval('(function(){return document.querySelector(".publish-article-modal__footer")?"YES":"NO";})()');
  console.log('[Publish] dialog open: ' + open);
  return open === 'YES';
}

/**
 * 在发布对话框中添加标签（必填！）。
 * 流程：点「添加文章标签」→ 弹层搜索框 fill → press Enter。
 * ⚠️ 不要按 Escape 关弹层（会取消整个对话框）。
 */
async function addTag(tag) {
  if (!tag) return 'SKIP';
  console.log('[Publish] 添加标签: ' + tag);
  var addBtn = await clickTextReal('添加文章标签');
  console.log('[Publish] 点添加文章标签: ' + addBtn);
  await sleep(1500);
  // 弹层搜索框：input[placeholder*='搜索']
  var f = await fill("input[placeholder*='搜索']", tag);
  console.log('[Publish] fill 搜索框: ' + f);
  await sleep(800);
  var p = await press('Enter');
  console.log('[Publish] press Enter: ' + p);
  await sleep(1000);
  // 验证 chip 是否已加（不关弹层）
  var has = await simpleEval('(function(){var c=document.querySelectorAll(".tag-item,.el-tag,[class*=tag][class*=item]");for(var i=0;i<c.length;i++){if((c[i].innerText||c[i].textContent||"").trim()===' + JSON.stringify(tag) + ')return "YES";}return "NO";})()');
  console.log('[Publish] 标签 chip: ' + has);
  return has;
}

/**
 * 点击发布对话框 footer 最右「发布文章」按钮（真实鼠标）。
 * 返回 'OK cx,cy' 或 'NF'。
 */
async function clickFinalPublish() {
  console.log('[Publish] 点击对话框「发布文章」...');
  var r = await clickTextReal('发布文章');
  console.log('[Publish] final publish click: ' + r);
  return r;
}

/**
 * 完整发布流程：
 *  打开对话框 → 加标签 → 点发布 → 校验成功页。
 */
async function publish(opts) {
  opts = opts || {};
  var tags = opts.tags ? String(opts.tags).split(',').map(function(t){return t.trim();}).filter(Boolean) : [];
  var dialogOk = await openPublishDialog();
  if (!dialogOk) return 'NO_DIALOG';

  // 逐个加标签（至少一个；CSDN 静默拦截空标签）
  if (tags.length === 0) tags = ['随笔'];
  for (var i = 0; i < tags.length; i++) {
    await addTag(tags[i]);
  }
  await sleep(500);

  // 点发布（标签弹层仍开着也没关系，footer 按钮在弹层下方可见）
  var clicked = await clickFinalPublish();
  console.log('[Publish] clicked: ' + clicked);
  await sleep(6000);

  // 校验成功
  var url = await getUrl();
  if (url.indexOf('/creation/success/') >= 0) return 'SUCCESS:' + url;
  return 'NOT_SUCCESS:' + url;
}

async function screenshot(filename) {
  var p = connect.screenshot(filename, CDP_PORT);
  if (p) {
    var dst = path.join(WORKSPACE, filename);
    try { fs.copyFileSync(p, dst); console.log('[SS] ' + dst); return dst; } catch (e) {}
  }
  return null;
}

// ==================== 主流程 ====================

async function publishArticle(opts) {
  await ensureChrome();
  await navigateTo(EDITOR_URL, '编辑器');
  var st = await checkLogin();
  if (!st.ok) await doLogin();
  await openEditor();
  await fillTitle(opts.title);
  await fillBody(opts.body, opts.isHtml);
  var result = await publish({ tags: opts.tags });
  await sleep(3000);
  var finalUrl = await getUrl();

  if (result && result.indexOf('SUCCESS') === 0) {
    writeStatus('PUBLISHED');
    console.log('\n发布成功！URL: ' + finalUrl);
    return { ok: true, url: finalUrl, result: result };
  } else {
    writeStatus('FAILED:' + result);
    console.log('\n发布可能未完成: ' + result);
    return { ok: false, result: result, url: finalUrl };
  }
}

module.exports = {
  ensureChrome: ensureChrome, checkLogin: checkLogin, doLogin: doLogin,
  openEditor: openEditor, simpleEval: simpleEval, evalJS: evalJS,
  fillTitle: fillTitle, fillBody: fillBody, publish: publish,
  screenshot: screenshot, navigateTo: navigateTo, getUrl: getUrl,
  publishArticle: publishArticle
};
