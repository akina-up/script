// ==UserScript==
// @name         Blu-ray.com Info Extractor
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Extracts release info, formats into BBCode, and grabs front cover image.
// @author       akina
// @downloadURL  https://cdn.jsdelivr.net/gh/akina-up/script@master/PT/misc/Blu-ray.com-Info-Extractor.user.js
// @updateURL    https://cdn.jsdelivr.net/gh/akina-up/script@master/PT/misc/Blu-ray.com-Info-Extractor.user.js
// @supportURL   https://github.com/akina-up/script/issues
// @match        https://www.blu-ray.com/movies/*
// @grant        GM_setClipboard
// ==/UserScript==

(function() {
    'use strict';

    var targetElement = document.querySelector('.subheading.grey');
    if (!targetElement) return;

    var parts = targetElement.innerText.split('|').map(function(p) {
        return p.trim();
    });

    if (parts.length >= 2) {
        var secondToLastIndex = parts.length - 2;
        if (parts[secondToLastIndex].toLowerCase().indexOf('min') === -1) {
            parts.splice(secondToLastIndex, 1);
        }
    }

    if (parts.length >= 1) {
        var lastIndex = parts.length - 1;
        parts[lastIndex] = parts[lastIndex].replace(/\s*\(.*?\)/g, '').trim();
    }

    var infoText = parts.join(' | ');
    var currentUrl = window.location.href;

    var formatFull = '[b]RELEASE INFO[/b]\n[b][url=' + currentUrl + ']' + infoText + '[/url][/b]';
    var formatShort = '[url=' + currentUrl + ']' + infoText + '[/url]';

    var imgElement = document.getElementById('frontimage_overlay');
    var imgUrl = '';
    if (imgElement && imgElement.src) {
        imgUrl = imgElement.src.split('?')[0].replace('large', 'front');
    }

    var container = document.createElement('span');
    container.style.marginLeft = '10px';

    function createBtn(text, content) {
        var btn = document.createElement('button');
        btn.innerText = text;
        btn.style.marginRight = '5px';
        btn.style.padding = '2px 8px';
        btn.style.fontSize = '12px';
        btn.style.cursor = 'pointer';
        btn.style.background = '#0071bb';
        btn.style.color = '#fff';
        btn.style.border = 'none';
        btn.style.borderRadius = '3px';
        btn.style.verticalAlign = 'middle';

        btn.onclick = function(e) {
            e.preventDefault();
            if (!content) {
                btn.innerText = 'No Image!';
                setTimeout(function() { btn.innerText = text; }, 2000);
                return;
            }
            GM_setClipboard(content);
            var originalText = btn.innerText;
            btn.innerText = 'Copied!';
            setTimeout(function() {
                btn.innerText = originalText;
            }, 2000);
        };
        return btn;
    }

    var btnFull = createBtn('Copy Info', formatFull);
    var btnShort = createBtn('Copy Link Only', formatShort);

    container.appendChild(btnFull);
    container.appendChild(btnShort);

    if (imgUrl) {
        var btnImage = createBtn('Copy Image', imgUrl);
        container.appendChild(btnImage);
    }

    var subheadingTitle = document.querySelector('.subheadingtitle');
    if (subheadingTitle) {
        subheadingTitle.appendChild(container);
    } else {
        var h1 = document.querySelector('h1');
        if (h1) {
            var aTag = h1.closest('a');
            if (aTag) {
                var flagImg = aTag.nextElementSibling;
                // 判断紧跟在链接后面的元素是不是国旗图片
                if (flagImg && flagImg.tagName.toLowerCase() === 'img') {
                    flagImg.insertAdjacentElement('afterend', container);
                } else {
                    aTag.insertAdjacentElement('afterend', container);
                }
            } else {
                h1.insertAdjacentElement('afterend', container);
            }
        } else {
            targetElement.appendChild(container);
        }
    }
})();