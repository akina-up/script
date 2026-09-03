// ==UserScript==
// @name         Pastebin Copy Button
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  Adds a one-click copy button to Pastebin's paste action bar.
// @author       akina
// @downloadURL  https://cdn.jsdelivr.net/gh/akina-up/script@master/PT/misc/Pastebin-Copy-Button.user.js
// @updateURL    https://cdn.jsdelivr.net/gh/akina-up/script@master/PT/misc/Pastebin-Copy-Button.user.js
// @supportURL   https://github.com/akina-up/script/issues
// @match        https://pastebin.com/*
// @match        https://www.pastebin.com/*
// @grant        GM_setClipboard
// ==/UserScript==

(function() {
    'use strict';

    var rawLink = document.querySelector('.right a[href^="/raw/"]');
    if (!rawLink) return;

    var actionBar = rawLink.closest('.right');
    if (!actionBar || actionBar.querySelector('.pastebin-copy-button')) return;

    async function getRawText() {
        var response = await fetch(rawLink.href, {
            credentials: 'same-origin',
            cache: 'no-store'
        });

        if (!response.ok) {
            throw new Error('Raw request failed: HTTP ' + response.status);
        }

        return response.text();
    }

    function showStatus(text, className) {
        copyButton.textContent = text;
        copyButton.classList.add(className);

        window.setTimeout(function() {
            copyButton.textContent = 'copy';
            copyButton.classList.remove(className);
        }, 1600);
    }

    var style = document.createElement('style');
    style.textContent = [
        '.pastebin-copy-button {',
        '  background: #12a594 !important;',
        '  border-color: #0e8b7d !important;',
        '  color: #fff !important;',
        '  cursor: pointer;',
        '}',
        '.pastebin-copy-button:hover {',
        '  background: #0e8b7d !important;',
        '}',
        '.pastebin-copy-button.is-copied {',
        '  background: #2e7d32 !important;',
        '  border-color: #256628 !important;',
        '}',
        '.pastebin-copy-button.is-error {',
        '  background: #c62828 !important;',
        '  border-color: #a82020 !important;',
        '}'
    ].join('\n');
    document.head.appendChild(style);

    var copyButton = document.createElement('a');
    copyButton.href = '#';
    copyButton.className = 'btn -small pastebin-copy-button';
    copyButton.textContent = 'copy';
    copyButton.title = 'Copy paste text';

    copyButton.addEventListener('click', async function(event) {
        event.preventDefault();

        copyButton.textContent = 'copying...';

        try {
            var text = await getRawText();
            GM_setClipboard(text, 'text');
            showStatus('copied!', 'is-copied');
        } catch (error) {
            showStatus('failed', 'is-error');
            console.error('[Pastebin Copy Button] Copy failed:', error);
        }
    });

    rawLink.insertAdjacentElement('afterend', copyButton);
})();
