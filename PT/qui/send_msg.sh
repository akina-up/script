#!/bin/bash

BOT_TOKEN=$1
CHANNEL_ID=$2
NAME=$3
# 使用 awk 处理小数乘法，确保 0.92 能变成 92
progress_fixed=$(awk "BEGIN {print $4 * 100}")

CURRENT_TIME=$(date "+%Y-%m-%d %H:%M:%S")
MESSAGE="即将完成%0A时间：${CURRENT_TIME}%0A名称：${NAME}%0A进度：${progress_fixed}%"

curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -d chat_id="${CHANNEL_ID}" \
    -d text="${MESSAGE}"