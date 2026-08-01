# vscomp — VapourSynth 视频比对环境

在浏览器里开一个 KDE 桌面跑 `vspreview`，做逐帧画质比对。基于
`linuxserver/webtop` 自建镜像，VapourSynth 插件和 Python 依赖全部
bake 进镜像，容器秒起、重启不重装。

---

## 环境要求

- Linux 主机，装了 Docker 和 Docker Compose v2
- **至少 15 GB 空闲磁盘**（基础镜像 4~6 GB + 构建产物，成品镜像约 8~10 GB）
- 构建期间需要联网（pacman 官方源 + AUR + PyPI）

## 快速开始

```bash
git clone https://github.com/akina-up/script.git
cd script/PT/comp

cp .env.example .env
vim .env                 # 至少要改 MEDIA_DIR 和 WEBTOP_PASSWORD

docker compose build --progress=plain 2>&1 | tee build.log
docker compose up -d
```

首次构建约 **4~5 分钟**（大头是 AUR 插件编译）。构建结尾会打印一张校验表，
所有源滤镜和 `compare.py` 需要的符号都应该是 `OK`：

```
源滤镜（至少要有一个）:
    lsmas      OK
    bs         OK
    ffms2      OK

compare.py 需要的符号:
    OK    from vstools import vs, core
    OK    from vspreview import set_output
    ...
```

**没有可用源滤镜时构建会主动失败**，不会产出一个能启动但没法用的镜像。

浏览器打开 `https://<主机>:3011`，用 `.env` 里的用户名密码登录。(注意是https与https端口)

## 使用

在桌面里开 **Konsole**（不要用 `docker exec` —— vspreview 是 GUI，
没有 DISPLAY 起不来）：

```bash
cd /comp
vspreview compare.py
```

编辑 `compare.py`，每次比对只改两行：

```python
clip1 = src(r'片子A.mkv')
clip2 = src(r'片子B.mkv')

source1 = "4 527 kb/s"      # 显示在画面上的标签
source2 = "7 529 kb/s"
```

脚本里预留了常用操作（去掉注释即可）：

```python
clip2 = clip2[1:]                                        # 对齐帧偏移
clip2 = core.std.Levels(clip2, gamma=0.88, planes=0)     # 伽马校正
clip1 = core.std.AssumeFPS(clip1, fpsnum=24000, fpsden=1001)   # 改帧率
clip1 = core.std.Crop(clip1, top=140, bottom=140)        # 裁黑边
```

## 目录结构

```
vscomp/
├── Dockerfile            构建入口，3 个 RUN 层
├── build-vs.sh           分阶段构建：system / plugins / python
├── build-aur.sh          AUR 插件安装（以 vsbuild 用户运行）
├── docker-compose.yml
├── .env.example          复制成 .env 后填
├── compare.py            比对脚本，挂到容器 /comp/compare.py
└── config/               容器里的 /config（桌面配置 + 索引缓存），自动创建
```

容器内的路径：

| 容器路径 | 说明 |
|---|---|
| `/comp` | 片源目录（`.env` 里的 `MEDIA_DIR`） |
| `/config` | 桌面用户 HOME，持久化到项目下的 `config/` |
| `/config/lwi` | lsmas 的 `.lwi` 索引缓存 |
| `/opt/vsenv` | Python venv，`vspreview` / `vspy` 已软链到 `/usr/local/bin` |

## 镜像里有什么

**VapourSynth 插件**（`core.` 后面的命名空间）

| 命名空间 | 来源 | 用途 |
|---|---|---|
| `lsmas` | L-SMASH Works | 源滤镜，`LWLibavSource` |
| `bs` | BestSource | 源滤镜，帧精确，推荐 |
| `ffms2` | FFmpegSource2 | 源滤镜 |
| `placebo` | vs-placebo | tonemap / deband |
| `resize2` | resize2 | 缩放（打过补丁的 zimg） |
| `akarin` | vs-akarin | Expr / 文本 |
| `fpng` | vs-fpng | PNG 输出 |
| `libp2p` | libp2p | 像素打包 |
| `vivtc` | VIVTC | 反交错 |
| `sub` / `text` | SubText | 字幕、`FrameInfo` 打帧号 |

**Python 包**：`vsjetpack<2`、`vsutil`、`vspreview`、`awsmfunc`、`requests`

VapourSynth 用系统版（Arch 的 `vapoursynth` 包），venv 通过
`--system-site-packages` 继承 —— 绑定和 AUR 编译插件的版本天然对齐。

## 常见问题

**`vspreview: command not found`**
只在桌面终端里有效。`/usr/local/bin/vspreview` 是软链，`/usr/local/bin`
永远在默认 PATH 里。如果确实没有，说明构建没跑完，看 `build.log`。

**窗口起不来，报 `qt.qpa.plugin`**
PyQt6 的 wheel 不带 Wayland platform 插件，走 XWayland 兜底：

```bash
QT_QPA_PLATFORM=xcb vspreview compare.py
```

**`lsmas: failed to construct index`**
片源目录通常对容器用户只读，而 lsmas 默认要在片子旁边写 `.lwi` 索引。
`compare.py` 里的 `src()` 已经把索引重定向到 `/config/lwi`。如果你绕开
`src()` 直接调 `core.lsmas.LWLibavSource()`，就会撞上这个。

想让片源目录可写的话，把 `.env` 里的 `PUID`/`PGID` 改成该目录属主的 uid/gid。

**某个插件显示 MISSING**
构建日志里搜 `fail <插件名>`。两种典型情况：

- `构建或安装失败` —— AUR 包编译挂了，看上面的编译报错
- `空包：装上了但没有任何 .so` —— 包装上了却零文件产出（AUR 里真有这种），
  脚本会自动尝试下一个候选包名

校验步骤在必需插件缺失时会打印插件目录清单、手动 `LoadPlugin` 的报错、
以及 `ldd` 的缺库列表，照着看就行。

**启动时有一行 `Plugin ... already loaded (info.akarin.vsplugin)`**
说明 akarin 装了两份。当前配置（`vsjetpack<2`）下不会出现 —— 只有解除
vsjetpack 的版本钉死时，2.x 会额外拉一个 PyPI 的 akarin wheel，跟
`build-aur.sh` 手动编译的那份重复。功能无影响，VapourSynth 会跳过重复的那个。

## 维护

改了 `compare.py`：**不用重建**，它是 bind mount，存盘即生效。

改了 `build-vs.sh` / `build-aur.sh` / `Dockerfile`：

```bash
docker compose build --progress=plain 2>&1 | tee build.log
docker compose up -d
```

Windows 上编辑过脚本的话，传上去先去掉 CR：

```bash
sed -i 's/\r$//' build-vs.sh build-aur.sh && chmod +x build-vs.sh build-aur.sh
```

**磁盘不够时**：`docker system df` 看占用，`docker builder prune -f` +
`docker image prune -f` 清构建缓存和悬空镜像（不会碰其他项目的镜像，
`docker system prune -a` 会，别用）。根盘太小的话把 Docker 数据目录挪到大盘：
`/etc/docker/daemon.json` 里设 `"data-root"`，搬迁用 `rsync -aHAX`
（`-H` 保留硬链接是必须的，overlay2 重度依赖硬链接）。

## 设计说明

几个不那么直观的决定，改之前先看一眼：

**为什么用系统 VapourSynth 而不是 pip 版**
Arch 的 AUR 插件是编译给系统 VapourSynth 的，装进系统 Python 的
site-packages。venv 里的绑定从「自己模块目录下的 `plugins/`」autoload，
两个位置对不上，所以构建时会按 venv 里模块的**实际路径**把插件软链过去。
路径不写死，由 Python 自己报告。

**为什么插件目录要扫五六个 glob**
Arch 上 VS 插件散落在至少三个地方：`/usr/lib/vapoursynth`、
`/usr/lib/python3.X/site-packages/vapoursynth/plugins`、`/usr/vapoursynth`
（lsmashsource 和 libp2p 在最后这个）。

**为什么 `vsjetpack` 钉 `<2`**
vsjetpack 2.0.0 做了破坏性改名（`vs_object` → `VSObject`），而 vspreview
0.20.1 声明的是 `vsjetpack>=1.1.0` 不封上界 —— pip 会拉 2.x，然后 vspreview
自己 import 就炸。同时**不要**显式装 `vstools`：1.x 的 vsjetpack 自带顶层
`vstools` 模块，PyPI 上的 `vstools` 3.4.x 只是转发到 2.x 的空壳，两者会打架。

**为什么 `install_one` 要查 `.so`**
部分 AUR 包能「装成功」却一个文件都不产出（打包阶段 meson 报
`Nothing to install.`，`Net Change 0.00 MiB`，但 `pacman -Q` 照样返回 0）。
只看 `pacman -Q` 会把空包当成功，等到运行时才发现命名空间不存在。

**为什么脚本放 `/opt/vsbuild` 而不是 `/tmp`**
每个构建阶段结尾都会 `rm -rf /tmp/*` 清缓存 —— 镜像层是叠加的，
留到最后一层再删根本瘦不了身。脚本放 `/tmp` 会被自己的清理删掉，
下一层就找不到了。
