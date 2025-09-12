// ==UserScript==
// @name         qBittorrent 复制命令
// @namespace    localhost
// @version      2.0.2
// @description  为 qBittorrent 右键菜单添加“复制完整路径”和“复制 UA 命令”选项，并支持可配置的路径映射。原脚本来源UA discord服务器的btTeddy，改写部分功能
// @author       akina (由 Gemini 2.5 Pro  助理重构)
// @icon         https://www.qbittorrent.org/favicon.ico
// @run-at       document-end
// @downloadURL  https://cdn.jsdelivr.net/gh/akina-up/script@master/PT/UA/ua-cmd.user.js
// @updateURL    https://cdn.jsdelivr.net/gh/akina-up/script@master/PT/UA/ua-cmd.user.js
// @supportURL   https://github.com/akina-up/script/issues
// ==/UserScript==

(function() {
    'use strict';

    // 存储配置时使用的键名
    const CONFIG_KEY = 'qbitCopyScriptConfig';

    // 默认配置：仅在用户首次运行脚本或存储被清除时使用
    const defaultConfig = {
        isPathMappingEnabled: true,
        uploadAssistantCommand: 'upload',
        uploadAssistantAdditionalParams: '',
        pathMappings: [
            {
                qbitPath: "/data/torrents/",
                mappedPath: "/mnt/user/data/torrents/"
            },
            {
                qbitPath: "/downloads/",
                mappedPath: "Z:\\shared\\downloads\\"
            }
        ]
    };

    // 用于在脚本运行时存储加载后的配置
    let currentConfig = {};

    /**
     * 从油猴存储中异步加载配置。如果不存在，则使用默认配置。
     * @returns {Promise<object>} 加载到的配置对象
     */
    async function loadConfig() {
        const storedConfigJson = await GM_getValue(CONFIG_KEY, null);
        if (storedConfigJson) {
            try {
                return JSON.parse(storedConfigJson);
            } catch (e) {
                console.error("qBit脚本: 解析存储的配置失败，将使用默认配置。", e);
                return defaultConfig;
            }
        }
        return defaultConfig;
    }

    /**
     * 将配置对象异步保存到油猴存储中。
     * @param {object} configToSave 需要保存的配置对象
     */
    async function saveConfig(configToSave) {
        try {
            const configJson = JSON.stringify(configToSave, null, 4); // 格式化JSON以便阅读
            await GM_setValue(CONFIG_KEY, configJson);
            console.log("qBit脚本: 配置已成功保存。");
        } catch (e) {
            console.error("qBit脚本: 保存配置失败。", e);
            alert("保存配置失败！");
        }
    }


    /**
     * 创建并显示设置对话框
     */
    function showSettingsDialog() {
        // 防止重复创建
        if (document.getElementById('qbit-script-settings-overlay')) {
            return;
        }

        const dialogHTML = `
            <div id="qbit-script-settings-overlay" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 9999; display: flex; align-items: center; justify-content: center;">
                <div id="qbit-script-settings-dialog" style="background: #fdfdfd; color: #333; padding: 20px; border-radius: 8px; width: 600px; max-width: 90%; box-shadow: 0 5px 15px rgba(0,0,0,0.3);">
                    <h2 style="margin-top: 0; border-bottom: 1px solid #ccc; padding-bottom: 10px;">脚本设置</h2>
                    <div style="margin-bottom: 15px;">
                        <label>
                            <input type="checkbox" id="qbit-settings-enable-mapping">
                            <strong>启用路径映射</strong> (若禁用，则所有命令都使用qBittorrent的原始路径)
                        </label>
                    </div>
                    <div style="margin-bottom: 15px;">
                        <label for="qbit-settings-ua-cmd">UA 主命令:</label>
                        <input type="text" id="qbit-settings-ua-cmd" style="width: 98%; padding: 5px;">
                    </div>
                    <div style="margin-bottom: 15px;">
                        <label for="qbit-settings-ua-params">UA 附加参数:</label>
                        <input type="text" id="qbit-settings-ua-params" style="width: 98%; padding: 5px;">
                    </div>
                    <div style="margin-bottom: 20px;">
                        <label for="qbit-settings-mappings">路径映射规则 (必须为合法的JSON格式):</label>
                        <textarea id="qbit-settings-mappings" rows="8" style="width: 98%; padding: 5px; font-family: monospace;"></textarea>
                    </div>
                    <div style="text-align: right;">
                        <button id="qbit-settings-save" style="padding: 8px 15px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;">保存并关闭</button>
                        <button id="qbit-settings-cancel" style="padding: 8px 15px; margin-left: 10px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">取消</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', dialogHTML);

        // 填充当前配置
        document.getElementById('qbit-settings-enable-mapping').checked = currentConfig.isPathMappingEnabled;
        document.getElementById('qbit-settings-ua-cmd').value = currentConfig.uploadAssistantCommand;
        document.getElementById('qbit-settings-ua-params').value = currentConfig.uploadAssistantAdditionalParams;
        document.getElementById('qbit-settings-mappings').value = JSON.stringify(currentConfig.pathMappings, null, 4);

        // 绑定事件
        document.getElementById('qbit-settings-save').addEventListener('click', async () => {
            const newMappingsText = document.getElementById('qbit-settings-mappings').value;
            let newMappings;
            try {
                newMappings = JSON.parse(newMappingsText);
                if (!Array.isArray(newMappings)) throw new Error("顶层结构必须是一个数组");
            } catch (e) {
                alert(`路径映射规则的JSON格式错误，请检查！\n错误信息: ${e.message}`);
                return;
            }

            const newConfig = {
                isPathMappingEnabled: document.getElementById('qbit-settings-enable-mapping').checked,
                uploadAssistantCommand: document.getElementById('qbit-settings-ua-cmd').value,
                uploadAssistantAdditionalParams: document.getElementById('qbit-settings-ua-params').value,
                pathMappings: newMappings
            };

            await saveConfig(newConfig);
            currentConfig = newConfig; // 更新当前会话的配置
            document.getElementById('qbit-script-settings-overlay').remove();
            alert("设置已保存！");
        });

        document.getElementById('qbit-settings-cancel').addEventListener('click', () => {
            document.getElementById('qbit-script-settings-overlay').remove();
        });
    }

    /**
     * 应用路径映射规则（如果已启用）
     * @param {string} originalPath 来自 qBittorrent 的原始完整路径。
     * @returns {string} 转换后的路径或原始路径。
     */
    function applyPathMapping(originalPath) {
        if (!currentConfig.isPathMappingEnabled) {
            return originalPath;
        }

        for (const mapping of currentConfig.pathMappings) {
            if (originalPath.startsWith(mapping.qbitPath)) {
                return originalPath.replace(mapping.qbitPath, mapping.mappedPath);
            }
        }
        return originalPath;
    }

    // --- 核心脚本逻辑 ---

    async function initScript() {
        // 脚本启动时加载配置
        currentConfig = await loadConfig();

        const menu = document.getElementById('torrentsTableMenu');
        if (!menu) {
            console.error("用户脚本错误: 未找到 torrentsTableMenu 元素。");
            return;
        }

        const iconsBase = menu.querySelector('img')?.src?.includes('/icons/') ? 'icons/' : 'images/';

        const menuItems = [
            { id: 'copyMappedFullPath', text: '复制完整路径', icon: 'edit-copy.svg', handler: copyFullPath },
            { id: 'copyUaCmdMapped', text: '复制 UA 命令', icon: 'edit-copy.svg', handler: copyUploadAssistantCmd },
            { isSeparator: true },
            { id: 'openQbitScriptSettings', text: '设置', icon: 'configure.svg', handler: showSettingsDialog }
        ];

        // 添加菜单项
        menuItems.forEach(item => {
            if (item.isSeparator) {
                 menu.insertAdjacentHTML('beforeend', '<li class="separator"></li>');
                 return;
            }
            const menuItemHTML = `
                <li>
                    <a id="${item.id}" href="#" role="button">
                        <img alt="${item.text}" src="${iconsBase}${item.icon}">
                        ${item.text}
                    </a>
                </li>`;
            menu.insertAdjacentHTML('beforeend', menuItemHTML);
        });

        // 附加事件处理器
        menuItems.forEach(item => {
            if(item.handler) {
                const element = document.getElementById(item.id);
                if (element) {
                    element.addEventListener('click', (e) => {
                        e.preventDefault();
                        item.handler();
                    });
                }
            }
        });
    }

    // --- 辅助函数和命令处理器 ---

    function getSelectedTorrents() {
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
        return torrentsTable.getFilteredAndSortedRows()[hash]?.full_data;
    }

    // ==========================================================
    //  vvvvvvvvv   这里是已修正的函数   vvvvvvvvv
    // ==========================================================

    /**
     * 将文本复制到剪贴板，智能判断使用现代API还是传统方法。
     * @param {string} text 要复制的文本
     */
    function copyToClipboard(text) {
        // 首先检查 navigator.clipboard 是否存在并且当前是否为安全上下文 (https 或 localhost)
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).catch((err) => {
                console.error("使用 Clipboard API 复制失败:", err);
                // 如果API调用失败（例如，用户拒绝权限），则尝试备用方法
                fallbackCopy(text);
            });
        } else {
            // 如果是在 http:// 页面或旧版浏览器上，直接使用备用方法
            fallbackCopy(text);
        }
    }

    /**
     * 使用传统的 document.execCommand 方法作为备用复制方案。
     * @param {string} text 要复制的文本
     */
    function fallbackCopy(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        // 设置样式以防止在页面上闪烁或占用空间
        textarea.style.position = 'fixed';
        textarea.style.top = '-9999px';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        try {
            const successful = document.execCommand('copy');
            if (successful) {
                console.log('已使用备用方法成功复制到剪贴板。');
            } else {
                console.error('备用复制方法执行失败。');
                alert("复制失败，请检查浏览器控制台获取详细信息。");
            }
        } catch (err) {
            console.error('执行备用复制方法时出错:', err);
            alert("复制时发生错误，请检查浏览器控制台获取详细信息。");
        }
        document.body.removeChild(textarea);
    }
    // ==========================================================
    //  ^^^^^^^^^   修正部分结束   ^^^^^^^^^
    // ==========================================================


    function copyFullPath() {
        const selected = getSelectedTorrents();
        if (!selected) return;

        const paths = selected.map(hash => {
            const data = getTorrentData(hash);
            if (!data) return '';
            const originalPath = `${data.save_path.replace(/\/$/, '')}/${data.name}`;
            return applyPathMapping(originalPath);
        }).filter(Boolean);

        if (paths.length > 0) {
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
            const fullPathQuoted = `"${mappedPath}"`;

            return `${currentConfig.uploadAssistantCommand} ${fullPathQuoted} ${currentConfig.uploadAssistantAdditionalParams}`.trim();
        }).filter(Boolean);

        if (commands.length > 0) {
            copyToClipboard(commands.join('\n'));
        }
    }

    // 在页面完全加载后运行脚本
    window.addEventListener('load', initScript);
})();