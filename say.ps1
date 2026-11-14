# TTS helper for dsh-cura (fallback chain, five tiers)
# Usage: 待合成文本走标准输入，输出路径走参数：
#   printf '%s' "$text" | powershell -NoProfile -File say.ps1 -Out "reply.mp3"   （bash）
#   spawn('powershell', ['-NoProfile','-File',say.ps1,'-Out',out]) 之后写 stdin （node，见 lib/say.js）
# 仍兼容老写法 -Text "..."，但那条路要求文本不得以 - 开头，新代码不要再走。
# Python: set CURA_PYTHON to a python.exe path; otherwise the first python on PATH is used.
# Tier 0/1 need that python to have requests (and whatever tts-volc.py imports).
# Tier 0: Volcano cloned voice (speaker/resource configured in local tts-volc.py + .volc, untracked)
# Tier 0.5: configured OpenAI-compatible TTS (voice.json tts.openai)
# Tier 1: Aliyun qwen-audio-3.0-tts-plus (cloud)
# Tier 2: edge-tts (cloud)
# Tier 3: Windows SAPI (offline)
param(
  # 旧写法是 [Parameter(Mandatory = $true)] + 命令行 -Text <值>。那样文本必须进 argv，
  # 而 PowerShell 会把以 - 开头的值当成参数名：回复里出现 -Text / -Out / --text 这类字样时
  # 会报 "Missing an argument for parameter Text"，语音静默失败。
  # 待合成的正是模型回复（QQ 里对方说的话会进来），不能让它长什么样影响解析。
  # 所以文本默认从标准输入读；只有老调用方仍显式传 -Text 时才用参数值。
  [string]$Text,
  [string]$Out = "$env:TEMP\qq-voice-reply.mp3"
)

# 产物路径要经 stdout 回给调用方。Windows PowerShell 默认按控制台代码页（中文机器上是 GBK）
# 输出，调用方按 UTF-8 解就会把路径里的中文解成乱码，于是「文件明明在，却找不到」。
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

if (-not $PSBoundParameters.ContainsKey('Text')) {
  # 显式按 UTF-8 解码 stdin。默认的 [Console]::In 走控制台代码页（中文机器是 GBK），
  # 调用方按 UTF-8 写入，读出来就是「浣犲ソ」这类乱码，念出来的也是一串噪音。
  $sr = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
  $Text = $sr.ReadToEnd()
}
# 空文本不该继续往下走：四层链会一路失败，最后产出 0.5 秒静音，对方听到的是死寂。
if ([string]::IsNullOrWhiteSpace($Text)) {
  [Console]::Error.Write("say.ps1: 待合成文本为空")
  exit 2
}
$ErrorActionPreference = 'Stop'
$keyFile = Join-Path $PSScriptRoot '.key'

# Python 解释器：环境变量 CURA_PYTHON 优先，其次 PATH 里的 python / python3。
# 找不到就当 Tier 0 不可用（下面会自然跳过），不让整条链因为一个变量报错。
$py = $env:CURA_PYTHON
if (-not $py) {
  $cmd = Get-Command python -ErrorAction SilentlyContinue
  if (-not $cmd) { $cmd = Get-Command python3 -ErrorAction SilentlyContinue }
  if ($cmd) { $py = $cmd.Source }
}
$hasPy = $py -and (Test-Path $py)

# 文本落成一个 UTF-8 临时文件，供下游 CLI 用「读文件」而不是「传参数」的方式取。
# 为什么不用参数：这些 CLI 用的都是 argparse 一类解析器，值以 "-" 开头时会被当成
# 另一个选项（"--text -Text" -> expected one argument），而待合成的正是回复内容。
# 落盘用 WriteAllText + 无 BOM UTF-8：带 BOM 的话第一个字会被读成零宽字符，念出来是杂音。
$textFile = Join-Path $env:TEMP ("qq-say-text-" + [guid]::NewGuid().ToString('N').Substring(0,8) + ".txt")
[IO.File]::WriteAllText($textFile, $Text, (New-Object System.Text.UTF8Encoding($false)))
# 五档里任何一档成功都会 exit 0，把清理挂在进程退出事件上，免得每条语音留一个临时文件。
$null = Register-EngineEvent -SourceIdentifier PowerShell.Exiting -SupportEvent -Action {
  Remove-Item -LiteralPath $event.MessageData -Force -ErrorAction SilentlyContinue
} -MessageData $textFile

# ---- Tier 0: Volcano cloned voice (speaker configured in local tts-volc.py) ----
try {
  if (-not $hasPy) { throw 'python not found (set CURA_PYTHON)' }
  $volcOut = "$env:TEMP\qq-volc-$([guid]::NewGuid().ToString('N').Substring(0,8)).mp3"
  & $py (Join-Path $PSScriptRoot 'tts-volc.py') --text-file $textFile --out $volcOut 2>$null
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
  $edge = Get-Command edge-tts -ErrorAction SilentlyContinue
  if (-not $edge) { throw 'edge-tts not on PATH' }
  & $edge.Source --voice zh-CN-XiaoxiaoNeural -f $textFile --write-media $Out 2>$null
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
