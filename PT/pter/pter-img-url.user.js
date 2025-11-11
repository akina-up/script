// ==UserScript==
// @name         pter 修复旧域名图片
// @namespace    http://tampermonkey.net/
// @version      0.3
// @author       shadows,akina
// @license      MIT License
// @include      /^https?://pterclub\.net/.*$/
// @icon         https://pterclub.net/favicon.ico
// @downloadURL  https://cdn.jsdelivr.net/gh/akina-up/script@master/PT/pter/pter-img-url.user.js
// @updateURL    https://cdn.jsdelivr.net/gh/akina-up/script@master/PT/pter/pter-img-url.user.js
// @supportURL   https://github.com/akina-up/script/issues
// ==/UserScript==

/* 更新日志
 * v0.3
 * - [优化] 同时修复 data-src 与 data-orig 的旧域名
 * v0.2
 * - [优化] 扩大适配范围
 */
'use strict';

window.addEventListener('load', () => {
  const imgs = document.querySelectorAll('img');

  for (const img of imgs) {
    // 修复 src
    if (img.src && img.src.includes('pterclub.com')) {
      img.src = img.src.replace(/pterclub\.com/gi, 'pterclub.net');
    }

    // 修复 data-src
    if (img.dataset.src && img.dataset.src.includes('pterclub.com')) {
      img.dataset.src = img.dataset.src.replace(/pterclub\.com/gi, 'pterclub.net');
    }

    // 修复 data-orig
    if (img.dataset.orig && img.dataset.orig.includes('pterclub.com')) {
      img.dataset.orig = img.dataset.orig.replace(/pterclub\.com/gi, 'pterclub.net');
    }
  }
});