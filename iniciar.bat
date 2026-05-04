@echo off
setlocal

set "APP_DIR=%~dp0"
cd /d "%APP_DIR%"

if "%PORT%"=="" set "PORT=3001"
set "APP_URL=http://localhost:%PORT%"

if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
  )
)

where node >nul 2>nul
if %errorlevel%==0 (
  start "" "%APP_URL%"
  node server.js
  goto :end
)

set "CODEX_NODE=%LOCALAPPDATA%\OpenAI\Codex\bin\node.exe"
if exist "%CODEX_NODE%" (
  start "" "%APP_URL%"
  "%CODEX_NODE%" server.js
  goto :end
)

set "RUNTIME_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%RUNTIME_NODE%" (
  start "" "%APP_URL%"
  "%RUNTIME_NODE%" server.js
  goto :end
)

echo No se encontro Node.js en Windows.
echo Instala Node.js desde https://nodejs.org/ y vuelve a ejecutar este archivo.
echo.
pause

:end
endlocal
