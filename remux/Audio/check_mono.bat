@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

if "%~1"=="" (
    echo 请将文件或文件夹拖拽到此脚本上。
    pause
    exit /b
)

for %%A in (%*) do (
    if exist "%%~A\" (
        for %%F in ("%%~A\*.flac") do (
            call :ProcessFile "%%~F"
        )
    ) else (
        if /I "%%~xA"==".flac" (
            call :ProcessFile "%%~A"
        )
    )
)

echo 全部处理完成！
pause
exit /b

:ProcessFile
set "FILE=%~1"
set "BASENAME=%~dpn1"
echo.
echo 正在处理: !FILE!
sox "!FILE!" -n remix 1,2v-1 spectrogram -x 10000 -y 1025 -z 120 -o "!BASENAME!_mono.png" -c "Dual.Mono"
goto :EOF