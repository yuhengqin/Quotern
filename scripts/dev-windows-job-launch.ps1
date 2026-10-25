param(
  [Parameter(Mandatory = $true)][string]$NodePath,
  [Parameter(Mandatory = $true)][string]$HostPath,
  [Parameter(Mandatory = $true)][string]$PayloadBase64
)
$ErrorActionPreference = 'Stop'
# None of these arguments are shell code. The two paths end in files, and the
# payload is base64, so ordinary Windows command-line quoting is sufficient.
if ($NodePath.Contains('"') -or $HostPath.Contains('"') -or $PayloadBase64 -notmatch '^[A-Za-z0-9+/=]+$') {
  throw 'Invalid guardian arguments'
}
$quoternStartup = ([wmiclass]'Win32_ProcessStartup').CreateInstance()
$quoternStartup.ShowWindow = 0
# CREATE_BREAKAWAY_FROM_JOB | CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS.
# A failure is fatal: never silently fall back to a guardian in the caller tree.
$quoternStartup.CreateFlags = 0x01000208
$quoternCommand = '"{0}" "{1}" {2}' -f $NodePath, $HostPath, $PayloadBase64
$quoternResult = ([wmiclass]'Win32_Process').Create($quoternCommand, (Split-Path -Parent $HostPath), $quoternStartup)
if ($quoternResult.ReturnValue -ne 0) { throw "Independent Windows Job guardian creation failed: $($quoternResult.ReturnValue)" }
@{ pid = [int]$quoternResult.ProcessId } | ConvertTo-Json -Compress
