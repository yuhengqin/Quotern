param(
  [Parameter(Mandatory = $true)][int]$SupervisorProcessId,
  [Parameter(Mandatory = $true)][string]$JobName,
  [Parameter(Mandatory = $true)][string]$EvidencePath,
  [Parameter(Mandatory = $true)][string]$EvidenceBase64
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

public static class QuoternDevJob {
  [StructLayout(LayoutKind.Sequential)]
  struct Accounting {
    public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
    public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool member);
  [DllImport("kernel32.dll")]
  static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool QueryInformationJobObject(IntPtr job, int infoClass, out Accounting info, int size, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll")]
  static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool ProcessIdToSessionId(int pid, out uint session);

  static uint Count(IntPtr job) {
    Accounting info;
    if (!QueryInformationJobObject(job, 1, out info, Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero))
      throw new Win32Exception(Marshal.GetLastWin32Error());
    return info.ActiveProcesses;
  }
  static bool Alive(IntPtr process) {
    uint result = WaitForSingleObject(process, 0);
    if (result == 0xFFFFFFFF) throw new Win32Exception(Marshal.GetLastWin32Error());
    return result == 258;
  }
  static void Reply(string text) {
    // Broken pipes from a dead supervisor must not end monitoring.
    try { Console.Out.WriteLine(text); Console.Out.Flush(); } catch (IOException) { }
  }
  public static int Run(int pid, string name, string evidencePath, string encodedEvidence, Action releaseGuards) {
    IntPtr supervisor = IntPtr.Zero, job = IntPtr.Zero;
    try {
      // Pin the original process identity BEFORE asking that process to attach.
      supervisor = OpenProcess(0x00100501, false, pid); // SYNCHRONIZE | QUERY_INFORMATION | SET_QUOTA | TERMINATE
      if (supervisor == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
      long created, exited, kernel, user;
      uint session;
      if (!GetProcessTimes(supervisor, out created, out exited, out kernel, out user)
        || !ProcessIdToSessionId(pid, out session)) throw new Win32Exception(Marshal.GetLastWin32Error());
      Reply("{\"type\":\"prepared\",\"createdAt\":\"" + created + "\",\"windowsSessionId\":" + session + "}");
      if (Console.ReadLine() != "attach" || !Alive(supervisor)) return 1;
      job = CreateJobObject(IntPtr.Zero, name);
      int error = Marshal.GetLastWin32Error();
      if (job == IntPtr.Zero || error == 183) throw new Win32Exception(error);
      // No KILL_ON_JOB_CLOSE or BREAKAWAY flags: this helper only observes.
      if (!AssignProcessToJobObject(job, supervisor)) throw new Win32Exception(Marshal.GetLastWin32Error());
      bool member, observerMember;
      if (!IsProcessInJob(supervisor, job, out member) || !member
        || !IsProcessInJob(GetCurrentProcess(), job, out observerMember) || observerMember)
        throw new InvalidOperationException("Job membership could not be confirmed");
      Reply("{\"type\":\"ready\"}");
      Task<string> command = Task.Run(() => Console.ReadLine());
      bool inputClosed = false;
      bool terminating = false;
      while (true) {
        if (!Alive(supervisor) && !terminating) {
          // This is the original pinned process, not a historical PID. Its Job
          // contains only this session, including detached ordinary descendants.
          if (!TerminateJobObject(job, 1)) throw new Win32Exception(Marshal.GetLastWin32Error());
          terminating = true;
        }
        uint active = Count(job);
        if (!Alive(supervisor) && active == 0) {
          // Keep the original supervisor handle pinned while checking guard PIDs:
          // its ID cannot be reused until that kernel object is released.
          releaseGuards();
          // Only this path produces proof; a missing helper is never proof.
          string temp = evidencePath + "." + Guid.NewGuid().ToString("N") + ".tmp";
          File.WriteAllText(temp, Encoding.UTF8.GetString(Convert.FromBase64String(encodedEvidence)), new UTF8Encoding(false));
          File.Move(temp, evidencePath);
          return 0;
        }
        if (!inputClosed && command.IsCompleted) {
          string request = command.GetAwaiter().GetResult();
          if (request == null) inputClosed = true;
          else {
            int id;
            if (request.StartsWith("check:") && Int32.TryParse(request.Substring(6), out id) && Alive(supervisor))
              Reply("{\"type\":\"members\",\"id\":" + id + ",\"active\":" + Count(job) + "}");
            command = Task.Run(() => Console.ReadLine());
          }
        }
        Thread.Sleep(50);
      }
    } catch (Exception error) {
      try { Console.Error.WriteLine("Quotern Job monitor: " + error.Message); } catch (IOException) { }
      return 1;
    } finally {
      if (job != IntPtr.Zero) CloseHandle(job);
      if (supervisor != IntPtr.Zero) CloseHandle(supervisor);
    }
  }
}
'@
$quoternSession = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($EvidenceBase64)) | ConvertFrom-Json
$quoternReleaseGuards = [Action]{
  # Other launchers never reclaim a guard themselves. While this original PID is
  # pinned and ended, a matching guard has no writer and cannot be a reused PID.
  $quoternState = Join-Path $quoternSession.worktree '.quotern-dev'
  foreach ($quoternResource in @('runtime', 'ui', 'desktop-ui')) {
    $quoternGuard = Join-Path $quoternState ($quoternResource + '.guard')
    $quoternOwnerPath = Join-Path $quoternGuard 'owner.json'
    try {
      if (-not (Test-Path -LiteralPath $quoternGuard -PathType Container)) { continue }
      if ((Get-Item -LiteralPath $quoternState -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
      if ((Get-Item -LiteralPath $quoternGuard -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
      $quoternEntries = @(Get-ChildItem -LiteralPath $quoternGuard -Force)
      if ($quoternEntries.Count -ne 1 -or $quoternEntries[0].Name -ne 'owner.json' -or $quoternEntries[0].PSIsContainer -or
        ($quoternEntries[0].Attributes -band [IO.FileAttributes]::ReparsePoint)) { continue }
      $quoternOwner = [IO.File]::ReadAllText($quoternOwnerPath) | ConvertFrom-Json
      if ($quoternOwner.pid -ne $SupervisorProcessId -or $quoternOwner.resource -ne $quoternResource) { continue }
      [IO.File]::Delete($quoternOwnerPath)
      [IO.Directory]::Delete($quoternGuard)
    } catch {
      # Unknown guard contents stay intact; they cannot invalidate Job-zero proof.
      [Console]::Error.WriteLine('Quotern guard cleanup: ' + $_.Exception.Message)
    }
  }
}
exit ([QuoternDevJob]::Run($SupervisorProcessId, $JobName, $EvidencePath, $EvidenceBase64, $quoternReleaseGuards))
