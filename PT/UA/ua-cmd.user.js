// ==UserScript==
// @name         qBittorrent 复制命令 (带路径映射功能)
// @namespace    localhost
// @version      2.0.1
// @description  为 qBittorrent 右键菜单添加“复制完整路径”和“复制 UA 命令”选项，并支持可配置的路径映射。原脚本来源UA discord服务器的btTeddy，改写部分功能
// @author       akina (由 Gemini 2.5 Pro  助理重构)
// @include      你的qb url
// @icon         https://www.qbittorrent.org/favicon.ico
// @run-at       document-end
// @downloadURL  https://cdn.jsdelivr.net/gh/akina-up/script@master/PT/UA/ua-cmd.user.js
// @updateURL    https://cdn.jsdelivr.net/gh/akina-up/script@master/PT/UA/ua-cmd.user.js
// @supportURL   https://github.com/akina-up/script/issues
// ==/UserScript==

(function() {
    'use strict';

    const config = {
        // 上传助手 (Upload Assistant) 设置
        uploadAssistantCommand: 'upload',
        uploadAssistantAdditionalParams: '',

        // 路径映射规则。脚本会查找并应用从上到下第一个匹配的规则。
        // 它会将路径开头的 'qbitPath' 替换为 'mappedPath'。
        pathMappings: [
            // 示例 1: 将 qBittorrent 内部的 Docker 路径映射到宿主机路径，以便脚本使用
            {
                qbitPath: "/data/torrents/",
                mappedPath: "/mnt/user/data/torrents/"
            },
            // 示例 2: 映射为 Windows 风格的路径，以便在 Windows 电脑上使用
            {
                qbitPath: "/downloads/",
                mappedPath: "Z:\\shared\\downloads\\"
            }
            // 如果需要，可以添加更多规则。
        ]
    };

    // 定义菜单项
    const menuItems = [
        {
            id: 'copyMappedFullPath',
            text: '复制完整路径', // 菜单显示文本
            icon: 'edit-copy.svg',
            handler: copyFullPath
        },
        {
            id: 'copyUaCmdMapped',
            text: '复制 UA 命令', // 菜单显示文本
            icon: 'edit-copy.svg',
            handler: copyUploadAssistantCmd
        }
    ];

    /**
     * 应用配置中第一个匹配的路径映射规则。
     * @param {string} originalPath 来自 qBittorrent 的原始完整路径。
     * @returns {string} 转换后的路径。
     */
    function applyPathMapping(originalPath) {
        for (const mapping of config.pathMappings) {
            if (originalPath.startsWith(mapping.qbitPath)) {
                // 替换路径的开头部分并返回
                return originalPath.replace(mapping.qbitPath, mapping.mappedPath);
            }
        }
        // 如果没有找到匹配的映射规则，则返回原始路径
        return originalPath;
    }

    // --- 核心脚本逻辑 (通常无需修改以下内容) ---

    function initScript() {
        const menu = document.getElementById('torrentsTableMenu');
        if (!menu) {
            console.error("用户脚本错误: 未找到 torrentsTableMenu 元素。");
            return;
        }

        const iconsBase = menu.querySelector('img')?.src?.includes('/icons/') ? 'icons/' : 'images/';

        // 如果菜单不为空，则添加一个分隔线
        if (menu.children.length > 0) {
             menu.insertAdjacentHTML('beforeend', '<li class="separator"></li>');
        }

        // 添加菜单项
        menuItems.forEach(item => {
            const menuItemHTML = `
                <li>
                    <a id="${item.id}" href="#" role="button">
                        <img alt="${item.text}" src="${iconsBase}${item.icon}">
                        ${item.text}
                    </a>
                </li>`;
            menu.insertAdjacentHTML('beforeend', menuItemHTML);
        });

        // 为菜单项附加事件处理器
        menuItems.forEach(item => {
            const element = document.getElementById(item.id);
            if (element) {
                element.addEventListener('click', item.handler);
            }
        });
    }

    // === 辅助函数 ===

    function getSelectedTorrents() {
        // 'torrentsTable' 是 qBittorrent WebUI 提供的一个全局对象
        if (typeof torrentsTable === 'undefined') {
            alert("错误: 无法访问 torrentsTable 对象。");
            return null;
        }
        const selected = torrentsTable.selectedRowsIds();
        if (selected.length === 0) {
            alert("请至少选择一个种子。");
            return null;
        }
        return selected;
    }

    function getTorrentData(hash) {
        const rows = torrentsTable.getFilteredAndSortedRows();
        return rows[hash]?.full_data;
    }

    function copyToClipboard(text) {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text)
                .then(() => console.log('已复制到剪贴板。'))
                .catch(err => {
                    console.error('使用 navigator.clipboard 复制失败:', err);
                    fallbackCopy(text);
                });
        } else {
            fallbackCopy(text);
        }
    }

    function fallbackCopy(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.top = '-9999px';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        try {
            const successful = document.execCommand('copy');
            console.log(successful ? '已使用备用方法复制到剪贴板。' : '备用复制方法失败。');
        } catch (err) {
            console.error('备用复制方法出错:', err);
            alert("无法复制文本。");
        }
        document.body.removeChild(textarea);
    }

    // === 命令处理器 ===

    function copyFullPath() {
        const selected = getSelectedTorrents();
        if (!selected) return;

        const paths = selected.map(hash => {
            const data = getTorrentData(hash);
            if (!data) return '';

            const originalPath = `${data.save_path.replace(/\/$/, '')}/${data.name}`;
            return applyPathMapping(originalPath);
        }).filter(Boolean); // 过滤掉因查找失败而产生的空字符串

        if (paths.length > 0) {
            // 使用 Set 去除重复路径后，用换行符连接
            copyToClipboard([...new Set(paths)].join('\n'));
        }
    }

    function copyUploadAssistantCmd() {
        const selected = getSelectedTorrents();
        if (!selected) return;

        const commands = selected.map(hash => {
            const data = getTorrentData(hash);
            if (!data) return '';

            const originalPath = `${data.save_path.replace(/\/$/, '')}/${data.name}`;
            const mappedPath = applyPathMapping(originalPath);

            // 为路径添加引号，以处理路径中可能存在的空格和特殊字符
            const fullPathQuoted = `"${mappedPath}"`;

            return `${config.uploadAssistantCommand} ${fullPathQuoted} ${config.uploadAssistantAdditionalParams}`.trim();
        }).filter(Boolean);

        if (commands.length > 0) {
            copyToClipboard(commands.join('\n'));
        }
    }

    // 在页面完全加载后运行脚本
    window.addEventListener('load', initScript);
})();