# 分析图

```pip install soundfile numpy scipy matplotlib rich```

将文件/文件夹拖放到audio.bat会自动生成波形(waveforms),频谱(spectrograms),位深(bit_depth),频率响应(频率响应)，动态/振幅统计(Dynamics / Amplitude Statistics)文件图

对于振幅统计，需要安装[foobar2000](https://www.foobar2000.org/windows)和 [DR Meter](https://www.foobar2000.org/components/view/foo_dr_meter) 插件，并到foobar2000将Preferences->Advanced->Tools->DR Meter下开启Automatically save logs。把audio.bat的[第9行](https://github.com/akina-up/script/blob/master/PT/Audio/audio.bat#L9)设置为实际的foobar2000路径


# check_mono.bat
将文件/文件夹拖放到check_mono.bat，会自动反相音轨叠加生成频谱图，以方便检查是否是dual mono


# audio_delay.bat
拖入输入延迟参数 (例如 +178ms 或 -50ms)