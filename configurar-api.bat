@echo off
setlocal

set "APP_DIR=%~dp0"
cd /d "%APP_DIR%"

echo Configuracion de TheSportsDB
echo.
echo TheSportsDB usa la key gratuita 123 para v1.
echo La key se guardara solo en .env, que esta ignorado por Git.
echo.

set /p API_KEY= Escribe tu API key de TheSportsDB o presiona Enter para usar 123: 

if "%API_KEY%"=="" (
  set "API_KEY=123"
)

(
  echo PORT=3001
  echo.
  echo # TheSportsDB
  echo THESPORTSDB_KEY=%API_KEY%
  echo THESPORTSDB_BASE_URL=https://www.thesportsdb.com/api/v1/json
  echo THESPORTSDB_WORLD_CUP_LEAGUE_ID=4429
  echo THESPORTSDB_CHAMPIONS_LEAGUE_ID=4480
  echo THESPORTSDB_LIGA_MX_LEAGUE_ID=4350
  echo WORLD_CUP_SEASON=2026
  echo CHAMPIONS_SEASON=2025-2026
  echo LIGA_MX_SEASON=2025-2026
  echo COMPETITION_CACHE_MINUTES=180
) > ".env"

echo.
echo Listo. La app quedo configurada para consultar TheSportsDB.
echo Ahora ejecuta iniciar.bat y presiona "Actualizar datos" en la pagina.
echo.
pause

:end
endlocal
