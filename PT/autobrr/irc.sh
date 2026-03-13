#!/bin/sh

# 检查参数数量，最少需要8个参数，第9个IMDb是可选的
if [ $# -lt 8 ]; then
    echo "Usage: $0 BOT_TOKENS CHAT_IDS #xxx IndexerName CombinedName Size InfoUrl Publisher [ImdbId]"
    exit 1
fi

# 获取基础配置并立即用双引号锁定，防止单词拆分
BOT_TOKENS="$1"
CHAT_IDS="$2"
TAG="$3"
SITE_NAME="$4"
# 对种子名称进行 HTML 转义处理
TORRENT_NAME=$(echo "$5" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')
SIZE_RAW="$6"
INFO_URL="$7"
PUBLISHER="$8"
IMDB_ID="$9"

# 生成当前时间
CURRENT_TIME=$(date +"%Y-%m-%d %H:%M:%S")

# 转换字节为GB，使用 printf 确保格式统一
SIZE_GB=$(echo "$SIZE_RAW" | awk '{ printf "%.2f GB", $1 / 1024 / 1024 / 1024 }')

# 构建基础消息内容
MESSAGE="${TAG}
<b>当前站点：</b>${SITE_NAME}
<b>获取时间：</b>${CURRENT_TIME}"

# 判断发布者是否为空并动态拼接
if [ -n "$PUBLISHER" ]; then
    MESSAGE="${MESSAGE}
<b>发布者：</b>${PUBLISHER}"
fi

# 追加必填的剩余消息内容
MESSAGE="${MESSAGE}
<b>种子名称：</b>${TORRENT_NAME}
<b>种子大小：</b>${SIZE_GB}
<b>种子地址：</b>${INFO_URL}"

# 判断 IMDb 是否为空并动态拼接
if [ -n "$IMDB_ID" ]; then
    MESSAGE="${MESSAGE}
<b>IMDb：</b>https://www.imdb.com/title/${IMDB_ID}"
fi

# 将分号替换为空格以便在for循环中遍历
TOKENS=$(echo "$BOT_TOKENS" | tr ';' ' ')
CHATS=$(echo "$CHAT_IDS" | tr ';' ' ')

# 遍历所有的 Token 和 Chat ID 组合进行并发推送
for TOKEN in $TOKENS; do
    for CHAT in $CHATS; do
        curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
            --data-urlencode "chat_id=${CHAT}" \
            --data-urlencode "text=${MESSAGE}" \
            --data-urlencode "parse_mode=HTML" > /dev/null &
    done
done

# 等待所有并发的curl任务完成
wait
echo "All messages dispatched!"