#!/usr/bin/env bash
# 修复 LSIO webtop (Arch) 镜像里 nginx 起不来的问题。
#
# 镜像自带的 nginx 配置引用了 fancyindex 指令，但对应模块没装/没加载，
# nginx 直接 [emerg] 退出并被 s6 无限重启：
#     [emerg] unknown directive "fancyindex" in /etc/nginx/conf.d/default.conf:42
# webtop 的 3000/3001 是 nginx 在前面顶着的，它挂了就没人应答 —— 表现为
# 宿主机端口被 docker-proxy 占着、外面却连不上（TLS handshake 直接失败），
# 很容易误判成防火墙问题。
#
# Fixes nginx failing to start in the LSIO webtop (Arch) image.
#
# The bundled nginx config uses fancyindex directives while the module is not
# installed/loaded, so nginx exits with [emerg] and s6 restarts it forever:
#     [emerg] unknown directive "fancyindex" in /etc/nginx/conf.d/default.conf:42
# nginx fronts ports 3000/3001, so when it dies nothing answers — the host port
# still looks bound (docker-proxy holds it) while connections fail the TLS
# handshake, which is easily mistaken for a firewall problem.
#
# 本脚本被 COPY 到 /custom-cont-init.d/，LSIO 会在服务启动前执行它，
# 所以即使基础镜像日后重新生成配置，每次启动都会重新打上补丁。
# Copied into /custom-cont-init.d/ so LSIO runs it before services start —
# the patch is re-applied on every boot even if the base image regenerates
# its config.
set -uo pipefail

patched=0

# 1) 注释掉 fancyindex 指令（webtop 用不到目录美化列表）
#    Comment out fancyindex directives (webtop has no use for pretty listings)
for conf in /etc/nginx/conf.d/*.conf /etc/nginx/nginx.conf /config/nginx/*.conf; do
    [ -f "$conf" ] || continue
    if grep -qE '^[[:space:]]*fancyindex' "$conf" 2>/dev/null; then
        sed -i 's/^\([[:space:]]*fancyindex.*\)$/#\1/' "$conf"
        echo "[fix-nginx] commented out fancyindex in $conf"
        patched=1
    fi
done

# 2) 模块声明指向的 .so 不存在时，禁用该声明
#    nginx 在 load_module 阶段就会失败，比上面那步更早
#    Disable a module declaration whose .so is missing — nginx fails at
#    load_module, even earlier than the directive above
shopt -s nullglob
for m in /etc/nginx/modules.d/*fancy*.conf; do
    so="$(grep -oE '[^"[:space:]]+\.so' "$m" 2>/dev/null | head -n1)"
    if [ -n "${so:-}" ] && [ ! -f "$so" ]; then
        mv "$m" "$m.disabled"
        echo "[fix-nginx] disabled $m (module $so not found)"
        patched=1
    fi
done
shopt -u nullglob

[ "$patched" -eq 1 ] || echo "[fix-nginx] nothing to patch"
exit 0
