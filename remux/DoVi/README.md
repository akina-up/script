# remuxdv

  > [!WARNING]
  > 只能用在linux使用

## 简介
从原盘用dgdemux demux原盘并启用合并DV功能，自动提取EL和合并后P7的RPU，比较info。并且提取剪辑帧比较

## 安装
需要先安装[DGDemux](https://www.videohelp.com/software/DGDemux)，同时建议替换其中[dovi_tool](https://github.com/quietvoid/dovi_tool)为最新版

安装脚本  
```wget -O /usr/local/bin/remuxdv https://raw.githubusercontent.com/akina-up/script/master/remux/DoVi/remuxdv && chmod +x /usr/local/bin/remuxdv```

修改脚本  
[L5](https://github.com/akina-up/script/blob/master/remux/DoVi/remuxdv#L5)设置为实际的DGDemux路径，[L6](https://github.com/akina-up/script/blob/master/remux/DoVi/remuxdv#L6)设置为实际的dovi_tool路径

## 使用

```remuxdv "盘路径，具体到主mpls" “保存路径/保存名称"```

如```remuxdv "/bcache/up/FAREWELL_MY_CONCUBINE_UHD-ANKO/BDMV/PLAYLIST/00004.mpls" "/bcache/Rouge/FAREWELL"```