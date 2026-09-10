# oracle-server-health.ps1 — Monitor do KDS: liveness (/health) + readiness (/ready).
# Uso: powershell -File oracle-server-health.ps1 [-Mode Both] [-TimeoutSec 12]
# Agendamento sugerido: Task Scheduler 3-4x/dia (monitor independente da VM).
# Alerta opcional: defina $env:KDS_ALERT_WEBHOOK (nunca comitar o valor).
# So alerta apos 2 falhas consecutivas (estado em .last-health.json no LogDir).
# Codigo de saida: 0 = tudo OK; 1 = falha.

param(
  [string]$BaseUrl = "",
  [ValidateSet("Liveness", "Readiness", "Both")][string]$Mode = "Both",
  [int]$TimeoutSec = 12,
  [string]$LogDir = "$PSScriptRoot\..\.opencode\stack-jobs\health"
)

$canonico = "https://kds-framboa.duckdns.org"
if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
  if (-not [string]::IsNullOrWhiteSpace($env:KDS_PUBLIC_URL)) { $BaseUrl = $env:KDS_PUBLIC_URL } else { $BaseUrl = $canonico }
}
$BaseUrl = $BaseUrl.TrimEnd("/")

function Test-Endpoint {
  param([string]$Url)
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
    $sw.Stop()
    return @{ ok = ($r.StatusCode -eq 200); code = $r.StatusCode; ms = [int]$sw.ElapsedMilliseconds; err = "" }
  } catch {
    $sw.Stop()
    $code = 0
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    return @{ ok = $false; code = $code; ms = [int]$sw.ElapsedMilliseconds; err = $_.Exception.Message }
  }
}

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }
# Retencao: um arquivo por dia, 30 dias (§6 da spec)
Get-ChildItem -Path $LogDir -Filter "health-*.log" -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force -ErrorAction SilentlyContinue

$resultados = @()
if ($Mode -in @("Liveness", "Both")) {
  $t = Test-Endpoint "$BaseUrl/health"
  $resultados += @{ nome = "liveness"; url = "$BaseUrl/health"; evento = "PROCESS_DOWN"; res = $t }
}
if ($Mode -in @("Readiness", "Both")) {
  $t = Test-Endpoint "$BaseUrl/ready"
  $resultados += @{ nome = "readiness"; url = "$BaseUrl/ready"; evento = "DB_DOWN"; res = $t }
}

$arquivo = Join-Path $LogDir ("health-{0:yyyy-MM-dd}.log" -f (Get-Date))
$falhou = $false
foreach ($r in $resultados) {
  $estado = if ($r.res.ok) { "OK" } else { "FAIL"; $falhou = $true }
  $linha = "[{0:yyyy-MM-dd HH:mm:ss}] {1} {2} http={3} {4}ms {5}" -f (Get-Date), $r.nome, $estado, $r.res.code, $r.res.ms, $r.res.err
  $linha | Tee-Object -FilePath $arquivo -Append | Out-Null
  Write-Output $linha
}

# Alerta so na 2a falha consecutiva (mesmo endpoint)
$estadoPath = Join-Path $LogDir ".last-health.json"
$anterior = @{}
if (Test-Path $estadoPath) {
  try {
    $j = Get-Content $estadoPath -Raw | ConvertFrom-Json
    foreach ($p in $j.PSObject.Properties) { $anterior[$p.Name] = [bool]$p.Value }
  } catch { $anterior = @{} }
}
$atual = @{}
foreach ($r in $resultados) {
  $chave = $r.nome
  $atual[$chave] = -not $r.res.ok
  $repetiu = (-not $r.res.ok) -and ($anterior[$chave] -eq $true)
  if ($repetiu -and -not [string]::IsNullOrWhiteSpace($env:KDS_ALERT_WEBHOOK)) {
    $corpo = @{ event = $r.evento; endpoint = $r.url; code = $r.res.code; at = (Get-Date).ToString("o") } | ConvertTo-Json
    try { Invoke-RestMethod -Uri $env:KDS_ALERT_WEBHOOK -Method Post -Body $corpo -ContentType "application/json" -TimeoutSec 10 | Out-Null } catch { Write-Output "webhook falhou: $($_.Exception.Message)" }
  }
  if ($repetiu) { Write-Output "ALERTA: $($r.evento) em $($r.url) (2a falha consecutiva)" }
}
$atual | ConvertTo-Json | Set-Content $estadoPath

if ($falhou) { exit 1 }
