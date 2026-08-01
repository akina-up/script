import os

from vstools import vs, core
from vspreview import set_output
from awsmfunc import FrameInfo
from awsmfunc.types.placebo import PlaceboColorSpace as ColorSpace
from awsmfunc.types.placebo import PlaceboGamutMapping as Gamut

# /comp（宿主机 /mnt/downloads）目录不可写，lsmas 默认要在片子旁边写 .lwi 索引
# 会失败。统一重定向到 /config —— abc 的 HOME，可写，且映射到宿主机
# /mnt/docker/comp/config，容器重建也不丢，索引能复用。
CACHE_DIR = "/config/lwi"
os.makedirs(CACHE_DIR, exist_ok=True)


def src(path):
    """打开视频，索引写到 CACHE_DIR 而不是片子旁边。"""
    try:
        return core.lsmas.LWLibavSource(path, cachedir=CACHE_DIR)
    except vs.Error:
        # 老版本 L-SMASH Works 没有 cachedir，只有 cachefile（完整路径）
        cachefile = os.path.join(CACHE_DIR, os.path.basename(path) + ".lwi")
        return core.lsmas.LWLibavSource(path, cachefile=cachefile)


## File paths —— 每次比对改这两行
clip1 = src(r'1.mkv')
clip2 = src(r'C2.mkv')

## Source: 来源名称
source1 = "4 527 kb/s"
source2 = "7 529 kb/s"
clip2 = clip2[1:]
##clip2 = core.std.Levels(clip2, gamma=0.88, planes=0)
##clip1 = core.std.AssumeFPS(clip1, fpsnum=24000, fpsden=1001)
##clip2 = core.std.AssumeFPS(clip2, fpsnum=30000, fpsden=1001)
#clip1 = core.std.Crop(clip1, left=0, right=0, top=140, bottom=140)
#clip2 = core.std.Crop(clip2, left=0, right=0, top=140, bottom=140)
clip1 = FrameInfo(clip1, source1)
clip2 = FrameInfo(clip2, source2)

set_output(clip1, name=source1)
set_output(clip2, name=source2)
