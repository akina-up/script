#!/usr/bin/env bash
# 分阶段构建脚本。Dockerfile 里按 stage 拆成独立 RUN 层，
# 这样某一步失败重试时，前面成功的层直接走 Docker 缓存，不用重跑。
#
#   ./build-vs.sh system    keyring + 系统包 + 构建用户
#   ./build-vs.sh plugins   AUR 插件（最慢）
#   ./build-vs.sh python    venv + pip + 校验 + 清理
#
set -euo pipefail

VSENV="${VSENV:-/opt/vsenv}"
BUILDER=vsbuild
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

step() { echo -e "\n\033[1;36m==> $*\033[0m"; }

# ============================================================ stage: system
stage_system() {
    step "[system 1/3] 初始化 pacman keyring"
    # LSIO 镜像里 keyring 可能已就绪，重复 init 无害；真失败了也先不致命，
    # 后面 pacman 真的验签失败会自己报错，那时报错信息更有用。
    pacman-key --init            || echo "WARN: pacman-key --init 返回非 0，继续"
    pacman-key --populate archlinux || echo "WARN: populate 返回非 0，继续"
    pacman -Sy --noconfirm --needed archlinux-keyring \
      || echo "WARN: archlinux-keyring 更新失败，继续"

    step "[system 2/3] 安装系统依赖"
    # 只放「确定存在于官方仓库」的包 —— 任何一个 target not found
    # 都会让整条 pacman 事务失败，有疑问的一律走 build-aur.sh 的候选列表。
    #
    # --overwrite '*' : LSIO 镜像改过一些系统文件，全量 -Syu 时容易撞
    #                   "conflicting files"，这是 Arch 容器里的经典坑。
    pacman -Syu --noconfirm --needed --overwrite '*' \
        base-devel git sudo \
        python python-pip \
        vapoursynth \
        ffmpeg \
        llvm clang meson ninja cmake pkgconf nasm yasm \
        qt6-wayland xcb-util-cursor libxkbcommon-x11

    step "[system 3/3] 创建构建用户 $BUILDER"
    # makepkg 拒绝以 root 运行，必须有个普通用户 + 免密 sudo 装依赖。
    id "$BUILDER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$BUILDER"
    printf '%s ALL=(ALL) NOPASSWD: ALL\n' "$BUILDER" > "/etc/sudoers.d/99-$BUILDER"
    chmod 0440 "/etc/sudoers.d/99-$BUILDER"

    # 让 makepkg 吃满所有核心（默认 -j2，akarin 链 LLVM 会慢到离谱）
    sed -i "s/^#\?MAKEFLAGS=.*/MAKEFLAGS=\"-j\$(nproc)\"/" /etc/makepkg.conf
    sed -i 's/^OPTIONS=.*/OPTIONS=(strip !docs !libtool !staticlibs emptydirs zipman purge !debug)/' /etc/makepkg.conf

    echo "系统 VapourSynth: $(pacman -Q vapoursynth)"

    # 必须在本层内清理！Docker 镜像层是叠加的，等到层 3 再 rm 只会多加一层
    # 删除标记，层 1 里那几个 GB 的下载缓存照样留在镜像里。
    pacman -Scc --noconfirm >/dev/null 2>&1 || true
    rm -rf /var/cache/pacman/pkg/* /root/.cache /tmp/* 2>/dev/null || true
}

# =========================================================== stage: plugins
stage_plugins() {
    step "[plugins] 构建 VapourSynth 插件（AUR，耗时最长的一步）"
    # 直接从 $HERE 跑，不再中转 /tmp —— 本函数结尾会 `rm -rf /tmp/*`，
    # 任何放在 /tmp 的东西都是定时炸弹。
    sudo -u "$BUILDER" -H bash "$HERE/build-aur.sh"

    # 同上，本层内清理。yay 会把每个 AUR 包的 git 仓库、解包后的源码树、
    # 编译中间产物、打好的 .pkg.tar.zst 全留在 ~/.cache/yay 里 —— 这是构建
    # 过程中最占地方的一坨（zimg / LLVM 那几个尤其大）。
    echo "清理前 yay 缓存: $(du -sh /home/${BUILDER}/.cache 2>/dev/null | cut -f1 || echo 0)"
    rm -rf "/home/${BUILDER}/.cache" "/home/${BUILDER}/yay-bin" 2>/dev/null || true
    pacman -Scc --noconfirm >/dev/null 2>&1 || true
    rm -rf /var/cache/pacman/pkg/* /tmp/* 2>/dev/null || true
}

# ============================================================ stage: python
stage_python() {
    step "[python 1/4] 创建 venv: $VSENV"
    python -m venv --system-site-packages "$VSENV"
    "$VSENV/bin/pip" install --no-cache-dir --upgrade pip setuptools wheel cython

    echo "系统 VapourSynth: $(pacman -Q vapoursynth)"

    # 不给 vapoursynth 钉版本 —— vsjetpack/vsjetengine 会要求更高版本，钉了也会
    # 被 pip 的依赖回溯绕过（实测把 R77 顶成了 78）。绑定用哪个版本无所谓，
    # 插件由下一步按 venv 里模块的实际路径软链进去。
    #
    # vsjetpack 则必须钉在 1.x。2.0.0 是破坏性改名（vs_object -> VSObject 等），
    # 而 vspreview 0.20.1 声明的是 `vsjetpack>=1.1.0`、不封上界 —— pip 会拉到
    # 2.x，然后 vspreview 自己 import 的时候就炸：
    #   vspreview/plugins/utils.py: from vstools import vs, vs_object
    #   ImportError: cannot import name 'vs_object'
    #
    # 也不要显式装 vstools：1.x 的 vsjetpack 自带顶层 vstools 模块，
    # 而 PyPI 上的 vstools 3.4.x 只是个转发到 vsjetpack 2.x 的空壳（2.5 KB），
    # 两者同时装会互相打架。
    "$VSENV/bin/pip" install --no-cache-dir --upgrade \
        "vsjetpack<2" vsutil vspreview awsmfunc requests

    # 让桌面终端里不用 activate 也能直接敲 vspreview。
    # /usr/local/bin 永远在默认 PATH 里，比 profile.d 可靠（KDE 的 Konsole
    # 起的是非登录 shell，不读 /etc/profile.d）。
    echo 'export PATH="/opt/vsenv/bin:$PATH"' > /etc/profile.d/vsenv.sh
    chmod 0644 /etc/profile.d/vsenv.sh
    ln -sf "$VSENV/bin/vspreview" /usr/local/bin/vspreview
    ln -sf "$VSENV/bin/python"    /usr/local/bin/vspy

    step "[python 2/4] 把系统插件软链进 venv 的插件目录"
    # AUR 装的插件在系统 python 的 site-packages 下，而 venv 里的 vapoursynth
    # 绑定会从「自己模块目录下的 plugins/」autoload —— 两个地方，必须搭桥。
    # 目录不写死，让 Python 报告实际路径。
    "$VSENV/bin/python" - <<'PY'
import glob
import os
import vapoursynth

dst = os.path.join(os.path.dirname(vapoursynth.__file__), "plugins")
os.makedirs(dst, exist_ok=True)
print(f"venv 插件目录: {dst}")

srcs = set()
for pattern in ("/usr/lib/vapoursynth/*.so",
                "/usr/lib64/vapoursynth/*.so",
                "/usr/vapoursynth/*.so",          # lsmashsource / libp2p 装这儿
                "/usr/lib/*/vapoursynth/*.so",
                "/usr/lib/python3*/site-packages/vapoursynth/plugins/*.so",
                "/usr/local/lib/vapoursynth/*.so"):
    srcs.update(glob.glob(pattern))

linked = skipped = 0
for so in sorted(srcs):
    if os.path.realpath(os.path.dirname(so)) == os.path.realpath(dst):
        continue
    target = os.path.join(dst, os.path.basename(so))
    if os.path.lexists(target):          # pip 装的插件 wheel 已经占位了
        skipped += 1
        continue
    os.symlink(so, target)
    linked += 1
    print(f"  link {os.path.basename(so)}")

print(f"新建软链 {linked} 个，已存在跳过 {skipped} 个")
print("最终插件目录:")
for f in sorted(os.listdir(dst)):
    print(f"    {f}")
PY

    step "[python 3/4] 校验插件与 Python 包"
    "$VSENV/bin/python" - <<'PY'
import sys
import vapoursynth as vs

core = vs.core

# 注意：不要用 core.version_string() —— 新版 VapourSynth 已经没有这个方法，
# 而 Core.__getattr__ 会把未知属性当成插件命名空间去查，抛 AttributeError。
print(f"VapourSynth : {getattr(vs, '__version__', '?')} "
      f"(API {getattr(vs, '__api_version__', '?')})")
print(f"Python      : {sys.version.split()[0]}")

# 源滤镜至少要有一个能用。compare.py 现在用的是 lsmas.LWLibavSource，
# 但 L-SMASH-Works 对新版 ffmpeg 兼容性一向拖后腿（当前系统是 libavcodec 62 /
# ffmpeg 8），bs (BestSource) 和 ffms2 是等价替代，且 bs 是现在推荐的选择。
SOURCE_FILTERS = ("lsmas", "bs", "ffms2")
OTHER = ("fpng", "libp2p", "placebo", "resize2",
         "akarin", "vivtc", "sub", "text")

print("\n源滤镜（至少要有一个）:")
have_source = [n for n in SOURCE_FILTERS if hasattr(core, n)]
for name in SOURCE_FILTERS:
    print(f"    {name:<10} {'OK' if name in have_source else 'MISSING'}")

print("\n其他插件:")
for name in OTHER:
    print(f"    {name:<10} {'OK' if hasattr(core, name) else 'MISSING'}")

print("\nPython 包:")
for mod in ("vstools", "vsutil", "vsjetpack", "vspreview", "awsmfunc"):
    try:
        m = __import__(mod)
        print(f"    {mod:<10} OK   {getattr(m, '__file__', '?')}")
    except Exception as exc:
        print(f"    {mod:<10} FAIL: {exc}")

# 模块能 import 不代表符号还在 —— PyPI 上 vstools/vsutil 已经缩水成几 KB 的壳，
# 真实现搬去了 vsjetpack，而 pip 的安装顺序可能让壳覆盖掉真模块。
# 这里直接跑 compare.py 第 1~4 行用到的 import。
print("\ncompare.py 需要的符号:")
for stmt in ("from vstools import vs, core",
             "from vspreview import set_output",
             "from awsmfunc import FrameInfo",
             "from awsmfunc.types.placebo import PlaceboColorSpace",
             "from awsmfunc.types.placebo import PlaceboGamutMapping"):
    try:
        exec(stmt, {})
        print(f"    OK    {stmt}")
    except Exception as exc:
        print(f"    FAIL  {stmt}")
        print(f"          -> {type(exc).__name__}: {exc}")

# vspreview 启动时真正走的 import 链 —— vsjetpack 版本漂移（2.x 的破坏性改名）
# 会在这里现形，别等到桌面上才发现。
#
# 必须开独立子进程：vspreview.main 在 import 时会注册 VapourSynth 的
# EnvironmentPolicy，而本进程上面已经碰过 vs.core（注册了默认 policy），
# 同进程再 import 会报 "There is already a policy registered" —— 那是假阳性，
# vspreview 真正启动时是全新进程，不会撞。
import subprocess

_stmt = "from vspreview.main import MainWindow"
_r = subprocess.run([sys.executable, "-c", _stmt], capture_output=True, text=True)
if _r.returncode == 0:
    print(f"    OK    {_stmt}   (独立进程)")
else:
    _last = (_r.stderr.strip().splitlines() or ["(无输出)"])[-1]
    print(f"    FAIL  {_stmt}")
    print(f"          -> {_last}")

if have_source:
    print(f"\n可用源滤镜: {', '.join(have_source)}")
    if "lsmas" not in have_source:
        alt = ("core.bs.VideoSource(path)" if "bs" in have_source
               else "core.ffms2.Source(path)")
        print("提示: lsmas 不可用，compare.py 里的")
        print("        core.lsmas.LWLibavSource(path)")
        print("      要改成")
        print(f"        {alt}")

missing_required = [] if have_source else list(SOURCE_FILTERS)

if missing_required:
    import glob
    import os
    import subprocess

    # .so 文件名跟命名空间往往对不上（lsmas <- liblsmashsource.so）
    ALIASES = {"lsmas": ("lsmash", "lsmas"), "bs": ("bestsource", "bs"),
               "sub": ("subtext", "sub"), "libp2p": ("p2p",)}

    dirs = [os.path.join(os.path.dirname(vs.__file__), "plugins"),
            "/usr/lib/vapoursynth", "/usr/vapoursynth",
            "/usr/local/lib/vapoursynth"]
    dirs += glob.glob("/usr/lib/python3*/site-packages/vapoursynth/plugins")
    dirs = [d for d in dict.fromkeys(dirs) if os.path.isdir(d)]

    print("\n" + "=" * 62)
    print("诊断：必需插件缺失 —— " + ", ".join(missing_required))
    print("=" * 62)

    for d in dirs:
        print(f"\n[{d}]")
        for f in sorted(os.listdir(d)):
            print(f"    {f}")

    for name in missing_required:
        keys = ALIASES.get(name, (name,))
        print(f"\n--- 手动加载 {name}（文件名关键字 {keys}）---")
        found = [p for d in dirs for p in glob.glob(os.path.join(d, "*.so"))
                 if any(k in os.path.basename(p).lower() for k in keys)]
        if not found:
            print("  插件目录里没有任何匹配的 .so —— 包没装上，或装到了扫不到的地方")
            continue
        for p in found:
            real = os.path.realpath(p)
            print(f"  {p}\n    -> {real}")
            try:
                core.std.LoadPlugin(path=real)
                print("    LoadPlugin 成功 —— 文件没问题，只是没被 autoload 扫到")
            except Exception as exc:
                print(f"    LoadPlugin 失败: {exc}")
            try:
                ldd = subprocess.run(["ldd", real], capture_output=True, text=True)
                bad = [l.strip() for l in ldd.stdout.splitlines() if "not found" in l]
                if bad:
                    print("    缺失的共享库:")
                    for l in bad:
                        print(f"      {l}")
            except Exception:
                pass

    raise SystemExit(
        f"\n没有任何可用的源滤镜（{', '.join(missing_required)} 全部缺失）—— 构建终止")
PY

    step "[python 4/4] 清理构建残留"
    userdel -r "$BUILDER" 2>/dev/null || true
    rm -f "/etc/sudoers.d/99-$BUILDER"
    pacman -Scc --noconfirm >/dev/null 2>&1 || true
    rm -rf /var/cache/pacman/pkg/* /root/.cache /tmp/* 2>/dev/null || true

    echo -e "\n\033[1;32m构建完成\033[0m"
}

case "${1:-all}" in
    system)  stage_system ;;
    plugins) stage_plugins ;;
    python)  stage_python ;;
    all)     stage_system; stage_plugins; stage_python ;;
    *)       echo "用法: $0 {system|plugins|python|all}" >&2; exit 2 ;;
esac
