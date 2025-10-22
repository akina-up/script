// ==UserScript==
// @name         PT Auto Seeder
// @namespace    https://github.com/akina-up/script
// @version      1.0.5
// @description  (由 Gemini 2.5 Pro 助理)PT站发布成功后自动推送到qBittorrent，推送成功或失败时临时显示结果（包含分类、保存路径、qB名称），并可管理推送记录。
// @author       akina
// @match        http*://*/upload.php*
// @match        http*://*/details.php*
// @match        http*://*/edit.php*
// @match        http*://*/torrents.php*
// @match        https://kp.m-team.cc/*
// @match        https://*/torrents*
// @match        https://totheglory.im/t/*
// @match        https://beyond-hd.me/*
// @connect      *
// @downloadURL  https://cdn.jsdelivr.net/gh/akina-up/script@master/PT/upload/PT-Auto-Seeder.user.js
// @updateURL    https://cdn.jsdelivr.net/gh/akina-up/script@master/PT/upload/PT-Auto-Seeder.user.js
// @supportURL   https://github.com/akina-up/script/issues
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        window.onurlchange
// @run-at       document-end
// ==/UserScript==

/* 更新日志
 * v1.0.5 (由 Gemini 助理修改)
 * - [优化] 仅在“域名推送覆盖”列表中的域名，才会启用“下载模式”。
 * v1.0.4
 * - [新增] 可以设置自动下载
 * - [修复] “已配置站点”支持删除
 * - [优化] 兼容&uploaded=1&offer=1
 * v1.0.3
 * - [修复] chrome下重复推送的问题
 * v1.0.2
 * - [新增] 支持BHD
 * - [优化] hawke强推
 * - [修复] 修复了在qB设置中点击“编辑”按钮。
 * v1.0.1
 * - [新增] 支持U3D
 * - [新增] “强制推送”按钮，可手动触发推送
 * - [新增] “快速操作”按钮，用于快速发布/编辑/保存
 * - [新增] 独立的推送记录悬浮窗
 * - [新增] 设置项：推送排除列表
 * - [新增] 设置项：悬浮图标大小调整
 * - [优化] 推送状态通知栏不再自动消失
 * - [优化] 删除折叠的推送记录时，会删除组内所有条目
 * - [优化] qB密码框改为文本类型
 * v1.0.0
 * -试运行
 */

(function() {
    'use strict';

    // ===========================
    // Constants & Configuration
    // ===========================
    const STORAGE_KEYS = {
        QBS: 'pt_aas_qbs_list',
        ACTIVE_QB: 'pt_aas_active_qb_id',
        SITES: 'pt_aas_site_configs',
        HISTORY: 'pt_aas_history_', // prefix
        UI_POS: 'pt_aas_ui_position',
        SETTINGS_UI_OPEN: 'pt_aas_settings_ui_is_open',
        HISTORY_UI_POS: 'pt_aas_history_ui_position',
        HISTORY_UI_OPEN: 'pt_aas_history_ui_is_open',
        EXCLUDED_URLS: 'pt_aas_excluded_urls',
        ICON_SCALE: 'pt_aas_icon_scale',
        DOMAIN_OVERRIDES: 'pt_aas_domain_overrides' // { [host]: { qbId, downloadMode, dlUpLimit } }
    };

    const ICON_CONTAINER_ID = 'pt-aas-icon-container';
    const SETTINGS_UI_ID = 'pt-aas-settings-ui';
    const HISTORY_UI_ID = 'pt-aas-history-ui';
    const STATUS_BAR_ID = 'pt-aas-status-bar';

    // ===========================
    // Data Management (Storage)
    // ===========================
    const Data = {
        getQBs: () => GM_getValue(STORAGE_KEYS.QBS, []),
        setQBs: (list) => GM_setValue(STORAGE_KEYS.QBS, list),
        getActiveQbId: () => GM_getValue(STORAGE_KEYS.ACTIVE_QB, null),
        setActiveQbId: (id) => { GM_setValue(STORAGE_KEYS.ACTIVE_QB, id); },
        getActiveQb: () => {
            const qbs = Data.getQBs();
            const activeId = Data.getActiveQbId();
            return qbs.find(qb => qb.id === activeId) || null;
        },
        getSites: () => GM_getValue(STORAGE_KEYS.SITES, {}),
        setSites: (sites) => GM_setValue(STORAGE_KEYS.SITES, sites),
        getSiteConfig: (hostname) => Data.getSites()[hostname] || null,

        // 覆盖
        getDomainOverrides: () => GM_getValue(STORAGE_KEYS.DOMAIN_OVERRIDES, {}),
        setDomainOverrides: (obj) => GM_setValue(STORAGE_KEYS.DOMAIN_OVERRIDES, obj),

        getHistory: (qbId) => GM_getValue(STORAGE_KEYS.HISTORY + qbId, []),
        addHistory: (qbId, entry) => {
            let hist = Data.getHistory(qbId);
            hist.unshift(entry);
            GM_setValue(STORAGE_KEYS.HISTORY + qbId, hist);
        },
        deleteHistoryEntry: (qbId, timestamp) => {
            let hist = Data.getHistory(qbId);
            hist = hist.filter(entry => entry.time !== Number(timestamp));
            GM_setValue(STORAGE_KEYS.HISTORY + qbId, hist);
        },
        deleteHistoryGroup: (qbId, name) => {
             if (!confirm(`确定要删除所有名为 "${name}" 的推送记录吗？`)) return false;
            let hist = Data.getHistory(qbId);
            hist = hist.filter(entry => entry.name !== name);
            GM_setValue(STORAGE_KEYS.HISTORY + qbId, hist);
            return true;
        },
        clearHistory: (qbId) => {
            const qbName = (Data.getQBs().find(q => q.id === qbId) || {}).name || 'Unknown';
            if (!confirm(`确定要清除qB "${qbName}" 的所有推送记录吗？\n此操作无法撤销。`)) return;
            GM_setValue(STORAGE_KEYS.HISTORY + qbId, []);
        },
        getIconPos: () => GM_getValue(STORAGE_KEYS.UI_POS, { top: '100px', left: '10px' }),
        setIconPos: (pos) => GM_setValue(STORAGE_KEYS.UI_POS, pos),
        getSettingsUIPos: () => GM_getValue(STORAGE_KEYS.SETTINGS_UI_POS, { top: '100px', left: '60px' }),
        setSettingsUIPos: (pos) => GM_setValue(STORAGE_KEYS.SETTINGS_UI_POS, pos),
        isSettingsUIOpen: () => GM_getValue(STORAGE_KEYS.SETTINGS_UI_OPEN, false),
        setSettingsUIOpen: (isOpen) => GM_setValue(STORAGE_KEYS.SETTINGS_UI_OPEN, isOpen),
        getHistoryUIPos: () => GM_getValue(STORAGE_KEYS.HISTORY_UI_POS, { top: '150px', left: '80px' }),
        setHistoryUIPos: (pos) => GM_setValue(STORAGE_KEYS.HISTORY_UI_POS, pos),
        isHistoryUIOpen: () => GM_getValue(STORAGE_KEYS.HISTORY_UI_OPEN, false),
        setHistoryUIOpen: (isOpen) => GM_setValue(STORAGE_KEYS.HISTORY_UI_OPEN, isOpen),
        getExcludedUrls: () => GM_getValue(STORAGE_KEYS.EXCLUDED_URLS, ''),
        setExcludedUrls: (urls) => GM_setValue(STORAGE_KEYS.EXCLUDED_URLS, urls),
        getIconScale: () => GM_getValue(STORAGE_KEYS.ICON_SCALE, 100),
        setIconScale: (scale) => GM_setValue(STORAGE_KEYS.ICON_SCALE, scale),
    };

    // ===========================
    // Utilities
    // ===========================
    const Utils = {
        generateId: () => Date.now().toString(36) + Math.random().toString(36).substr(2),
        getCurrentHost: () => window.location.hostname,
        cleanTorrentName: (name) => {
            if (!name) return "未知种子";
            let cleaned = name.replace(/^(\[[^\]]+\]\.?)+/g, '').trim();
            cleaned = cleaned.replace(/\.torrent$/i, '').trim();
            return cleaned;
        },
        cleanUrl: (url) => {
            try { let u = new URL(url); u.searchParams.delete('uploaded'); return u.toString(); }
            catch (e) { return url; }
        },
        formatTime: (timestamp) => new Date(timestamp).toLocaleString('zh-CN', { hour12: false }),
        mibToBytes: (mib) => (!mib || isNaN(mib)) ? 0 : Math.floor(parseFloat(mib) * 1024 * 1024)
    };

    // ===========================
    // qBittorrent API Client
    // ===========================
    class QBClient {
        constructor(config) { this.config = config; this.baseUrl = config.url.replace(/\/+$/, ""); }
        async login() {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "POST", url: `${this.baseUrl}/api/v2/auth/login`,
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    data: `username=${encodeURIComponent(this.config.user)}&password=${encodeURIComponent(this.config.pass)}`,
                    onload: (res) => (res.responseText.trim() === "Ok.") ? resolve(true) : reject(`登录失败: ${res.status}`),
                    onerror: (err) => reject(`登录网络错误: ${JSON.stringify(err)}`)
                });
            });
        }
        /**
         * @param {Blob} torrentBlob
         * @param {Object|null} siteSettings
         * @param {Object} mode { skipChecking: boolean, paused: boolean }
         */
        async addTorrent(torrentBlob, siteSettings, mode = { skipChecking: false, paused: false }) {
            try { await this.login(); } catch (e) { return { success: false, message: `qB 认证失败: ${e}` }; }
            return new Promise((resolve) => {
                const formData = new FormData();
                formData.append("torrents", torrentBlob, "torrent.torrent");

                if (this.config.path) formData.append("savepath", this.config.path);
                if (this.config.cat) formData.append("category", this.config.cat);

                // 模式
                formData.append("skip_checking", String(!!mode.skipChecking));
                formData.append("paused", String(!!mode.paused));

                if (siteSettings) {
                    if (siteSettings.upLimit) formData.append("upLimit", Utils.mibToBytes(siteSettings.upLimit));
                    if (siteSettings.superSeed) formData.append("super_seeding", siteSettings.superSeed.toString());
                }

                GM_xmlhttpRequest({
                    method: "POST",
                    url: `${this.baseUrl}/api/v2/torrents/add`,
                    data: formData,
                    onload: (res) => resolve(
                        res.status === 200 && res.responseText.trim() === 'Ok.'
                            ? { success: true }
                            : { success: false, message: `添加失败 (${res.status}): ${res.responseText}` }
                    ),
                    onerror: (err) => resolve({ success: false, message: `添加网络错误: ${JSON.stringify(err)}` })
                });
            });
        }
    }

    // ===========================
    // UI & Styling
    // ===========================
    const Styles = `
        :root {
            --pt-aas-bg: rgba(30, 30, 35, 0.95); --pt-aas-text: #eee; --pt-aas-text-sub: #aaa; --pt-aas-accent: #3498db;
            --pt-aas-accent-hover: #2980b9; --pt-aas-success: #27ae60; --pt-aas-danger: #c0392b; --pt-aas-warning: #f39c12;
            --pt-aas-border: #444; --pt-aas-input-bg: #2c2c32; --pt-aas-info-bg: #2980b9;
            --pt-aas-download: #8e44ad; /* 下载模式通知色（覆盖/默认） */
        }
        #${STATUS_BAR_ID} {
            position: fixed; top: 0; left: 0; right: 0; height: 28px; padding: 0 15px; font-size: 14px; color: white;
            z-index: 10000; box-shadow: 0 1px 5px rgba(0,0,0,0.2); justify-content: center; align-items: center;
            transition: background-color 0.3s; display: none;
        }
        #${STATUS_BAR_ID}.info { background-color: var(--pt-aas-info-bg); }
        #${STATUS_BAR_ID}.success { background-color: var(--pt-aas-success); }
        #${STATUS_BAR_ID}.error { background-color: var(--pt-aas-danger); }
        #${STATUS_BAR_ID}.loading { background-color: var(--pt-aas-warning); }
        #${STATUS_BAR_ID}.download { background-color: var(--pt-aas-download); }

        #${ICON_CONTAINER_ID} { position: fixed; display: flex; flex-direction: column; gap: 8px; z-index: 9998; user-select: none; }
        .pt-aas-action-icon {
             width: 40px; height: 40px; background: var(--pt-aas-accent); color: white; border-radius: 50%;
            display: flex; align-items: center; justify-content: center; cursor: pointer;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3); font-size: 20px; transition: all 0.2s ease-in-out;
        }
        .pt-aas-action-icon:hover { transform: scale(1.15); background-color: var(--pt-aas-accent-hover); }
        #pt-aas-toggle-icon { background-color: #7f8c8d; } #pt-aas-toggle-icon:hover { background-color: #95a5a6; }
        .pt-aas-panel {
            position: fixed; width: 420px; max-height: calc(90vh - 40px); background: var(--pt-aas-bg); color: var(--pt-aas-text); z-index: 9999;
            border-radius: 8px; box-shadow: 0 5px 25px rgba(0,0,0,0.5); display: flex; flex-direction: column; backdrop-filter: blur(5px);
            border: 1px solid var(--pt-aas-border); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-size: 13px; transition: opacity 0.3s, transform 0.3s;
        }
        .pt-aas-panel.hidden { opacity: 0; pointer-events: none; transform: translateX(-20px); }
        .pt-aas-header { padding: 12px 15px; background: rgba(0,0,0,0.2); border-bottom: 1px solid var(--pt-aas-border); font-weight: bold; font-size: 15px; cursor: move; display: flex; justify-content: space-between; align-items: center; border-radius: 8px 8px 0 0; }
        .pt-aas-close-btn { cursor: pointer; padding: 4px; }
        .pt-aas-content { padding: 15px; overflow-y: auto; flex: 1; }
        .pt-aas-content::-webkit-scrollbar { width: 6px; } .pt-aas-content::-webkit-scrollbar-thumb { background: #555; border-radius: 3px; }
        .pt-aas-section { margin-bottom: 20px; border: 1px solid var(--pt-aas-border); border-radius: 6px; overflow: hidden;}
        .pt-aas-sec-title { padding: 8px 12px; background: rgba(255,255,255,0.05); font-weight: 600; cursor: pointer; user-select: none; display: flex; justify-content: space-between; }
        .pt-aas-sec-title::after { content: '▼'; font-size: 0.8em; transition: transform 0.3s;}
        .pt-aas-section.collapsed .pt-aas-sec-title::after { transform: rotate(-90deg); }
        .pt-aas-sec-body { padding: 12px; display: block;} .pt-aas-section.collapsed .pt-aas-sec-body { display: none; }
        .pt-aas-form-group { margin-bottom: 10px; } .pt-aas-form-group label { display: block; margin-bottom: 4px; color: var(--pt-aas-text-sub); }
        .pt-aas-input, .pt-aas-textarea, .pt-aas-select { width: 100%; box-sizing: border-box; padding: 8px; background: var(--pt-aas-input-bg); border: 1px solid var(--pt-aas-border); color: var(--pt-aas-text); border-radius: 4px; }
        .pt-aas-textarea { min-height: 80px; resize: vertical; }
        .pt-aas-input:focus, .pt-aas-textarea:focus, .pt-aas-select:focus { outline: 1px solid var(--pt-aas-accent); border-color: var(--pt-aas-accent); }
        .pt-aas-btn { padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; background: #555; color: white; transition: background 0.2s; }
        .pt-aas-btn.primary { background: var(--pt-aas-accent); } .pt-aas-btn.primary:hover { background: var(--pt-aas-accent-hover); }
        .pt-aas-btn.danger { background: var(--pt-aas-danger); } .pt-aas-btn.small { padding: 4px 8px; font-size: 11px; }
        .pt-aas-btn-group { display: flex; gap: 5px; flex-wrap: wrap; }
        .pt-aas-qb-selector-btn { background: transparent; border: 1px solid var(--pt-aas-border); color: var(--pt-aas-text-sub); flex: 1; min-width: 60px; }
        .pt-aas-qb-selector-btn.active { background: var(--pt-aas-accent); color: white; border-color: var(--pt-aas-accent); }
        .pt-aas-toggle-btn { background: #555; color: #aaa; display: inline-flex; align-items: center; gap: 5px; }
        .pt-aas-toggle-btn.on { background: var(--pt-aas-success); color: white; }
        .pt-aas-toggle-btn::before { content: 'OFF'; } .pt-aas-toggle-btn.on::before { content: 'ON'; }
        .pt-aas-table { width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed; }
        .pt-aas-table th { text-align: left; color: var(--pt-aas-text-sub); padding: 4px; border-bottom: 1px solid var(--pt-aas-border); }
        .pt-aas-table th:nth-child(1) { width: 40%; } .pt-aas-table th:nth-child(4) { width: 15%; text-align: center; }
        .pt-aas-table td { padding: 6px 4px; border-bottom: 1px solid #333; vertical-align: top; word-break: break-all; }
        .pt-aas-table td:nth-child(4) { text-align: center; }
        .pt-aas-table-site a { color: var(--pt-aas-accent); text-decoration: none; } .pt-aas-table-site a:hover { text-decoration: underline; }
        .pt-aas-hist-group-header { cursor: pointer; background: rgba(255,255,255,0.02); } .pt-aas-hist-group-header:hover { background: rgba(255,255,255,0.05); }
        .pt-aas-hist-badge { background: var(--pt-aas-accent); padding: 1px 5px; border-radius: 10px; font-size: 9px; display: inline-block; vertical-align: middle; }
        .pt-aas-hist-expander { display: inline-block; width: 12px; text-align: center; margin-right: 4px; color: var(--pt-aas-text-sub); }
        .pt-aas-config-list-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 6px; background: rgba(0,0,0,0.1); margin-bottom: 4px; border-radius: 4px; }
        .pt-aas-mt-10 { margin-top: 10px; }
        .pt-aas-slider-container { display:flex; align-items:center; gap:10px; }
        .pt-aas-slider-container input { flex-grow:1; }
        .pt-aas-row { display:flex; gap:6px; align-items:center; }
        .pt-aas-row > * { flex:1; }
        .pt-aas-note { color: var(--pt-aas-text-sub); font-size: 12px; }
    `;

    // ===========================
    // UI Construction & Logic
    // ===========================
    const UI = {
        collapsedHistoryGroups: {},
        statusTimeout: null,

        init: () => {
            GM_addStyle(Styles);
            UI.createStatusBar(); UI.createActionIcons(); UI.createSettingsSidebar(); UI.createHistoryPanel();
            UI.bindDraggable('#'+ICON_CONTAINER_ID, Data.getIconPos, Data.setIconPos);
            UI.bindDraggable(`#${SETTINGS_UI_ID} .pt-aas-header`, Data.getSettingsUIPos, Data.setSettingsUIPos);
            UI.bindDraggable(`#${HISTORY_UI_ID} .pt-aas-header`, Data.getHistoryUIPos, Data.setHistoryUIPos);
            UI.renderAll();
            UI.updateIconScale(Data.getIconScale());

            if (Data.isSettingsUIOpen()) document.getElementById(SETTINGS_UI_ID).classList.remove('hidden');
            if (Data.isHistoryUIOpen()) document.getElementById(HISTORY_UI_ID).classList.remove('hidden');
        },

        createStatusBar: () => { const div = document.createElement('div'); div.id = STATUS_BAR_ID; document.body.appendChild(div); },
        updateStatusBar: (status, message, isSticky = false) => {
            clearTimeout(UI.statusTimeout);
            const el = document.getElementById(STATUS_BAR_ID);
            el.className = status;
            el.textContent = message;

            if (status === 'info' || !message) {
                el.style.display = 'none';
                document.body.style.marginTop = '0';
            } else {
                el.style.display = 'flex';
                document.body.style.marginTop = '28px';
            }

            if (!isSticky && (status === 'success' || status === 'error' || status === 'warning' || status === 'download')) {
                 // No auto-hide
            }
        },

        createActionIcons: () => {
            const container = document.createElement('div');
            container.id = ICON_CONTAINER_ID;
            const pos = Data.getIconPos();
            container.style.top = pos.top; container.style.left = pos.left;
            container.innerHTML = `
                <div class="pt-aas-action-icon" id="pt-aas-push-icon" title="强制推送当前种子">🚀</div>
                <div class="pt-aas-action-icon" id="pt-aas-quick-action-icon" title="快速发布/编辑">⚡️</div>
                <div class="pt-aas-action-icon" id="pt-aas-history-icon" title="显示推送记录">📜</div>
                <div class="pt-aas-action-icon" id="pt-aas-toggle-icon" title="打开设置">⚙️</div>
            `;
            document.body.appendChild(container);

            document.getElementById('pt-aas-toggle-icon').onclick = UI.toggleSettingsSidebar;
            document.getElementById('pt-aas-history-icon').onclick = UI.toggleHistoryPanel;
            document.getElementById('pt-aas-push-icon').onclick = () => Automation.pushTorrent(true);
            document.getElementById('pt-aas-quick-action-icon').onclick = Automation.quickAction;
        },
        toggleSettingsSidebar: () => { const sidebar = document.getElementById(SETTINGS_UI_ID); sidebar.classList.toggle('hidden'); Data.setSettingsUIOpen(!sidebar.classList.contains('hidden')); },
        toggleHistoryPanel: () => { const panel = document.getElementById(HISTORY_UI_ID); panel.classList.toggle('hidden'); Data.setHistoryUIOpen(!panel.classList.contains('hidden')); },
        updateIconScale: (value) => {
            const container = document.getElementById(ICON_CONTAINER_ID);
            if(container) container.style.transform = `scale(${value / 100})`;
            const label = document.getElementById('icon-scale-label');
            if(label) label.textContent = `${value}%`;
        },

        createSettingsSidebar: () => {
            const container = document.createElement('div'); container.id = SETTINGS_UI_ID; container.className = 'pt-aas-panel hidden';
            const pos = Data.getSettingsUIPos(); container.style.top = pos.top; container.style.left = pos.left;
            container.innerHTML = `
                <div class="pt-aas-header"><span>PT Auto Seeder 设置</span><span class="pt-aas-close-btn" id="pt-aas-close-btn-settings">✕</span></div>
                <div class="pt-aas-content">
                    <div class="pt-aas-section">
                        <div class="pt-aas-sec-title">选择活动的 qB</div>
                        <div class="pt-aas-sec-body"><div class="pt-aas-btn-group" id="pt-aas-active-qb-list"></div></div>
                    </div>

                    <div class="pt-aas-section collapsed">
                        <div class="pt-aas-sec-title">qBittorrent 设置</div>
                        <div class="pt-aas-sec-body">
                            <div id="pt-aas-qb-form">
                                <input type="hidden" id="qb-id">
                                <div class="pt-aas-form-group"><label>别名</label><input class="pt-aas-input" id="qb-name" placeholder="例如: Home NAS"></div>
                                <div class="pt-aas-form-group"><label>URL (http://ip:port)</label><input class="pt-aas-input" id="qb-url" placeholder="http://192.168.1.1:8080"></div>
                                <div class="pt-aas-form-group"><label>用户名</label><input class="pt-aas-input" id="qb-user"></div>
                                <div class="pt-aas-form-group"><label>密码</label><input class="pt-aas-input" type="text" id="qb-pass"></div>
                                <div class="pt-aas-form-group"><label>分类 (可选)</label><input class="pt-aas-input" id="qb-cat"></div>
                                <div class="pt-aas-form-group"><label>保存路径 (可选)</label><input class="pt-aas-input" id="qb-path"></div>
                                <div class="pt-aas-btn-group">
                                    <button class="pt-aas-btn primary" id="pt-aas-save-qb-btn">保存 qB</button>
                                    <button class="pt-aas-btn" id="pt-aas-clear-qb-btn">清空表单</button>
                                </div>
                            </div>
                            <div class="pt-aas-mt-10"><strong>已保存的 qB:</strong></div>
                            <div id="pt-aas-saved-qb-list" class="pt-aas-mt-10"></div>
                        </div>
                    </div>

                    <div class="pt-aas-section collapsed">
                        <div class="pt-aas-sec-title">站点特定设置</div>
                        <div class="pt-aas-sec-body">
                            <div class="pt-aas-form-group"><label>站点别名 (可选)</label><input class="pt-aas-input" id="site-alias" placeholder="例如: 柠檬HD"></div>
                            <div class="pt-aas-form-group"><label>站点域名 (Host)</label><div class="pt-aas-row"><input class="pt-aas-input" id="site-host" placeholder="xxx.com"><button class="pt-aas-btn small" id="pt-aas-get-host-btn">获取当前</button></div></div>
                            <div class="pt-aas-form-group"><label>上传限速 (MiB/s, 0为不限)</label><input type="number" step="0.1" class="pt-aas-input" id="site-uplimit" placeholder="0"></div>
                            <div class="pt-aas-form-group" style="display:flex; justify-content:space-between; align-items:center;"><label style="margin:0">超级做种模式</label><button class="pt-aas-btn pt-aas-toggle-btn" id="site-superseed-btn" data-val="false"></button></div>
                            <div class="pt-aas-btn-group"><button class="pt-aas-btn primary" id="pt-aas-save-site-btn">保存站点配置</button></div>
                            <div class="pt-aas-mt-10"><strong>已配置站点:</strong></div>
                            <div id="pt-aas-saved-site-list" class="pt-aas-mt-10"></div>
                            <div class="pt-aas-note">提示：此处为“做种模式/通用”参数；如需同URL改为在另一台 qB 以“下载模式”添加，请使用下方“域名推送覆盖”。</div>
                        </div>
                    </div>

                    <div class="pt-aas-section collapsed">
                        <div class="pt-aas-sec-title">域名推送覆盖（下载模式）</div>
                        <div class="pt-aas-sec-body">
                            <div class="pt-aas-form-group"><label>域名 (Host)</label>
                                <div class="pt-aas-row">
                                    <input class="pt-aas-input" id="ovr-host" placeholder="例如: xxx.me">
                                    <button class="pt-aas-btn small" id="ovr-get-host-btn">获取当前</button>
                                </div>
                            </div>
                            <div class="pt-aas-form-group"><label>推送到的 qB（单独服务器）</label>
                                <select class="pt-aas-select" id="ovr-qb"></select>
                            </div>
                            <div class="pt-aas-form-group">
                                <label style="display:flex;align-items:center;gap:8px;">
                                    <input type="checkbox" id="ovr-download-mode" checked>
                                    以“下载模式”推送（不同通知样式）
                                </label>
                            </div>
                            <div class="pt-aas-form-group">
                                <label>下载模式上传限速 (MiB/s，0为不限)</label>
                                <input type="number" step="0.1" class="pt-aas-input" id="ovr-dl-uplimit" placeholder="0">
                            </div>
                            <div class="pt-aas-btn-group">
                                <button class="pt-aas-btn primary" id="ovr-save-btn">保存覆盖</button>
                                <button class="pt-aas-btn" id="ovr-clear-btn">清空</button>
                            </div>
                            <div class="pt-aas-mt-10"><strong>已配置覆盖:</strong></div>
                            <div id="ovr-list" class="pt-aas-mt-10"></div>
                        </div>
                    </div>

                    <div class="pt-aas-section collapsed">
                        <div class="pt-aas-sec-title">高级设置</div>
                        <div class="pt-aas-sec-body">
                         <div class="pt-aas-form-group">
                            <label>推送排除列表 (每行一个域名)</label>
                            <textarea class="pt-aas-textarea" id="excluded-urls-textarea" placeholder="e.g.\nexample.com\nanother.site.net"></textarea>
                            <button class="pt-aas-btn primary pt-aas-mt-10" id="save-excluded-urls-btn">保存排除列表</button>
                         </div>
                         <div class="pt-aas-form-group">
                            <label>悬浮图标大小</label>
                            <div class="pt-aas-slider-container">
                                <input type="range" id="icon-scale-slider" min="50" max="300" step="10">
                                <span id="icon-scale-label">100%</span>
                            </div>
                         </div>
                        </div>
                    </div>
                </div>`;
            document.body.appendChild(container);
            UI.bindSettingsEvents();
        },
        createHistoryPanel: () => {
             const container = document.createElement('div'); container.id = HISTORY_UI_ID; container.className = 'pt-aas-panel hidden';
             const pos = Data.getHistoryUIPos(); container.style.top = pos.top; container.style.left = pos.left;
             container.innerHTML = `
                <div class="pt-aas-header"><span>推送记录</span><span class="pt-aas-close-btn" id="pt-aas-close-btn-history">✕</span></div>
                <div class="pt-aas-content">
                    <div class="pt-aas-section"><div class="pt-aas-sec-body">
                        <div style="display: flex; gap: 5px; align-items: center; margin-bottom: 10px;">
                            <select id="pt-aas-history-qb-select" class="pt-aas-input" style="flex-grow: 1;"></select>
                            <button class="pt-aas-btn danger small" id="pt-aas-clear-history-btn" title="清空当前选中qB的所有记录">清空</button>
                        </div>
                        <table class="pt-aas-table">
                            <thead><tr><th>名称</th><th>站点</th><th>时间</th><th>操作</th></tr></thead>
                            <tbody id="pt-aas-history-body"></tbody>
                        </table>
                    </div></div>
                </div>
             `;
             document.body.appendChild(container);
             UI.bindHistoryEvents();
        },
        bindDraggable: (selector, getter, setter) => {
            const handle = document.querySelector(selector);
            if (!handle) return;
            const target = handle.closest('.pt-aas-panel') || handle;
            let isDragging = false, startX, startY, initialTop, initialLeft;

            handle.addEventListener("mousedown", e => {
                if (e.target.closest('button, a, input, select, textarea, .pt-aas-close-btn')) return;
                isDragging = true;
                startX = e.clientX; startY = e.clientY;
                const pos = getter();
                initialTop = parseInt(pos.top, 10) || 0;
                initialLeft = parseInt(pos.left, 10) || 0;
                handle.style.cursor = "grabbing";
                document.body.style.userSelect = 'none';
                e.preventDefault();
            });

            document.addEventListener("mousemove", e => {
                if (!isDragging) return;
                target.style.top = initialTop + e.clientY - startY + "px";
                target.style.left = initialLeft + e.clientX - startX + "px";
            });

            document.addEventListener("mouseup", () => {
                if (isDragging) {
                    isDragging = false;
                    handle.style.cursor = "move";
                    document.body.style.userSelect = '';
                    setter({ top: target.style.top, left: target.style.left });
                }
            });
        },

        bindSettingsEvents: () => {
            document.querySelectorAll(`#${SETTINGS_UI_ID} .pt-aas-sec-title`).forEach(el => el.onclick = () => el.parentElement.classList.toggle('collapsed'));
            document.getElementById('pt-aas-close-btn-settings').onclick = UI.toggleSettingsSidebar;

            // qB
            document.getElementById('pt-aas-clear-qb-btn').onclick = UI.clearQbForm;
            document.getElementById('pt-aas-save-qb-btn').onclick = UI.saveQb;

            // 站点
            document.getElementById('pt-aas-get-host-btn').onclick = () => { document.getElementById('site-host').value = Utils.getCurrentHost(); };
            document.getElementById('site-superseed-btn').onclick = (e) => { const isOn = !e.target.classList.contains('on'); e.target.dataset.val = isOn; e.target.classList.toggle('on', isOn); };
            document.getElementById('pt-aas-save-site-btn').onclick = UI.saveSite;

            // 覆盖
            document.getElementById('ovr-get-host-btn').onclick = () => { document.getElementById('ovr-host').value = Utils.getCurrentHost(); };
            document.getElementById('ovr-save-btn').onclick = UI.saveOverride;
            document.getElementById('ovr-clear-btn').onclick = UI.clearOverrideForm;

            // 高级
            const scaleSlider = document.getElementById('icon-scale-slider');
            scaleSlider.oninput = (e) => UI.updateIconScale(e.target.value);
            scaleSlider.onchange = (e) => { Data.setIconScale(e.target.value); };
            document.getElementById('save-excluded-urls-btn').onclick = () => {
                const urls = document.getElementById('excluded-urls-textarea').value;
                Data.setExcludedUrls(urls);
                alert('排除列表已保存。');
            };
        },
        bindHistoryEvents: () => {
            document.getElementById('pt-aas-close-btn-history').onclick = UI.toggleHistoryPanel;
            document.getElementById('pt-aas-history-qb-select').onchange = (e) => UI.renderHistory(e.target.value);
            document.getElementById('pt-aas-clear-history-btn').onclick = () => {
                const qbId = document.getElementById('pt-aas-history-qb-select').value;
                if (qbId) { Data.clearHistory(qbId); UI.renderHistory(qbId); }
            };
            document.getElementById('pt-aas-history-body').onclick = (e) => {
                const deleteBtn = e.target.closest('.pt-aas-delete-hist-btn');
                if (deleteBtn) {
                    const { qbid, time, groupName } = deleteBtn.dataset;
                    if (groupName) {
                        if (Data.deleteHistoryGroup(qbid, groupName)) { UI.renderHistory(qbid); }
                    } else {
                        Data.deleteHistoryEntry(qbid, time);
                        UI.renderHistory(qbid);
                    }
                    return;
                }
                const header = e.target.closest('.pt-aas-hist-group-header');
                if (header) {
                    const name = header.dataset.groupName;
                    UI.collapsedHistoryGroups[name] = !(UI.collapsedHistoryGroups[name] !== false);
                    UI.renderHistory(header.dataset.qbid);
                }
            };
        },

        renderAll: () => {
            UI.renderActiveQbSelector(); UI.renderQbList(); UI.renderSiteList();
            UI.renderOverrideForm(); UI.renderOverrideList();
            UI.renderHistorySelectors(); UI.renderAdvancedSettings();
        },
        renderAdvancedSettings: () => {
            document.getElementById('excluded-urls-textarea').value = Data.getExcludedUrls();
            const scale = Data.getIconScale();
            document.getElementById('icon-scale-slider').value = scale;
            document.getElementById('icon-scale-label').textContent = `${scale}%`;
        },
        clearQbForm: () => ['qb-id','qb-name','qb-url','qb-user','qb-pass','qb-cat','qb-path'].forEach(id => document.getElementById(id).value = ''),
        fillQbForm: (qb) => { document.getElementById('qb-id').value = qb.id; document.getElementById('qb-name').value = qb.name; document.getElementById('qb-url').value = qb.url; document.getElementById('qb-user').value = qb.user; document.getElementById('qb-pass').value = qb.pass; document.getElementById('qb-cat').value = qb.cat || ''; document.getElementById('qb-path').value = qb.path || ''; },
        saveQb: () => {
            const id = document.getElementById('qb-id').value || Utils.generateId(), newQb = { id, name: document.getElementById('qb-name').value.trim() || 'Unnamed', url: document.getElementById('qb-url').value.trim(), user: document.getElementById('qb-user').value.trim(), pass: document.getElementById('qb-pass').value.trim(), cat: document.getElementById('qb-cat').value.trim(), path: document.getElementById('qb-path').value.trim() };
            if (!newQb.url) return alert('URL is required');
            let qbs = Data.getQBs(), idx = qbs.findIndex(q => q.id === id); (idx > -1) ? qbs[idx] = newQb : qbs.push(newQb);
            Data.setQBs(qbs); UI.clearQbForm(); UI.renderAll(); if (!Data.getActiveQbId()) { Data.setActiveQbId(id); UI.renderActiveQbSelector(); UI.renderHistorySelectors(); }
        },
        deleteQb: (id) => { if (!confirm('确定要删除此qB配置吗？')) return; let qbs = Data.getQBs().filter(q => q.id !== id); Data.setQBs(qbs); if (Data.getActiveQbId() === id) Data.setActiveQbId(qbs.length > 0 ? qbs[0].id : null); UI.renderAll(); },
        renderActiveQbSelector: () => {
            const qbs = Data.getQBs(), activeId = Data.getActiveQbId(), container = document.getElementById('pt-aas-active-qb-list');
            container.innerHTML = qbs.length ? '' : '<span style="color:#aaa;font-style:italic;">请先添加qB配置</span>';
            qbs.forEach(qb => { const btn = document.createElement('button'); btn.className = `pt-aas-btn pt-aas-qb-selector-btn ${qb.id === activeId ? 'active' : ''}`; btn.textContent = qb.name; btn.title = qb.url; btn.onclick = () => { Data.setActiveQbId(qb.id); UI.renderActiveQbSelector(); UI.renderHistorySelectors(); }; container.appendChild(btn); });
        },
        renderQbList: () => {
            const container = document.getElementById('pt-aas-saved-qb-list'); container.innerHTML = '';
            Data.getQBs().forEach(qb => {
                const div = document.createElement('div'); div.className = 'pt-aas-config-list-item';
                div.innerHTML = `<span><strong>${qb.name}</strong> <small>(${qb.url})</small></span>
                    <div>
                        <button class="pt-aas-btn small" data-id="${qb.id}" data-action="edit">编辑</button>
                        <button class="pt-aas-btn small danger" data-id="${qb.id}" data-action="delete">X</button>
                    </div>`;
                container.appendChild(div);
            });
            container.onclick = (e) => {
                const t = e.target;
                if (t.tagName !== 'BUTTON') return;
                const id = t.dataset.id;
                const action = t.dataset.action;
                if (action === 'edit') {
                    const qbToEdit = Data.getQBs().find(q => q.id === id);
                    if (qbToEdit) UI.fillQbForm(qbToEdit);
                    const qbSection = document.getElementById('pt-aas-qb-form').closest('.pt-aas-section');
                    if (qbSection && qbSection.classList.contains('collapsed')) qbSection.classList.remove('collapsed');
                    document.getElementById('qb-name').focus();
                } else if (action === 'delete') {
                    UI.deleteQb(id);
                }
            };
        },

        // 站点设置
        saveSite: () => {
            const host = document.getElementById('site-host').value.trim(); if (!host) return alert('Host required');
            const sites = Data.getSites();
            sites[host] = { alias: document.getElementById('site-alias').value.trim(), upLimit: document.getElementById('site-uplimit').value, superSeed: document.getElementById('site-superseed-btn').dataset.val === 'true' };
            Data.setSites(sites); UI.renderSiteList();
            ['site-host', 'site-alias', 'site-uplimit'].forEach(id => document.getElementById(id).value = '');
            const ssBtn = document.getElementById('site-superseed-btn'); ssBtn.dataset.val = 'false'; ssBtn.classList.remove('on');
        },
        fillSiteForm: (host, config) => { document.getElementById('site-host').value = host; document.getElementById('site-alias').value = config.alias || ''; document.getElementById('site-uplimit').value = config.upLimit || ''; const ssBtn = document.getElementById('site-superseed-btn'); ssBtn.dataset.val = config.superSeed ? 'true' : 'false'; ssBtn.classList.toggle('on', !!config.superSeed); },
        renderSiteList: () => {
            const container = document.getElementById('pt-aas-saved-site-list');
            container.innerHTML = '';
            const sites = Data.getSites();
            Object.entries(sites).forEach(([host, conf]) => {
                const div = document.createElement('div');
                div.className = 'pt-aas-config-list-item';

                let details = [];
                if (conf.upLimit && parseFloat(conf.upLimit) > 0) details.push(`限速: ${conf.upLimit}MiB/s`);
                else details.push('不限速');
                if (conf.superSeed) details.push('超级做种');
                const detailsText = details.join(' | ');

                const siteDisplayName = conf.alias
                    ? `<strong>${conf.alias}</strong> <small style="color: var(--pt-aas-text-sub);">(${host})</small>`
                    : `<strong>${host}</strong>`;

                div.innerHTML = `
                    <div style="flex-grow: 1; display: flex; flex-direction: column; justify-content: center;">
                        <div style="font-size:12px; line-height: 1.3;">${siteDisplayName}</div>
                        <small style="display: block; color: var(--pt-aas-text-sub); font-size: 10px; margin-top: 3px;">${detailsText}</small>
                    </div>
                    <div>
                        <button class="pt-aas-btn small" data-host="${host}" data-action="edit">编辑</button>
                        <button class="pt-aas-btn small danger" data-host="${host}" data-action="delete">删除</button>
                    </div>
                `;
                container.appendChild(div);
            });

            container.onclick = (e) => {
                const btn = e.target.closest('button'); if (!btn) return;
                const host = btn.dataset.host; const action = btn.dataset.action;
                if (action === 'edit') {
                    const conf = Data.getSites()[host];
                    const siteSection = document.getElementById('pt-aas-saved-site-list').closest('.pt-aas-section');
                    if (siteSection.classList.contains('collapsed')) siteSection.classList.remove('collapsed');
                    UI.fillSiteForm(host, conf);
                } else if (action === 'delete') {
                    if (!confirm(`删除站点配置：${host}？`)) return;
                    const sites2 = Data.getSites();
                    delete sites2[host];
                    Data.setSites(sites2);
                    UI.renderSiteList();
                }
            };
        },

        // 覆盖（下载模式）
        renderOverrideForm: () => {
            const sel = document.getElementById('ovr-qb');
            sel.innerHTML = '';
            const qbs = Data.getQBs();
            if (!qbs.length) {
                const opt = document.createElement('option'); opt.value=''; opt.textContent='请先在“qBittorrent 设置”中添加 qB';
                sel.appendChild(opt);
                sel.disabled = true;
            } else {
                qbs.forEach(qb => {
                    const opt = document.createElement('option');
                    opt.value = qb.id; opt.textContent = `${qb.name} (${qb.url})`;
                    sel.appendChild(opt);
                });
                sel.disabled = false;
            }
        },
        clearOverrideForm: () => {
            document.getElementById('ovr-host').value = '';
            const sel = document.getElementById('ovr-qb');
            if (sel.options.length) sel.selectedIndex = 0;
            document.getElementById('ovr-download-mode').checked = true;
            document.getElementById('ovr-dl-uplimit').value = '';
        },
        saveOverride: () => {
            const host = document.getElementById('ovr-host').value.trim();
            const qbId = document.getElementById('ovr-qb').value;
            const downloadMode = document.getElementById('ovr-download-mode').checked;
            const dlUpLimit = parseFloat(document.getElementById('ovr-dl-uplimit').value || '0') || 0;
            if (!host) return alert('Host required');
            if (!qbId) return alert('请选择要推送到的 qB');
            const overrides = Data.getDomainOverrides();
            overrides[host] = { qbId, downloadMode: !!downloadMode, dlUpLimit };
            Data.setDomainOverrides(overrides);
            UI.renderOverrideList();
            UI.clearOverrideForm();
        },
        renderOverrideList: () => {
            const container = document.getElementById('ovr-list');
            container.innerHTML = '';
            const overrides = Data.getDomainOverrides();
            const qbs = Data.getQBs();
            const getQBName = (id) => (qbs.find(q => q.id === id) || {}).name || '未知qB';

            Object.entries(overrides).forEach(([host, conf]) => {
                const div = document.createElement('div');
                div.className = 'pt-aas-config-list-item';
                const qbName = getQBName(conf.qbId);
                const tag = conf.downloadMode ? '下载模式' : '普通';
                const limitDesc = (conf.dlUpLimit && conf.dlUpLimit > 0) ? `，限速：${conf.dlUpLimit}MiB/s` : '';
                div.innerHTML = `
                    <div style="flex-grow:1;">
                        <strong>${host}</strong>
                        <div class="pt-aas-note">→ ${qbName} <span style="opacity:0.8;">（${tag}${limitDesc}）</span></div>
                    </div>
                    <div>
                        <button class="pt-aas-btn small" data-host="${host}" data-action="edit">编辑</button>
                        <button class="pt-aas-btn small danger" data-host="${host}" data-action="delete">删除</button>
                    </div>
                `;
                container.appendChild(div);
            });

            container.onclick = (e) => {
                const btn = e.target.closest('button'); if (!btn) return;
                const host = btn.dataset.host, action = btn.dataset.action;
                if (action === 'delete') {
                    if (!confirm(`删除覆盖：${host}？`)) return;
                    const ovr = Data.getDomainOverrides();
                    delete ovr[host];
                    Data.setDomainOverrides(ovr);
                    UI.renderOverrideList();
                } else if (action === 'edit') {
                    const ovr = Data.getDomainOverrides()[host];
                    const sec = document.getElementById('ovr-list').closest('.pt-aas-section');
                    if (sec.classList.contains('collapsed')) sec.classList.remove('collapsed');
                    document.getElementById('ovr-host').value = host;
                    document.getElementById('ovr-qb').value = ovr.qbId;
                    document.getElementById('ovr-download-mode').checked = !!ovr.downloadMode;
                    document.getElementById('ovr-dl-uplimit').value = (ovr.dlUpLimit ?? 0) || '';
                }
            };
        },

        renderHistorySelectors: () => {
            const qbs = Data.getQBs(), select = document.getElementById('pt-aas-history-qb-select'); select.innerHTML = '';
            qbs.forEach(qb => { const opt = document.createElement('option'); opt.value = qb.id; opt.textContent = qb.name; select.appendChild(opt); });
            const activeId = Data.getActiveQbId(); if (activeId) { select.value = activeId; }
            UI.renderHistory(select.value);
        },
        renderHistory: (qbId) => {
            if (!qbId) return;
            const history = Data.getHistory(qbId), tbody = document.getElementById('pt-aas-history-body');
            tbody.innerHTML = history.length ? '' : '<tr><td colspan="4" style="text-align:center; color:#aaa;">暂无记录</td></tr>';
            if (!history.length) return;

            const groups = history.reduce((acc, item) => { (acc[item.name] = acc[item.name] || []).push(item); return acc; }, {});

            Object.entries(groups).forEach(([name, groupItems]) => {
                const isMulti = groupItems.length > 1;
                const newest = groupItems[0];
                const isCollapsed = isMulti && (UI.collapsedHistoryGroups[name] !== false);

                const tr = document.createElement('tr');
                tr.dataset.qbid = qbId; tr.dataset.groupName = name;
                if (isMulti) { tr.className = 'pt-aas-hist-group-header'; }

                const countBadge = `<span class="pt-aas-hist-badge">${groupItems.length}</span>`;
                let nameCellHtml = name;
                if (isMulti) nameCellHtml = `<span class="pt-aas-hist-expander">${isCollapsed ? '▶' : '▼'}</span>${name}`;

                const siteCellHtml = (() => {
                    if (isMulti && isCollapsed) return countBadge;
                    const host = newest.host || new URL(newest.url).hostname;
                    const siteConf = Data.getSiteConfig(host);
                    return `<a href="${newest.url}" target="_blank" title="${newest.url}">${siteConf?.alias || host}</a>`;
                })();

                const deleteButtonHtml = isCollapsed
                    ? `<button class="pt-aas-btn danger small pt-aas-delete-hist-btn" data-qbid="${qbId}" data-group-name="${name}" title="删除组内所有记录">删组</button>`
                    : `<button class="pt-aas-btn danger small pt-aas-delete-hist-btn" data-qbid="${qbId}" data-time="${newest.time}" title="删除此条记录">删</button>`;

                tr.innerHTML = `
                    <td>${nameCellHtml}</td> <td class="pt-aas-table-site">${siteCellHtml}</td>
                    <td>${Utils.formatTime(newest.time)}</td> <td>${deleteButtonHtml}</td>`;
                tbody.appendChild(tr);

                if (isMulti && !isCollapsed) {
                    groupItems.slice(1).forEach(item => {
                        const detailTr = document.createElement('tr');
                        detailTr.style.background = 'rgba(0,0,0,0.15)';
                        const detailHost = item.host || new URL(item.url).hostname;
                        const detailSiteConf = Data.getSiteConfig(detailHost);
                        const detailSiteLink = `<a href="${item.url}" target="_blank" title="${item.url}">${detailSiteConf?.alias || detailHost}</a>`;
                        detailTr.innerHTML = `
                            <td style="padding-left:25px;opacity:0.7;">↳ ${item.name}</td>
                            <td class="pt-aas-table-site" style="opacity:0.7;">${detailSiteLink}</td>
                            <td style="opacity:0.7;">${Utils.formatTime(item.time)}</td>
                            <td><button class="pt-aas-btn danger small pt-aas-delete-hist-btn" data-qbid="${qbId}" data-time="${item.time}" title="删除此条记录">删</button></td>`;
                        tbody.appendChild(detailTr);
                    });
                }
            });
        }
    };

    // ===========================
    // Main Automation Logic
    // ===========================
    const Automation = {
        parsePageForTorrent: () => {
            const url = window.location.href;
            const doc = document;
            let torrentLink, torrentName;

            // BHD download_check
            if (url.includes('beyond-hd.me/download_check/')) {
                const nameElement = doc.querySelector('a.beta-link-blend[href*="/torrents/"]');
                const linkElement = doc.querySelector('a.bhd-md-button[href*="/download/"]');
                if (nameElement && linkElement) {
                    torrentLink = linkElement.href;
                    torrentName = nameElement.textContent.trim();
                    return { link: new URL(torrentLink, url).href, name: torrentName };
                }
            }

            // TTG-like
            const ttgLink = Array.from(doc.querySelectorAll('a.index[href*="/dl/"], a[href*=".torrent"]')).find(a => a.href.includes('/dl/') && (a.href.includes('.torrent') || a.textContent.includes('.torrent')));
            if (ttgLink) {
                torrentLink = ttgLink.href;
                torrentName = ttgLink.textContent.trim();
                return { link: new URL(torrentLink, url).href, name: torrentName };
            }

            // 旧 download_check
            if (url.includes('download_check')) {
                const nameElement = Array.from(doc.querySelectorAll('dt')).find(dt => dt.textContent.trim().toLowerCase() === 'name')?.nextElementSibling;
                const linkElement = doc.querySelector('a.form__button[href*="/torrents/download/"]');
                if (nameElement && linkElement) {
                    torrentLink = linkElement.href;
                    torrentName = nameElement.textContent.trim();
                    return { link: new URL(torrentLink, url).href, name: torrentName };
                }
            }

            // details + badge-extra
            const torrentNameH1 = doc.querySelector('h1.torrent__name, h1');
            if (torrentNameH1) {
                const linkElement = doc.querySelector(
                    'a.form__button[href*="/torrents/download/"],' +
                    'a[href*="/torrents/download/"][role="button"].badge-extra'
                );
                if (linkElement) {
                    torrentLink = linkElement.href;
                    torrentName = torrentNameH1.textContent.trim();
                    return { link: new URL(torrentLink, url).href, name: torrentName };
                }
            }

            // 原逻辑
            if (url.includes('details.php')) {
                 const link = Array.from(doc.querySelectorAll('a[href*="download.php"]')).find(a => a.href.includes('id='));
                 if (link) {
                    torrentLink = link.href;
                    torrentName = link.textContent.trim() || doc.title;
                    return { link: new URL(torrentLink, url).href, name: torrentName };
                 }
            }
            return null;
        },

        // 根据覆盖策略，选择 qB + 模式。仅在覆盖设置中推送下载模式，其他默认为做种状态。
        resolveTarget: () => {
            const host = Utils.getCurrentHost();
            const overrides = Data.getDomainOverrides();
            const conf = overrides[host];
            if (conf) {
                const qb = Data.getQBs().find(q => q.id === conf.qbId) || null;
                if (qb) {
                    // 找到了覆盖配置，使用指定的qB和下载模式
                    return { qb, isOverride: true, downloadMode: !!conf.downloadMode };
                }
            }
            // 默认情况：使用活动qB，并设置为做种状态 (downloadMode: false)
            return { qb: Data.getActiveQb(), isOverride: false, downloadMode: false };
        },

        pushTorrent: async (isForced = false) => {
            const torrentInfo = Automation.parsePageForTorrent();
            if (!torrentInfo) {
                if (isForced) UI.updateStatusBar('error', '推送失败: 在当前页面找不到有效的种子链接', true);
                return;
            }

            const target = Automation.resolveTarget();
            const qb = target.qb;
            if (!qb) { UI.updateStatusBar('warning', '推送跳过: 未选择可用的qB客户端', true); return; }

            const cleanName = Utils.cleanTorrentName(torrentInfo.name);

            // 模式：做种模式 (skipChecking=true) vs 下载模式 (skipChecking=false)
            const mode = target.downloadMode
                ? { skipChecking: false, paused: false } // 下载：立即开始校验与下载
                : { skipChecking: true,  paused: false }; // 做种：跳过校验，直接做种

            UI.updateStatusBar('loading', `正在推送: ${cleanName}${target.downloadMode ? '（下载模式）' : ''}`, true);

            try {
                const blob = await new Promise((resolve, reject) => GM_xmlhttpRequest({
                    method:"GET", url:torrentInfo.link, responseType:"blob",
                    onload:r=>r.status===200?resolve(r.response):reject(r.status), onerror:reject
                }));

                // 合成站点参数并在下载模式下应用覆盖限速
                const host = Utils.getCurrentHost();
                const siteCfg = Data.getSiteConfig(host) || {};
                const ovr = Data.getDomainOverrides()[host];

                const effectiveUpLimit =
                    (target.downloadMode && ovr && ovr.dlUpLimit > 0) ? ovr.dlUpLimit :
                    (siteCfg.upLimit ? parseFloat(siteCfg.upLimit) : 0);

                const mergedSiteSettings = {
                    ...siteCfg,
                    upLimit: effectiveUpLimit // MiB/s
                };

                const result = await new QBClient(qb).addTorrent(blob, mergedSiteSettings, mode);

                if (result.success) {
                    Data.addHistory(qb.id, { name: cleanName, url: Utils.cleanUrl(window.location.href), host, time: Date.now() });
                    UI.renderHistory(qb.id);

                    const messageParts = [ target.downloadMode ? '推送成功（下载）' : '推送成功' ];
                    messageParts.push(`qB: ${qb.name}`);
                    if (qb.cat) messageParts.push(`分类: ${qb.cat}`);
                    if (mergedSiteSettings.upLimit && mergedSiteSettings.upLimit > 0) {
                        messageParts.push(`限速: ${mergedSiteSettings.upLimit}MiB/s`);
                    }

                    UI.updateStatusBar(target.downloadMode ? 'download' : 'success', messageParts.join(' | '), true);
                } else {
                     throw new Error(result.message);
                }
            } catch (error) {
                UI.updateStatusBar('error', `推送失败: ${error?.message || '网络错误'} | qB: ${qb.name}`, true);
            }
        },

        checkAndRun: async () => {
            const url = window.location.href;
            const excluded = Data.getExcludedUrls().split('\n').filter(Boolean).map(u => u.trim());
            if(excluded.some(ex => url.includes(ex))) {
                console.log("PT AAS: URL on exclusion list, skipping automatic push.");
                return;
            }

            if (/uploaded=1(&offer=1)?$/.test(url) || url.includes('download_check')) {
                console.log("PT AAS: Upload success page detected, attempting to push.");
                Automation.pushTorrent(false);
            }
        },

        quickAction: () => {
            const path = window.location.pathname;
            let target;

            if (path.includes('/upload.php')) {
                target = document.querySelector('input#qr[type="submit"].btn, input[type="submit"][value="发布"]');
            } else if (path.includes('/details.php')) {
                target = document.querySelector('a[href*="edit.php?id="]');
            } else if (path.includes('/edit.php')) {
                target = document.querySelector('input#qr[type="submit"], input[type="submit"][value="保存"], input[type="submit"][value="编辑"]');
            }

            if (target) {
                target.click();
            } else {
                alert('快速操作按钮在此页面无效。');
            }
        }
    };

    // Initialization
    UI.init();
    Automation.checkAndRun();
    if (window.onurlchange === null) {
        window.addEventListener('urlchange', Automation.checkAndRun);
    }
})();