@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"

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
set "FILENAME=%~n1"
set "FILEPATH=%~dp1"
set "OUTPUTNAME=!FILENAME:audio_=!"
echo.
echo 正在处理: !FILE!
python "!SCRIPT_DIR!gen_waveforms.py" -i "!FILE!" -o "!BASENAME!_waveforms.png"
python "!SCRIPT_DIR!compute_bit_depth.py" -i "!FILE!" -o "!BASENAME!_bit_depth.png"
python "!SCRIPT_DIR!plotfreq.py" "!FILE!" -o "!BASENAME!_freq_response.png"
sox.exe "!FILE!" -S -n spectrogram -x 4000 -y 513 -z 120 -w Kaiser -t "!OUTPUTNAME!" -o "!FILEPATH!!OUTPUTNAME!_spectrogram.png"
(
    echo !FILENAME!
    echo.
) > "!BASENAME!.txt"
sox.exe "!FILE!" -n stats >> "!BASENAME!.txt" 2>&1
goto :EOF
