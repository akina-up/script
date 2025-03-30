// ==UserScript==
// @name         SSD文件树状视图
// @version      1.0
// @description  将页面中的文件列表（表格）转换为带图标、排序、搜索、智能折叠功能的树状视图
// @author       akina
// @match        *://springsunday.net/details.php?id=*
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @downloadURL  https://cdn.jsdelivr.net/gh/akina-up/script@master/pt/ssd-tree-view.user.js
// @updateURL    https://cdn.jsdelivr.net/gh/akina-up/script@master/pt/ssd-tree-view.user.js
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// @require      https://cdn.jsdelivr.net/npm/jstree@3.3.11/dist/jstree.min.js
// @resource     customCSS https://cdn.jsdelivr.net/npm/jstree@3.3.11/dist/themes/default/style.min.css
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    // 文件类型图标映射
    const ICONS = {
        audio: "/images/icon/mp3.gif",
        bmp: "/images/icon/bmp.gif",
        image: "/images/icon/jpg.gif",
        png: "/images/icon/png.gif",
        rar: "/images/icon/rar.gif",
        text: "/images/icon/txt.gif",
        unknown: "/images/icon/unknown.gif",
        video: "/images/icon/mp4.gif"
    };

    // 文件扩展名分类
    const FILE_TYPES = {
        audio: ["flac", "aac", "wav", "mp3", "m4a", "mka"],
        bmp: ["bmp"],
        image: ["jpg", "jpeg", "webp"],
        png: ["png", "gif"],
        rar: ["rar", "zip", "7z", "tar", "gz"],
        text: ["txt", "log", "cue", "ass", "ssa", "srt", "doc", "docx", "xls", "xlsx", "pdf"],
        video: ["mkv", "mp4", "avi", "wmv", "flv", "m2ts"]
    };

    // 设置样式：加载 jstree 默认 CSS 以及自定义样式
    const setupCSS = () => {
        // 加载 jstree 样式资源
        GM_addStyle(GM_getResourceText("customCSS"));
        // 自定义样式
        GM_addStyle(`
            .tree-container {
                background: #fff;
                border: 2px solid;
                border-color: #404040 #dfdfdf #dfdfdf #404040;
                padding: 5px;
                margin: 10px 0;
            }

            .control-panel {
                background: #f0f0f0;
                border-bottom: 1px solid #ccc;
                padding: 5px;
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .control-panel-left {
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .control-panel-right {
                margin-left: auto;
                display: flex;
                align-items: center;
            }

            #search_input {
                border: 1px solid #ccc;
                padding: 2px 5px;
                width: 200px;
            }

            #switch {
                padding: 2px 5px;
                cursor: pointer;
            }

            #file_tree {
                padding: 5px;
                max-height: 600px;
                overflow: auto;
            }

            .filesize {
                padding-left: 8px;
                color: #666;
            }

            .smart-toggle {
                display: flex;
                align-items: center;
                gap: 4px;
                cursor: pointer;
                user-select: none;
            }

            .smart-toggle input {
                margin: 0;
            }

            .sort-controls {
                display: flex;
                align-items: center;
                gap: 5px;
            }

            .sort-btn {
                padding: 2px 8px;
                cursor: pointer;
                border: 1px solid #ccc;
                background: #f8f8f8;
                display: flex;
                align-items: center;
                gap: 4px;
            }

            .sort-btn.active {
                background: #e0e0e0;
            }

            .sort-direction {
                display: inline-block;
                width: 12px;
            }
        `);
    };

    // 树节点基础类，用于构建文件/文件夹树
    class TreeNode {
        constructor(name) {
            this.name = name;
            this.length = 0;
            this.childNode = new Map();
            this._cache = new Map();
        }

        // 插入节点：path 为数组（路径分段），size 为文件大小字符串（例如 "0.28 KB"）
        insert(path, size) {
            let currentNode = this;
            for (const node of path) {
                if (!currentNode.childNode.has(node)) {
                    currentNode.childNode.set(node, new TreeNode(node));
                }
                currentNode = currentNode.childNode.get(node);
            }
            currentNode.length = this.toLength(size);
            return currentNode;
        }

        // 转换为显示文本（包括名称和大小），增加文件夹和文件的图标：
        // 如果存在子节点则认为是文件夹，前置图标使用 📁；否则使用 📄
        toString() {
            const size = this.childNode.size > 0 ? this.calculateTotalSize() : this.length;
            const icon = this.childNode.size > 0 ? "📁" : "📄";
            return `<span class="icon">${icon}</span><span class="filename">${this.name}</span><span class="filesize">${this.toSize(size)}</span>`;
        }

        // 计算总大小（包含子节点累计）
        calculateTotalSize() {
            if (this._cache.has('totalSize')) return this._cache.get('totalSize');
            let total = this.length;
            for (const node of this.childNode.values()) {
                total += node.childNode.size === 0 ? node.length : node.calculateTotalSize();
            }
            this._cache.set('totalSize', total);
            return total;
        }

        // 转换为 jstree 需要的对象
        toObject() {
            if (this._cache.has('object')) return this._cache.get('object');
            const ret = {
                text: this.toString(),
                children: [],
                state: { opened: false }
            };
            const folders = [];
            const files = [];
            for (const [, value] of this.childNode) {
                if (value.childNode.size === 0) {
                    // 文件节点，直接使用 toString()（已包含 📄 图标）
                    files.push({
                        icon: value.icon,
                        length: value.length,
                        text: value.toString()
                    });
                } else {
                    // 文件夹节点，前置增加 📁 图标
                    const inner = value.toObject();
                    folders.push({
                        ...inner,
                        text: `<span class="icon">📁</span><span class="filename">${value.name}</span><span class="filesize">${this.toSize(value.calculateTotalSize())}</span>`,
                        state: { opened: false }
                    });
                }
            }
            ret.children = [...folders, ...files];
            this._cache.set('object', ret);
            return ret;
        }

        // 获取文件扩展名
        get ext() {
            if (this._ext !== undefined) return this._ext;
            const dotIndex = this.name.lastIndexOf(".");
            this._ext = dotIndex > 0 ? this.name.substr(dotIndex + 1).toLowerCase() : "";
            return this._ext;
        }

        // 根据扩展名选择图标（备用，可用于自定义 jstree 图标）
        get icon() {
            if (this._icon !== undefined) return this._icon;
            this._icon = ICONS.unknown;
            for (const [type, extensions] of Object.entries(FILE_TYPES)) {
                if (extensions.includes(this.ext)) {
                    this._icon = ICONS[type];
                    break;
                }
            }
            return this._icon;
        }

        // 将大小字符串转换为字节数，支持 "KB" "MB" "GB" 等（这里采用 2 的幂换算）
        toLength(size) {
            if (!size) return -1;
            const match = size.toLowerCase().match(/^([\d.]+)\s*([kmgt]?b(?:ytes)?)$/);
            if (!match) return -1;
            const [, value, unit] = match;
            const factors = { b: 0, bytes: 0, kb: 10, mb: 20, gb: 30, tb: 40 };
            return parseFloat(value) * Math.pow(2, factors[unit] || 0);
        }

        // 将字节数转换为易读字符串
        toSize(length) {
            if (length < 0) return "";
            const units = [[40, "TiB"], [30, "GiB"], [20, "MiB"], [10, "KiB"], [0, "Bytes"]];
            for (const [factor, unit] of units) {
                if (length >= Math.pow(2, factor)) {
                    return (length / Math.pow(2, factor)).toFixed(unit === "Bytes" ? 0 : 3) + unit;
                }
            }
            return "0 Bytes";
        }
    }

    // 以下函数为 jstree 操作提供辅助功能

    // 查找树中第一个分叉节点
    function findFirstForkNode(tree) {
        const findForkInNode = (nodeId) => {
            const node = tree.get_node(nodeId);
            if (!node || !node.children) return null;
            if (node.children.length > 1) return node;
            if (node.children.length === 1) return findForkInNode(node.children[0]);
            return null;
        };
        return findForkInNode('#');
    }

    // 获取指定节点的路径（由节点 id 组成的数组）
    function getPathToNode(tree, targetNode) {
        const path = [];
        let currentNode = targetNode;
        while (currentNode.id !== '#') {
            path.unshift(currentNode.id);
            currentNode = tree.get_node(tree.get_parent(currentNode));
        }
        return path;
    }

    // 获取第一个分叉点及其路径信息
    function getFirstForkInfo(tree) {
        const firstFork = findFirstForkNode(tree);
        if (!firstFork) return null;
        const pathToFork = getPathToNode(tree, firstFork);
        const protectedNodes = new Set(pathToFork);
        protectedNodes.add(firstFork.id);
        return {
            fork: firstFork,
            pathToFork,
            protectedNodes
        };
    }

    // 智能折叠：只折叠不在保护名单中的节点
    function smartCollapse(tree, treeDepth) {
        if (treeDepth <= 1) {
            tree.close_all();
            return;
        }
        const forkInfo = getFirstForkInfo(tree);
        if (!forkInfo) return;
        const openNodes = tree.get_json('#', { flat: true })
            .filter(node => tree.is_open(node.id))
            .map(node => node.id);
        openNodes.forEach(nodeId => {
            if (!forkInfo.protectedNodes.has(nodeId)) {
                tree.close_node(nodeId);
            }
        });
    }

    // 检查文件树的最大层级
    function checkTreeDepth(tree) {
        const getNodeDepth = (nodeId, currentDepth = 0) => {
            const node = tree.get_node(nodeId);
            if (!node || !node.children || node.children.length === 0) {
                return currentDepth - 1;
            }
            return Math.max(...node.children.map(childId =>
                getNodeDepth(childId, currentDepth + 1)
            ));
        };
        return Math.max(0, getNodeDepth('#'));
    }

    // 使用 MutationObserver 监听 #filelist 区域出现 table.main
    function waitForFileList(callback) {
        const observer = new MutationObserver((mutations, obs) => {
            const table = document.querySelector("#filelist table.main");
            if (table) {
                obs.disconnect();
                callback();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // 主程序入口：解析表格数据，构建树数据，并用 jstree 显示
    function main() {
        setupCSS();

        // 创建树数据，根节点名称可自行调整
        const data = new TreeNode('文件列表');

        // 从 #filelist 中获取表格数据（跳过第一行表头）
        $("#filelist table.main tr:gt(0)").each(function() {
            const $cells = $(this).find("td");
            if ($cells.length >= 2) {
                const pathStr = $cells.eq(0).text().trim();
                const sizeStr = $cells.eq(1).text().trim();
                if (pathStr) {
                    data.insert(pathStr.split('/'), sizeStr);
                }
            }
        });

        // 创建UI容器：包含控制面板（搜索、展开/折叠、排序）和树显示区域
        const fragment = document.createDocumentFragment();
        const treeContainer = $('<div class="tree-container"></div>').appendTo(fragment);

        const controlPanel = $('<div class="control-panel"></div>')
            .append($('<div class="control-panel-left"></div>')
                .append('<input type="text" id="search_input" placeholder="搜索文件..." />')
                .append('<button id="switch">展开全部</button>')
                .append($('<div class="sort-controls"></div>')
                    .append('<button class="sort-btn" data-sort="name">名称<span class="sort-direction">↑</span></button>')
                    .append('<button class="sort-btn" data-sort="size">大小<span class="sort-direction">↓</span></button>')
                )
            )
            .append($('<div class="control-panel-right"></div>')
                .append('<label class="smart-toggle"><input type="checkbox" id="smart_mode" />智能展开</label>')
            )
            .appendTo(treeContainer);

        const fileTree = $('<div id="file_tree"></div>').appendTo(treeContainer);
        // 用新创建的树容器替换原来的 #filelist 内容
        $("#filelist").empty().append(fragment);

        // 创建 jstree 实例
        const treeInstance = fileTree.jstree({
            core: {
                data: data.toObject(),
                themes: { variant: "large" }
            },
            plugins: ["search", "wholerow", "contextmenu"],
            contextmenu: {
                select_node: false,
                show_at_node: false,
                items: {
                    getText: {
                        label: "复制",
                        action: selected => {
                            const text = selected.reference.find(".filename").text();
                            navigator.clipboard.writeText(text);
                        }
                    }
                }
            }
        });

        // 绑定 jstree 相关事件
        treeInstance.on("ready.jstree", function() {
            const tree = treeInstance.jstree(true);
            const isSmartMode = localStorage.getItem('dmhy_smart_mode') !== 'false';
            if (isSmartMode) {
                const treeDepth = checkTreeDepth(tree);
                if (treeDepth > 1) {
                    const firstFork = findFirstForkNode(tree);
                    if (firstFork) {
                        const pathToFork = getPathToNode(tree, firstFork);
                        pathToFork.forEach(nodeId => tree.open_node(nodeId));
                    }
                } else {
                    tree.open_all();
                }
            }
        });

        treeInstance.on("loaded.jstree", function() {
            const tree = treeInstance.jstree(true);
            let isExpanded = false;
            let isSmartMode = localStorage.getItem('dmhy_smart_mode') !== 'false';
            let previousState = null;
            let hasSearched = false;
            let searchTimeout = null;
            let treeNodes = tree.get_json('#', { flat: true });

            const updateSwitchButton = () => {
                $("#switch").text(isExpanded ? "折叠全部" : "展开全部");
            };

            // 展开/折叠按钮事件
            $("#switch").click(function() {
                isExpanded = !isExpanded;
                const treeDepth = checkTreeDepth(tree);
                if (isSmartMode) {
                    if (isExpanded) {
                        tree.open_all();
                    } else {
                        if (treeDepth > 1) {
                            smartCollapse(tree, treeDepth);
                        } else {
                            tree.close_all();
                        }
                    }
                } else {
                    isExpanded ? tree.open_all() : tree.close_all();
                }
                updateSwitchButton();
            });

            // 智能模式切换事件
            $("#smart_mode").prop('checked', isSmartMode).change(function() {
                isSmartMode = this.checked;
                localStorage.setItem('dmhy_smart_mode', isSmartMode);
                isExpanded = false;
                localStorage.setItem('dmhy_tree_expanded', isExpanded);
                if (isSmartMode) {
                    tree.close_all();
                    const firstFork = findFirstForkNode(tree);
                    if (firstFork) {
                        const pathToFork = getPathToNode(tree, firstFork);
                        pathToFork.forEach(nodeId => tree.open_node(nodeId));
                    }
                } else {
                    tree.close_all();
                }
                updateSwitchButton();
            });

            // 初始排序：默认按名称升序
            const rootNode = tree.get_node('#');
            $('.sort-btn[data-sort="name"]').addClass('active').find('.sort-direction').text('↑');

            const sortNodes = (node, sortType, isAsc) => {
                if (node.children && node.children.length) {
                    node.children.sort((a, b) => {
                        const nodeA = tree.get_node(a);
                        const nodeB = tree.get_node(b);
                        // 文件夹始终排在前面
                        const isAFolder = nodeA.children.length > 0;
                        const isBFolder = nodeB.children.length > 0;
                        if (isAFolder !== isBFolder) {
                            return isAFolder ? -1 : 1;
                        }
                        let result = 0;
                        if (sortType === 'size') {
                            const sizeA = parseFloat(nodeA.text.match(/[\d.]+(?=[TGMK]iB|Bytes)/)) || 0;
                            const sizeB = parseFloat(nodeB.text.match(/[\d.]+(?=[TGMK]iB|Bytes)/)) || 0;
                            const unitA = nodeA.text.match(/[TGMK]iB|Bytes/)?.[0] || '';
                            const unitB = nodeB.text.match(/[TGMK]iB|Bytes/)?.[0] || '';
                            const units = { 'TiB': 4, 'GiB': 3, 'MiB': 2, 'KiB': 1, 'Bytes': 0 };
                            const unitCompare = (units[unitA] || 0) - (units[unitB] || 0);
                            result = unitCompare !== 0 ? unitCompare : sizeA - sizeB;
                        } else {
                            const nameA = nodeA.text.match(/class="filename">([^<]+)/)?.[1] || '';
                            const nameB = nodeB.text.match(/class="filename">([^<]+)/)?.[1] || '';
                            result = nameA.localeCompare(nameB, undefined, { numeric: true });
                        }
                        return isAsc ? result : -result;
                    });
                    node.children.forEach(childId => {
                        sortNodes(tree.get_node(childId), sortType, isAsc);
                    });
                }
            };

            // 执行初始排序
            sortNodes(rootNode, 'name', true);
            tree.redraw(true);

            // 排序按钮事件
            $('.sort-btn').on('click', function() {
                const $this = $(this);
                const $direction = $this.find('.sort-direction');
                const sortType = $this.data('sort');
                if ($this.hasClass('active')) {
                    $direction.text($direction.text() === '↑' ? '↓' : '↑');
                } else {
                    $('.sort-btn').removeClass('active').find('.sort-direction').text('↓');
                    $this.addClass('active');
                }
                const isAsc = $direction.text() === '↑';
                sortNodes(rootNode, sortType, isAsc);
                tree.redraw(true);
            });

            // 搜索功能
            const searchDebounceTime = 250;
            $('#search_input').keyup(function() {
                if (searchTimeout) {
                    clearTimeout(searchTimeout);
                }
                searchTimeout = setTimeout(() => {
                    const searchText = $(this).val().toLowerCase();
                    if (searchText) {
                        if (!hasSearched) {
                            previousState = {
                                isExpanded,
                                openNodes: treeNodes.filter(node => tree.is_open(node.id))
                                    .map(node => node.id)
                            };
                            hasSearched = true;
                        }
                        const matchedNodes = new Set();
                        treeNodes.forEach(node => {
                            const nodeText = tree.get_text(node.id).toLowerCase();
                            if (nodeText.includes(searchText)) {
                                matchedNodes.add(node.id);
                                let parent = tree.get_parent(node.id);
                                while (parent !== '#') {
                                    matchedNodes.add(parent);
                                    parent = tree.get_parent(parent);
                                }
                            }
                        });
                        const operations = [];
                        treeNodes.forEach(node => {
                            if (matchedNodes.has(node.id)) {
                                operations.push(() => {
                                    tree.show_node(node.id);
                                    tree.open_node(node.id);
                                });
                            } else {
                                operations.push(() => tree.hide_node(node.id));
                            }
                        });
                        const batchSize = 50;
                        const executeBatch = (startIndex) => {
                            const endIndex = Math.min(startIndex + batchSize, operations.length);
                            for (let i = startIndex; i < endIndex; i++) {
                                operations[i]();
                            }
                            if (endIndex < operations.length) {
                                requestAnimationFrame(() => executeBatch(endIndex));
                            }
                        };
                        executeBatch(0);
                        isExpanded = true;
                    } else {
                        if (previousState) {
                            tree.show_all();
                            tree.close_all();
                            const restoreNodes = () => {
                                const batch = previousState.openNodes.splice(0, 50);
                                batch.forEach(nodeId => tree.open_node(nodeId, false));
                                if (previousState.openNodes.length > 0) {
                                    requestAnimationFrame(restoreNodes);
                                }
                            };
                            restoreNodes();
                            isExpanded = previousState.isExpanded;
                            previousState = null;
                            hasSearched = false;
                        }
                    }
                    updateSwitchButton();
                }, searchDebounceTime);
            });
        });
    }

    // 等待文件列表出现后启动主程序
    waitForFileList(main);

})();