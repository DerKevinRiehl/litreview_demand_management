@echo off
setlocal
python "%~dp0global_atlas_page\scripts\run_local.py" %*
if errorlevel 1 (
    echo.
    echo Atlas could not start. Please read the error above.
    pause
    exit /b 1
)
