@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "DR_TIMEOUT_SECONDS=1800"

:: If auto-detection fails, uncomment the next line and set the full path.
 set "FOOBAR_EXE=C:\tools\foobar2000\foobar2000.exe"

if "%~1"=="" (
    echo Drag one or more FLAC files or folders onto this script.
    pause
    exit /b
)

:: Find foobar2000. FOOBAR_EXE can also be set before running this script.
if not defined FOOBAR_EXE if exist "%ProgramFiles%\foobar2000\foobar2000.exe" set "FOOBAR_EXE=%ProgramFiles%\foobar2000\foobar2000.exe"
if not defined FOOBAR_EXE if exist "%ProgramFiles(x86)%\foobar2000\foobar2000.exe" set "FOOBAR_EXE=%ProgramFiles(x86)%\foobar2000\foobar2000.exe"
for /f "delims=" %%P in ('where.exe foobar2000.exe 2^>nul') do if not defined FOOBAR_EXE set "FOOBAR_EXE=%%P"

if not defined FOOBAR_EXE (
    echo Could not find foobar2000.exe.
    echo Set FOOBAR_EXE near the top of audio.bat and try again.
    pause
    exit /b 1
)

if not exist "!FOOBAR_EXE!" (
    echo Invalid foobar2000.exe path: !FOOBAR_EXE!
    pause
    exit /b 1
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

echo All processing completed.
pause
exit /b

:ProcessFile
set "FILE=%~1"
set "BASENAME=%~dpn1"
set "FILENAME=%~n1"
set "FILEPATH=%~dp1"
set "OUTPUTNAME=!FILENAME:audio_=!"
echo.
echo Processing: !FILE!
python "!SCRIPT_DIR!gen_waveforms.py" -i "!FILE!" -o "!BASENAME!_waveforms.png"
python "!SCRIPT_DIR!compute_bit_depth.py" -i "!FILE!" -o "!BASENAME!_bit_depth.png"
python "!SCRIPT_DIR!plotfreq.py" "!FILE!" -o "!BASENAME!_freq_response.png"
sox.exe "!FILE!" -S -n spectrogram -x 4000 -y 513 -z 120 -w Kaiser -t "!OUTPUTNAME!" -o "!FILEPATH!!OUTPUTNAME!_spectrogram.png"
(
    echo !FILENAME!
    echo.
) > "!BASENAME!.txt"
sox.exe "!FILE!" -n stats >> "!BASENAME!.txt" 2>&1

echo.
echo Measuring dynamic range with foobar2000 DR Meter...
echo If automatic log writing is disabled, write the log from the result window.

set "DR_START_FILETIME="
for /f "delims=" %%T in ('powershell.exe -NoProfile -Command "[DateTime]::UtcNow.ToFileTimeUtc()"') do set "DR_START_FILETIME=%%T"

if not defined DR_START_FILETIME (
    echo Could not get the start time. Skipping the DR Meter log.
    goto :EOF
)

start "" "!FOOBAR_EXE!" /show "/context_command:Measure Dynamic Range" "!FILE!"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "!SCRIPT_DIR!append_dr_meter.ps1" -Directory "!FILEPATH!." -TargetPath "!BASENAME!.txt" -StartFileTimeUtc !DR_START_FILETIME! -TimeoutSeconds !DR_TIMEOUT_SECONDS!
if errorlevel 1 (
    echo Failed to append the DR Meter result: !FILE!
) else (
    echo DR Meter result appended to: !BASENAME!.txt
)

echo Rendering the text report as a PNG...
python "!SCRIPT_DIR!txt2png.py" "!BASENAME!.txt" -o "!BASENAME!_dr_stats.png"
if errorlevel 1 (
    echo Failed to render the text report: !BASENAME!.txt
) else (
    echo Text report image created: !BASENAME!_dr_stats.png
)
goto 