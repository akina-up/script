#!/usr/bin/env bash
# 修复 LSIO webtop (Arch) 镜像里 nginx 起不来的问题。
#
# 镜像里的 fancyindex 模块经常和 nginx 对不上，nginx 直接 [emerg] 退出并被
# s6 无限重启。实测见过两种报错：
#   1) unknown directive "fancyindex" in /etc/nginx/conf.d/default.conf:42
#      （配置引用了指令，但模块没加载）
#   2) module ".../ngx_http_fancyindex_module.so" version 1030000
#      instead of 1030004 in /etc/nginx/modules.d/fancy.conf:1
#      （模块在，但是给旧版 nginx 编的 —— Arch 滚动更新的版本错位）
#
# webtop 的 3000/3001 是 nginx 顶在前面的，它一挂就没人应答。但宿主机端口
# 仍然被 docker-proxy 占着，`lsof` 看着一切正常 —— 极容易误判成防火墙问题。
#
# fancyindex 只影响 nginx 目录列表的外观，webtop 桌面完全用不到，
# 所以这里直接无条件禁用，不去纠结版本能不能对上。
#
# Fixes nginx failing to start in the LSIO webtop (Arch) image.
#
# The bundled fancyindex module frequently mismatches the installed nginx, so
# nginx exits with [emerg] and s6 restarts it forever. Two variants seen:
#   1) unknown directive "fancyindex" ...      (directive used, module absent)
#   2) module "...so" version 1030000 instead of 1030004 ...
#      (module present but built for an older nginx — Arch rolling skew)
#
# nginx fronts ports 3000/3001, so when it dies nothing answers — yet the host
# port still looks bound (docker-proxy holds it), which is easily mistaken for
# a firewall problem.
#
# fancyindex only affects the look of nginx directory listings, which webtop
# never uses, so this disables it unconditionally instead of trying to match
# versions.
#
# 本脚本被 COPY 到 /custom-cont-init.d/，LSIO 会在服务启动前执行它，
# 所以基础镜像日后再变，每次启动也会重新打上补丁。
# Copied into /custom-cont-init.d/ so LSIO runs it before services start —
# re-applied on every boot even if the base image changes again.
set -uo pipefail
shopt -s nullglob

patched=0

# 1) 先禁用模块声明。必须排在注释指令之前 —— 模块一旦不加载，
#    配置里残留的 fancyindex 指令就会变成 "unknown directive"。
#    Disable the module declaration first: once the module is gone, any
#    leftover fancyindex directive becomes an "unknown directive" error.
for m in /etc/nginx/modules.d/*fancy*.conf; do
    mv "$m" "$m.disabled" && echo "[fix-nginx] disabled module declaration $m"
    patched=1
done

# 2) 注释掉配置里的 fancyindex 指令
#    Comment out fancyindex directives in the configs
for conf in /etc/nginx/conf.d/*.conf /etc/nginx/nginx.conf /config/nginx/*.conf; do
    [ -f "$conf" ] || continue
    if grep -qE '^[[:space:]]*fancyindex' "$conf" 2>/dev/null; then
        sed -i 's/^\([[:space:]]*fancyindex.*\)$/#\1/' "$conf"
        echo "[fix-nginx] commented out fancyindex directives in $conf"
        patched=1
    fi
done

[ "$patched" -eq 1 ] || echo "[fix-nginx] nothing to patch"

# 3) 自检：配置到底能不能过。基础镜像哪天又换花样，这行会直接出现在
#    `docker logs` 里，不用再从「端口通但连不上」倒推。
#    Self-check: surface a bad config directly in `docker logs` instead of
#    having to work backwards from "port bound but nothing answers".
if command -v nginx >/dev/null 2>&1; then
    if out="$(nginx -t 2>&1)"; then
        echo "[fix-nginx] nginx -t OK"
    else
        echo "[fix-nginx] !! nginx 配置仍然有问题 / nginx config still broken:"
        echo "$out" | sed 's/^/[fix-nginx]    /'
    fi
fi

exit 0
