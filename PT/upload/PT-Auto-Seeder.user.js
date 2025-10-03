// ==UserScript==
// @name         PT Auto Seeder
// @namespace    https://github.com/akina-up/script
// @version      1.0.0
// @description  (由 Gemini 2.5 Pro 助理)PT站发布成功后自动推送到qBittorrent，推送成功或失败时临时显示结果（包含分类、保存路径、qB名称），并可管理推送记录。
// @author       akina
// @match        http*://*/upload.php*
// @match        http*://*/details.php*
// @match        http*://*/edit.php*
// @match        http*://*/torrents.php*
// @match        http*://*/index.php*
// @connect      *
// @downloadURL  https://cdn.jsdelivr.net/gh/akina-up/script@master/PT/upload/PT-Auto-Seeder.user.js
// @updateURL    https://cdn.jsdelivr.net/gh/akina-up/script@master/PT/upload/PT-Auto-Seeder.user.js
// @supportURL   https://github.com/akina-up/script/issues
// @grant        GM_setValue
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        window.onurlchange
// @run-at       document-end
// ==/UserScript==


/* 更新日志
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
        UI_OPEN: 'pt_aas_ui_is_open'
    };

    const UI_ID = 'pt-aas-sidebar-container';
    const TOGGLE_ICON_ID = 'pt-aas-toggle-icon';
    const STATUS_BAR_ID = 'pt-aas-status-bar';

    // ===========================
    // Data Management (Storage)
    // ===========================
    const Data = {
        getQBs: () => GM_getValue(STORAGE_KEYS.QBS, []),
        setQBs: (list) => GM_setValue(STORAGE_KEYS.QBS, list),
        getActiveQbId: () => GM_getValue(STORAGE_KEYS.ACTIVE_QB, null),
        setActiveQbId: (id) => { GM_setValue(STORAGE_KEYS.ACTIVE_QB, id); UI.renderDefaultStatus(); },
        getActiveQb: () => {
            const qbs = Data.getQBs();
            const activeId = Data.getActiveQbId();
            return qbs.find(qb => qb.id === activeId) || null;
        },
        getSites: () => GM_getValue(STORAGE_KEYS.SITES, {}),
        setSites: (sites) => GM_setValue(STORAGE_KEYS.SITES, sites),
        getSiteConfig: (hostname) => Data.getSites()[hostname] || null,
        getHistory: (qbId) => GM_getValue(STORAGE_KEYS.HISTORY + qbId, []),
        addHistory: (qbId, entry) => {
            let hist = Data.getHistory(qbId);
            hist.unshift(entry);
            GM_setValue(STORAGE_KEYS.HISTORY + qbId, hist);
        },
        deleteHistoryEntry: (qbId, timestamp) => {
            let hist = Data.getHistory(qbId);
            const ts = Number(timestamp);
            hist = hist.filter(entry => entry.time !== ts);
            GM_setValue(STORAGE_KEYS.HISTORY + qbId, hist);
        },
        clearHistory: (qbId) => {
            const qbName = (Data.getQBs().find(q => q.id === qbId) || {}).name || 'Unknown';
            if (!confirm(`确定要清除qB "${qbName}" 的所有推送记录吗？\n此操作无法撤销。`)) return;
            GM_setValue(STORAGE_KEYS.HISTORY + qbId, []);
        },
        getUIPos: () => GM_getValue(STORAGE_KEYS.UI_POS, { top: '100px', left: '10px' }),
        setUIPos: (pos) => GM_setValue(STORAGE_KEYS.UI_POS, pos),
        isUIOpen: () => GM_getValue(STORAGE_KEYS.UI_OPEN, false),
        setUIOpen: (isOpen) => GM_setValue(STORAGE_KEYS.UI_OPEN, isOpen)
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
                    onload: (res) => (res.responseText === "Ok." || res.status === 200) ? resolve(true) : reject(`登录失败: ${res.status} ${res.responseText}`),
                    onerror: (err) => reject(`登录网络错误: ${err}`)
                });
            });
        }
        async addTorrent(torrentBlob, siteSettings) {
            try { await this.login(); } catch (e) { return { success: false, message: `qB 认证失败: ${e}` }; }
            return new Promise((resolve) => {
                const formData = new FormData();
                formData.append("torrents", torrentBlob, "torrent.torrent");
                if (this.config.path) formData.append("savepath", this.config.path);
                if (this.config.category) formData.append("category", this.config.category);
                formData.append("skip_checking", "true"); formData.append("paused", "false");
                if (siteSettings) {
                    if (siteSettings.upLimit) formData.append("upLimit", Utils.mibToBytes(siteSettings.upLimit));
                    if (siteSettings.superSeed) formData.append("super_seeding", siteSettings.superSeed.toString());
                }
                GM_xmlhttpRequest({
                    method: "POST", url: `${this.baseUrl}/api/v2/torrents/add`, data: formData,
                    onload: (res) => resolve(res.status === 200 ? { success: true } : { success: false, message: `添加失败 (${res.status}): ${res.responseText}` }),
                    onerror: (err) => resolve({ success: false, message: `添加网络错误: ${err}` })
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
        }
        #${STATUS_BAR_ID} {
            position: fixed; top: 0; left: 0; right: 0; height: 28px; padding: 0 15px; font-size: 12px; color: white;
            z-index: 10000; box-shadow: 0 1px 5px rgba(0,0,0,0.2); justify-content: center; align-items: center;
            transition: background-color 0.3s;
            /* [MODIFIED] Hide by default */
            display: none;
        }
        #${STATUS_BAR_ID}.info { background-color: var(--pt-aas-info-bg); }
        #${STATUS_BAR_ID}.success { background-color: var(--pt-aas-success); }
        #${STATUS_BAR_ID}.error { background-color: var(--pt-aas-danger); }
        #${STATUS_BAR_ID}.loading { background-color: var(--pt-aas-warning); }
        #${TOGGLE_ICON_ID} {
            position: fixed; width: 40px; height: 40px; background: var(--pt-aas-accent); color: white; border-radius: 50%;
            display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 9998;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3); font-size: 20px; transition: transform 0.3s; user-select: none;
        }
        #${TOGGLE_ICON_ID}:hover { transform: scale(1.1); }
        #${UI_ID} {
            position: fixed; width: 380px; max-height: calc(90vh - 40px); top: 40px; background: var(--pt-aas-bg); color: var(--pt-aas-text); z-index: 9999;
            border-radius: 8px; box-shadow: 0 5px 25px rgba(0,0,0,0.5); display: flex; flex-direction: column; backdrop-filter: blur(5px);
            border: 1px solid var(--pt-aas-border); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-size: 13px; transition: opacity 0.3s, transform 0.3s;
        }
        #${UI_ID}.hidden { opacity: 0; pointer-events: none; transform: translateX(-20px); }
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
        .pt-aas-input { width: 100%; box-sizing: border-box; padding: 8px; background: var(--pt-aas-input-bg); border: 1px solid var(--pt-aas-border); color: var(--pt-aas-text); border-radius: 4px; }
        .pt-aas-input:focus { outline: 1px solid var(--pt-aas-accent); border-color: var(--pt-aas-accent); }
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
        .pt-aas-table th:nth-child(1) { width: 40%; } .pt-aas-table th:nth-child(4) { width: 12%; text-align: center; }
        .pt-aas-table td { padding: 6px 4px; border-bottom: 1px solid #333; vertical-align: top; word-break: break-all; }
        .pt-aas-table td:nth-child(4) { text-align: center; }
        .pt-aas-table-site a { color: var(--pt-aas-accent); text-decoration: none; } .pt-aas-table-site a:hover { text-decoration: underline; }
        .pt-aas-hist-group-header { cursor: pointer; background: rgba(255,255,255,0.02); } .pt-aas-hist-group-header:hover { background: rgba(255,255,255,0.05); }
        .pt-aas-hist-badge { background: var(--pt-aas-accent); padding: 1px 5px; border-radius: 10px; font-size: 9px; display: inline-block; vertical-align: middle; }
        .pt-aas-hist-expander { display: inline-block; width: 12px; text-align: center; margin-right: 4px; color: var(--pt-aas-text-sub); }
        .pt-aas-config-list-item { display: flex; justify-content: space-between; align-items: center; padding: 6px; background: rgba(0,0,0,0.1); margin-bottom: 4px; border-radius: 4px; }
        .pt-aas-mt-10 { margin-top: 10px; }
    `;

    // ===========================
    // UI Construction & Logic
    // ===========================
    const UI = {
        collapsedHistoryGroups: {},
        statusTimeout: null,

        init: () => {
            GM_addStyle(Styles);
            UI.createStatusBar(); UI.createToggleIcon(); UI.createSidebar();
            UI.bindDrag(); UI.renderAll(); UI.renderDefaultStatus();
            if (Data.isUIOpen()) document.getElementById(UI_ID).classList.remove('hidden');
        },

        createStatusBar: () => { const div = document.createElement('div'); div.id = STATUS_BAR_ID; document.body.appendChild(div); },
        // [MODIFIED] Logic for showing and hiding the status bar
        updateStatusBar: (status, message) => {
            clearTimeout(UI.statusTimeout);
            const el = document.getElementById(STATUS_BAR_ID);
            el.className = status;
            el.textContent = message;

            if (status === 'info') {
                el.style.display = 'none';
                document.body.style.marginTop = '0';
            } else {
                el.style.display = 'flex';
                document.body.style.marginTop = '28px';
            }

            if (status === 'success' || status === 'error' || status === 'warning') {
                UI.statusTimeout = setTimeout(() => {
                    UI.renderDefaultStatus(); // This will revert to 'info' state, hiding the bar
                }, 8000); // Hide after 8 seconds
            }
        },
        // [MODIFIED] Now this function's main purpose is to set the hidden 'info' state.
        renderDefaultStatus: () => {
            UI.updateStatusBar('info', '');
        },

        createToggleIcon: () => { const icon = document.createElement('div'); icon.id = TOGGLE_ICON_ID; icon.innerHTML = '⚙️'; const pos = Data.getUIPos(); icon.style.top = pos.top; icon.style.left = pos.left; document.body.appendChild(icon); },
        toggleSidebar: () => { const sidebar = document.getElementById(UI_ID); sidebar.classList.toggle('hidden'); Data.setUIOpen(!sidebar.classList.contains('hidden')); },

        createSidebar: () => {
            const container = document.createElement('div'); container.id = UI_ID; container.className = 'hidden';
            const pos = Data.getUIPos(); container.style.top = pos.top; container.style.left = `${parseInt(pos.left) + 50}px`;
            container.innerHTML = `
                <div class="pt-aas-header" id="pt-aas-drag-handle"><span>PT Auto Seeder</span><span class="pt-aas-close-btn" id="pt-aas-close-btn-x">✕</span></div>
                <div class="pt-aas-content">
                    <div class="pt-aas-section"><div class="pt-aas-sec-title">选择活动的 qB</div><div class="pt-aas-sec-body"><div class="pt-aas-btn-group" id="pt-aas-active-qb-list"></div></div></div>
                    <div class="pt-aas-section collapsed"><div class="pt-aas-sec-title">qBittorrent 设置</div><div class="pt-aas-sec-body"><div id="pt-aas-qb-form"><input type="hidden" id="qb-id"><div class="pt-aas-form-group"><label>别名</label><input class="pt-aas-input" id="qb-name" placeholder="例如: Home NAS"></div><div class="pt-aas-form-group"><label>URL (http://ip:port)</label><input class="pt-aas-input" id="qb-url" placeholder="http://192.168.1.1:8080"></div><div class="pt-aas-form-group"><label>用户名</label><input class="pt-aas-input" id="qb-user"></div><div class="pt-aas-form-group"><label>密码</label><input class="pt-aas-input" type="password" id="qb-pass"></div><div class="pt-aas-form-group"><label>分类 (可选)</label><input class="pt-aas-input" id="qb-cat"></div><div class="pt-aas-form-group"><label>保存路径 (可选)</label><input class="pt-aas-input" id="qb-path"></div><div class="pt-aas-btn-group"><button class="pt-aas-btn primary" id="pt-aas-save-qb-btn">保存 qB</button><button class="pt-aas-btn" id="pt-aas-clear-qb-btn">清空表单</button></div></div><div class="pt-aas-mt-10"><strong>已保存的 qB:</strong></div><div id="pt-aas-saved-qb-list" class="pt-aas-mt-10"></div></div></div>
                    <div class="pt-aas-section collapsed"><div class="pt-aas-sec-title">站点特定设置</div><div class="pt-aas-sec-body">
                        <div class="pt-aas-form-group"><label>站点别名 (可选)</label><input class="pt-aas-input" id="site-alias" placeholder="例如: 柠檬HD"></div>
                        <div class="pt-aas-form-group"><label>站点域名 (Host)</label><div style="display:flex; gap:5px;"><input class="pt-aas-input" id="site-host" placeholder="xxx.com"><button class="pt-aas-btn small" id="pt-aas-get-host-btn">获取当前</button></div></div>
                        <div class="pt-aas-form-group"><label>上传限速 (MiB/s, 0为不限)</label><input type="number" step="0.1" class="pt-aas-input" id="site-uplimit" placeholder="0"></div>
                        <div class="pt-aas-form-group" style="display:flex; justify-content:space-between; align-items:center;"><label style="margin:0">超级做种模式</label><button class="pt-aas-btn pt-aas-toggle-btn" id="site-superseed-btn" data-val="false"></button></div>
                        <div class="pt-aas-btn-group"><button class="pt-aas-btn primary" id="pt-aas-save-site-btn">保存站点配置</button></div>
                        <div class="pt-aas-mt-10"><strong>已配置站点:</strong></div><div id="pt-aas-saved-site-list" class="pt-aas-mt-10"></div>
                    </div></div>
                    <div class="pt-aas-section"><div class="pt-aas-sec-title">推送记录</div><div class="pt-aas-sec-body">
                        <div style="display: flex; gap: 5px; align-items: center; margin-bottom: 10px;">
                            <select id="pt-aas-history-qb-select" class="pt-aas-input" style="flex-grow: 1;"></select>
                            <button class="pt-aas-btn danger small" id="pt-aas-clear-history-btn" title="清空当前选中qB的所有记录">清空</button>
                        </div>
                        <table class="pt-aas-table">
                            <thead><tr><th>名称</th><th>站点</th><th>时间</th><th>操作</th></tr></thead>
                            <tbody id="pt-aas-history-body"></tbody>
                        </table>
                    </div></div>
                </div>`;
            document.body.appendChild(container); UI.bindEvents();
        },
        bindDrag: () => { const handle=document.getElementById("pt-aas-drag-handle"),container=document.getElementById(UI_ID),icon=document.getElementById(TOGGLE_ICON_ID);let isDraggingPanel=!1,startX,startY,initialTop,initialLeft,iconIsBeingDragged=!1;handle.addEventListener("mousedown",e=>{if(e.target.classList.contains("pt-aas-close-btn"))return;isDraggingPanel=!0,startX=e.clientX,startY=e.clientY,initialTop=container.offsetTop,initialLeft=container.offsetLeft,handle.style.cursor="grabbing",e.preventDefault()}),icon.addEventListener("click",e=>{iconIsBeingDragged||UI.toggleSidebar()}),icon.addEventListener("mousedown",e=>{let t=!1;startX=e.clientX,startY=e.clientY,initialTop=icon.offsetTop,initialLeft=icon.offsetLeft,e.preventDefault();const n=o=>{t||(Math.abs(o.clientX-startX)>5||Math.abs(o.clientY-startY)>5)&&(t=!0,iconIsBeingDragged=!0,icon.style.cursor="grabbing"),t&&(icon.style.top=initialTop+o.clientY-startY+"px",icon.style.left=initialLeft+o.clientX-startX+"px")},s=()=>{document.removeEventListener("mousemove",n),document.removeEventListener("mouseup",s),icon.style.cursor="pointer",t&&(Data.setUIPos({top:icon.style.top,left:icon.style.left}),container.style.top=icon.style.top,container.style.left=parseInt(icon.style.left)+50+"px"),setTimeout(()=>{iconIsBeingDragged=!1},0)};document.addEventListener("mousemove",n),document.addEventListener("mouseup",s)}),document.addEventListener("mousemove",e=>{if(!isDraggingPanel)return;const t=e.clientY-startY,n=e.clientX-startX;container.style.top=initialTop+t+"px",container.style.left=initialLeft+n+"px"}),document.addEventListener("mouseup",()=>{isDraggingPanel&&(isDraggingPanel=!1,handle.style.cursor="move")}); },
        bindEvents: () => {
            document.querySelectorAll('.pt-aas-sec-title').forEach(el => el.onclick = () => el.parentElement.classList.toggle('collapsed'));
            document.getElementById('pt-aas-close-btn-x').onclick = UI.toggleSidebar;
            document.getElementById('pt-aas-clear-qb-btn').onclick = UI.clearQbForm; document.getElementById('pt-aas-save-qb-btn').onclick = UI.saveQb;
            document.getElementById('pt-aas-get-host-btn').onclick = () => { document.getElementById('site-host').value = Utils.getCurrentHost(); };
            document.getElementById('site-superseed-btn').onclick = (e) => { const isOn = !e.target.classList.contains('on'); e.target.dataset.val = isOn; e.target.classList.toggle('on', isOn); };
            document.getElementById('pt-aas-save-site-btn').onclick = UI.saveSite;
            document.getElementById('pt-aas-history-qb-select').onchange = (e) => UI.renderHistory(e.target.value);
            document.getElementById('pt-aas-clear-history-btn').onclick = () => {
                const qbId = document.getElementById('pt-aas-history-qb-select').value;
                if (qbId) { Data.clearHistory(qbId); UI.renderHistory(qbId); }
            };
            document.getElementById('pt-aas-history-body').onclick = (e) => {
                const deleteBtn = e.target.closest('.pt-aas-delete-hist-btn');
                if (deleteBtn) {
                    const qbId = deleteBtn.dataset.qbid;
                    const time = parseInt(deleteBtn.dataset.time, 10);
                    Data.deleteHistoryEntry(qbId, time);
                    UI.renderHistory(qbId);
                    return;
                }
                const header = e.target.closest('.pt-aas-hist-group-header');
                if (header) {
                    const name = header.dataset.groupName;
                    UI.collapsedHistoryGroups[name] = !(UI.collapsedHistoryGroups[name] !== false); // Toggle state
                    UI.renderHistory(header.dataset.qbid);
                }
            };
        },

        renderAll: () => { UI.renderActiveQbSelector(); UI.renderQbList(); UI.renderSiteList(); UI.renderHistorySelectors(); },
        clearQbForm: () => ['qb-id','qb-name','qb-url','qb-user','qb-pass','qb-cat','qb-path'].forEach(id => document.getElementById(id).value = ''),
        fillQbForm: (qb) => { document.getElementById('qb-id').value = qb.id; document.getElementById('qb-name').value = qb.name; document.getElementById('qb-url').value = qb.url; document.getElementById('qb-user').value = qb.user; document.getElementById('qb-pass').value = qb.pass; document.getElementById('qb-cat').value = qb.cat || ''; document.getElementById('qb-path').value = qb.path || ''; },
        saveQb: () => {
            const id = document.getElementById('qb-id').value || Utils.generateId(), newQb = { id, name: document.getElementById('qb-name').value.trim() || 'Unnamed', url: document.getElementById('qb-url').value.trim(), user: document.getElementById('qb-user').value.trim(), pass: document.getElementById('qb-pass').value.trim(), cat: document.getElementById('qb-cat').value.trim(), path: document.getElementById('qb-path').value.trim() };
            if (!newQb.url) return alert('URL is required');
            let qbs = Data.getQBs(), idx = qbs.findIndex(q => q.id === id); (idx > -1) ? qbs[idx] = newQb : qbs.push(newQb);
            Data.setQBs(qbs); UI.clearQbForm(); UI.renderAll(); if (!Data.getActiveQbId()) Data.setActiveQbId(id);
        },
        deleteQb: (id) => { if (!confirm('确定要删除此qB配置吗？')) return; let qbs = Data.getQBs().filter(q => q.id !== id); Data.setQBs(qbs); if (Data.getActiveQbId() === id) Data.setActiveQbId(qbs.length > 0 ? qbs[0].id : null); UI.renderAll(); },
        renderActiveQbSelector: () => {
            const qbs = Data.getQBs(), activeId = Data.getActiveQbId(), container = document.getElementById('pt-aas-active-qb-list');
            container.innerHTML = qbs.length ? '' : '<span style="color:#aaa;font-style:italic;">请先添加qB配置</span>';
            qbs.forEach(qb => { const btn = document.createElement('button'); btn.className = `pt-aas-btn pt-aas-qb-selector-btn ${qb.id === activeId ? 'active' : ''}`; btn.textContent = qb.name; btn.title = qb.url; btn.onclick = () => { Data.setActiveQbId(qb.id); UI.renderActiveQbSelector(); UI.renderHistorySelectors(); }; container.appendChild(btn); });
        },
        renderQbList: () => {
            const container = document.getElementById('pt-aas-saved-qb-list'); container.innerHTML = '';
            Data.getQBs().forEach(qb => { const div = document.createElement('div'); div.className = 'pt-aas-config-list-item'; div.innerHTML = `<span><strong>${qb.name}</strong> <small>(${qb.url})</small></span><div><button class="pt-aas-btn small" data-id="${qb.id}" data-action="edit">编辑</button><button class="pt-aas-btn small danger" data-id="${qb.id}" data-action="delete">X</button></div>`; container.appendChild(div); });
            container.onclick = (e) => { const t = e.target; if (t.tagName !== 'BUTTON') return; const id = t.dataset.id, action = t.dataset.action; if (action === 'edit') UI.fillQbForm(Data.getQBs().find(q=>q.id===id)); else if (action === 'delete') UI.deleteQb(id); };
        },
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
            const container = document.getElementById('pt-aas-saved-site-list'); container.innerHTML = '';
            Object.entries(Data.getSites()).forEach(([host, conf]) => {
                const div = document.createElement('div'); div.className = 'pt-aas-config-list-item';
                div.innerHTML = `<span style="font-size:11px;"><strong>${conf.alias||host}</strong> <small>(${host})</small></span><div><button class="pt-aas-btn small" data-host="${host}">编辑</button></div>`; container.appendChild(div);
                div.querySelector('button').onclick = () => UI.fillSiteForm(host, conf);
            });
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
                tr.dataset.qbid = qbId;
                tr.dataset.groupName = name;
                if (isMulti) { tr.className = 'pt-aas-hist-group-header'; }

                const countBadge = `<span class="pt-aas-hist-badge">${groupItems.length}</span>`;
                let nameCellHtml = name;
                if (isMulti) {
                    nameCellHtml = `<span class="pt-aas-hist-expander">${isCollapsed ? '▶' : '▼'}</span>${name}`;
                }

                const siteCellHtml = (() => {
                    if (isMulti && isCollapsed) return countBadge;
                    let host; try { host = newest.host || new URL(newest.url).hostname; } catch { host = "未知站点"; }
                    const siteConf = Data.getSiteConfig(host);
                    const siteDisplay = siteConf?.alias || host;
                    return `<a href="${newest.url}" target="_blank" title="${newest.url}">${siteDisplay}</a>`;
                })();

                tr.innerHTML = `
                    <td>${nameCellHtml}</td>
                    <td class="pt-aas-table-site">${siteCellHtml}</td>
                    <td>${Utils.formatTime(newest.time)}</td>
                    <td><button class="pt-aas-btn danger small pt-aas-delete-hist-btn" data-qbid="${qbId}" data-time="${newest.time}" title="删除此条记录">删</button></td>
                `;
                tbody.appendChild(tr);

                if (isMulti && !isCollapsed) {
                    groupItems.slice(1).forEach(item => {
                        const detailTr = document.createElement('tr');
                        detailTr.style.background = 'rgba(0,0,0,0.15)';
                        let detailHost; try { detailHost = item.host || new URL(item.url).hostname; } catch { detailHost = "未知站点"; }
                        const detailSiteConf = Data.getSiteConfig(detailHost);
                        const detailSiteDisplay = detailSiteConf?.alias || detailHost;
                        const detailSiteLink = `<a href="${item.url}" target="_blank" title="${item.url}">${detailSiteDisplay}</a>`;
                        detailTr.innerHTML = `
                            <td style="padding-left:25px;opacity:0.7;">↳ ${item.name}</td>
                            <td class="pt-aas-table-site" style="opacity:0.7;">${detailSiteLink}</td>
                            <td style="opacity:0.7;">${Utils.formatTime(item.time)}</td>
                            <td><button class="pt-aas-btn danger small pt-aas-delete-hist-btn" data-qbid="${qbId}" data-time="${item.time}" title="删除此条记录">删</button></td>
                        `;
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
        checkAndRun: async () => {
            if (!/details\.php.+uploaded=1/.test(window.location.href)) return;
            console.log("PT AAS: Upload success page detected.");

            const link = Array.from(document.querySelectorAll('a[href*="download.php"]')).find(a => a.href.includes('id='));
            if (!link) { UI.updateStatusBar('error', '推送失败: 找不到下载链接'); return; }

            const activeQb = Data.getActiveQb();
            if (!activeQb) { UI.updateStatusBar('warning', '推送跳过: 未选择qB客户端'); return; }

            const cleanName = Utils.cleanTorrentName(link.textContent.trim() || document.title);
            UI.updateStatusBar('loading', `正在推送: ${cleanName}`);

            try {
                const blob = await new Promise((resolve, reject) => GM_xmlhttpRequest({ method:"GET", url:link.href, responseType:"blob", onload:r=>r.status===200?resolve(r.response):reject(r.status), onerror:reject }));
                const result = await new QBClient(activeQb).addTorrent(blob, Data.getSiteConfig(Utils.getCurrentHost()));

                if (result.success) {
                    Data.addHistory(activeQb.id, { name: cleanName, url: Utils.cleanUrl(window.location.href), host: Utils.getCurrentHost(), time: Date.now() });
                    if (Data.isUIOpen() && Data.getActiveQbId() === activeQb.id) UI.renderHistory(activeQb.id);
                    const messageParts = ['推送成功'];
                    messageParts.push(`qB: ${activeQb.name}`);
                    if (activeQb.cat) messageParts.push(`分类: ${activeQb.cat}`);
                    if (activeQb.path) messageParts.push(`路径: ${activeQb.path}`);
                    UI.updateStatusBar('success', messageParts.join(' | '));
                } else {
                     throw new Error(result.message);
                }
            } catch (error) {
                const messageParts = [`推送失败: ${error.message || '网络错误'}`];
                if (activeQb) { messageParts.push(`qB: ${activeQb.name}`); }
                UI.updateStatusBar('error', messageParts.join(' | '));
            }
        }
    };

    // Initialization
    UI.init();
    Automation.checkAndRun();
    if (window.onurlchange === null) window.addEventListener('urlchange', Automation.checkAndRun);

})();