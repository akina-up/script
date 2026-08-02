import os

from vstools import vs, core
from vspreview import set_output
from awsmfunc import FrameInfo
from awsmfunc.types.placebo import PlaceboColorSpace as ColorSpace
from awsmfunc.types.placebo import PlaceboGamutMapping as Gamut

# 片源目录 /comp 通常对容器用户只读，而 lsmas 默认要在片子旁边写 .lwi 索引，
# 会直接报 "failed to construct index"。统一重定向到 /config —— 桌面用户的
# HOME，可写，且映射到宿主机，容器重建后索引还在，同一个片子第二次秒开。
#
# The media directory /comp is usually read-only for the container user, while
# lsmas writes its .lwi index next to the source file by default — that fails
# with "failed to construct index". Redirect it to /config instead: the desktop
# user's HOME, writable, and persisted on the host, so indexes survive a
# container rebuild and reopening the same file is instant.
CACHE_DIR = "/config/lwi"
os.makedirs(CACHE_DIR, exist_ok=True)


def src(path):
    """打开视频，索引写到 CACHE_DIR 而不是片子旁边。

    Open a video, writing the index to CACHE_DIR instead of next to the source.
    """
    try:
        return core.lsmas.LWLibavSource(path, cachedir=CACHE_DIR)
    except vs.Error:
        # 老版本 L-SMASH Works 没有 cachedir，只有 cachefile（完整路径）
        # Older L-SMASH Works has no cachedir, only cachefile (a full path)
        cachefile = os.path.join(CACHE_DIR, os.path.basename(path) + ".lwi")
        return core.lsmas.LWLibavSource(path, cachefile=cachefile)


## 片源路径 —— 每次比对只改这两行。相对路径，先 cd 到片子所在目录
## File paths — the only two lines you change per comparison.
## Relative paths, so cd into the directory holding the files first.
clip1 = src(r'1.mkv')
clip2 = src(r'C2.mkv')

## 来源名称 —— 显示在画面左上角的标签
## Source labels — drawn in the top-left corner of each frame
source1 = "4 527 kb/s"
source2 = "7 529 kb/s"

## 对齐帧偏移：丢掉 clip2 开头的 1 帧
## Align frame offset: drop the first frame of clip2
clip2 = clip2[1:]

## 下面这些按需去掉注释 / Uncomment the ones you need:

## 伽马校正（只作用于亮度平面）/ Gamma correction (luma plane only)
##clip2 = core.std.Levels(clip2, gamma=0.88, planes=0)

## 强制帧率，用于两边帧率不同时对齐 / Force fps when the two sources differ
##clip1 = core.std.AssumeFPS(clip1, fpsnum=24000, fpsden=1001)
##clip2 = core.std.AssumeFPS(clip2, fpsnum=30000, fpsden=1001)

## 裁掉上下黑边 / Crop the black bars
#clip1 = core.std.Crop(clip1, left=0, right=0, top=140, bottom=140)
#clip2 = core.std.Crop(clip2, left=0, right=0, top=140, bottom=140)

## 在画面上叠加帧号、帧类型和来源名 / Overlay frame number, picture type and label
clip1 = FrameInfo(clip1, source1)
clip2 = FrameInfo(clip2, source2)

## 输出到 vspreview，可在预览窗口里用数字键切换
## Send to vspreview; switch between outputs with the number keys
set_output(clip1, name=source1)
set_output(clip2, name=source2)
