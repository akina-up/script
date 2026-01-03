// ==UserScript==
// @name         PT Auto Seeder
// @namespace    https://github.com/akina-up/script
// @version      1.0.8
// @description  (由 Gemini 2.5 Pro 助理)PT站发布成功后自动推送到qBittorrent，推送成功或失败时临时显示结果（包含分类、保存路径、qB名称），并可管理推送记录。
// @author       akina
// @match        http*://*/upload.php*
// @match        http*://*/details.php*
// @match        http*://*/edit.php*
// @match        http*://*/torrents.php*
// @match        https://*.m-team.cc/*
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

/**
 * ============================================================================
 * 更新日志
 * ============================================================================
 * v1.0.8 - 代码重构
 * - [优化] 重构代码结构，提升可读性和可维护性
 * - [优化] 将UI拆分为独立组件
 * - [优化] 提取HTML模板和站点解析器
 *
 * v1.0.7
 * - [新增] 馒头推送(仅支持手动)
 * - [新增] 可以设置标签
 * - [新增] 可以设置延迟
 *
 * v1.0.6
 * - [修改] "强制推送"将无视"域名推送覆盖"规则，始终推送到当前选择的活动qB
 *
 * v1.0.5
 * - [优化] 仅在"域名推送覆盖"列表中的域名，才会启用"下载模式"。
 *
 * v1.0.4
 * - [新增] 可以设置自动下载
 * - [修复] "已配置站点"支持删除
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

(function () {
    'use strict';

    // ========================================================================
    //                           第一部分：常量与配置
    // ========================================================================

    /**
     * 存储键名常量
     * 用于 GM_getValue / GM_setValue 的键名定义
     */
    const STORAGE_KEYS = {
        QBS: 'pt_aas_qbs_list',              // qB客户端列表
        ACTIVE_QB: 'pt_aas_active_qb_id',    // 当前活动的qB ID
        SITES: 'pt_aas_site_configs',        // 站点配置
        HISTORY: 'pt_aas_history_',          // 推送历史前缀
        UI_POS: 'pt_aas_ui_position',        // 悬浮图标位置
        SETTINGS_UI_OPEN: 'pt_aas_settings_ui_is_open',
        SETTINGS_UI_POS: 'pt_aas_settings_ui_position',
        HISTORY_UI_POS: 'pt_aas_history_ui_position',
        HISTORY_UI_OPEN: 'pt_aas_history_ui_is_open',
        EXCLUDED_URLS: 'pt_aas_excluded_urls',
        ICON_SCALE: 'pt_aas_icon_scale',
        DOMAIN_OVERRIDES: 'pt_aas_domain_overrides',
        GLOBAL_QUEUE: 'pt_aas_global_task_queue',
        GLOBAL_SETTINGS: 'pt_aas_global_settings'
    };

    /**
     * UI 元素 ID 常量
     */
    const UI_IDS = {
        ICON_CONTAINER: 'pt-aas-icon-container',
        SETTINGS_UI: 'pt-aas-settings-ui',
        HISTORY_UI: 'pt-aas-history-ui',
        STATUS_BAR: 'pt-aas-status-bar'
    };

    // ========================================================================
    //                           第二部分：数据管理层
    // ========================================================================

    /**
     * Data 模块
     * 封装所有 GM_getValue / GM_setValue 操作，提供统一的数据访问接口
     */
    const Data = {
        // ----- qBittorrent 客户端管理 -----

        /** 获取所有已保存的qB客户端列表 */
        getQBs: () => GM_getValue(STORAGE_KEYS.QBS, []),

        /** 保存qB客户端列表 */
        setQBs: (list) => GM_setValue(STORAGE_KEYS.QBS, list),

        /** 获取当前活动qB的ID */
        getActiveQbId: () => GM_getValue(STORAGE_KEYS.ACTIVE_QB, null),

        /** 设置当前活动qB的ID */
        setActiveQbId: (id) => GM_setValue(STORAGE_KEYS.ACTIVE_QB, id),

        /** 获取当前活动的qB客户端对象 */
        getActiveQb: () => {
            const qbs = Data.getQBs();
            const activeId = Data.getActiveQbId();
            return qbs.find(qb => qb.id === activeId) || null;
        },

        // ----- 站点配置管理 -----

        /** 获取所有站点配置 */
        getSites: () => GM_getValue(STORAGE_KEYS.SITES, {}),

        /** 保存站点配置 */
        setSites: (sites) => GM_setValue(STORAGE_KEYS.SITES, sites),

        /** 获取指定站点的配置 */
        getSiteConfig: (hostname) => Data.getSites()[hostname] || null,

        // ----- 域名覆盖配置 -----

        /** 获取域名推送覆盖配置 */
        getDomainOverrides: () => GM_getValue(STORAGE_KEYS.DOMAIN_OVERRIDES, {}),

        /** 保存域名推送覆盖配置 */
        setDomainOverrides: (obj) => GM_setValue(STORAGE_KEYS.DOMAIN_OVERRIDES, obj),

        // ----- 推送历史管理 -----

        /** 获取指定qB的推送历史 */
        getHistory: (qbId) => GM_getValue(STORAGE_KEYS.HISTORY + qbId, []),

        /** 添加推送历史记录 */
        addHistory: (qbId, entry) => {
            const hist = Data.getHistory(qbId);
            hist.unshift(entry);
            GM_setValue(STORAGE_KEYS.HISTORY + qbId, hist);
        },

        /** 删除单条推送历史 */
        deleteHistoryEntry: (qbId, timestamp) => {
            let hist = Data.getHistory(qbId);
            hist = hist.filter(entry => entry.time !== Number(timestamp));
            GM_setValue(STORAGE_KEYS.HISTORY + qbId, hist);
        },

        /** 删除指定名称的所有历史记录（组删除） */
        deleteHistoryGroup: (qbId, name) => {
            if (!confirm(`确定要删除所有名为 "${name}" 的推送记录吗？`)) {
                return false;
            }
            let hist = Data.getHistory(qbId);
            hist = hist.filter(entry => entry.name !== name);
            GM_setValue(STORAGE_KEYS.HISTORY + qbId, hist);
            return true;
        },

        /** 清空指定qB的所有历史记录 */
        clearHistory: (qbId) => {
            const qbName = (Data.getQBs().find(q => q.id === qbId) || {}).name || 'Unknown';
            if (!confirm(`确定要清除qB "${qbName}" 的所有推送记录吗？\n此操作无法撤销。`)) {
                return;
            }
            GM_setValue(STORAGE_KEYS.HISTORY + qbId, []);
        },

        // ----- UI 位置和状态 -----

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

        // ----- 高级设置 -----

        getExcludedUrls: () => GM_getValue(STORAGE_KEYS.EXCLUDED_URLS, ''),
        setExcludedUrls: (urls) => GM_setValue(STORAGE_KEYS.EXCLUDED_URLS, urls),

        getIconScale: () => GM_getValue(STORAGE_KEYS.ICON_SCALE, 100),
        setIconScale: (scale) => GM_setValue(STORAGE_KEYS.ICON_SCALE, scale),

        getGlobalSettings: () => GM_getValue(STORAGE_KEYS.GLOBAL_SETTINGS, { delaySeconds: 0 }),
        setGlobalSettings: (settings) => GM_setValue(STORAGE_KEYS.GLOBAL_SETTINGS, settings),

        // ----- 任务队列管理 -----

        getQueue: () => GM_getValue(STORAGE_KEYS.GLOBAL_QUEUE, []),

        addToQueue: (task) => {
            const q = Data.getQueue();
            q.push(task);
            GM_setValue(STORAGE_KEYS.GLOBAL_QUEUE, q);
        },

        removeFromQueue: (taskId) => {
            let q = Data.getQueue();
            q = q.filter(t => t.id !== taskId);
            GM_setValue(STORAGE_KEYS.GLOBAL_QUEUE, q);
        }
    };

    // ========================================================================
    //                           第三部分：工具函数
    // ========================================================================

    /**
     * Utils 模块
     * 通用工具函数集合
     */
    const Utils = {
        /** 生成唯一ID */
        generateId: () => Date.now().toString(36) + Math.random().toString(36).substr(2),

        /** 获取当前页面的域名 */
        getCurrentHost: () => window.location.hostname,

        /**
         * 清理种子名称
         * 移除前缀标签和后缀扩展名
         */
        cleanTorrentName: (name) => {
            if (!name) return "未知种子";

            // 移除形如 [xxx]. 的前缀
            let cleaned = name.replace(/^(\[[^\]]+\]\.?)+/g, '').trim();
            // 移除 .torrent 后缀
            cleaned = cleaned.replace(/\.torrent$/i, '').trim();

            return cleaned;
        },

        /**
         * 清理URL
         * 移除 uploaded 参数
         */
        cleanUrl: (url) => {
            try {
                const u = new URL(url);
                u.searchParams.delete('uploaded');
                return u.toString();
            } catch (e) {
                return url;
            }
        },

        /** 格式化时间戳为本地时间字符串 */
        formatTime: (timestamp) => {
            return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
        },

        /** MiB 转换为 Bytes */
        mibToBytes: (mib) => {
            if (!mib || isNaN(mib)) return 0;
            return Math.floor(parseFloat(mib) * 1024 * 1024);
        }
    };

    // ========================================================================
    //                       第四部分：qBittorrent API 客户端
    // ========================================================================

    /**
     * QBClient 类
     * 封装与 qBittorrent WebUI 的 HTTP 通信
     */
    class QBClient {
        /**
         * @param {Object} config - qB配置对象
         * @param {string} config.url - qB WebUI 地址
         * @param {string} config.user - 用户名
         * @param {string} config.pass - 密码
         * @param {string} config.cat - 分类（可选）
         * @param {string} config.path - 保存路径（可选）
         * @param {string} config.tags - 标签（可选）
         */
        constructor(config) {
            this.config = config;
            this.baseUrl = config.url.replace(/\/+$/, "");
        }

        /**
         * 登录到 qBittorrent
         * @returns {Promise<boolean>}
         */
        async login() {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "POST",
                    url: `${this.baseUrl}/api/v2/auth/login`,
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    data: `username=${encodeURIComponent(this.config.user)}&password=${encodeURIComponent(this.config.pass)}`,
                    onload: (res) => {
                        if (res.responseText.trim() === "Ok.") {
                            resolve(true);
                        } else {
                            reject(`登录失败: ${res.status}`);
                        }
                    },
                    onerror: (err) => reject(`登录网络错误: ${JSON.stringify(err)}`)
                });
            });
        }

        /**
         * 添加种子到 qBittorrent
         * @param {Blob|string} torrentSource - 种子文件Blob或下载链接
         * @param {Object|null} siteSettings - 站点特定设置
         * @param {Object} mode - 添加模式 { skipChecking, paused }
         * @returns {Promise<{success: boolean, message?: string}>}
         */
        async addTorrent(torrentSource, siteSettings, mode = { skipChecking: false, paused: false }) {
            // 先登录
            try {
                await this.login();
            } catch (e) {
                return { success: false, message: `qB 认证失败: ${e}` };
            }

            return new Promise((resolve) => {
                const formData = new FormData();

                // 根据类型添加种子源
                if (typeof torrentSource === 'string') {
                    formData.append("urls", torrentSource);
                } else {
                    formData.append("torrents", torrentSource, "torrent.torrent");
                }

                // 添加基本配置
                if (this.config.path) formData.append("savepath", this.config.path);
                if (this.config.cat) formData.append("category", this.config.cat);
                if (this.config.tags) formData.append("tags", this.config.tags);

                // 添加模式设置
                formData.append("skip_checking", String(!!mode.skipChecking));
                formData.append("paused", String(!!mode.paused));

                // 添加站点特定设置
                if (siteSettings && siteSettings.upLimit) {
                    formData.append("upLimit", Utils.mibToBytes(siteSettings.upLimit));
                }

                GM_xmlhttpRequest({
                    method: "POST",
                    url: `${this.baseUrl}/api/v2/torrents/add`,
                    data: formData,
                    onload: (res) => {
                        if (res.status === 200 && res.responseText.trim() === 'Ok.') {
                            resolve({ success: true });
                        } else {
                            resolve({ success: false, message: `添加失败 (${res.status}): ${res.responseText}` });
                        }
                    },
                    onerror: (err) => {
                        resolve({ success: false, message: `添加网络错误: ${JSON.stringify(err)}` });
                    }
                });
            });
        }
    }

    // ========================================================================
    //                         第五部分：站点解析器
    // ========================================================================

    /**
     * SiteParsers 模块
     * 统一的站点种子链接解析器
     * 每个站点有独立的解析逻辑，方便扩展新站点
     */
    const SiteParsers = {
        /**
         * M-Team 专用：获取真实下载链接
         * 需要拦截XHR请求获取动态生成的token
         */
        getMTeamDownloadLink: async () => {
            return new Promise((resolve, reject) => {
                let tokenFound = false;

                // Hook XHR 拦截下载token
                const originalOpen = XMLHttpRequest.prototype.open;

                XMLHttpRequest.prototype.open = function (method, url) {
                    this.addEventListener('load', function () {
                        if (url.includes('/api/torrent/genDlToken') && !tokenFound) {
                            try {
                                const res = JSON.parse(this.responseText);
                                if (res.code === '0' && res.data) {
                                    tokenFound = true;
                                    resolve(res.data);
                                }
                            } catch (e) {
                                console.error("M-Team JSON parse error", e);
                            }
                        }
                    });
                    originalOpen.apply(this, arguments);
                };

                // 查找并点击下载按钮
                const buttons = Array.from(document.querySelectorAll('button.ant-btn'));
                const downloadBtn = buttons.find(btn => {
                    const txt = btn.textContent.trim();
                    return txt.includes('下載') || txt.includes('Download');
                }) || document.querySelector('button.ant-btn-primary');

                if (downloadBtn) {
                    downloadBtn.click();
                } else {
                    reject("未找到 M-Team 下载按钮");
                    return;
                }

                // 超时处理
                setTimeout(() => {
                    if (!tokenFound) reject("获取真实链接超时");
                }, 5000);
            });
        },

        /**
         * 解析 M-Team 页面
         */
        parseMTeam: async (doc, url) => {
            // 获取标题
            const titleEl = doc.querySelector('.ant-typography h2, .ant-typography h3') ||
                doc.querySelector('h1') ||
                doc.title;
            const title = titleEl.textContent ? titleEl.textContent.trim() : "M-Team Torrent";

            try {
                const link = await SiteParsers.getMTeamDownloadLink();
                return { link, name: title };
            } catch (e) {
                console.error("M-Team fetch error:", e);
                throw new Error("M-Team 下载链接获取失败: " + e);
            }
        },

        /**
         * 解析 BHD (Beyond-HD) 页面
         */
        parseBHD: (doc, url) => {
            const nameElement = doc.querySelector('a.beta-link-blend[href*="/torrents/"]');
            const linkElement = doc.querySelector('a.bhd-md-button[href*="/download/"]');

            if (nameElement && linkElement) {
                return {
                    link: new URL(linkElement.href, url).href,
                    name: nameElement.textContent.trim()
                };
            }
            return null;
        },

        /**
         * 解析 TTG (ToTheGlory) 及类似站点
         */
        parseTTG: (doc, url) => {
            const ttgLink = Array.from(doc.querySelectorAll('a.index[href*="/dl/"], a[href*=".torrent"]'))
                .find(a => a.href.includes('/dl/') && (a.href.includes('.torrent') || a.textContent.includes('.torrent')));

            if (ttgLink) {
                return {
                    link: ttgLink.href,
                    name: ttgLink.textContent.trim()
                };
            }
            return null;
        },

        /**
         * 解析 UNIT3D 风格站点
         */
        parseUnit3D: (doc, url) => {
            const torrentNameH1 = doc.querySelector('h1.torrent__name, h1');

            if (torrentNameH1) {
                const linkElement = doc.querySelector(
                    'a.form__button[href*="/torrents/download/"],' +
                    'a[href*="/torrents/download/"][role="button"].badge-extra'
                );

                if (linkElement) {
                    return {
                        link: linkElement.href,
                        name: torrentNameH1.textContent.trim()
                    };
                }
            }
            return null;
        },

        /**
         * 解析经典 NexusPHP 站点 (details.php)
         */
        parseClassic: (doc, url) => {
            const link = Array.from(doc.querySelectorAll('a[href*="download.php"], a[href*="download/"]'))
                .find(a => a.href.includes('id=') || a.href.includes('download/'));

            if (link) {
                // 尝试从多个位置获取种子名称
                let name = doc.title;

                const h1 = doc.querySelector('h1');
                if (h1) {
                    name = h1.textContent.trim();
                } else {
                    const nameDt = Array.from(doc.querySelectorAll('dt'))
                        .find(dt => dt.textContent.trim().toLowerCase() === 'name');
                    if (nameDt && nameDt.nextElementSibling) {
                        name = nameDt.nextElementSibling.textContent.trim();
                    }
                }

                return { link: link.href, name: name };
            }
            return null;
        },

        /**
         * 统一解析入口
         * 根据URL自动选择合适的解析器
         */
        parse: async () => {
            const url = window.location.href;
            const doc = document;

            // M-Team (新版React站点)
            if (url.includes('m-team.cc/detail/')) {
                return SiteParsers.parseMTeam(doc, url);
            }

            // BHD download_check 页面
            if (url.includes('beyond-hd.me/download_check/')) {
                return SiteParsers.parseBHD(doc, url);
            }

            // TTG 及类似站点
            const ttgResult = SiteParsers.parseTTG(doc, url);
            if (ttgResult) return ttgResult;

            // UNIT3D 风格站点
            const unit3dResult = SiteParsers.parseUnit3D(doc, url);
            if (unit3dResult) return unit3dResult;

            // 经典 details.php 页面
            if (url.includes('details.php') || url.includes('download_check')) {
                return SiteParsers.parseClassic(doc, url);
            }

            return null;
        }
    };

    // ========================================================================
    //                           第六部分：样式定义
    // ========================================================================

    /**
     * Styles 模块
     * 所有CSS样式，按功能分组
     */
    const Styles = `
        /* ===== CSS 变量定义 ===== */
        :root {
            --pt-aas-bg: rgba(30, 30, 35, 0.95);
            --pt-aas-text: #eee;
            --pt-aas-text-sub: #aaa;
            --pt-aas-accent: #3498db;
            --pt-aas-accent-hover: #2980b9;
            --pt-aas-success: #27ae60;
            --pt-aas-danger: #c0392b;
            --pt-aas-warning: #f39c12;
            --pt-aas-border: #444;
            --pt-aas-input-bg: #2c2c32;
            --pt-aas-info-bg: #2980b9;
            --pt-aas-download: #8e44ad;
        }

        /* ===== 状态栏样式 ===== */
        #${UI_IDS.STATUS_BAR} {
            position: fixed;
            top: 0; left: 0; right: 0;
            height: 28px;
            padding: 0 15px;
            font-size: 14px;
            color: white;
            z-index: 10000;
            box-shadow: 0 1px 5px rgba(0,0,0,0.2);
            justify-content: center;
            align-items: center;
            transition: background-color 0.3s;
            display: none;
        }
        #${UI_IDS.STATUS_BAR}.info { background-color: var(--pt-aas-info-bg); }
        #${UI_IDS.STATUS_BAR}.success { background-color: var(--pt-aas-success); }
        #${UI_IDS.STATUS_BAR}.error { background-color: var(--pt-aas-danger); }
        #${UI_IDS.STATUS_BAR}.loading { background-color: var(--pt-aas-warning); }
        #${UI_IDS.STATUS_BAR}.download { background-color: var(--pt-aas-download); }

        /* ===== 悬浮图标容器 ===== */
        #${UI_IDS.ICON_CONTAINER} {
            position: fixed;
            display: flex;
            flex-direction: column;
            gap: 8px;
            z-index: 9998;
            user-select: none;
        }

        /* ===== 操作图标按钮 ===== */
        .pt-aas-action-icon {
            width: 40px;
            height: 40px;
            background: var(--pt-aas-accent);
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            font-size: 20px;
            transition: all 0.2s ease-in-out;
        }
        .pt-aas-action-icon:hover {
            transform: scale(1.15);
            background-color: var(--pt-aas-accent-hover);
        }
        #pt-aas-toggle-icon { background-color: #7f8c8d; }
        #pt-aas-toggle-icon:hover { background-color: #95a5a6; }

        /* ===== 面板通用样式 ===== */
        .pt-aas-panel {
            position: fixed;
            width: 420px;
            max-height: calc(90vh - 40px);
            background: var(--pt-aas-bg);
            color: var(--pt-aas-text);
            z-index: 9999;
            border-radius: 8px;
            box-shadow: 0 5px 25px rgba(0,0,0,0.5);
            display: flex;
            flex-direction: column;
            backdrop-filter: blur(5px);
            border: 1px solid var(--pt-aas-border);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-size: 13px;
            transition: opacity 0.3s, transform 0.3s;
        }
        .pt-aas-panel.hidden {
            opacity: 0;
            pointer-events: none;
            transform: translateX(-20px);
        }

        /* ===== 面板头部 ===== */
        .pt-aas-header {
            padding: 12px 15px;
            background: rgba(0,0,0,0.2);
            border-bottom: 1px solid var(--pt-aas-border);
            font-weight: bold;
            font-size: 15px;
            cursor: move;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-radius: 8px 8px 0 0;
        }
        .pt-aas-close-btn { cursor: pointer; padding: 4px; }

        /* ===== 面板内容区 ===== */
        .pt-aas-content {
            padding: 15px;
            overflow-y: auto;
            flex: 1;
        }
        .pt-aas-content::-webkit-scrollbar { width: 6px; }
        .pt-aas-content::-webkit-scrollbar-thumb { background: #555; border-radius: 3px; }

        /* ===== 折叠区块 ===== */
        .pt-aas-section {
            margin-bottom: 20px;
            border: 1px solid var(--pt-aas-border);
            border-radius: 6px;
            overflow: hidden;
        }
        .pt-aas-sec-title {
            padding: 8px 12px;
            background: rgba(255,255,255,0.05);
            font-weight: 600;
            cursor: pointer;
            user-select: none;
            display: flex;
            justify-content: space-between;
        }
        .pt-aas-sec-title::after {
            content: '▼';
            font-size: 0.8em;
            transition: transform 0.3s;
        }
        .pt-aas-section.collapsed .pt-aas-sec-title::after { transform: rotate(-90deg); }
        .pt-aas-sec-body { padding: 12px; display: block; }
        .pt-aas-section.collapsed .pt-aas-sec-body { display: none; }

        /* ===== 表单元素 ===== */
        .pt-aas-form-group { margin-bottom: 10px; }
        .pt-aas-form-group label {
            display: block;
            margin-bottom: 4px;
            color: var(--pt-aas-text-sub);
        }
        .pt-aas-input, .pt-aas-textarea, .pt-aas-select {
            width: 100%;
            box-sizing: border-box;
            padding: 8px;
            background: var(--pt-aas-input-bg);
            border: 1px solid var(--pt-aas-border);
            color: var(--pt-aas-text);
            border-radius: 4px;
        }
        .pt-aas-textarea { min-height: 80px; resize: vertical; }
        .pt-aas-input:focus, .pt-aas-textarea:focus, .pt-aas-select:focus {
            outline: 1px solid var(--pt-aas-accent);
            border-color: var(--pt-aas-accent);
        }

        /* ===== 按钮样式 ===== */
        .pt-aas-btn {
            padding: 6px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 600;
            background: #555;
            color: white;
            transition: background 0.2s;
        }
        .pt-aas-btn.primary { background: var(--pt-aas-accent); }
        .pt-aas-btn.primary:hover { background: var(--pt-aas-accent-hover); }
        .pt-aas-btn.danger { background: var(--pt-aas-danger); }
        .pt-aas-btn.small { padding: 4px 8px; font-size: 11px; }
        .pt-aas-btn-group { display: flex; gap: 5px; flex-wrap: wrap; }

        /* ===== qB选择器按钮 ===== */
        .pt-aas-qb-selector-btn {
            background: transparent;
            border: 1px solid var(--pt-aas-border);
            color: var(--pt-aas-text-sub);
            flex: 1;
            min-width: 60px;
        }
        .pt-aas-qb-selector-btn.active {
            background: var(--pt-aas-accent);
            color: white;
            border-color: var(--pt-aas-accent);
        }

        /* ===== 表格样式 ===== */
        .pt-aas-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
            table-layout: fixed;
        }
        .pt-aas-table th {
            text-align: left;
            color: var(--pt-aas-text-sub);
            padding: 4px;
            border-bottom: 1px solid var(--pt-aas-border);
        }
        .pt-aas-table th:nth-child(1) { width: 40%; }
        .pt-aas-table th:nth-child(4) { width: 15%; text-align: center; }
        .pt-aas-table td {
            padding: 6px 4px;
            border-bottom: 1px solid #333;
            vertical-align: top;
            word-break: break-all;
        }
        .pt-aas-table td:nth-child(4) { text-align: center; }
        .pt-aas-table-site a {
            color: var(--pt-aas-accent);
            text-decoration: none;
        }
        .pt-aas-table-site a:hover { text-decoration: underline; }

        /* ===== 历史记录分组 ===== */
        .pt-aas-hist-group-header {
            cursor: pointer;
            background: rgba(255,255,255,0.02);
        }
        .pt-aas-hist-group-header:hover { background: rgba(255,255,255,0.05); }
        .pt-aas-hist-badge {
            background: var(--pt-aas-accent);
            padding: 1px 5px;
            border-radius: 10px;
            font-size: 9px;
            display: inline-block;
            vertical-align: middle;
        }
        .pt-aas-hist-expander {
            display: inline-block;
            width: 12px;
            text-align: center;
            margin-right: 4px;
            color: var(--pt-aas-text-sub);
        }

        /* ===== 配置列表项 ===== */
        .pt-aas-config-list-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 6px;
            background: rgba(0,0,0,0.1);
            margin-bottom: 4px;
            border-radius: 4px;
        }

        /* ===== 辅助类 ===== */
        .pt-aas-mt-10 { margin-top: 10px; }
        .pt-aas-slider-container { display: flex; align-items: center; gap: 10px; }
        .pt-aas-slider-container input { flex-grow: 1; }
        .pt-aas-row { display: flex; gap: 6px; align-items: center; }
        .pt-aas-row > * { flex: 1; }
        .pt-aas-note { color: var(--pt-aas-text-sub); font-size: 12px; }
    `;

    // ========================================================================
    //                          第七部分：HTML 模板
    // ========================================================================

    /**
     * Templates 模块
     * 提取所有内联HTML为可复用的模板函数
     * 每个函数返回HTML字符串，便于阅读和维护
     */
    const Templates = {
        /**
         * 生成配置列表项
         * @param {string} title - 主标题HTML
         * @param {string} subtitle - 副标题HTML（可选）
         * @param {string} actions - 操作按钮HTML
         */
        configListItem: (title, subtitle, actions) => `
            <div class="pt-aas-config-list-item">
                <div style="flex-grow: 1; display: flex; flex-direction: column; justify-content: center;">
                    <div style="font-size:12px; line-height: 1.3;">${title}</div>
                    ${subtitle ? `<small style="display: block; color: var(--pt-aas-text-sub); font-size: 10px; margin-top: 3px;">${subtitle}</small>` : ''}
                </div>
                <div class="pt-aas-btn-group">${actions}</div>
            </div>
        `,

        /**
         * 生成表单组
         * @param {string} label - 标签文本
         * @param {string} inputHtml - 输入元素HTML
         */
        formGroup: (label, inputHtml) => `
            <div class="pt-aas-form-group">
                <label>${label}</label>
                ${inputHtml}
            </div>
        `,

        /**
         * 生成悬浮操作图标
         */
        actionIcons: () => `
            <div class="pt-aas-action-icon" id="pt-aas-push-icon" title="强制推送当前种子">🚀</div>
            <div class="pt-aas-action-icon" id="pt-aas-quick-action-icon" title="快速发布/编辑">⚡️</div>
            <div class="pt-aas-action-icon" id="pt-aas-history-icon" title="显示推送记录">📜</div>
            <div class="pt-aas-action-icon" id="pt-aas-toggle-icon" title="打开设置">⚙️</div>
        `,

        /**
         * 生成设置面板HTML
         */
        settingsPanel: () => `
            <div class="pt-aas-header">
                <span>PT Auto Seeder 设置</span>
                <span class="pt-aas-close-btn" id="pt-aas-close-btn-settings">✕</span>
            </div>
            <div class="pt-aas-content">
                <!-- 选择活动qB -->
                <div class="pt-aas-section">
                    <div class="pt-aas-sec-title">选择活动的 qB</div>
                    <div class="pt-aas-sec-body">
                        <div class="pt-aas-btn-group" id="pt-aas-active-qb-list"></div>
                    </div>
                </div>

                <!-- qBittorrent 设置 -->
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
                            <div class="pt-aas-form-group"><label>标签 (Tags, 逗号分隔)</label><input class="pt-aas-input" id="qb-tags" placeholder="Auto, PT"></div>
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

                <!-- 站点特定设置 -->
                <div class="pt-aas-section collapsed">
                    <div class="pt-aas-sec-title">站点特定设置</div>
                    <div class="pt-aas-sec-body">
                        <div class="pt-aas-form-group"><label>站点别名 (可选)</label><input class="pt-aas-input" id="site-alias" placeholder="例如: 柠檬HD"></div>
                        <div class="pt-aas-form-group"><label>站点域名 (Host)</label><div class="pt-aas-row"><input class="pt-aas-input" id="site-host" placeholder="xxx.com"><button class="pt-aas-btn small" id="pt-aas-get-host-btn">获取当前</button></div></div>
                        <div class="pt-aas-form-group"><label>上传限速 (MiB/s, 0为不限)</label><input type="number" step="0.1" class="pt-aas-input" id="site-uplimit" placeholder="0"></div>
                        <div class="pt-aas-btn-group"><button class="pt-aas-btn primary" id="pt-aas-save-site-btn">保存站点配置</button></div>
                        <div class="pt-aas-mt-10"><strong>已配置站点:</strong></div>
                        <div id="pt-aas-saved-site-list" class="pt-aas-mt-10"></div>
                        <div class="pt-aas-note">提示：此处为"做种模式/通用"参数；如需同URL改为在另一台 qB 以"下载模式"添加，请使用下方"域名推送覆盖"。</div>
                    </div>
                </div>

                <!-- 域名推送覆盖 -->
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
                                以"下载模式"推送（不同通知样式）
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

                <!-- 高级设置 -->
                <div class="pt-aas-section collapsed">
                    <div class="pt-aas-sec-title">高级设置</div>
                    <div class="pt-aas-sec-body">
                        <div class="pt-aas-form-group">
                            <label>延迟推送 (秒)</label>
                            <input type="number" id="global-delay-seconds" class="pt-aas-input" placeholder="0" title="进入队列后等待多久再推送，即便页面关闭只要浏览器有其他脚本页面打开即可执行">
                            <div class="pt-aas-note">即使关闭当前页面，只要浏览器中有任意安装了此脚本的PT页面打开，倒计时结束后也会自动推送。</div>
                        </div>
                        <div class="pt-aas-form-group">
                            <label>推送排除列表 (每行一个域名)</label>
                            <textarea class="pt-aas-textarea" id="excluded-urls-textarea" placeholder="e.g.\nexample.com\nanother.site.net"></textarea>
                            <button class="pt-aas-btn primary pt-aas-mt-10" id="save-advanced-btn">保存高级设置</button>
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
            </div>
        `,

        /**
         * 生成历史记录面板HTML
         */
        historyPanel: () => `
            <div class="pt-aas-header">
                <span>推送记录</span>
                <span class="pt-aas-close-btn" id="pt-aas-close-btn-history">✕</span>
            </div>
            <div class="pt-aas-content">
                <div class="pt-aas-section">
                    <div class="pt-aas-sec-body">
                        <div style="display: flex; gap: 5px; align-items: center; margin-bottom: 10px;">
                            <select id="pt-aas-history-qb-select" class="pt-aas-input" style="flex-grow: 1;"></select>
                            <button class="pt-aas-btn danger small" id="pt-aas-clear-history-btn" title="清空当前选中qB的所有记录">清空</button>
                        </div>
                        <table class="pt-aas-table">
                            <thead><tr><th>名称</th><th>站点</th><th>时间</th><th>操作</th></tr></thead>
                            <tbody id="pt-aas-history-body"></tbody>
                        </table>
                    </div>
                </div>
            </div>
        `
    };

    // ========================================================================
    //                          第八部分：UI 组件
    // ========================================================================

    /**
     * UI 模块
     * 包含所有UI组件的创建、渲染和事件处理
     */
    const UI = {
        // ----- 状态管理 -----
        collapsedHistoryGroups: {},  // 记录历史分组折叠状态
        statusTimeout: null,          // 状态栏超时计时器

        // ========================================
        // 初始化
        // ========================================

        /**
         * 初始化所有UI组件
         */
        init: () => {
            // 注入样式
            GM_addStyle(Styles);

            // 创建UI元素
            UI.createStatusBar();
            UI.createActionIcons();
            UI.createSettingsSidebar();
            UI.createHistoryPanel();

            // 绑定拖拽功能
            UI.bindDraggable('#' + UI_IDS.ICON_CONTAINER, Data.getIconPos, Data.setIconPos);
            UI.bindDraggable(`#${UI_IDS.SETTINGS_UI} .pt-aas-header`, Data.getSettingsUIPos, Data.setSettingsUIPos);
            UI.bindDraggable(`#${UI_IDS.HISTORY_UI} .pt-aas-header`, Data.getHistoryUIPos, Data.setHistoryUIPos);

            // 渲染所有数据
            UI.renderAll();
            UI.updateIconScale(Data.getIconScale());

            // 恢复面板状态
            if (Data.isSettingsUIOpen()) {
                document.getElementById(UI_IDS.SETTINGS_UI).classList.remove('hidden');
            }
            if (Data.isHistoryUIOpen()) {
                document.getElementById(UI_IDS.HISTORY_UI).classList.remove('hidden');
            }
        },

        // ========================================
        // 状态栏组件
        // ========================================

        /** 创建状态栏 */
        createStatusBar: () => {
            const div = document.createElement('div');
            div.id = UI_IDS.STATUS_BAR;
            document.body.appendChild(div);
        },

        /**
         * 更新状态栏显示
         * @param {string} status - 状态类型: 'info', 'success', 'error', 'loading', 'download'
         * @param {string} message - 显示的消息
         * @param {boolean} isSticky - 是否保持显示（不自动消失）
         */
        updateStatusBar: (status, message, isSticky = false) => {
            clearTimeout(UI.statusTimeout);
            const el = document.getElementById(UI_IDS.STATUS_BAR);
            el.className = status;
            el.textContent = message;

            if (status === 'info' || !message) {
                el.style.display = 'none';
                document.body.style.marginTop = '0';
            } else {
                el.style.display = 'flex';
                document.body.style.marginTop = '28px';
            }
        },

        // ========================================
        // 悬浮图标组件
        // ========================================

        /** 创建悬浮操作图标 */
        createActionIcons: () => {
            const container = document.createElement('div');
            container.id = UI_IDS.ICON_CONTAINER;

            const pos = Data.getIconPos();
            container.style.top = pos.top;
            container.style.left = pos.left;
            container.innerHTML = Templates.actionIcons();

            document.body.appendChild(container);

            // 绑定点击事件
            document.getElementById('pt-aas-toggle-icon').onclick = UI.toggleSettingsSidebar;
            document.getElementById('pt-aas-history-icon').onclick = UI.toggleHistoryPanel;
            document.getElementById('pt-aas-push-icon').onclick = () => Automation.pushTorrent(true);
            document.getElementById('pt-aas-quick-action-icon').onclick = Automation.quickAction;
        },

        /** 切换设置面板显示 */
        toggleSettingsSidebar: () => {
            const sidebar = document.getElementById(UI_IDS.SETTINGS_UI);
            sidebar.classList.toggle('hidden');
            Data.setSettingsUIOpen(!sidebar.classList.contains('hidden'));
        },

        /** 切换历史记录面板显示 */
        toggleHistoryPanel: () => {
            const panel = document.getElementById(UI_IDS.HISTORY_UI);
            panel.classList.toggle('hidden');
            Data.setHistoryUIOpen(!panel.classList.contains('hidden'));
        },

        /**
         * 更新图标缩放
         * @param {number} value - 缩放百分比
         */
        updateIconScale: (value) => {
            const container = document.getElementById(UI_IDS.ICON_CONTAINER);
            if (container) {
                container.style.transform = `scale(${value / 100})`;
            }
            const label = document.getElementById('icon-scale-label');
            if (label) {
                label.textContent = `${value}%`;
            }
        },

        // ========================================
        // 设置面板组件
        // ========================================

        /** 创建设置面板 */
        createSettingsSidebar: () => {
            const container = document.createElement('div');
            container.id = UI_IDS.SETTINGS_UI;
            container.className = 'pt-aas-panel hidden';

            const pos = Data.getSettingsUIPos();
            container.style.top = pos.top;
            container.style.left = pos.left;
            container.innerHTML = Templates.settingsPanel();

            document.body.appendChild(container);
            UI.bindSettingsEvents();
        },

        /** 创建历史记录面板 */
        createHistoryPanel: () => {
            const container = document.createElement('div');
            container.id = UI_IDS.HISTORY_UI;
            container.className = 'pt-aas-panel hidden';

            const pos = Data.getHistoryUIPos();
            container.style.top = pos.top;
            container.style.left = pos.left;
            container.innerHTML = Templates.historyPanel();

            document.body.appendChild(container);
            UI.bindHistoryEvents();
        },

        // ========================================
        // 拖拽功能
        // ========================================

        /**
         * 为元素绑定拖拽功能
         * @param {string} selector - CSS选择器
         * @param {Function} getter - 获取位置的函数
         * @param {Function} setter - 保存位置的函数
         */
        bindDraggable: (selector, getter, setter) => {
            const handle = document.querySelector(selector);
            if (!handle) return;

            const target = handle.closest('.pt-aas-panel') || handle;
            let isDragging = false;
            let startX, startY, initialTop, initialLeft;

            handle.addEventListener("mousedown", (e) => {
                // 忽略交互元素上的点击
                if (e.target.closest('button, a, input, select, textarea, .pt-aas-close-btn')) return;

                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;

                const pos = getter();
                initialTop = parseInt(pos.top, 10) || 0;
                initialLeft = parseInt(pos.left, 10) || 0;

                handle.style.cursor = "grabbing";
                document.body.style.userSelect = 'none';
                e.preventDefault();
            });

            document.addEventListener("mousemove", (e) => {
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

        // ========================================
        // 事件绑定
        // ========================================

        /** 绑定设置面板事件 */
        bindSettingsEvents: () => {
            // 折叠区块点击
            document.querySelectorAll(`#${UI_IDS.SETTINGS_UI} .pt-aas-sec-title`).forEach(el => {
                el.onclick = () => el.parentElement.classList.toggle('collapsed');
            });

            // 关闭按钮
            document.getElementById('pt-aas-close-btn-settings').onclick = UI.toggleSettingsSidebar;

            // qB 表单按钮
            document.getElementById('pt-aas-clear-qb-btn').onclick = UI.clearQbForm;
            document.getElementById('pt-aas-save-qb-btn').onclick = UI.saveQb;

            // 站点设置按钮
            document.getElementById('pt-aas-get-host-btn').onclick = () => {
                document.getElementById('site-host').value = Utils.getCurrentHost();
            };
            document.getElementById('pt-aas-save-site-btn').onclick = UI.saveSite;

            // 覆盖设置按钮
            document.getElementById('ovr-get-host-btn').onclick = () => {
                document.getElementById('ovr-host').value = Utils.getCurrentHost();
            };
            document.getElementById('ovr-save-btn').onclick = UI.saveOverride;
            document.getElementById('ovr-clear-btn').onclick = UI.clearOverrideForm;

            // 高级设置
            const scaleSlider = document.getElementById('icon-scale-slider');
            scaleSlider.oninput = (e) => UI.updateIconScale(e.target.value);
            scaleSlider.onchange = (e) => Data.setIconScale(e.target.value);

            document.getElementById('save-advanced-btn').onclick = () => {
                const urls = document.getElementById('excluded-urls-textarea').value;
                Data.setExcludedUrls(urls);

                const delay = parseInt(document.getElementById('global-delay-seconds').value) || 0;
                Data.setGlobalSettings({ delaySeconds: delay });

                alert('高级设置已保存。');
            };
        },

        /** 绑定历史记录面板事件 */
        bindHistoryEvents: () => {
            document.getElementById('pt-aas-close-btn-history').onclick = UI.toggleHistoryPanel;

            document.getElementById('pt-aas-history-qb-select').onchange = (e) => {
                UI.renderHistory(e.target.value);
            };

            document.getElementById('pt-aas-clear-history-btn').onclick = () => {
                const qbId = document.getElementById('pt-aas-history-qb-select').value;
                if (qbId) {
                    Data.clearHistory(qbId);
                    UI.renderHistory(qbId);
                }
            };

            // 使用事件委托处理历史记录操作
            document.getElementById('pt-aas-history-body').onclick = (e) => {
                const deleteBtn = e.target.closest('.pt-aas-delete-hist-btn');
                if (deleteBtn) {
                    const { qbid, time, groupName } = deleteBtn.dataset;
                    if (groupName) {
                        if (Data.deleteHistoryGroup(qbid, groupName)) {
                            UI.renderHistory(qbid);
                        }
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

        // ========================================
        // 渲染函数
        // ========================================

        /** 渲染所有UI数据 */
        renderAll: () => {
            UI.renderActiveQbSelector();
            UI.renderQbList();
            UI.renderSiteList();
            UI.renderOverrideForm();
            UI.renderOverrideList();
            UI.renderHistorySelectors();
            UI.renderAdvancedSettings();
        },

        /** 渲染高级设置 */
        renderAdvancedSettings: () => {
            document.getElementById('excluded-urls-textarea').value = Data.getExcludedUrls();
            const scale = Data.getIconScale();
            document.getElementById('icon-scale-slider').value = scale;
            document.getElementById('icon-scale-label').textContent = `${scale}%`;
            document.getElementById('global-delay-seconds').value = Data.getGlobalSettings().delaySeconds;
        },

        // ----- qB 管理 -----

        /** 清空qB表单 */
        clearQbForm: () => {
            ['qb-id', 'qb-name', 'qb-url', 'qb-user', 'qb-pass', 'qb-cat', 'qb-path', 'qb-tags'].forEach(id => {
                document.getElementById(id).value = '';
            });
        },

        /** 填充qB表单 */
        fillQbForm: (qb) => {
            document.getElementById('qb-id').value = qb.id;
            document.getElementById('qb-name').value = qb.name;
            document.getElementById('qb-url').value = qb.url;
            document.getElementById('qb-user').value = qb.user;
            document.getElementById('qb-pass').value = qb.pass;
            document.getElementById('qb-cat').value = qb.cat || '';
            document.getElementById('qb-path').value = qb.path || '';
            document.getElementById('qb-tags').value = qb.tags || '';
        },

        /** 保存qB配置 */
        saveQb: () => {
            const id = document.getElementById('qb-id').value || Utils.generateId();
            const newQb = {
                id,
                name: document.getElementById('qb-name').value.trim() || 'Unnamed',
                url: document.getElementById('qb-url').value.trim(),
                user: document.getElementById('qb-user').value.trim(),
                pass: document.getElementById('qb-pass').value.trim(),
                cat: document.getElementById('qb-cat').value.trim(),
                path: document.getElementById('qb-path').value.trim(),
                tags: document.getElementById('qb-tags').value.trim()
            };

            if (!newQb.url) {
                return alert('URL is required');
            }

            let qbs = Data.getQBs();
            const idx = qbs.findIndex(q => q.id === id);
            if (idx > -1) {
                qbs[idx] = newQb;
            } else {
                qbs.push(newQb);
            }

            Data.setQBs(qbs);
            UI.clearQbForm();
            UI.renderAll();

            if (!Data.getActiveQbId()) {
                Data.setActiveQbId(id);
                UI.renderActiveQbSelector();
                UI.renderHistorySelectors();
            }
        },

        /** 删除qB配置 */
        deleteQb: (id) => {
            if (!confirm('确定要删除此qB配置吗？')) return;

            let qbs = Data.getQBs().filter(q => q.id !== id);
            Data.setQBs(qbs);

            if (Data.getActiveQbId() === id) {
                Data.setActiveQbId(qbs.length > 0 ? qbs[0].id : null);
            }
            UI.renderAll();
        },

        /** 渲染活动qB选择器 */
        renderActiveQbSelector: () => {
            const qbs = Data.getQBs();
            const activeId = Data.getActiveQbId();
            const container = document.getElementById('pt-aas-active-qb-list');

            if (!qbs.length) {
                container.innerHTML = '<span style="color:#aaa;font-style:italic;">请先添加qB配置</span>';
                return;
            }

            container.innerHTML = '';
            qbs.forEach(qb => {
                const btn = document.createElement('button');
                btn.className = `pt-aas-btn pt-aas-qb-selector-btn ${qb.id === activeId ? 'active' : ''}`;
                btn.textContent = qb.name;
                btn.title = qb.url;
                btn.onclick = () => {
                    Data.setActiveQbId(qb.id);
                    UI.renderActiveQbSelector();
                    UI.renderHistorySelectors();
                };
                container.appendChild(btn);
            });
        },

        /** 渲染已保存的qB列表 */
        renderQbList: () => {
            const container = document.getElementById('pt-aas-saved-qb-list');
            container.innerHTML = '';

            Data.getQBs().forEach(qb => {
                const div = document.createElement('div');
                div.className = 'pt-aas-config-list-item';
                div.innerHTML = `
                    <span><strong>${qb.name}</strong> <small>(${qb.url})</small></span>
                    <div>
                        <button class="pt-aas-btn small" data-id="${qb.id}" data-action="edit">编辑</button>
                        <button class="pt-aas-btn small danger" data-id="${qb.id}" data-action="delete">X</button>
                    </div>
                `;
                container.appendChild(div);
            });

            // 事件委托
            container.onclick = (e) => {
                const t = e.target;
                if (t.tagName !== 'BUTTON') return;

                const id = t.dataset.id;
                const action = t.dataset.action;

                if (action === 'edit') {
                    const qbToEdit = Data.getQBs().find(q => q.id === id);
                    if (qbToEdit) UI.fillQbForm(qbToEdit);

                    const qbSection = document.getElementById('pt-aas-qb-form').closest('.pt-aas-section');
                    if (qbSection && qbSection.classList.contains('collapsed')) {
                        qbSection.classList.remove('collapsed');
                    }
                    document.getElementById('qb-name').focus();
                } else if (action === 'delete') {
                    UI.deleteQb(id);
                }
            };
        },

        // ----- 站点管理 -----

        /** 保存站点配置 */
        saveSite: () => {
            const host = document.getElementById('site-host').value.trim();
            if (!host) return alert('Host required');

            const sites = Data.getSites();
            sites[host] = {
                alias: document.getElementById('site-alias').value.trim(),
                upLimit: document.getElementById('site-uplimit').value
            };
            Data.setSites(sites);
            UI.renderSiteList();

            ['site-host', 'site-alias', 'site-uplimit'].forEach(id => {
                document.getElementById(id).value = '';
            });
        },

        /** 填充站点表单 */
        fillSiteForm: (host, config) => {
            document.getElementById('site-host').value = host;
            document.getElementById('site-alias').value = config.alias || '';
            document.getElementById('site-uplimit').value = config.upLimit || '';
        },

        /** 渲染站点列表 */
        renderSiteList: () => {
            const container = document.getElementById('pt-aas-saved-site-list');
            container.innerHTML = '';

            const sites = Data.getSites();
            Object.entries(sites).forEach(([host, conf]) => {
                // 构建详情文本
                let detailsText = (conf.upLimit && parseFloat(conf.upLimit) > 0)
                    ? `限速: ${conf.upLimit}MiB/s`
                    : '不限速';

                // 构建显示名称
                const siteDisplayName = conf.alias
                    ? `<strong>${conf.alias}</strong> <small style="color: var(--pt-aas-text-sub);">(${host})</small>`
                    : `<strong>${host}</strong>`;

                const div = document.createElement('div');
                div.className = 'pt-aas-config-list-item';
                div.innerHTML = Templates.configListItem(
                    siteDisplayName,
                    detailsText,
                    `<button class="pt-aas-btn small" data-host="${host}" data-action="edit">编辑</button>
                     <button class="pt-aas-btn small danger" data-host="${host}" data-action="delete">删除</button>`
                );
                container.appendChild(div);
            });

            // 事件委托
            container.onclick = (e) => {
                const btn = e.target.closest('button');
                if (!btn) return;

                const host = btn.dataset.host;
                const action = btn.dataset.action;

                if (action === 'edit') {
                    const conf = Data.getSites()[host];
                    const siteSection = container.closest('.pt-aas-section');
                    if (siteSection.classList.contains('collapsed')) {
                        siteSection.classList.remove('collapsed');
                    }
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

        // ----- 覆盖管理 -----

        /** 渲染覆盖表单（qB选择器） */
        renderOverrideForm: () => {
            const sel = document.getElementById('ovr-qb');
            sel.innerHTML = '';

            const qbs = Data.getQBs();
            if (!qbs.length) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = '请先在"qBittorrent 设置"中添加 qB';
                sel.appendChild(opt);
                sel.disabled = true;
            } else {
                qbs.forEach(qb => {
                    const opt = document.createElement('option');
                    opt.value = qb.id;
                    opt.textContent = `${qb.name} (${qb.url})`;
                    sel.appendChild(opt);
                });
                sel.disabled = false;
            }
        },

        /** 清空覆盖表单 */
        clearOverrideForm: () => {
            document.getElementById('ovr-host').value = '';
            const sel = document.getElementById('ovr-qb');
            if (sel.options.length) sel.selectedIndex = 0;
            document.getElementById('ovr-download-mode').checked = true;
            document.getElementById('ovr-dl-uplimit').value = '';
        },

        /** 保存覆盖配置 */
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

        /** 渲染覆盖列表 */
        renderOverrideList: () => {
            const container = document.getElementById('ovr-list');
            container.innerHTML = '';

            const overrides = Data.getDomainOverrides();
            const qbs = Data.getQBs();
            const getQBName = (id) => (qbs.find(q => q.id === id) || {}).name || '未知qB';

            Object.entries(overrides).forEach(([host, conf]) => {
                const qbName = getQBName(conf.qbId);
                const tag = conf.downloadMode ? '下载模式' : '普通';
                const limitDesc = (conf.dlUpLimit && conf.dlUpLimit > 0)
                    ? `，限速：${conf.dlUpLimit}MiB/s`
                    : '';

                const div = document.createElement('div');
                div.className = 'pt-aas-config-list-item';
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

            // 事件委托
            container.onclick = (e) => {
                const btn = e.target.closest('button');
                if (!btn) return;

                const host = btn.dataset.host;
                const action = btn.dataset.action;

                if (action === 'delete') {
                    if (!confirm(`删除覆盖：${host}？`)) return;
                    const ovr = Data.getDomainOverrides();
                    delete ovr[host];
                    Data.setDomainOverrides(ovr);
                    UI.renderOverrideList();
                } else if (action === 'edit') {
                    const ovr = Data.getDomainOverrides()[host];
                    const sec = container.closest('.pt-aas-section');
                    if (sec.classList.contains('collapsed')) {
                        sec.classList.remove('collapsed');
                    }
                    document.getElementById('ovr-host').value = host;
                    document.getElementById('ovr-qb').value = ovr.qbId;
                    document.getElementById('ovr-download-mode').checked = !!ovr.downloadMode;
                    document.getElementById('ovr-dl-uplimit').value = (ovr.dlUpLimit ?? 0) || '';
                }
            };
        },

        // ----- 历史记录 -----

        /** 渲染历史记录选择器 */
        renderHistorySelectors: () => {
            const qbs = Data.getQBs();
            const select = document.getElementById('pt-aas-history-qb-select');
            select.innerHTML = '';

            qbs.forEach(qb => {
                const opt = document.createElement('option');
                opt.value = qb.id;
                opt.textContent = qb.name;
                select.appendChild(opt);
            });

            const activeId = Data.getActiveQbId();
            if (activeId) {
                select.value = activeId;
            }
            UI.renderHistory(select.value);
        },

        /** 渲染历史记录列表 */
        renderHistory: (qbId) => {
            if (!qbId) return;

            const history = Data.getHistory(qbId);
            const tbody = document.getElementById('pt-aas-history-body');

            if (!history.length) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#aaa;">暂无记录</td></tr>';
                return;
            }

            tbody.innerHTML = '';

            // 按名称分组
            const groups = history.reduce((acc, item) => {
                (acc[item.name] = acc[item.name] || []).push(item);
                return acc;
            }, {});

            Object.entries(groups).forEach(([name, groupItems]) => {
                const isMulti = groupItems.length > 1;
                const newest = groupItems[0];
                const isCollapsed = isMulti && (UI.collapsedHistoryGroups[name] !== false);

                const tr = document.createElement('tr');
                tr.dataset.qbid = qbId;
                tr.dataset.groupName = name;
                if (isMulti) {
                    tr.className = 'pt-aas-hist-group-header';
                }

                const countBadge = `<span class="pt-aas-hist-badge">${groupItems.length}</span>`;
                let nameCellHtml = name;
                if (isMulti) {
                    nameCellHtml = `<span class="pt-aas-hist-expander">${isCollapsed ? '▶' : '▼'}</span>${name}`;
                }

                // 站点单元格
                const siteCellHtml = (() => {
                    if (isMulti && isCollapsed) return countBadge;
                    const host = newest.host || new URL(newest.url).hostname;
                    const siteConf = Data.getSiteConfig(host);
                    return `<a href="${newest.url}" target="_blank" title="${newest.url}">${siteConf?.alias || host}</a>`;
                })();

                // 删除按钮
                const deleteButtonHtml = isCollapsed
                    ? `<button class="pt-aas-btn danger small pt-aas-delete-hist-btn" data-qbid="${qbId}" data-group-name="${name}" title="删除组内所有记录">删组</button>`
                    : `<button class="pt-aas-btn danger small pt-aas-delete-hist-btn" data-qbid="${qbId}" data-time="${newest.time}" title="删除此条记录">删</button>`;

                tr.innerHTML = `
                    <td>${nameCellHtml}</td>
                    <td class="pt-aas-table-site">${siteCellHtml}</td>
                    <td>${Utils.formatTime(newest.time)}</td>
                    <td>${deleteButtonHtml}</td>
                `;
                tbody.appendChild(tr);

                // 展开状态下显示详细记录
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
                            <td><button class="pt-aas-btn danger small pt-aas-delete-hist-btn" data-qbid="${qbId}" data-time="${item.time}" title="删除此条记录">删</button></td>
                        `;
                        tbody.appendChild(detailTr);
                    });
                }
            });
        }
    };

    // ========================================================================
    //                         第九部分：自动化逻辑
    // ========================================================================

    /**
     * Automation 模块
     * 包含所有自动推送相关的业务逻辑
     */
    const Automation = {
        /**
         * 解析当前页面的种子信息
         * 使用 SiteParsers 统一入口
         */
        parsePageForTorrent: async () => {
            return SiteParsers.parse();
        },

        /**
         * 根据当前域名确定推送目标
         * @returns {{ qb: Object, isOverride: boolean, downloadMode: boolean }}
         */
        resolveTarget: () => {
            const host = Utils.getCurrentHost();
            const overrides = Data.getDomainOverrides();
            const conf = overrides[host];

            if (conf) {
                const qb = Data.getQBs().find(q => q.id === conf.qbId) || null;
                if (qb) {
                    return { qb, isOverride: true, downloadMode: !!conf.downloadMode };
                }
            }
            return { qb: Data.getActiveQb(), isOverride: false, downloadMode: false };
        },

        /**
         * 推送种子到 qBittorrent
         * @param {boolean} isForced - 是否为强制推送（忽略覆盖规则）
         */
        pushTorrent: async (isForced = false) => {
            try {
                // 1. 获取种子信息
                let torrentInfo;
                try {
                    torrentInfo = await Automation.parsePageForTorrent();
                } catch (e) {
                    UI.updateStatusBar('error', e.message, true);
                    return;
                }

                if (!torrentInfo) {
                    if (isForced) {
                        UI.updateStatusBar('error', '推送失败: 在当前页面找不到有效的种子链接', true);
                    }
                    return;
                }

                // 2. 确定目标 qB
                let target;
                if (isForced) {
                    // 强制推送时使用当前选择的活动qB
                    target = { qb: Data.getActiveQb(), isOverride: false, downloadMode: false };
                } else {
                    target = Automation.resolveTarget();
                }

                const qb = target.qb;
                if (!qb) {
                    UI.updateStatusBar('warning', '推送跳过: 未选择可用的qB客户端', true);
                    return;
                }

                const cleanName = Utils.cleanTorrentName(torrentInfo.name);

                // 3. 检查延迟推送设置
                const globalSettings = Data.getGlobalSettings();
                if (!isForced && globalSettings.delaySeconds > 0) {
                    const task = {
                        id: Utils.generateId(),
                        name: cleanName,
                        link: torrentInfo.link,
                        host: Utils.getCurrentHost(),
                        url: window.location.href,
                        target: target,
                        executeTime: Date.now() + (globalSettings.delaySeconds * 1000)
                    };
                    Data.addToQueue(task);
                    UI.updateStatusBar('info', `已加入队列，${globalSettings.delaySeconds}秒后推送 (请保持浏览器开启)`, true);
                    return;
                }

                // 4. 执行推送
                await Automation.executePush(qb, torrentInfo.link, cleanName, target.downloadMode, window.location.href);

            } catch (error) {
                UI.updateStatusBar('error', `错误: ${error?.message || '未知错误'}`, true);
            }
        },

        /**
         * 执行推送核心逻辑
         * 从 pushTorrent 分离以便队列复用
         */
        executePush: async (qb, link, cleanName, downloadMode, pageUrl) => {
            const mode = downloadMode
                ? { skipChecking: false, paused: false }
                : { skipChecking: true, paused: false };

            UI.updateStatusBar('loading', `正在推送: ${cleanName}${downloadMode ? '（下载模式）' : ''}`, true);

            try {
                // 下载种子文件
                const blob = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: "GET",
                        url: link,
                        responseType: "blob",
                        anonymous: false,
                        onload: (r) => r.status === 200
                            ? resolve(r.response)
                            : reject(`下载种子文件失败: ${r.status}`),
                        onerror: reject
                    });
                });

                const host = new URL(pageUrl).hostname;
                const siteCfg = Data.getSiteConfig(host) || {};
                const ovr = Data.getDomainOverrides()[host];

                // 计算有效上传限速
                const effectiveUpLimit =
                    (downloadMode && ovr && ovr.dlUpLimit > 0) ? ovr.dlUpLimit :
                        (siteCfg.upLimit ? parseFloat(siteCfg.upLimit) : 0);

                const mergedSiteSettings = {
                    ...siteCfg,
                    upLimit: effectiveUpLimit
                };

                const result = await new QBClient(qb).addTorrent(blob, mergedSiteSettings, mode);

                if (result.success) {
                    // 记录历史
                    Data.addHistory(qb.id, {
                        name: cleanName,
                        url: Utils.cleanUrl(pageUrl),
                        host,
                        time: Date.now()
                    });
                    UI.renderHistory(qb.id);

                    // 构建成功消息
                    const messageParts = [downloadMode ? '推送成功（下载）' : '推送成功'];
                    messageParts.push(`qB: ${qb.name}`);
                    if (qb.tags) messageParts.push(`标签: ${qb.tags}`);
                    if (effectiveUpLimit > 0) messageParts.push(`限速: ${effectiveUpLimit} MiB/s`);

                    UI.updateStatusBar(downloadMode ? 'download' : 'success', messageParts.join(' | '), true);
                } else {
                    throw new Error(result.message);
                }
            } catch (error) {
                console.error(error);
                UI.updateStatusBar('error', `推送失败: ${error?.message || '网络错误'}`, true);
            }
        },

        /**
         * 队列处理器
         * 每隔5秒检查是否有待执行的任务
         */
        queueWorker: async () => {
            const queue = Data.getQueue();
            if (queue.length === 0) return;

            const now = Date.now();
            const readyTasks = queue.filter(t => t.executeTime <= now);

            if (readyTasks.length > 0) {
                for (const task of readyTasks) {
                    console.log(`[PT-AAS] Processing queued task: ${task.name}`);
                    // 先移除防止重复执行
                    Data.removeFromQueue(task.id);

                    await Automation.executePush(
                        task.target.qb,
                        task.link,
                        task.name,
                        task.target.downloadMode,
                        task.url
                    );
                }
            }
        },

        /**
         * 检查并运行自动推送
         * 页面加载时和URL变化时调用
         */
        checkAndRun: async () => {
            const url = window.location.href;
            const excluded = Data.getExcludedUrls().split('\n').filter(Boolean).map(u => u.trim());

            // 检查是否在排除列表中
            if (excluded.some(ex => url.includes(ex))) return;

            // 检测发布完成页
            if (/uploaded=1(&offer=1)?$/.test(url) || url.includes('download_check')) {
                console.log("PT AAS: Upload success page detected, attempting to push.");
                Automation.pushTorrent(false);
                return;
            }

            // M-Team 逻辑保留（目前为空，待扩展）
        },

        /**
         * 快速操作
         * 自动点击发布/编辑/保存按钮
         */
        quickAction: () => {
            const path = window.location.pathname;
            let target;

            if (path.includes('/upload.php') || path.includes('/upload')) {
                target = document.querySelector('input#qr[type="submit"].btn, input[type="submit"][value="发布"]');
                // M-Team 新版
                if (!target) target = document.querySelector('button.ant-btn-primary');
            } else if (path.includes('/details.php')) {
                target = document.querySelector('a[href*="edit.php?id="]');
            } else if (path.includes('/edit.php')) {
                target = document.querySelector('input#qr[type="submit"], input[type="submit"][value="保存"], input[type="submit"][value="编辑"]');
            }

            if (target) {
                target.click();
            } else {
                alert('快速操作按钮在此页面无效或未适配。');
            }
        }
    };

    // ========================================================================
    //                            第十部分：入口点
    // ========================================================================

    // 初始化 UI
    UI.init();

    // 启动队列检查 Worker（每5秒检查一次）
    setInterval(Automation.queueWorker, 5000);

    // 页面加载检查
    Automation.checkAndRun();

    // URL 变化监听（SPA 支持）
    if (window.onurlchange === null) {
        window.addEventListener('urlchange', () => {
            // URL 变化后，DOM 可能还没渲染完，稍作延迟
            setTimeout(Automation.checkAndRun, 1000);
        });
    }

})();
