@echo off
REM status-oracle.bat — Status da Oracle Cloud (instancias, jobs A1, rede)
REM Uso: scripts\status-oracle.bat
REM Requer: OCI CLI em "C:\Program Files (x86)\Oracle\oci_cli\oci.exe" e SUPPRESS_LABEL_WARNING
setlocal

set OCI=C:\Program Files (x86)\Oracle\oci_cli\oci.exe
set STACK=ocid1.ormstack.oc1.sa-saopaulo-1.amaaaaaahcnjvwia3bbznzaw4bbdr5fywlijkchoaiftf2ey6z4jqdxwlbca
set TENANCY=ocid1.tenancy.oc1..aaaaaaaalpz2wnl4qclpvrftejule6zzleql5km7tiy7mwbqgnvwehgmbtmq

echo === Oracle Cloud — Status ===
echo.

echo [1/4] Tarefas agendadas (A1 retry a cada 15 min)
schtasks /query /tn "KDS-Deploy-Retry" /fo LIST /v | findstr /C:"TaskName" /C:"Status" /C:"Last Run" /C:"Next Run"
schtasks /query /tn "KDS-Deploy-AMD-Retry" /fo LIST /v | findstr /C:"TaskName" /C:"Status"
echo.

echo [2/4] Jobs do stack A1 (ultimos 3)
set SUPPRESS_LABEL_WARNING=True
"%OCI%" resource-manager job list --stack-id %STACK% 2>NUL | python -c "import json,sys; d=json.load(sys.stdin)['data']; d=sorted(d,key=lambda x: x['time-created'], reverse=True)[:3]; [print(f\"{x['display-name']:30} {x['lifecycle-state']:12} {x['time-created']}\") for x in d]" 2>NUL
echo  (FAILED=sem capacidade, SUCCEEDED=liberou!)

echo.
echo [3/4] Instancias
"%OCI%" compute instance list --compartment-id %TENANCY% 2>NUL | python -c "import json,sys; d=json.load(sys.stdin)['data']; [print(f\"{x['display-name']:20} {x['lifecycle-state']:10} {x['shape']:22} {x['time-created']}\") for x in d]" 2>NUL
echo.

echo [4/4] VNIC/IP da AMD
"%OCI%" compute instance list-vnics --instance-id ocid1.instance.oc1.sa-saopaulo-1.antxeljrhcnjvwiclojbnjxjb3sezqfx3ogqfchtpa2o6odz5ls7oxmbuqnq 2>NUL | python -c "import json,sys; d=json.load(sys.stdin)['data'][0]; print(f\"public-ip: {d['public-ip']}\"); print(f\"private: {d['private-ip']}\"); print(f\"ipv6: {d['ipv6-addresses']}\"); print(f\"subnet: {d['subnet-id'][:50]}...\")" 2>NUL

echo.
echo [5/5] Como interpretar
echo   RUNNING + IP igual ao DNS  = plataforma OK; se pagina cai, ver app/banco/TLS (runbook: /ready).
echo   RUNNING + IP diferente     = DuckDNS desatualizado; rode scripts\duckdns-update.bat e confira Caddy.
echo   STOPPED                    = iniciar pela console OCI e investigar causa (ociosidade/cobranca).
echo   TERMINATED                 = seguir runbook de recriacao (setup-instance.sh + compose + DuckDNS).
echo.
pause
