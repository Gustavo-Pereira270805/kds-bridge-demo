@echo off
REM check-health.bat — Checagem rapida do KDS Bridge (sem SSH)
REM Uso: duplo clique ou scripts\check-health.bat
REM Env: KDS_PUBLIC_URL (padrao https://kds-framboa.duckdns.org), KDS_DIRECT_IP (opcional, sem padrao)
setlocal

if "%KDS_PUBLIC_URL%"=="" set "KDS_PUBLIC_URL=https://kds-framboa.duckdns.org"
set FALHOU=0

echo === KDS Bridge — Health Check ===
echo Data: %date% %time%
echo Base: %KDS_PUBLIC_URL%
echo.

echo [1/5] DNS (dominio canonico)
for /f "tokens=2 delims=:" %%H in ("%KDS_PUBLIC_URL%") do set HOST=%%H
set HOST=%HOST://=%
for /f "tokens=1 delims=/" %%H in ("%HOST%") do set HOST=%%H
nslookup %HOST% 8.8.8.8 | findstr "Address"
echo.

echo [2/5] Liveness %KDS_PUBLIC_URL%/health
curl.exe -s -o NUL -w "HTTP: %%{http_code} Time: %%{time_total}s\n" %KDS_PUBLIC_URL%/health
if errorlevel 1 set FALHOU=1
echo.

echo [3/5] Readiness %KDS_PUBLIC_URL%/ready
curl.exe -s %KDS_PUBLIC_URL%/ready
echo.
curl.exe -s -o NUL -w "HTTP: %%{http_code} Time: %%{time_total}s\n" %KDS_PUBLIC_URL%/ready
echo.

echo [4/5] HTTP direto por IP (somente se KDS_DIRECT_IP definido)
if "%KDS_DIRECT_IP%"=="" (
  echo   pulado - defina KDS_DIRECT_IP para checar direto por IP
) else (
  curl.exe -s -o NUL -w "HTTP: %%{http_code}\n" http://%KDS_DIRECT_IP%/health
)
echo.

echo [5/5] Paginas
for %%P in (login salao cozinha-quente cozinha-fria) do (
  curl.exe -s -o NUL -w "  %%P: %%{http_code}\n" %KDS_PUBLIC_URL%/%%P
)

echo.
if "%FALHOU%"=="1" (
  echo RESULTADO: FALHA — rode scripts\logs-kds.bat e consulte o runbook na spec de monitoramento.
) else (
  echo RESULTADO: OK aparente. /ready 200 = app + banco acessiveis.
)
pause
exit /b %FALHOU%
