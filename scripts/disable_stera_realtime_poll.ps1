# 合言葉「ステラ」用(CLAUDE.md 7.4参照)。80000785 PC上で実行する。
# SteraRealtimeSalesPoll(当日速報の定期ポーリング)を無効化し、ステラへのアクセスを
# 毎朝のSteraDailySalesImport(1日1回)だけにする。削除ではなく無効化なので
# Enable-ScheduledTask -TaskName SteraRealtimeSalesPoll で元に戻せる。
$ErrorActionPreference = 'Stop'

function Show-Tasks($label) {
    Write-Host "---- $label ----"
    Get-ScheduledTask -TaskName 'Stera*' -ErrorAction SilentlyContinue | ForEach-Object {
        $info = $_ | Get-ScheduledTaskInfo
        $rep = ($_.Triggers | ForEach-Object { $_.Repetition.Interval }) -join ','
        [pscustomobject]@{
            TaskName       = $_.TaskName
            State          = $_.State
            Repetition     = $rep
            LastRunTime    = $info.LastRunTime
            LastTaskResult = $info.LastTaskResult
            NextRunTime    = $info.NextRunTime
        }
    } | Format-Table -AutoSize | Out-String | Write-Host
}

Show-Tasks '変更前'

$task = Get-ScheduledTask -TaskName 'SteraRealtimeSalesPoll' -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host 'SteraRealtimeSalesPoll は登録されていません(何もしません)。'
} elseif ($task.State -eq 'Disabled') {
    Write-Host 'SteraRealtimeSalesPoll は既に無効です(何もしません)。'
} else {
    Disable-ScheduledTask -TaskName 'SteraRealtimeSalesPoll' | Out-Null
    Write-Host 'SteraRealtimeSalesPoll を無効化しました。'
}

Show-Tasks '変更後'

$daily = Get-ScheduledTask -TaskName 'SteraDailySalesImport' -ErrorAction SilentlyContinue
if (-not $daily -or $daily.State -eq 'Disabled') {
    Write-Host '⚠ SteraDailySalesImport が無い/無効です。1日1回の取込みも止まっているので要確認。'
}
