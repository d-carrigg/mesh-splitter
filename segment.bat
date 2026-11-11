@echo off
cd /d "%~dp0"
where uv >NUL 2>&1 || (echo uv not found. Install: https://docs.astral.sh/uv/getting-started/installation/ & pause & exit /b 1)
uv run splitter
