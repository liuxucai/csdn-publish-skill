/**
 * CSDN 完整发布脚本（isolated-browser 路线）
 * 用法: node skills/csdn-publisher/scripts/publish.js
 *
 * 环境变量:
 *   CSDN_PHONE  登录手机号（必填，未登录时需要）
 *   CSDN_TITLE  文章标题
 *   CSDN_BODY   文章正文
 *   CSDN_TAGS   标签，逗号分隔（可选，默认加「随笔」）
 */
'use strict';

var lib = require('./lib.js');

var title = process.env.CSDN_TITLE || '测试文章';
var body = process.env.CSDN_BODY || '正文';
var tags = process.env.CSDN_TAGS || '';

async function main() {
  console.log('========================================');
  console.log('CSDN 文章发布助手（isolated-browser）');
  console.log('========================================');
  console.log('标题: ' + title.substring(0, 50));
  console.log('正文: ' + body.length + ' 字符');
  console.log('标签: ' + (tags || '(默认随笔)'));
  console.log('');

  try {
    var result = await lib.publishArticle({ title: title, body: body, tags: tags, isHtml: false });
    console.log('\n结果:', JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (e) {
    console.error('\n错误:', e.message);
    process.exitCode = 1;
  }
}

main().then(function () {
  console.log('\n执行完毕');
  process.exit(process.exitCode || 0);
});
