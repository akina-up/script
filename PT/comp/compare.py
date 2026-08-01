from vstools import vs, core, set_output
from awsmfunc import FrameInfo
from awsmfunc.types.placebo import PlaceboColorSpace as ColorSpace
from awsmfunc.types.placebo import PlaceboGamutMapping as Gamut

## File paths
clip1 = core.lsmas.LWLibavSource(r'1.mkv')
clip2 = core.lsmas.LWLibavSource(r"C2.mkv")

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
