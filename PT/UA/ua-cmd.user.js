// ==UserScript==
// @name         qBittorrent 复制跳转脚本
// @namespace    https://github.com/akina-up/script
// @version      3.0.1
// @description  (由 Gemini 3.0.0 Pro 助理重构)为qB右键菜单添加高度可定制的复制/跳转命令, 支持拖放排序、层级子菜单、可视化图标选择、路径映射和模板, 保存无需刷新。原脚本来源UA discord服务器的btTeddy，改写部分功能
// @author       akina
// @icon         https://www.qbittorrent.org/favicon.ico
// @run-at       document-end
// @downloadURL  https://cdn.jsdelivr.net/gh/akina-up/script@master/PT/UA/ua-cmd.user.js
// @updateURL    https://cdn.jsdelivr.net/gh/akina-up/script@master/PT/UA/ua-cmd.user.js
// @supportURL   https://github.com/akina-up/script/issues
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG_KEY = 'qbitCustomCommandsConfig_v3.0.0_final_reset';

    const ICON_LIST = [
        'qbittorrent-tray.svg', 'list-add.svg', 'insert-link.svg', 'system-log-out.svg', 'application-exit.svg', 'torrent-start.svg',
        'torrent-stop.svg', 'list-remove.svg', 'go-top.svg', 'go-up.svg', 'go-down.svg', 'go-bottom.svg', 'checked-completed.svg',
        'view-statistics.svg', 'configure.svg', 'torrent-magnet.svg', 'browser-cookies.svg', 'help-contents.svg', 'wallet-open.svg',
        'help-about.svg', 'filter-all.svg', 'edit-find.svg', 'application-rss.svg', 'torrent-start-forced.svg', 'set-location.svg',
        'edit-rename.svg', 'view-categories.svg', 'tags.svg', 'download.svg', 'upload.svg', 'ratio.svg', 'force-recheck.svg',
        'reannounce.svg', 'queued.svg', 'edit-copy.svg', 'name.svg', 'hash.svg', 'edit-clear.svg', 'peers-add.svg', 'peers-remove.svg',
        'firewalled.svg', 'slow_off.svg', 'downloading.svg'
    ];

    const defaultConfig = {
        isPathMappingEnabled: false,
        pathMappings: [
            { qbitPath: "/data/torrents/", mappedPath: "/mnt/user/data/torrents/" },
            { qbitPath: "/downloads/", mappedPath: "Z:\\shared\\downloads\\" }
        ],
        submenuSettings: {
            "复制命令": { icon: "edit-copy.svg" },
            "跳转链接": { icon: "insert-link.svg" }
        },
        commands: [
            { id: `cmd-${Date.now()}-1`, name: '复制完整路径', type: 'copy', icon: 'edit-copy.svg', template: '{full_path_mapped}', submenu: '', enabled: true },
            { id: `cmd-${Date.now()}-3`, name: '复制 UA 命令', type: 'copy', icon: 'upload.svg', template: 'upload "{full_path_mapped}"', submenu: '复制命令', enabled: true },
            { id: `cmd-${Date.now()}-4`, name: '在资源站搜索', type: 'open', icon: 'set-location.svg', template: 'https://xxxx.com/torrents.php?searchstr={name}', submenu: '跳转链接', enabled: true }
        ]
    };

    let currentConfig = {};
    let iconsBaseUrl = '';

    // ==========================================================
    //  vvvvvvvvv   配置管理 & UI   vvvvvvvvv
    // ==========================================================

    async function loadConfig() {
        const storedConfigJson = await GM_getValue(CONFIG_KEY, null);
        if (storedConfigJson) {
            try {
                const storedConfig = JSON.parse(storedConfigJson);
                const mergedConfig = {
                    ...defaultConfig,
                    ...storedConfig,
                    submenuSettings: { ...defaultConfig.submenuSettings, ...(storedConfig.submenuSettings || {}) }
                };
                mergedConfig.commands = Array.isArray(storedConfig.commands) ? storedConfig.commands : defaultConfig.commands;
                return mergedConfig;
            } catch (e) { console.error("qBit脚本: 解析配置失败", e); return { ...defaultConfig }; }
        }
        return { ...defaultConfig };
    }

    async function saveConfig(configToSave) {
        try {
            await GM_setValue(CONFIG_KEY, JSON.stringify(configToSave, null, 4));
        } catch (e) { console.error("qBit脚本: 保存配置失败", e); }
    }

    function showSettingsDialog() {
        if (document.getElementById('qbit-script-settings-overlay')) return;

        const placeholders = '{name}, {save_path}, {full_path}, {full_path_mapped}, {hash}, {category}, {tracker}';

        document.body.insertAdjacentHTML('beforeend', `
            <div id="qbit-script-settings-overlay">
                <div id="qbit-script-settings-dialog">
                    <div class="qbit-settings-header"><h2>脚本设置</h2><button id="qbit-settings-close" class="qbit-close-btn">×</button></div>
                    <div class="qbit-settings-content">
                        <div class="qbit-settings-section">
                            <h4>常规</h4>
                            <label><input type="checkbox" id="qbit-settings-enable-mapping"> <strong>启用路径映射</strong></label>
                            <label for="qbit-settings-mappings" style="margin-top: 15px;">路径映射规则 (JSON):</label>
                            <textarea id="qbit-settings-mappings" rows="4"></textarea>
                        </div>
                        <div class="qbit-settings-section" id="qbit-commands-section">
                            <h4>自定义命令</h4>
                            <p class="qbit-settings-desc">提示: 在模板中可使用以下占位符: ${placeholders}</p>
                            <div id="qbit-groups-container"></div>
                             <div class="qbit-section-footer"><button id="qbit-add-submenu" class="qbit-btn">＋ 添加二级菜单</button></div>
                        </div>
                    </div>
                    <div class="qbit-settings-footer"><button id="qbit-settings-save" class="qbit-btn qbit-btn-primary">保存设置</button></div>
                </div>
            </div>`);
        createIconPickerPanel();
        document.getElementById('qbit-settings-enable-mapping').checked = currentConfig.isPathMappingEnabled;
        document.getElementById('qbit-settings-mappings').value = JSON.stringify(currentConfig.pathMappings, null, 4);
        renderSettingsUI();
        setupDragAndDrop();
        const dialog = document.getElementById('qbit-script-settings-dialog');
        dialog.addEventListener('click', handleSettingsEvents);
        document.getElementById('qbit-script-settings-overlay').addEventListener('click', (e) => {
             if (e.target.id === 'qbit-script-settings-overlay') closeDialog();
        });
    }

    function handleSettingsEvents(e) {
        if (e.target.id === 'qbit-add-submenu') {
            const name = prompt("请输入新的二级菜单名称:", "新菜单");
            if (name) addCommandGroupUI(name, []);
        }
        else if (e.target.classList.contains('qbit-add-command-btn')) {
            const group = e.target.closest('.qbit-command-group');
            addCommandUI(null, group.querySelector('.qbit-group-commands'));
        }
        else if (e.target.classList.contains('qbit-delete-command')) e.target.closest('.qbit-command-card').remove();
        else if (e.target.classList.contains('qbit-delete-group-btn')) {
            if (confirm("确定要删除这个二级菜单及其所有命令吗？")) e.target.closest('.qbit-command-group').remove();
        }
        else if (e.target.closest('.icon-picker-trigger')) openIconPicker(e.target.closest('.icon-picker-trigger'));
        else if (e.target.id === 'qbit-settings-save') handleSave();
        else if (e.target.id === 'qbit-settings-close') closeDialog();
    }

    function renderSettingsUI() {
        const container = document.getElementById('qbit-groups-container');
        container.innerHTML = '';
        addCommandGroupUI('', []); // Root group
        const renderedSubmenus = new Set();
        currentConfig.commands.forEach(cmd => {
            if (cmd.submenu) {
                if (!renderedSubmenus.has(cmd.submenu)) {
                    addCommandGroupUI(cmd.submenu, []);
                    renderedSubmenus.add(cmd.submenu);
                }
                const groupContainer = container.querySelector(`[data-submenu-name="${cmd.submenu}"] .qbit-group-commands`);
                if(groupContainer) addCommandUI(cmd, groupContainer);
            } else {
                addCommandUI(cmd, container.querySelector('[data-submenu-name=""] .qbit-group-commands'));
            }
        });
    }

    function addCommandGroupUI(name, commands) {
        const isRoot = name === '';
        const title = isRoot ? '顶级菜单命令' : name;
        const container = document.getElementById('qbit-groups-container');
        const defaultIcon = 'configure.svg';
        const submenuIcon = currentConfig.submenuSettings?.[name]?.icon || defaultIcon;

        const groupWrapper = document.createElement('div');
        groupWrapper.className = 'qbit-command-group';
        groupWrapper.draggable = !isRoot;
        groupWrapper.dataset.submenuName = name;

        let titleHtml;
        if (isRoot) {
            titleHtml = `<h4>${title}</h4>`;
        } else {
            titleHtml = `
                <span class="drag-handle" title="拖动排序">⠿</span>
                <div class="icon-picker-trigger submenu-icon-preview" title="设置二级菜单图标">
                    <img src="${iconsBaseUrl}${submenuIcon}" alt="icon">
                </div>
                <input type="hidden" class="submenu-icon-value">
                <input type="text" class="qbit-submenu-name-input">
            `;
        }

        const actionsHtml = `
            <button class="qbit-btn qbit-btn-small qbit-add-command-btn">＋ 添加命令</button>
            ${isRoot ? '' : '<button class="qbit-btn qbit-btn-danger qbit-delete-group-btn">删除分组</button>'}
        `;

        groupWrapper.innerHTML = `
            <div class="qbit-group-header">
                <div class="qbit-group-title">${titleHtml}</div>
                <div class="qbit-group-actions">${actionsHtml}</div>
            </div>
            <div class="qbit-group-commands"></div>`;

        if (!isRoot) {
            groupWrapper.querySelector('.submenu-icon-value').value = submenuIcon;
            groupWrapper.querySelector('.qbit-submenu-name-input').value = title;
        }

        const commandsContainer = groupWrapper.querySelector('.qbit-group-commands');
        commands.forEach(cmd => addCommandUI(cmd, commandsContainer));
        container.appendChild(groupWrapper);
    }

    function addCommandUI(cmd, container) {
        const id = cmd ? cmd.id : `cmd-${Date.now()}`;
        const defaultIcon = 'configure.svg';
        const card = document.createElement('div');
        card.className = 'qbit-command-card';
        card.draggable = true;
        card.dataset.id = id;
        card.innerHTML = `
            <span class="drag-handle" title="拖动排序">⠿</span>
            <div class="icon-picker-trigger cmd-icon-preview" title="设置命令图标"><img alt="icon"></div>
            <input type="hidden" class="cmd-icon-value">
            <div class="qbit-card-fields-col">
                <div class="qbit-form-group">
                    <input type="text" class="cmd-name" placeholder="菜单名称">
                    <select class="cmd-type"><option value="copy">复制</option><option value="open">跳转</option></select>
                </div>
                <div class="qbit-form-group"><input type="text" class="cmd-template" placeholder="命令/链接模板"></div>
            </div>
            <div class="qbit-card-actions-col">
                 <label class="qbit-toggle-switch" title="启用/禁用"><input type="checkbox" class="cmd-enabled"><span></span></label>
                <button class="qbit-delete-command" title="删除命令">✕</button>
            </div>`;

        card.querySelector('.cmd-icon-preview img').src = `${iconsBaseUrl}${cmd?.icon || defaultIcon}`;
        card.querySelector('.cmd-icon-value').value = cmd?.icon || defaultIcon;
        card.querySelector('.cmd-name').value = cmd?.name || '';
        card.querySelector('.cmd-type').value = cmd?.type || 'copy';
        card.querySelector('.cmd-template').value = cmd?.template || '';
        card.querySelector('.cmd-enabled').checked = !cmd || cmd.enabled;

        container.appendChild(card);
    }

    async function handleSave() {
        let newMappings;
        try {
            newMappings = JSON.parse(document.getElementById('qbit-settings-mappings').value);
            if (!Array.isArray(newMappings)) throw new Error("顶层结构必须是数组");
        } catch (e) { alert(`路径映射规则JSON格式错误！\n${e.message}`); return; }

        const newCommands = [];
        const newSubmenuSettings = {};

        document.querySelectorAll('#qbit-groups-container .qbit-command-group').forEach(group => {
            const isRoot = !group.querySelector('.qbit-submenu-name-input');
            const submenuName = isRoot ? '' : group.querySelector('.qbit-submenu-name-input').value.trim();

            if (!isRoot && submenuName) {
                newSubmenuSettings[submenuName] = { icon: group.querySelector('.submenu-icon-value').value };
            }
            group.querySelectorAll('.qbit-command-card').forEach(card => {
                const name = card.querySelector('.cmd-name').value.trim();
                if (!name) return;
                newCommands.push({
                    id: card.dataset.id, enabled: card.querySelector('.cmd-enabled').checked, name: name,
                    type: card.querySelector('.cmd-type').value, icon: card.querySelector('.cmd-icon-value').value,
                    submenu: submenuName, template: card.querySelector('.cmd-template').value
                });
            });
        });

        const newConfig = {
            isPathMappingEnabled: document.getElementById('qbit-settings-enable-mapping').checked,
            pathMappings: newMappings, submenuSettings: newSubmenuSettings, commands: newCommands
        };
        await saveConfig(newConfig);
        currentConfig = newConfig;
        closeDialog();
        showNotification('设置已保存!', 'success');
        rebuildMenu();
    }

    function closeDialog() {
        document.getElementById('qbit-icon-picker-panel')?.remove();
        document.getElementById('qbit-script-settings-overlay')?.remove();
    }

    function rebuildMenu() {
        document.querySelectorAll('.qbit-script-menu-item').forEach(el => el.remove());
        createMenuItems();
    }

    // ==========================================================
    //  vvvvvvvvv   Drag and Drop Logic (FIXED)   vvvvvvvvv
    // ==========================================================

    function setupDragAndDrop() {
        const container = document.getElementById('qbit-groups-container');
        let draggedEl = null;

        container.addEventListener('dragstart', (e) => {
            // BUGFIX: The original check `!e.target.matches('.drag-handle')` was incorrect.
            // The `e.target` of a dragstart event is the draggable element itself, not the handle child.
            // This faulty check caused the drag to always be prevented.
            // The new logic allows dragging from anywhere on the card/group except for interactive form elements,
            // which prevents issues like being unable to select text in an input field.
            if (e.target.matches('input, select, textarea, button, a, .icon-picker-trigger')) {
                e.preventDefault();
                return;
            }

            draggedEl = e.target.closest('[draggable="true"]');
            if (!draggedEl) return;

            // Set data for Firefox compatibility
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', null);

            // Add dragging class after a short delay to allow the browser to create the drag image
            setTimeout(() => {
                if (draggedEl) {
                    draggedEl.classList.add('dragging');
                }
            }, 0);
        });

        container.addEventListener('dragend', () => {
            if (!draggedEl) return;
            draggedEl.classList.remove('dragging');
            const placeholder = getDragPlaceholder();
            if (placeholder.parentElement) {
                placeholder.remove();
            }
            draggedEl = null;
        });

        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!draggedEl) return;

            const dropZone = e.target.closest('.qbit-group-commands, #qbit-groups-container');
            if (!dropZone) return;

            const afterElement = getDragAfterElement(dropZone, e.clientY);
            const placeholder = getDragPlaceholder();
            if (afterElement == null) {
                dropZone.appendChild(placeholder);
            } else {
                dropZone.insertBefore(placeholder, afterElement);
            }
        });

        container.addEventListener('drop', (e) => {
            e.preventDefault();
            if (!draggedEl) return;

            const placeholder = getDragPlaceholder();
            if (placeholder.parentElement) {
                placeholder.parentElement.insertBefore(draggedEl, placeholder);
                placeholder.remove();
            }
        });
    }


    function getDragPlaceholder() {
        let placeholder = document.getElementById('drag-placeholder');
        if (!placeholder) {
            placeholder = document.createElement('div');
            placeholder.id = 'drag-placeholder';
        }
        // Check what kind of element is being dragged to apply the correct placeholder style
        if (document.querySelector('.qbit-command-group.dragging')) {
            placeholder.className = 'qbit-command-group';
        } else {
             placeholder.className = '';
        }
        return placeholder;
    }

    function getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('[draggable="true"]:not(.dragging):not(#drag-placeholder)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }


    // ==========================================================
    //  vvvvvvvvv   核心功能 (菜单创建, 命令执行)   vvvvvvvvv
    // ==========================================================

    function createMenuItems() {
        const menu = document.getElementById('torrentsTableMenu');
        if (!menu) return;

        const commandElementsToBind = [];
        let menuHtml = '';
        const enabledCommands = currentConfig.commands.filter(c => c.enabled);
        if (enabledCommands.length > 0) menuHtml += `<li class="separator qbit-script-menu-item"></li>`;

        const submenusRendered = new Set();
        enabledCommands.forEach(cmd => {
            if (cmd.submenu) {
                if (!submenusRendered.has(cmd.submenu)) {
                    const submenuCmds = enabledCommands.filter(c => c.submenu === cmd.submenu);
                    if (submenuCmds.length > 0) {
                        const submenuIcon = currentConfig.submenuSettings?.[cmd.submenu]?.icon || submenuCmds[0].icon;
                        menuHtml += `<li class="qbit-script-menu-item"><a href="#" class="arrow-right"><img src="${iconsBaseUrl}${submenuIcon}" alt="${cmd.submenu}"> ${cmd.submenu}</a><ul>`;
                        submenuCmds.forEach(innerCmd => {
                            menuHtml += `<li><a id="${innerCmd.id}" href="#"><img src="${iconsBaseUrl}${innerCmd.icon}" alt="${innerCmd.name}"> ${innerCmd.name}</a></li>`;
                            commandElementsToBind.push(innerCmd);
                        });
                        menuHtml += `</ul></li>`;
                        submenusRendered.add(cmd.submenu);
                    }
                }
            } else {
                menuHtml += `<li class="qbit-script-menu-item"><a id="${cmd.id}" href="#"><img alt="${cmd.name}" src="${iconsBaseUrl}${cmd.icon}">${cmd.name}</a></li>`;
                commandElementsToBind.push(cmd);
            }
        });

        menuHtml += `<li class="separator qbit-script-menu-item"></li><li class="qbit-script-menu-item"><a id="openQbitScriptSettings" href="#"><img alt="设置" src="${iconsBaseUrl}configure.svg"> 脚本设置</a></li>`;
        menu.insertAdjacentHTML('beforeend', menuHtml);

        commandElementsToBind.forEach(cmd => {
            document.getElementById(cmd.id)?.addEventListener('click', (e) => { e.preventDefault(); executeCommand(cmd.id); });
        });
        document.getElementById('openQbitScriptSettings')?.addEventListener('click', (e) => { e.preventDefault(); showSettingsDialog(); });
    }

    function executeCommand(commandId) {
        const command = currentConfig.commands.find(c => c.id === commandId);
        if (!command) return;
        const selectedHashes = torrentsTable.selectedRowsIds();
        if (selectedHashes.length === 0) { alert("请至少选择一个种子。"); return; }
        if (command.type === 'open' && selectedHashes.length > 1 && !confirm(`您选择了 ${selectedHashes.length} 个种子，将为每个种子打开一个新标签页。确定吗？`)) return;

        const results = selectedHashes.map(hash => {
            const data = torrentsTable.getFilteredAndSortedRows()[hash]?.full_data;
            if (!data) return '';
            const cleanSavePath = data.save_path.endsWith('/') ? data.save_path.slice(0, -1) : data.save_path;
            const originalFullPath = `${cleanSavePath}/${data.name}`;
            const mappedFullPath = applyPathMapping(originalFullPath);
            let result = command.template;
            const placeholders = {
                '{name}': data.name, '{save_path}': data.save_path, '{full_path}': originalFullPath,
                '{full_path_mapped}': mappedFullPath, '{hash}': hash, '{category}': data.category, '{tracker}': data.tracker
            };
            for (const key in placeholders) { result = result.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), placeholders[key]); }
            return result;
        }).filter(Boolean);

        if (results.length > 0) {
            if (command.type === 'copy') { copyToClipboard(results.join('\n')); showNotification(`已复制 ${results.length} 条命令!`, 'info'); }
            else if (command.type === 'open') { results.forEach(url => window.open(url, '_blank')); }
        }
    }

    // ==========================================================
    //  vvvvvvvvv   辅助函数   vvvvvvvvv
    // ==========================================================

    let currentIconPickerTarget = null;
    function createIconPickerPanel() {
        if (document.getElementById('qbit-icon-picker-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'qbit-icon-picker-panel';
        panel.innerHTML = ICON_LIST.map(icon => `<img src="${iconsBaseUrl}${icon}" alt="${icon}" title="${icon}">`).join('');
        panel.addEventListener('click', (e) => {
            if (e.target.tagName === 'IMG' && currentIconPickerTarget) {
                const iconName = e.target.alt;
                currentIconPickerTarget.querySelector('img').src = `${iconsBaseUrl}${iconName}`;
                currentIconPickerTarget.nextElementSibling.value = iconName;
                panel.style.display = 'none';
            }
        });
        document.body.appendChild(panel);
        document.addEventListener('click', (e) => {
            if (!panel.contains(e.target) && !e.target.closest('.icon-picker-trigger')) {
                panel.style.display = 'none';
            }
        }, true);
    }

    function openIconPicker(targetElement) {
        const panel = document.getElementById('qbit-icon-picker-panel');
        currentIconPickerTarget = targetElement;
        const rect = targetElement.getBoundingClientRect();
        panel.style.top = `${window.scrollY + rect.bottom + 5}px`;
        panel.style.left = `${window.scrollX + rect.left}px`;
        panel.style.display = 'grid';
    }

    function applyPathMapping(originalPath) {
        if (!currentConfig.isPathMappingEnabled) return originalPath;
        for (const mapping of currentConfig.pathMappings) {
            if (originalPath.startsWith(mapping.qbitPath)) return originalPath.replace(mapping.qbitPath, mapping.mappedPath);
        }
        return originalPath;
    }

    function showNotification(message, type = 'info') {
        let n = document.createElement('div');
        n.className = `qbit-script-notification qbit-notification-${type}`; n.textContent = message;
        document.body.appendChild(n);
        setTimeout(() => { n.style.opacity = '0'; setTimeout(() => n.remove(), 500); }, 2500);
    }

    function copyToClipboard(text) {
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
        else fallbackCopy(text);
    }

    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.top = '-9999px';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (err) { console.error('fallbackCopy Error:', err); }
        document.body.removeChild(ta);
    }

    // ==========================================================
    //  vvvvvvvvv   样式注入 & 初始化   vvvvvvvvv
    // ==========================================================

    function injectStyles() {
        GM_addStyle(`
            :root { --qb-bg: #F7F7F7; --qb-surface: #FFF; --qb-border: #E0E0E0; --qb-text: #333; --qb-text-light: #777; --qb-primary: #4CAF50; --qb-primary-hover: #45a049; --qb-danger: #f44336; --qb-danger-hover: #d32f2f; --qb-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            #qbit-script-settings-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
            #qbit-script-settings-dialog { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--qb-bg); color: var(--qb-text); border-radius: 12px; width: 850px; max-width: 95vw; box-shadow: var(--qb-shadow); display: flex; flex-direction: column; max-height: 90vh; }
            .qbit-settings-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; border-bottom: 1px solid var(--qb-border); }
            .qbit-close-btn { background: none; border: none; font-size: 24px; cursor: pointer; color: #999; }
            .qbit-settings-content { padding: 16px 24px; overflow-y: auto; }
            .qbit-settings-section { margin-bottom: 24px; }
            .qbit-settings-section h4 { margin: 0 0 12px; font-size: 1rem; color: var(--qb-text); }
            .qbit-settings-desc { font-size: 0.85em; color: var(--qb-text-light); margin: -8px 0 12px; padding: 8px; background: #f0f0f0; border-radius: 4px; word-break: break-all; }
            #qbit-commands-section .qbit-section-footer { padding-top: 16px; border-top: 1px dashed var(--qb-border); text-align: center; }

            .qbit-command-group { background: var(--qb-surface); border: 1px solid var(--qb-border); border-radius: 8px; margin-bottom: 12px; }
            .qbit-group-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: #fafafa; border-bottom: 1px solid var(--qb-border); }
            .qbit-group-title { display: flex; align-items: center; gap: 8px; flex-grow: 1; }
            .qbit-submenu-name-input { font-size: 1rem; font-weight: 500; border: 1px solid transparent; padding: 4px 8px; border-radius: 4px; flex-grow: 1; }
            .qbit-submenu-name-input:hover, .qbit-submenu-name-input:focus { border-color: #ccc; }
            .qbit-group-actions { display: flex; gap: 8px; }
            .qbit-group-commands { padding: 16px; display: flex; flex-direction: column; gap: 12px; }

            .qbit-command-card { display: flex; gap: 12px; align-items: center; padding: 8px; border: 1px solid transparent; border-radius: 6px; }
            .icon-picker-trigger { cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.2s; }
            .cmd-icon-preview { width: 40px; height: 40px; border-radius: 6px; background: #f0f0f0; }
            .cmd-icon-preview:hover { background: #e0e0e0; }
            .cmd-icon-preview img { width: 24px; height: 24px; }
            .submenu-icon-preview { width: 30px; height: 30px; border-radius: 50%; background: #e8eaf6; }
            .submenu-icon-preview:hover { background: #c5cae9; }
            .submenu-icon-preview img { width: 18px; height: 18px; }

            .qbit-card-fields-col { flex: 1; display: flex; flex-direction: column; gap: 8px; }
            .qbit-form-group { display: flex; gap: 8px; }
            #qbit-script-settings-dialog input, #qbit-script-settings-dialog textarea, #qbit-script-settings-dialog select { width: 100%; padding: 10px; border: 1px solid var(--qb-border); border-radius: 6px; font-size: 14px; background: var(--qb-surface); }
            .qbit-card-actions-col { display: flex; align-items: center; gap: 16px; }
            .qbit-delete-command { background: #fbe9e7; color: var(--qb-danger); border: none; border-radius: 50%; width: 28px; height: 28px; cursor: pointer; font-weight: bold; }

            .drag-handle { cursor: grab; color: #aaa; padding: 0 8px; font-size: 20px; align-self: stretch; display: flex; align-items: center; }
            .dragging { opacity: 0.5; background: #e3f2fd; }
            #drag-placeholder { background: #e3f2fd; border: 2px dashed #90caf9; border-radius: 6px; margin: 6px 0; }
            #drag-placeholder:not(.qbit-command-group) { height: 50px; }
            #drag-placeholder.qbit-command-group { min-height: 100px; }


            .qbit-settings-footer { text-align: right; padding: 16px 24px; border-top: 1px solid var(--qb-border); background: #fcfcfc; }
            .qbit-btn { padding: 8px 16px; border: 1px solid #ccc; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.2s; background: white; }
            .qbit-btn:hover { border-color: #999; }
            .qbit-btn-small { padding: 6px 12px; font-size: 12px; }
            .qbit-btn-primary { background: var(--qb-primary); color: white; border-color: var(--qb-primary); }
            .qbit-btn-primary:hover { background: var(--qb-primary-hover); }
            .qbit-btn-danger { background: var(--qb-surface); color: var(--qb-danger); border-color: var(--qb-danger); }
            .qbit-btn-danger:hover { background: var(--qb-danger); color: white; }

            .qbit-toggle-switch { position: relative; display: inline-block; width: 40px; height: 22px; }
            .qbit-toggle-switch input { opacity: 0; width: 0; height: 0; }
            .qbit-toggle-switch span { position: absolute; cursor: pointer; inset: 0; background-color: #ccc; border-radius: 22px; transition: .4s; }
            .qbit-toggle-switch span:before { position: absolute; content: ""; height: 16px; width: 16px; left: 3px; bottom: 3px; background-color: white; border-radius: 50%; transition: .4s; }
            .qbit-toggle-switch input:checked + span { background-color: var(--qb-primary); }
            .qbit-toggle-switch input:checked + span:before { transform: translateX(18px); }

            #qbit-icon-picker-panel { display: none; position: absolute; z-index: 10001; background: var(--qb-surface); border-radius: 8px; box-shadow: var(--qb-shadow); padding: 10px; grid-template-columns: repeat(6, 1fr); gap: 8px; max-width: 280px; }
            #qbit-icon-picker-panel img { width: 32px; height: 32px; padding: 4px; cursor: pointer; border-radius: 4px; transition: background 0.2s; }
            #qbit-icon-picker-panel img:hover { background: #f0f0f0; }
            .qbit-script-notification { position: fixed; bottom: 20px; right: 20px; color: white; padding: 12px 20px; border-radius: 6px; z-index: 10001; opacity: 1; transition: opacity 0.5s ease, transform 0.5s ease; transform: translateY(0); box-shadow: 0 3px 10px rgba(0,0,0,0.2); }
            .qbit-script-notification.qbit-notification-success { background-color: var(--qb-primary); }
            .qbit-script-notification.qbit-notification-info { background-color: #333; }
        `);
    }

    async function initScript() {
        const menu = document.getElementById('torrentsTableMenu');
        if (!menu) { setTimeout(initScript, 500); return; }
        iconsBaseUrl = menu.querySelector('img')?.src?.includes('/icons/') ? 'icons/' : 'images/';
        injectStyles();
        currentConfig = await loadConfig();
        rebuildMenu();
    }

    window.addEventListener('load', initScript);
})();