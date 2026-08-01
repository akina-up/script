#!/usr/bin/env bash
# builder 阶段（以 vsbuild 用户运行）：装 yay-bin，然后逐个装 VapourSynth 插件。
#
# 注意：这里刻意 **不用** `set -e` —— 单个插件装失败不应该炸掉整个镜像构建，
# 缺哪个由结尾的汇总列出来，必需插件由 build-vs.sh 的校验步骤兜底。
set -uo pipefail

export MAKEFLAGS="-j$(nproc)"

# Arch 现在把 VS 插件装在系统 python 的 site-packages 下（形如
# /usr/lib/python3.14/site-packages/vapoursynth/plugins），不是老的
# /usr/lib/vapoursynth。别写死，让 Python 自己报。
PLUGIN_DIR="$(python -c 'import os, vapoursynth; print(os.path.join(os.path.dirname(vapoursynth.__file__), "plugins"))' 2>/dev/null)"
[ -n "$PLUGIN_DIR" ] || PLUGIN_DIR=/usr/lib/vapoursynth

FAILED=()

log()  { echo "    $*"; }
head2() { echo -e "\n  \033[1;33m--- $* ---\033[0m"; }

# ---------------------------------------------------------------- yay-bin
head2 "安装 yay-bin"
if ! command -v yay >/dev/null 2>&1; then
    git clone --depth=1 https://aur.archlinux.org/yay-bin.git "$HOME/yay-bin" \
      && cd "$HOME/yay-bin" \
      && makepkg -si --noconfirm --needed \
      && cd "$HOME" \
      && rm -rf "$HOME/yay-bin"
fi
command -v yay >/dev/null 2>&1 || { echo "FATAL: yay 安装失败"; exit 1; }

# --------------------------------------------------------------- 安装函数
# 包里到底有没有 .so？
# 光靠 `pacman -Q` 判断成功是不够的：部分 AUR 包能「装成功」却一个文件都不产出
# （实测 vsakarin 打包时 meson 报 "Nothing to install."，Net Change 0.00 MiB，
# 但 pacman -Q 照样返回 0）。必须查文件清单，否则空包会被当成安装成功，
# 后面校验插件时才发现命名空间根本不存在。
pkg_has_so() {
    pacman -Ql "$1" 2>/dev/null | grep -qE '\.so$'
}

# install_one <展示名> <候选包名>...
# 依次尝试候选包名，先用 `yay -Si` 确认包存在（避免 yay 走进交互式搜索），
# 装完既要 `pacman -Q` 通过，也要包里确实有 .so。
install_one() {
    local label="$1"; shift
    local pkg

    for pkg in "$@"; do
        if pacman -Q "$pkg" >/dev/null 2>&1 && pkg_has_so "$pkg"; then
            log "OK   $label <= $pkg (已安装)"
            return 0
        fi
        if ! yay -Si "$pkg" >/dev/null 2>&1; then
            log "skip $label <= $pkg (仓库/AUR 中不存在)"
            continue
        fi

        log "try  $label <= $pkg"
        # 不用 --removemake：它装完会 pacman -Rsn 掉 makedepends，
        # 而部分 PKGBUILD 把运行时才需要的库（如 l-smash）错列在 makedepends 里，
        # 删掉之后 .so 还在但 dlopen 失败。
        yay -S --noconfirm --needed \
               --answerclean None --answerdiff None \
               --mflags "--nocheck" "$pkg"

        if ! pacman -Q "$pkg" >/dev/null 2>&1; then
            log "fail $label <= $pkg (构建或安装失败)"
            continue
        fi
        if ! pkg_has_so "$pkg"; then
            log "fail $label <= $pkg (空包：装上了但没有任何 .so)"
            continue
        fi

        log "OK   $label <= $pkg"
        pacman -Ql "$pkg" | grep -E '\.so$' | awk '{print "         " $2}'
        return 0
    done

    FAILED+=("$label")
    return 1
}

# ------------------------------------------------------------- 插件安装
head2 "源滤镜（compare.py 至少需要其中一个）"
install_one lsmas      vapoursynth-plugin-lsmashsource-git vapoursynth-plugin-lsmashsource \
                       vapoursynth-plugin-l-smash-works-git vapoursynth-plugin-lsmas-git
install_one bestsource vapoursynth-plugin-bestsource-git vapoursynth-plugin-bestsource
install_one ffms2      ffms2 vapoursynth-plugin-ffms2

head2 "处理 / 输出滤镜"
install_one fpng    vapoursynth-plugin-fpng-git vapoursynth-plugin-fpng
install_one libp2p  vapoursynth-plugin-libp2p-git vapoursynth-lib-libp2p-git vapoursynth-plugin-libp2p
install_one placebo vapoursynth-plugin-placebo-git vapoursynth-plugin-vsplacebo-git vapoursynth-plugin-placebo
install_one resize2 vapoursynth-plugin-resize2-git vapoursynth-plugin-resize2
install_one vivtc   vapoursynth-plugin-vivtc-git vapoursynth-plugin-vivtc

head2 "字幕（awsmfunc.FrameInfo 打帧号要用 core.sub）"
install_one subtext vapoursynth-plugin-subtext vapoursynth-plugin-subtext-git

# --------------------------------------------------------------- akarin
# akarin 链接 LLVM，AUR 的 PKGBUILD 默认可能走静态 LLVM（极慢且常 OOM），
# 所以 AUR 失败时手动 meson 构建并强制 -Dstatic-llvm=false。
head2 "akarin"
if ! install_one akarin vapoursynth-plugin-akarin-git vapoursynth-plugin-vsakarin-git; then
    log "AUR 安装失败，改为手动 meson 构建（动态链接系统 LLVM）"

    AK=/tmp/akarin-aur
    rm -rf "$AK"
    for repo in vapoursynth-plugin-akarin-git vapoursynth-plugin-vsakarin-git; do
        rm -rf "$AK"
        # 注意判据要看 PKGBUILD 在不在：AUR 上有的仓库是空的，
        # git clone 照样返回 0，直接 break 会拿到一个空目录。
        git clone --depth=1 "https://aur.archlinux.org/${repo}.git" "$AK" 2>/dev/null
        [ -f "$AK/PKGBUILD" ] && break
    done

    if [ -f "$AK/PKGBUILD" ]; then
        cd "$AK"
        # -o = 只下载并解包源码，不编译不打包
        makepkg -o --noconfirm --nodeps
        SRC="$(find "$AK/src" -maxdepth 1 -mindepth 1 -type d | head -n1)"
        if [ -n "${SRC:-}" ] && [ -f "$SRC/meson.build" ]; then
            cd "$SRC"
            meson setup build --wipe --buildtype=release -Dstatic-llvm=false \
              && ninja -C build \
              && sudo install -Dm755 build/libakarin.so "$PLUGIN_DIR/libakarin.so" \
              && log "OK   akarin <= 手动构建" \
              && FAILED=("${FAILED[@]/akarin}")
        else
            log "fail akarin：源码目录里没找到 meson.build"
        fi
        cd "$HOME"
        rm -rf "$AK"
    fi
fi

# ---------------------------------------------------------------- 汇总
echo
echo "  插件落地情况:"
for d in "$PLUGIN_DIR" /usr/lib/vapoursynth /usr/vapoursynth; do
    [ -d "$d" ] || continue
    echo "    [$d]"
    ls -1 "$d"/*.so 2>/dev/null | xargs -r -n1 basename | sed 's/^/      /' \
      || echo "      (空)"
done

# 去掉手动构建成功时留下的空串
CLEAN=()
for f in "${FAILED[@]:-}"; do [ -n "$f" ] && CLEAN+=("$f"); done

if [ ${#CLEAN[@]} -gt 0 ]; then
    echo -e "\n  \033[1;31m未能安装: ${CLEAN[*]}\033[0m"
else
    echo -e "\n  \033[1;32m全部插件安装成功\033[0m"
fi

exit 0
