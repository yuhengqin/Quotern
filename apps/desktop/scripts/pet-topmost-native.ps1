# Fixture-only Win32 probe. Both handles must belong to the supplied Electron PID.
param(
  [Parameter(Mandatory = $true)][long]$PetHandle,
  [Parameter(Mandatory = $true)][long]$CoverHandle,
  [Parameter(Mandatory = $true)][uint32]$OwnerProcessId,
  [switch]$Demote
)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class PetTopmostProbe {
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint command);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetStyle(IntPtr h, int index);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int width, int height, uint flags);
  public static void CheckOwner(IntPtr h, uint expected) {
    uint actual;
    GetWindowThreadProcessId(h, out actual);
    if (!IsWindow(h) || actual != expected) throw new InvalidOperationException("Window is not owned by this fixture");
  }
  public static bool Above(IntPtr higher, IntPtr lower) {
    var seen = new HashSet<IntPtr>();
    for (var h = GetWindow(lower, 3); h != IntPtr.Zero && seen.Add(h); h = GetWindow(h, 3)) {
      if (h == higher) return true;
    }
    return false;
  }
  public static void Demote(IntPtr pet, IntPtr cover) {
    if ((GetStyle(cover, -20).ToInt64() & 8) != 0) throw new InvalidOperationException("Cover must be an ordinary window");
    // Only demote this fixture's pet behind its ordinary cover window.
    if (!SetWindowPos(pet, cover, 0, 0, 0, 0, 0x13)) throw new Win32Exception(Marshal.GetLastWin32Error());
  }
}
'@
$qPet = [IntPtr]$PetHandle
$qCover = [IntPtr]$CoverHandle
[PetTopmostProbe]::CheckOwner($qPet, $OwnerProcessId)
[PetTopmostProbe]::CheckOwner($qCover, $OwnerProcessId)
if ($Demote) { [PetTopmostProbe]::Demote($qPet, $qCover) }
[pscustomobject]@{
  petTopmost = ([PetTopmostProbe]::GetStyle($qPet, -20).ToInt64() -band 8) -ne 0
  petAboveCover = [PetTopmostProbe]::Above($qPet, $qCover)
  foreground = [PetTopmostProbe]::GetForegroundWindow().ToInt64()
} | ConvertTo-Json -Compress
