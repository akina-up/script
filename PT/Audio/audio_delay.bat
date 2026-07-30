@echo off
chcp 65001 >nul

if "%~1"=="" (
    echo 请直接将音频文件拖拽到此脚本图标上。
    pause
    exit /b
)

echo 正在准备处理: %~nx1
set /p delay="请输入延迟参数 (例如 +178ms 或 -50ms): "

set "output_file=%~dp1%~n1_sync%~x1"

echo.
echo 准备执行: eac3to "%~1" "%output_file%" %delay%
eac3to "%~1" "%output_file%" %delay%

echo.
echo 处理完毕，按任意键退出...
pause >nul