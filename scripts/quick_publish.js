/**
 * CSDN 快速发布脚本（isolated-browser 路线，已登录状态）
 * 用法: node skills/csdn-publisher/scripts/quick_publish.js
 *
 * 环境变量: CSDN_TITLE / CSDN_BODY / CSDN_TAGS（同 publish.js）
 */
'use strict';

const { ensureChrome, navigateTo, fillTitle, fillBody, publish, screenshot } = require('./lib.js');

const ARTICLE = {
  title: process.env.CSDN_TITLE || '测试文章标题 - 请修改',
  body: process.env.CSDN_BODY || '正文内容',
  tags: process.env.CSDN_TAGS || '',
  isHtml: false
};

async function main() {
  console.log('CSDN 快速发布');
  console.log('标题:', ARTICLE.title);

  await ensureChrome();
  await navigateTo('https://mp.csdn.net/mp_blog/creation/editor', '编辑器');
  await screenshot('csdn_before.png');
  await fillTitle(ARTICLE.title);
  await fillBody(ARTICLE.body, ARTICLE.isHtml);
  await screenshot('csdn_after_fill.png');

  const result = await publish({ tags: ARTICLE.tags });

  if (result.indexOf('SUCCESS') === 0) {
    console.log('✅ 发布成功！');
  } else {
    console.log('⚠️ 发布未完成:', result);
  }

  await screenshot('csdn_final.png');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
