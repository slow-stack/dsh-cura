# TTS helper for dsh-cura (fallback chain, five tiers)
# Usage: powershell -NoProfile -File say.ps1 -Text "..." -Out "reply.mp3"
# Tier 0: Volcano cloned voice (speaker/resource configured in local tts-volc.py + .volc, untracked)
# Tier 0.5: configured OpenAI-compatible TTS (voice.json tts.openai)
# Tier 1: Aliyun qwen-audio-3.0-tts-plus (cloud)
# Tier 2: edge-tts (cloud)
# Tier 3: Windows SAPI (offline)
param(
  [Parameter(Mandatory = $true)][string]$Text,
  [string]$Out = "$env:TEMP\qq-voice-reply.mp3"
)
$ErrorActionPreference = 'Stop'
$keyFile = Join-Path $PSScriptRoot '.key'
$py = 'D:\Miniconda\envs\qqcall\python.exe'

# ---- Tier 0: Volcano cloned voice (speaker configured in local tts-volc.py) ----
try {
  $volcOut = "$env:TEMP\qq-volc-$([guid]::NewGuid().ToString('N').Substring(0,8)).mp3"
  & $py (Join-Path $PSScriptRoot 'tts-volc.py') --text $Text --out $volcOut 2>$null
  if ((Test-Path $volcOut) -and (Get-Item $volcOut).Length -gt 1000) { Write-Output $volcOut; exit 0 }
} catch { Write-Host "tier0 volcano failed: $_" }

# ---- Tier 0.5: configured OpenAI-compatible TTS (voice.json tts.openai) ----
try {
  $voiceCfgPath = Join-Path $PSScriptRoot 'voice.json'
  if (Test-Path $voiceCfgPath) {
    $v = Get-Content $voiceCfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($v.tts.provider -eq 'openai' -and $v.tts.openai.baseUrl -and $v.tts.openai.model) {
      $ext = if ($v.tts.openai.format) { $v.tts.openai.format } else { 'mp3' }
      $oaOut = "$env:TEMP\qq-openai-$([guid]::NewGuid().ToString('N').Substring(0,8)).$ext"
      $oaBody = @{ model = $v.tts.openai.model; input = $Text; response_format = $ext } | ConvertTo-Json
      if ($v.tts.openai.voice) { $oaBody | Add-Member -NotePropertyName voice -NotePropertyValue $v.tts.openai.voice }
      if ($v.tts.openai.speed) { $oaBody | Add-Member -NotePropertyName speed -NotePropertyValue ([double]$v.tts.openai.speed) }
      $headers = @{ }
      if ($v.tts.openai.apiKey) { $headers.Authorization = "Bearer " + $v.tts.openai.apiKey }
      Invoke-RestMethod -Uri ($v.tts.openai.baseUrl.TrimEnd('/') + '/v1/audio/speech') -Method Post -Headers $headers -ContentType 'application/json' -Body ([System.Text.Encoding]::UTF8.GetBytes($oaBody)) -OutFile $oaOut -TimeoutSec 60
      if ((Test-Path $oaOut) -and (Get-Item $oaOut).Length -gt 1000) { Write-Output $oaOut; exit 0 }
    }
  }
} catch { Write-Host "tier0.5 openai-tts failed: $_" }

# ---- Tier 1: Aliyun qwen-audio-3.0-tts-plus ----
try {
  $key = (Get-Content $keyFile -First 1).Trim()
  $body = @{ model = 'qwen-audio-3.0-tts-plus'; input = @{ text = $Text; voice = 'longanlufeng' } } | ConvertTo-Json
  $resp = Invoke-RestMethod -Uri 'https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer' -Method Post -Headers @{ Authorization = "Bearer $key" } -ContentType 'application/json' -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 60
  $url = $resp.output.audio.url
  $wav = $Out -replace '\.mp3$', '.wav'
  Invoke-WebRequest -Uri $url -OutFile $wav -TimeoutSec 60
  if ((Test-Path $wav) -and (Get-Item $wav).Length -gt 5000) { Write-Output $wav; exit 0 }
} catch { Write-Host "tier1 qwen-tts failed: $_" }

# ---- Tier 2: edge-tts ----
try {
  & 'D:\Miniconda\envs\qqcall\Scripts\edge-tts.exe' --voice zh-CN-XiaoxiaoNeural --text $Text --write-media $Out 2>$null
  if ((Test-Path $Out) -and (Get-Item $Out).Length -gt 1000) { Write-Output $Out; exit 0 }
} catch { Write-Host "tier2 edge-tts failed: $_" }

# ---- Tier 3: Windows SAPI (offline) ----
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $s.SelectVoice('Microsoft Huihui Desktop') } catch {}
$wav = $Out -replace '\.mp3$', '.wav'
$s.SetOutputToWaveFile($wav)
$s.Speak($Text)
$s.Dispose()
Write-Output $wav
