#!/bin/sh

# HDBits API 凭据：请在部署的脚本副本中填入已重置后的值。
HDB_USERNAME=""
HDB_PASSKEY=""

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

# HDBits API 返回的字段中，IMDb 和 TVDB 都是对象，exclusive 对应
# type_exclusive（0 为 Non-exclusive，1 为 Exclusive）。凭据由文件顶部的
# HDB_USERNAME、HDB_PASSKEY 固定配置提供。
if [ "$TAG" = "#hdb" ]; then
    HDB_TORRENT_ID=$(printf '%s\n' "$INFO_URL" | sed -n 's/.*[?&]id=\([0-9][0-9]*\).*/\1/p')

    if [ -z "$HDB_USERNAME" ] || [ -z "$HDB_PASSKEY" ]; then
        echo "#hdb requires HDB_USERNAME and HDB_PASSKEY to be configured in this script" >&2
    elif [ -z "$HDB_TORRENT_ID" ]; then
        echo "Unable to extract the HDBits torrent ID from: $INFO_URL" >&2
    else
        # HDB 用户名和 passkey 通常为普通文本；转义反斜杠和双引号以生成有效 JSON。
        HDB_USERNAME_JSON=$(printf '%s' "$HDB_USERNAME" | sed 's/\\/\\\\/g; s/"/\\"/g')
        HDB_PASSKEY_JSON=$(printf '%s' "$HDB_PASSKEY" | sed 's/\\/\\\\/g; s/"/\\"/g')
        HDB_RESPONSE=$(curl -sS --fail -X POST "https://hdbits.org/api/torrents" \
            -H "Content-Type: application/json" \
            --data "{\"username\":\"${HDB_USERNAME_JSON}\",\"passkey\":\"${HDB_PASSKEY_JSON}\",\"id\":${HDB_TORRENT_ID}}")

        if [ $? -ne 0 ] || [ -z "$HDB_RESPONSE" ]; then
            echo "HDBits API request failed for torrent ID $HDB_TORRENT_ID" >&2
        else
            HDB_JSON=$(printf '%s' "$HDB_RESPONSE" | tr -d '\r\n')
            HDB_API_STATUS=$(printf '%s' "$HDB_JSON" | sed -n 's/.*"status"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p')

            if [ "$HDB_API_STATUS" = "0" ]; then
                IMDB_ID=$(printf '%s' "$HDB_JSON" | sed -n 's/.*"imdb"[[:space:]]*:[[:space:]]*{[[:space:]]*"id"[[:space:]]*:[[:space:]]*"\{0,1\}\([0-9][0-9]*\).*/\1/p')
                HDB_TVDB_ID=$(printf '%s' "$HDB_JSON" | sed -n 's/.*"tvdb"[[:space:]]*:[[:space:]]*{[[:space:]]*"id"[[:space:]]*:[[:space:]]*"\{0,1\}\([0-9][0-9]*\).*/\1/p')
                HDB_EXCLUSIVE=$(printf '%s' "$HDB_JSON" | sed -n 's/.*"type_exclusive"[[:space:]]*:[[:space:]]*\([01]\).*/\1/p')

                # HDB 的 imdb.id 与传入的 IMDB_ID 语义相同，统一使用 IMDB_ID。
                if [ -n "$IMDB_ID" ]; then
                    IMDB_ID="tt$(printf '%07d' "$IMDB_ID")"
                fi
            else
                echo "HDBits API returned status ${HDB_API_STATUS:-unknown} for torrent ID $HDB_TORRENT_ID" >&2
            fi
        fi
    fi
fi

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

# #hdb 时以 API 返回的数据补充媒体信息；查不到某个字段时不输出该字段。
if [ "$TAG" = "#hdb" ]; then
    if [ "$HDB_EXCLUSIVE" = "1" ]; then
        MESSAGE="${MESSAGE}
<b>Exclusive：</b>Yes"
    fi
fi

# 将媒体链接构建为 Telegram Inline Keyboard。IMDb 存在时同时提供豆瓣搜索。
INLINE_BUTTONS=""
if [ -n "$IMDB_ID" ]; then
    INLINE_BUTTONS="{\"text\":\"IMDb\",\"url\":\"https://www.imdb.com/title/${IMDB_ID}/\"},{\"text\":\"豆瓣\",\"url\":\"https://search.douban.com/movie/subject_search?search_text=${IMDB_ID}\"},{\"text\":\"Blu-ray\",\"url\":\"https://www.blu-ray.com/search/?quicksearch=1&quicksearch_keyword=${IMDB_ID}&section=theatrical\"}"
fi

if [ -n "$HDB_TVDB_ID" ]; then
    if [ -n "$INLINE_BUTTONS" ]; then
        INLINE_BUTTONS="${INLINE_BUTTONS},"
    fi
    INLINE_BUTTONS="${INLINE_BUTTONS}{\"text\":\"TVDB\",\"url\":\"https://www.thetvdb.com/?tab=series&id=${HDB_TVDB_ID}\"}"
fi

if [ -n "$INLINE_BUTTONS" ]; then
    REPLY_MARKUP="{\"inline_keyboard\":[[${INLINE_BUTTONS}]]}"
fi

# 将分号替换为空格以便在for循环中遍历
TOKENS=$(echo "$BOT_TOKENS" | tr ';' ' ')
CHATS=$(echo "$CHAT_IDS" | tr ';' ' ')

# 遍历所有的 Token 和 Chat ID 组合进行并发推送
for TOKEN in $TOKENS; do
    for CHAT in $CHATS; do
        if [ -n "$REPLY_MARKUP" ]; then
            curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
                --data-urlencode "chat_id=${CHAT}" \
                --data-urlencode "text=${MESSAGE}" \
                --data-urlencode "parse_mode=HTML" \
                --data-urlencode "link_preview_options={\"is_disabled\":true}" \
                --data-urlencode "reply_markup=${REPLY_MARKUP}" > /dev/null &
        else
            curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
                --data-urlencode "chat_id=${CHAT}" \
                --data-urlencode "text=${MESSAGE}" \
                --data-urlencode "parse_mode=HTML" \
                --data-urlencode "link_preview_options={\"is_disabled\":true}" > /dev/null &
        fi
    done
done

# 等待所有并发的curl任务完成
wait
echo "All messages dispatched!"
