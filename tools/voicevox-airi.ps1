[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Command = 'help',
  [string]$Filter = '',
  [string]$Text = '',
  [string]$AiriRoot = '',
  [string]$VoicevoxRun = '',
  [switch]$NoAiri
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptRoot = Split-Path -Parent $PSCommandPath
$AppRoot = Split-Path -Parent $ScriptRoot

$BridgeScript = Join-Path $ScriptRoot 'voicevox-openai-bridge.mjs'
$BridgePort = 55221
$EnginePort = 50021
$BridgeBaseUrl = "http://127.0.0.1:$BridgePort"
$EngineBaseUrl = "http://127.0.0.1:$EnginePort"
$BridgeLogPath = Join-Path $AppRoot 'voicevox-bridge.log'
$TranslationsPath = Join-Path $AppRoot 'data\voicevox-translations.tr.json'
$PhrasesPath = Join-Path $AppRoot 'data\anime-japanese-phrases.json'
$VoiceBrowserTemplatePath = Join-Path $ScriptRoot 'voice-browser.template.html'
$VoiceBrowserHtmlPath = Join-Path $AppRoot 'voicevox-control-center.html'
$DefaultAiriRoot = if (Test-Path (Join-Path $ScriptRoot 'airi.exe')) {
  $ScriptRoot
}
else {
  Join-Path $env:LOCALAPPDATA 'Programs\airi'
}
$ResolvedAiriRoot = if ($AiriRoot) { $AiriRoot } else { $DefaultAiriRoot }
$AiriExe = Join-Path $ResolvedAiriRoot 'airi.exe'
$ResolvedVoicevoxRun = if ($VoicevoxRun) {
  $VoicevoxRun
}
else {
  Join-Path $env:LOCALAPPDATA 'Programs\VOICEVOX\vv-engine\run.exe'
}
$script:VoiceTranslationsCache = $null

function Write-Section {
  param([string]$Title)
  Write-Host ""
  Write-Host "== $Title ==" -ForegroundColor Cyan
}

function Write-KeyValue {
  param(
    [string]$Label,
    [string]$Value
  )
  Write-Host ("{0,-18} {1}" -f $Label, $Value)
}

function Test-CommandExists {
  param([string]$Name)
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-JsonPropertyValue {
  param(
    [AllowNull()]
    $Object,
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  if ($null -eq $Object) {
    return $null
  }

  $property = $Object.PSObject.Properties | Where-Object { $_.Name -eq $Name } | Select-Object -First 1
  if ($null -eq $property) {
    return $null
  }

  return $property.Value
}

function Get-VoiceTranslations {
  if ($null -ne $script:VoiceTranslationsCache) {
    return $script:VoiceTranslationsCache
  }

  if (-not (Test-Path $TranslationsPath)) {
    throw "Translation file was not found: $TranslationsPath"
  }

  $script:VoiceTranslationsCache = Get-Content -Path $TranslationsPath -Raw -Encoding UTF8 | ConvertFrom-Json
  return $script:VoiceTranslationsCache
}

function Test-PortOpen {
  param(
    [string]$HostName,
    [int]$Port
  )

  $client = New-Object Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect($HostName, $Port, $null, $null)
    $connected = $async.AsyncWaitHandle.WaitOne(1000, $false) -and $client.Connected
    if ($connected) {
      $client.EndConnect($async) | Out-Null
      return $true
    }
    return $false
  }
  catch {
    return $false
  }
  finally {
    $client.Close()
  }
}

function Wait-PortOpen {
  param(
    [string]$HostName,
    [int]$Port,
    [int]$Seconds = 10
  )

  for ($i = 0; $i -lt $Seconds; $i++) {
    if (Test-PortOpen -HostName $HostName -Port $Port) {
      return $true
    }
    Start-Sleep -Seconds 1
  }

  return (Test-PortOpen -HostName $HostName -Port $Port)
}

function Get-ListeningProcessIds {
  param([int]$Port)

  $processIds = @()

  try {
    $processIds = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique)
  }
  catch {
  }

  if ($processIds.Count -gt 0) {
    return $processIds
  }

  try {
    $pattern = "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$"
    $matches = netstat -ano -p tcp | Select-String -Pattern $pattern
    $processIds = @(
      $matches |
        ForEach-Object {
          if ($_.Matches.Count -gt 0) {
            [int]$_.Matches[0].Groups[1].Value
          }
        } |
        Select-Object -Unique
    )
  }
  catch {
    $processIds = @()
  }

  return $processIds
}

function Stop-PortProcesses {
  param([int]$Port)

  $processIds = Get-ListeningProcessIds -Port $Port
  foreach ($procId in $processIds) {
    try {
      Stop-Process -Id $procId -Force -ErrorAction Stop
    }
    catch {
      try {
        taskkill /PID $procId /F | Out-Null
      }
      catch {
      }
    }
  }
}

function Start-VoicevoxEngine {
  if (-not (Test-Path $ResolvedVoicevoxRun)) {
    throw "VOICEVOX engine was not found: $ResolvedVoicevoxRun"
  }

  if (Test-PortOpen -HostName '127.0.0.1' -Port $EnginePort) {
    Write-Host "VOICEVOX engine is already running."
    return
  }

  Write-Host "Starting VOICEVOX engine..."
  Start-Process -FilePath $ResolvedVoicevoxRun -ArgumentList @('--output_log_utf8') -WorkingDirectory (Split-Path $ResolvedVoicevoxRun) -WindowStyle Hidden | Out-Null

  if (-not (Wait-PortOpen -HostName '127.0.0.1' -Port $EnginePort -Seconds 20)) {
    throw "VOICEVOX engine did not answer on port $EnginePort."
  }
}

function Start-VoicevoxBridge {
  if (-not (Test-Path $BridgeScript)) {
    throw "Bridge script was not found: $BridgeScript"
  }
  if (-not (Test-CommandExists -Name 'node')) {
    throw 'Node.js was not found in PATH.'
  }

  Write-Host "Starting VOICEVOX bridge..."
  Start-Process -FilePath 'node' -ArgumentList @($BridgeScript) -WorkingDirectory $ScriptRoot -WindowStyle Hidden | Out-Null

  if (-not (Wait-PortOpen -HostName '127.0.0.1' -Port $BridgePort -Seconds 10)) {
    throw "VOICEVOX bridge did not answer on port $BridgePort."
  }
}

function Restart-VoicevoxBridge {
  if (Test-PortOpen -HostName '127.0.0.1' -Port $BridgePort) {
    Write-Host "Stopping existing VOICEVOX bridge..."
    Stop-PortProcesses -Port $BridgePort
    Start-Sleep -Seconds 1
  }
  Start-VoicevoxBridge
}

function Ensure-VoicevoxBridge {
  param([switch]$Restart)

  Start-VoicevoxEngine

  if ($Restart -or -not (Test-PortOpen -HostName '127.0.0.1' -Port $BridgePort)) {
    Restart-VoicevoxBridge
  }
}

function Invoke-JsonGet {
  param([string]$Url)
  return Invoke-RestMethod -Uri $Url -TimeoutSec 15
}

function Get-BridgeHealth {
  try {
    return Invoke-JsonGet -Url "$BridgeBaseUrl/healthz"
  }
  catch {
    return $null
  }
}

function Get-EngineVersion {
  try {
    return Invoke-RestMethod -Uri "$EngineBaseUrl/version" -TimeoutSec 10
  }
  catch {
    return $null
  }
}

function Get-RecentBridgeEvents {
  try {
    $payload = Invoke-JsonGet -Url "$BridgeBaseUrl/v1/debug/recent"
    $data = Get-JsonPropertyValue -Object $payload -Name 'data'
    if ($null -ne $data) {
      return @($data)
    }
  }
  catch {
  }

  if (-not (Test-Path $BridgeLogPath)) {
    return @()
  }

  $lines = @(Get-Content -Path $BridgeLogPath -Tail 20 -Encoding UTF8)
  $events = @()
  foreach ($line in $lines) {
    if (-not [string]::IsNullOrWhiteSpace($line)) {
      try {
        $events += ,($line | ConvertFrom-Json)
      }
      catch {
      }
    }
  }

  [array]::Reverse($events)
  return $events
}

function Get-VoiceList {
  Ensure-VoicevoxBridge
  $payload = Invoke-JsonGet -Url "$BridgeBaseUrl/v1/voices"
  if ($null -eq $payload) {
    return @()
  }

  if ($payload -is [System.Array]) {
    return @($payload)
  }

  $data = Get-JsonPropertyValue -Object $payload -Name 'data'
  if ($null -eq $data) {
    return @()
  }

  return @($data)
}

function Get-SpeakerTranslationEntry {
  param([string]$SpeakerName)

  $translations = Get-VoiceTranslations
  $speakerMap = Get-JsonPropertyValue -Object $translations -Name 'speakers'
  return Get-JsonPropertyValue -Object $speakerMap -Name $SpeakerName
}

function Get-StyleTranslation {
  param([string]$StyleName)

  $translations = Get-VoiceTranslations
  $styleMap = Get-JsonPropertyValue -Object $translations -Name 'styles'
  $translated = Get-JsonPropertyValue -Object $styleMap -Name $StyleName
  if ($translated) {
    return [string]$translated
  }
  return [string]$StyleName
}

function Convert-VoiceToTranslatedRecord {
  param($Voice)

  $speakerName = [string]$Voice.speaker_name
  $styleName = [string]$Voice.style_name
  $speakerEntry = Get-SpeakerTranslationEntry -SpeakerName $speakerName

  $speakerLatin = [string](Get-JsonPropertyValue -Object $speakerEntry -Name 'latin')
  if (-not $speakerLatin) {
    $speakerLatin = $speakerName
  }

  $speakerTr = [string](Get-JsonPropertyValue -Object $speakerEntry -Name 'tr')
  if (-not $speakerTr) {
    $speakerTr = $speakerLatin
  }

  $speakerDescriptionTr = [string](Get-JsonPropertyValue -Object $speakerEntry -Name 'description_tr')

  return [PSCustomObject]@{
    id = [string]$Voice.id
    type = [string]$Voice.type
    speaker_name = $speakerName
    speaker_latin = $speakerLatin
    speaker_tr = $speakerTr
    speaker_description_tr = $speakerDescriptionTr
    style_name = $styleName
    style_tr = (Get-StyleTranslation -StyleName $styleName)
  }
}

function Get-TranslatedVoiceList {
  $voices = @(Get-VoiceList)
  if ($voices.Count -eq 0) {
    return @()
  }

  $translated = @()
  foreach ($voice in $voices) {
    if ($null -ne $voice) {
      $translated += ,(Convert-VoiceToTranslatedRecord -Voice $voice)
    }
  }

  return $translated
}

function Test-VoiceFilterMatch {
  param(
    $Voice,
    [string]$NameFilter
  )

  if (-not $NameFilter) {
    return $true
  }

  $needle = $NameFilter.ToLowerInvariant()
  $haystack = @(
    [string]$Voice.id,
    [string]$Voice.speaker_name,
    [string]$Voice.speaker_latin,
    [string]$Voice.speaker_tr,
    [string]$Voice.speaker_description_tr,
    [string]$Voice.style_name,
    [string]$Voice.style_tr
  ) -join ' '

  return $haystack.ToLowerInvariant().Contains($needle)
}

function Show-ConfigHint {
  Write-Section 'AIRI Config'
  Write-KeyValue 'Provider' 'OpenAI Compatible'
  Write-KeyValue 'Base URL' "$BridgeBaseUrl/v1/"
  Write-KeyValue 'API key' 'voicevox'
  Write-KeyValue 'Model' 'voicevox or voicevox-tts (auto TR/EN + auto mood)'
  Write-KeyValue 'TR model' 'voicevox-tts-tr'
  Write-KeyValue 'EN model' 'voicevox-tts-en'
  Write-KeyValue 'Fixed model' 'voicevox-tts-raw'
  Write-KeyValue 'Voice' 'Use a style id such as 3'
  Write-KeyValue 'Speed boost' 'Bridge default is 1.25x'
}

function Show-PreprocessedTurkishText {
  if (-not $Text) {
    throw 'Use -Text with preview-tr.'
  }
  if (-not (Test-CommandExists -Name 'node')) {
    throw 'Node.js was not found in PATH.'
  }

  & node $BridgeScript --preprocess-tr $Text
}

function Show-PreprocessedEnglishText {
  if (-not $Text) {
    throw 'Use -Text with preview-en.'
  }
  if (-not (Test-CommandExists -Name 'node')) {
    throw 'Node.js was not found in PATH.'
  }

  & node $BridgeScript --preprocess-en $Text
}

function Show-Doctor {
  Write-Section 'Paths'
  Write-KeyValue 'AIRI exe' $AiriExe
  Write-KeyValue 'VOICEVOX run' $ResolvedVoicevoxRun
  Write-KeyValue 'Bridge script' $BridgeScript

  Write-Section 'Checks'
  Write-KeyValue 'Node.js' ($(if (Test-CommandExists -Name 'node') { 'OK' } else { 'Missing' }))
  Write-KeyValue 'AIRI exe exists' ($(if (Test-Path $AiriExe) { 'Yes' } else { 'No' }))
  Write-KeyValue 'VOICEVOX exists' ($(if (Test-Path $ResolvedVoicevoxRun) { 'Yes' } else { 'No' }))
  Write-KeyValue 'Bridge exists' ($(if (Test-Path $BridgeScript) { 'Yes' } else { 'No' }))
  Write-KeyValue 'Engine port 50021' ($(if (Test-PortOpen -HostName '127.0.0.1' -Port $EnginePort) { 'Open' } else { 'Closed' }))
  Write-KeyValue 'Bridge port 55221' ($(if (Test-PortOpen -HostName '127.0.0.1' -Port $BridgePort) { 'Open' } else { 'Closed' }))

  Show-ConfigHint
}

function Show-Status {
  Write-Section 'Status'
  $engineVersion = Get-EngineVersion
  $bridgeHealth = Get-BridgeHealth

  Write-KeyValue 'Engine online' ($(if ($engineVersion) { 'Yes' } else { 'No' }))
  if ($engineVersion) {
    Write-KeyValue 'Engine version' ([string]$engineVersion)
  }

  Write-KeyValue 'Bridge online' ($(if ($bridgeHealth) { 'Yes' } else { 'No' }))
  if ($bridgeHealth) {
    Write-KeyValue 'Bridge model' ([string]$bridgeHealth.model)
    $lastEvent = Get-JsonPropertyValue -Object $bridgeHealth -Name 'lastEvent'
    if ($lastEvent) {
      $lastMood = [string](Get-JsonPropertyValue -Object $lastEvent -Name 'mood')
      $lastResolvedVoice = [string](Get-JsonPropertyValue -Object $lastEvent -Name 'resolvedVoiceId')
      $lastBaseVoice = [string](Get-JsonPropertyValue -Object $lastEvent -Name 'baseVoiceId')
      if ($lastMood -or $lastResolvedVoice) {
        Write-KeyValue 'Last decision' ("{0} -> {1} ({2})" -f $lastBaseVoice, $lastResolvedVoice, $lastMood)
      }
    }
  }
}

function Show-Voices {
  param([string]$NameFilter)

  $voices = Get-VoiceList
  if ($NameFilter) {
    $voices = @($voices | Where-Object {
      $_.speaker_name -like "*$NameFilter*" -or $_.name -like "*$NameFilter*"
    })
  }

  if ($voices.Count -eq 0) {
    Write-Host 'No voices matched the filter.'
    return
  }

  $grouped = $voices | Group-Object speaker_name | Sort-Object Name
  foreach ($group in $grouped) {
    $styles = $group.Group |
      Sort-Object { [int]$_.id } |
      ForEach-Object { '{0}={1}' -f $_.id, $_.style_name }
    Write-Host ('{0}: {1}' -f $group.Name, ($styles -join ', '))
  }

  Write-Host ""
  Write-Host ('TOTAL_CHARACTERS={0}' -f $grouped.Count)
  Write-Host ('TOTAL_VOICES={0}' -f $voices.Count)
}

function Show-VoicesTr {
  param([string]$NameFilter)

  $voices = @(Get-TranslatedVoiceList | Where-Object {
    Test-VoiceFilterMatch -Voice $_ -NameFilter $NameFilter
  })

  if ($voices.Count -eq 0) {
    Write-Host 'Filtreye uyan ses bulunamadi.'
    return
  }

  $grouped = @($voices | Group-Object speaker_name | Sort-Object { $_.Group[0].speaker_latin })
  foreach ($group in $grouped) {
    $first = $group.Group[0]
    Write-Host ('{0} [{1}]' -f $first.speaker_latin, $first.speaker_name) -ForegroundColor Cyan
    if ($first.speaker_description_tr) {
      Write-Host ('  {0}' -f $first.speaker_description_tr)
    }

    $styles = $group.Group |
      Sort-Object { [int]$_.id } |
      ForEach-Object { '{0}={1} ({2})' -f $_.id, $_.style_tr, $_.style_name }

    Write-Host ('  {0}' -f ($styles -join ', '))
    Write-Host ''
  }

  Write-Host ('TOPLAM_KARAKTER={0}' -f $grouped.Count)
  Write-Host ('TOPLAM_SES={0}' -f $voices.Count)
}

function Show-VoicesJson {
  $voices = Get-VoiceList
  $voices | ConvertTo-Json -Depth 6
}

function Show-RecentBridgeEvents {
  $events = @(Get-RecentBridgeEvents)
  if ($events.Count -eq 0) {
    Write-Host 'No recent bridge events were found.'
    return
  }

  foreach ($event in $events | Select-Object -First 12) {
    $timestamp = [string](Get-JsonPropertyValue -Object $event -Name 'timestamp')
    $kind = [string](Get-JsonPropertyValue -Object $event -Name 'kind')

    if ($kind -eq 'speech') {
      $baseVoiceId = [string](Get-JsonPropertyValue -Object $event -Name 'baseVoiceId')
      $resolvedVoiceId = [string](Get-JsonPropertyValue -Object $event -Name 'resolvedVoiceId')
      $mood = [string](Get-JsonPropertyValue -Object $event -Name 'mood')
      $reason = [string](Get-JsonPropertyValue -Object $event -Name 'emotionReason')
      $preview = [string](Get-JsonPropertyValue -Object $event -Name 'inputPreview')
      Write-Host ('{0} | {1} -> {2} | mood={3} | reason={4}' -f $timestamp, $baseVoiceId, $resolvedVoiceId, $mood, $reason) -ForegroundColor Cyan
      if ($preview) {
        Write-Host ('  {0}' -f $preview)
      }
    }
    else {
      $message = [string](Get-JsonPropertyValue -Object $event -Name 'message')
      Write-Host ('{0} | error | {1}' -f $timestamp, $message) -ForegroundColor Yellow
    }
  }
}

function Show-BridgeLogTail {
  if (-not (Test-Path $BridgeLogPath)) {
    Write-Host "Bridge log does not exist yet: $BridgeLogPath"
    return
  }

  Get-Content -Path $BridgeLogPath -Tail 20 -Encoding UTF8
}

function Export-VoicesHtml {
  Ensure-VoicevoxBridge

  if (-not (Test-Path $VoiceBrowserTemplatePath)) {
    throw "HTML template was not found: $VoiceBrowserTemplatePath"
  }

  $voices = Get-TranslatedVoiceList
  $template = Get-Content -Path $VoiceBrowserTemplatePath -Raw -Encoding UTF8
  $voiceJson = $voices | ConvertTo-Json -Depth 8
  $generatedAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')

  $phraseJson = '{}'
  if (Test-Path $PhrasesPath) {
    $phraseJson = Get-Content -Path $PhrasesPath -Raw -Encoding UTF8
  }
  else {
    Write-Host "WARNING: Phrase file not found: $PhrasesPath" -ForegroundColor Yellow
  }

  $html = $template.
    Replace('__VOICE_DATA_JSON__', [string]$voiceJson).
    Replace('__PHRASE_DATA_JSON__', [string]$phraseJson).
    Replace('__GENERATED_AT__', $generatedAt).
    Replace('__BRIDGE_BASE_URL__', "$BridgeBaseUrl/v1/").
    Replace('__ENGINE_BASE_URL__', "$EngineBaseUrl/")

  Set-Content -Path $VoiceBrowserHtmlPath -Value $html -Encoding UTF8
  Write-Host "HTML control center written: $VoiceBrowserHtmlPath"
  return $VoiceBrowserHtmlPath
}

function Open-VoicesUi {
  $outputPath = Export-VoicesHtml
  Write-Host "Opening control center..."
  Start-Process -FilePath $outputPath | Out-Null
}

function Start-AiriApp {
  if (-not (Test-Path $AiriExe)) {
    throw "AIRI executable was not found: $AiriExe"
  }

  Write-Host "Starting AIRI..."
  Start-Process -FilePath $AiriExe | Out-Null
}

function Stop-BridgeOnly {
  if (Test-PortOpen -HostName '127.0.0.1' -Port $BridgePort) {
    Write-Host "Stopping VOICEVOX bridge..."
    Stop-PortProcesses -Port $BridgePort
  }
  else {
    Write-Host "VOICEVOX bridge is not running."
  }
}

function Show-Help {
  Write-Host 'VOICEVOX + AIRI CLI'
  Write-Host ''
  Write-Host 'Commands:'
  Write-Host '  help               Show this help'
  Write-Host '  doctor             Check paths, ports, and required tools'
  Write-Host '  setup              Start engine + bridge and print AIRI settings'
  Write-Host '  start              Start engine + bridge + AIRI'
  Write-Host '  start-bridge       Start or restart just the bridge stack'
  Write-Host '  restart-bridge     Restart the bridge'
  Write-Host '  stop               Stop the bridge only'
  Write-Host '  status             Show bridge and engine health'
  Write-Host '  config             Print the AIRI settings you should use'
  Write-Host '  list-voices        Print voices grouped by character'
  Write-Host '  list-voices-tr     Print a Turkish-friendly voice list'
  Write-Host '  list-voices-json   Print raw voice JSON'
  Write-Host '  recent             Show recent voice decisions'
  Write-Host '  log-tail           Show the last raw log lines'
  Write-Host '  export-voices-html Generate the HTML control center'
  Write-Host '  export-control-html Alias of export-voices-html'
  Write-Host '  voices-ui          Generate and open the HTML control center'
  Write-Host '  control-ui         Alias of voices-ui'
  Write-Host '  gui                Alias of voices-ui'
  Write-Host '  preview-tr         Show Turkish preprocessing output'
  Write-Host '  preview-en         Show English preprocessing output'
  Write-Host ''
  Write-Host 'Examples:'
  Write-Host '  .\voicevox-airi.bat start'
  Write-Host '  .\voicevox-airi.bat list-voices-tr'
  Write-Host '  .\voicevox-airi.bat recent'
  Write-Host '  .\voicevox-airi.ps1 list-voices-tr -Filter Nekotsukai'
  Write-Host '  .\voicevox-airi.bat export-voices-html'
  Write-Host '  .\voicevox-airi.bat gui'
  Write-Host '  .\voicevox-airi.ps1 preview-tr -Text "Merhaba nasilsin?"'
  Write-Host '  .\voicevox-airi.ps1 preview-en -Text "Hello, how are you?"'
}

$normalizedCommand = $Command.Trim().ToLowerInvariant()

switch ($normalizedCommand) {
  'doctor' {
    Show-Doctor
  }
  'setup' {
    Show-Doctor
    Ensure-VoicevoxBridge -Restart
    Show-Status
    Show-ConfigHint
  }
  'start' {
    Ensure-VoicevoxBridge -Restart
    Show-Status
    Show-ConfigHint
    if (-not $NoAiri) {
      Start-AiriApp
    }
  }
  'start-bridge' {
    Ensure-VoicevoxBridge -Restart
    Show-Status
  }
  'restart-bridge' {
    Restart-VoicevoxBridge
    Show-Status
  }
  'stop' {
    Stop-BridgeOnly
  }
  'status' {
    Show-Status
  }
  'config' {
    Show-ConfigHint
  }
  'list-voices' {
    Show-Voices -NameFilter $Filter
  }
  'list-voices-tr' {
    Show-VoicesTr -NameFilter $Filter
  }
  'list-voices-json' {
    Show-VoicesJson
  }
  'recent' {
    Show-RecentBridgeEvents
  }
  'log-tail' {
    Show-BridgeLogTail
  }
  'export-voices-html' {
    Export-VoicesHtml
  }
  'export-control-html' {
    Export-VoicesHtml
  }
  'voices-ui' {
    Open-VoicesUi
  }
  'control-ui' {
    Open-VoicesUi
  }
  'gui' {
    Open-VoicesUi
  }
  'preview-tr' {
    Show-PreprocessedTurkishText
  }
  'preview-en' {
    Show-PreprocessedEnglishText
  }
  'help' {
    Show-Help
  }
  default {
    throw "Unknown command: $Command"
  }
}
