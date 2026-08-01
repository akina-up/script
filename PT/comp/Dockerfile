# syntax=docker/dockerfile:1
#
# VapourSynth 比对环境 —— 基于 linuxserver webtop (Arch + KDE)
#
# 设计要点：
#   1. VapourSynth 用 pacman 的系统版（不是 pip 版），AUR 插件装进系统插件目录，
#      再按 venv 里 vapoursynth 模块的实际路径软链过去。
#   2. Python 包装进 /opt/vsenv（venv 带 --system-site-packages）。
#   3. AUR 编译用独立的 vsbuild 用户（makepkg 禁止 root 运行），
#      构建完连用户带 sudoers 规则一起删掉。
#   4. 拆成 3 个 RUN 层：某层失败重试时，前面成功的层走 Docker 缓存。
#   5. 脚本放 /opt/vsbuild 而不是 /tmp —— 各层内部会 `rm -rf /tmp/*` 清缓存，
#      放 /tmp 会把脚本自己删掉，下一层就找不到了。
#
FROM lscr.io/linuxserver/webtop:arch-kde

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV VSENV=/opt/vsenv
ENV PATH="/opt/vsenv/bin:${PATH}"

COPY build-vs.sh /opt/vsbuild/
RUN chmod +x /opt/vsbuild/build-vs.sh

# --- 层 1：keyring + 系统包 + 构建用户（约 50 秒） ---
RUN /opt/vsbuild/build-vs.sh system

# --- 层 2：AUR 插件编译（约 2 分钟） ---
# build-aur.sh 单独 COPY：只改插件列表时，层 1 仍走缓存。
COPY build-aur.sh /opt/vsbuild/
RUN chmod +x /opt/vsbuild/build-aur.sh && /opt/vsbuild/build-vs.sh plugins

# --- 层 3：venv + pip + 软链插件 + 校验 + 清理（约 1 分钟） ---
RUN /opt/vsbuild/build-vs.sh python \
 && rm -rf /opt/vsbuild

# ENTRYPOINT / CMD 继承自 linuxserver 基础镜像（/init），不要覆盖。
