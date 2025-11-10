// ==UserScript==
// @name         pter 修复旧域名图片
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  将旧域名的图片链接转为相对链接
// @author       shadows,akina
// @license      MIT License
// @include      /^https?://pterclub\.net/.*$/
// @icon         https://pterclub.net/favicon.ico
// @downloadURL  https://cdn.jsdelivr.net/gh/akina-up/script@master/PT/pter/pter-img-url.user.js
// @updateURL    https://cdn.jsdelivr.net/gh/akina-up/script@master/PT/pter/pter-img-url.user.js
// @supportURL   https://github.com/akina-up/script/issues
// ==/UserScript==

/* 更新日志
 * v0.2
 * - [优化] 扩大适配范围
 */
'use strict';

window.addEventListener('load', function () {
  // 选中页面中所有图片
  const imgs = document.querySelectorAll('img');

  for (const img of imgs) {
    if (img.src.includes('pterclub.com')) {
      // 将旧域名替换成新域名
      img.src = img.src.replace(/pterclub\.com/gi, 'pterclub.net');
    }
  }
});