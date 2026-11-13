param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^dev\.quotern\.desktop\.acceptance\.[a-f0-9-]{36}$')]
    [string]$AppId
)

# Read-only. Run with Windows PowerShell 5.1, and only query the unique identity
# printed in the acceptance harness's ready.json. Never clears user history.
$ErrorActionPreference = 'Stop'
$history = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]::History
$rows = @($history.GetHistory($AppId) | ForEach-Object {
    [pscustomobject]@{ Tag = $_.Tag; Group = $_.Group; Xml = $_.Content.GetXml() }
})
ConvertTo-Json -InputObject $rows -Depth 5 -Compress
