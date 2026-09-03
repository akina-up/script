// ==UserScript==
// @name         Blu-ray.com Info Extractor
// @namespace    http://tampermonkey.net/
// @version      1.8
// @description  Extracts release info, formats it as BBCode, and uploads the front cover to Pixhost.
// @author       akina
// @downloadURL  https://cdn.jsdelivr.net/gh/akina-up/script@master/PT/misc/Blu-ray.com-Info-Extractor.user.js
// @updateURL    https://cdn.jsdelivr.net/gh/akina-up/script@master/PT/misc/Blu-ray.com-Info-Extractor.user.js
// @supportURL   https://github.com/akina-up/script/issues
// @match        https://www.blu-ray.com/movies/*
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      *.blu-ray.com
// @connect      *.static-bluray.com
// @connect      api.pixhost.cc
// ==/UserScript==

(function() {
    'use strict';

    var targetElement = document.querySelector('.subheading.grey');
    if (!targetElement) return;
    var subheadingTitle = document.querySelector('.subheadingtitle');

    var parts = targetElement.innerText.split('|').map(function(p) {
        return p.trim();
    });

    var isWarnerArchiveRelease = subheadingTitle &&
        /Warner Archive Collection/i.test(subheadingTitle.textContent || '');
    if (parts.length && /^Warner Bros\.$/i.test(parts[0]) && isWarnerArchiveRelease) {
        parts[0] = 'Warner Bros. (Warner Archive Collection)';
    }

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

    var formatFull = '[center][b]RELEASE INFO[/b]\n[b][url=' + currentUrl + ']' + infoText + '[/url][/b][/center]';
    var formatShort = '[url=' + currentUrl + ']' + infoText + '[/url]';

    var imgElement = document.getElementById('frontimage_overlay');
    var imgUrl = '';
    if (imgElement && imgElement.src) {
        imgUrl = imgElement.src.split('?')[0].replace('large', 'front');
    }

    var container = document.createElement('span');
    container.style.marginLeft = '10px';

    function createButton(text) {
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

        return btn;
    }

    function createBtn(text, content) {
        var btn = createButton(text);

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

    function gmRequest(options) {
        return new Promise(function(resolve, reject) {
            GM_xmlhttpRequest(Object.assign({}, options, {
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300) {
                        resolve(response);
                    } else {
                        reject(new Error('HTTP ' + response.status));
                    }
                },
                onerror: function() {
                    reject(new Error('Network request failed'));
                },
                ontimeout: function() {
                    reject(new Error('Request timed out'));
                }
            }));
        });
    }

    function getImageFilename(url, mimeType) {
        var fallbackExtensions = {
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'image/avif': '.avif'
        };
        var pathname = new URL(url, location.href).pathname;
        var filename = decodeURIComponent(pathname.split('/').pop() || 'cover');
        filename = filename.replace(/[^a-zA-Z0-9._-]+/g, '_');
        if (!/\.(?:jpe?g|png|gif|webp|avif)$/i.test(filename)) {
            filename += fallbackExtensions[mimeType] || '.jpg';
        }
        return filename;
    }

    function pixhostDirectUrl(thumbnailUrl) {
        var url = new URL(thumbnailUrl);
        url.hostname = url.hostname.replace(/^t(\d+)\./i, 'img$1.');
        url.pathname = url.pathname.replace('/thumbs/', '/images/');
        if (!/^img\d+\./i.test(url.hostname) || url.pathname.indexOf('/images/') === -1) {
            throw new Error('Unexpected Pixhost URL format');
        }
        return url.href;
    }

    async function uploadImageToPixhost(url) {
        var download = await gmRequest({
            method: 'GET',
            url: url,
            responseType: 'blob',
            timeout: 30000
        });
        var image = download.response;
        if (!(image instanceof Blob) || !image.size) {
            throw new Error('Cover download returned no image');
        }
        if (image.size > 10 * 1024 * 1024) {
            throw new Error('Cover exceeds the Pixhost 10 MB limit');
        }

        var mimeType = image.type || 'image/jpeg';
        var formData = new FormData();
        formData.append('img', image, getImageFilename(url, mimeType));
        formData.append('content_type', '0');
        formData.append('max_th_size', '420');

        var upload = await gmRequest({
            method: 'POST',
            url: 'https://api.pixhost.cc/images',
            headers: { 'Accept': 'application/json' },
            data: formData,
            timeout: 60000
        });
        var result;
        try {
            result = JSON.parse(upload.responseText);
        } catch (error) {
            throw new Error('Pixhost returned an invalid response');
        }
        if (!result.th_url) {
            throw new Error('Pixhost did not return an image URL');
        }
        return pixhostDirectUrl(result.th_url);
    }

    function createPixhostButton(url) {
        var defaultText = 'Upload Pixhost';
        var btn = createButton(defaultText);
        var uploadedUrl = '';

        btn.onclick = async function(e) {
            e.preventDefault();
            if (!url) {
                btn.innerText = 'No Image!';
                setTimeout(function() { btn.innerText = defaultText; }, 2000);
                return;
            }
            if (uploadedUrl) {
                GM_setClipboard(uploadedUrl);
                btn.innerText = 'Copied!';
                setTimeout(function() { btn.innerText = defaultText; }, 2000);
                return;
            }

            btn.disabled = true;
            btn.style.opacity = '0.65';
            btn.innerText = 'Uploading...';
            try {
                uploadedUrl = await uploadImageToPixhost(url);
                GM_setClipboard(uploadedUrl);
                btn.innerText = 'Uploaded & Copied!';
                btn.title = uploadedUrl;
            } catch (error) {
                console.error('[Blu-ray.com Info Extractor]', error);
                btn.innerText = 'Upload Failed!';
                btn.title = error.message;
            } finally {
                setTimeout(function() {
                    btn.disabled = false;
                    btn.style.opacity = '1';
                    btn.innerText = defaultText;
                }, 2500);
            }
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

        var btnPixhost = createPixhostButton(imgUrl);
        container.appendChild(btnPixhost);
    }

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
