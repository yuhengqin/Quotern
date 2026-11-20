param([int]$HostProcessId, [string]$PetWindow, [string]$Action, [string]$ItemPath = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class PetProbe {
    public delegate bool Visitor(IntPtr window, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left, top, right, bottom; }
    [DllImport("user32")] public static extern bool EnumWindows(Visitor visitor, IntPtr p);
    [DllImport("user32")] public static extern uint GetWindowThreadProcessId(IntPtr w, out int pid);
    [DllImport("user32", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr w, StringBuilder s,int len);
    [DllImport("user32", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr w, StringBuilder s,int len);
    [DllImport("user32")] public static extern bool IsWindowVisible(IntPtr w);
    [DllImport("user32")] public static extern int GetWindowLong(IntPtr w,int index);
    [DllImport("user32")] public static extern bool GetWindowRect(IntPtr w,out Rect rect);
    [DllImport("user32")] public static extern bool SetProcessDPIAware();
    [DllImport("user32")] public static extern bool GetCursorPos(out Point point);
    [DllImport("user32")] public static extern bool SetCursorPos(int x,int y);
    [DllImport("user32")] public static extern IntPtr SendMessageTimeout(IntPtr w,uint msg,IntPtr wp,IntPtr lp,uint flags,uint timeout,out IntPtr result);
    [DllImport("user32")] public static extern bool PostMessage(IntPtr w,uint msg,IntPtr wp,IntPtr lp);
    [DllImport("user32")] public static extern int GetMenuItemCount(IntPtr menu);
    [DllImport("user32")] public static extern IntPtr GetSubMenu(IntPtr menu,int pos);
    [DllImport("user32")] public static extern uint GetMenuState(IntPtr menu,uint pos,uint flags);
    [DllImport("user32", CharSet=CharSet.Unicode)] static extern int GetMenuString(IntPtr menu,uint pos,StringBuilder s,int len,uint flags);
    public static string Label(IntPtr menu,uint pos) {
        var s=new StringBuilder(768); GetMenuString(menu,pos,s,s.Capacity,0x400);return s.ToString();
    }
    public static IntPtr Find(int pid,string title,string cls) {
        IntPtr found=IntPtr.Zero;
        EnumWindows(delegate(IntPtr w,IntPtr p) {
            int owner; GetWindowThreadProcessId(w,out owner);
            if(owner!=pid || !IsWindowVisible(w)) return true;
            var s=new StringBuilder(640);
            if(title!=null && title.Length>0){GetWindowText(w,s,s.Capacity);if(s.ToString()!=title)return true;}
            if(cls!=null && cls.Length>0){s.Clear();GetClassName(w,s,s.Capacity);if(s.ToString()!=cls)return true;}
            found=w; return false;
        },IntPtr.Zero);return found;
    }
    public static IntPtr Menu(IntPtr window) {
        IntPtr result;SendMessageTimeout(window,0x1e1,IntPtr.Zero,IntPtr.Zero,2,500,out result);return result;
    }
    public static IntPtr Popup(int pid, IntPtr expectedMenu) {
        var popups = new Dictionary<IntPtr, IntPtr>();
        var children = new HashSet<IntPtr>();
        EnumWindows(delegate(IntPtr w, IntPtr unused) {
            int owner; GetWindowThreadProcessId(w, out owner);
            if (owner != pid || !IsWindowVisible(w)) return true;
            var name = new StringBuilder(64);
            GetClassName(w, name, name.Capacity);
            if (name.ToString() != "#32768") return true;
            var menu = Menu(w);
            if (menu == IntPtr.Zero) return true;
            popups[menu] = w;
            int count = GetMenuItemCount(menu);
            for (int i = 0; i < count; i++) children.Add(GetSubMenu(menu, i));
            return true;
        }, IntPtr.Zero);
        if (expectedMenu != IntPtr.Zero) {
            IntPtr match;
            return popups.TryGetValue(expectedMenu, out match) ? match : IntPtr.Zero;
        }
        // A highlighted submenu can already be visible when the next probe attaches.
        foreach (var pair in popups) if (!children.Contains(pair.Key)) return pair.Value;
        return IntPtr.Zero;
    }
}
'@
[void][PetProbe]::SetProcessDPIAware()
$window = [PetProbe]::Find($HostProcessId, $PetWindow, '')
if ($window -eq [IntPtr]::Zero) { throw 'The owned pet window is unavailable' }
function Get-MenuTree([IntPtr]$Menu) {
    for ($i = 0; $i -lt [PetProbe]::GetMenuItemCount($Menu); $i++) {
        $flags = [PetProbe]::GetMenuState($Menu, $i, 0x400)
        $sub = [PetProbe]::GetSubMenu($Menu, $i)
        $children = $null
        if ($sub -ne [IntPtr]::Zero) { $children = @(Get-MenuTree $sub) }
        [pscustomobject]@{label=[PetProbe]::Label($Menu, $i); checked=[bool]($flags -band 8); enabled=!($flags -band 3); separator=($sub -eq [IntPtr]::Zero -and [bool]($flags -band 0x800)); children=$children }
    }
}
$popup = [PetProbe]::Popup($HostProcessId, [IntPtr]::Zero)
if ($Action -eq 'tree') {
    if ($popup -eq [IntPtr]::Zero) { 'null'; exit 0 }
    $menu = [PetProbe]::Menu($popup)
    ConvertTo-Json -InputObject @(Get-MenuTree $menu) -Depth 16 -Compress
} elseif ($Action -eq 'close-window') {
    if (![PetProbe]::PostMessage($window,0x10,0,0)) { throw 'Could not close the owned pet window' }
} elseif ($Action -eq 'close') {
    if ($popup -ne [IntPtr]::Zero) { [void][PetProbe]::PostMessage($window,0x1f,0,0) }
} elseif ($Action -eq 'choose') {
    if ($popup -eq [IntPtr]::Zero) { throw 'The native menu has closed' }
    $indices = $ItemPath.Split('.')
    foreach ($index in $indices) {
        $menu = [PetProbe]::Menu($popup)
        $count = [PetProbe]::GetMenuItemCount($menu)
        if ([int]$index -lt 0 -or [int]$index -ge $count) { throw "Native menu path $ItemPath requested index $index in a menu of $count items" }
        [void][PetProbe]::PostMessage($popup,0x1e5,[int]$index,0)
        Start-Sleep -Milliseconds 50
        $next = [PetProbe]::GetSubMenu($menu,[int]$index)
        $key = if ($next -eq [IntPtr]::Zero) {13} else {39}
        [void][PetProbe]::PostMessage($window,0x100,$key,0)
        if ($next -ne [IntPtr]::Zero) {
            for ($n=0; $n -lt 60; $n++) {
                Start-Sleep -Milliseconds 20
                $popup = [PetProbe]::Popup($HostProcessId, $next)
                if ($popup -ne [IntPtr]::Zero) { break }
            }
            if ($popup -eq [IntPtr]::Zero) { throw 'Native submenu did not open' }
        }
    }
} elseif ($Action -eq 'input') {
    $rect = New-Object PetProbe+Rect
    [void][PetProbe]::GetWindowRect($window, [ref]$rect)
    $saved = New-Object PetProbe+Point
    [void][PetProbe]::GetCursorPos([ref]$saved)
    try {
        $parts = $ItemPath.Split(',')
        $x = $rect.left + [int]$parts[0]; $y = $rect.top + [int]$parts[1]
        [void][PetProbe]::SetCursorPos($x,$y)
        Start-Sleep -Milliseconds 250
        $over = [PetProbe]::GetWindowLong($window,-20)
        [void][PetProbe]::SetCursorPos($rect.left-18,$rect.top-18)
        Start-Sleep -Milliseconds 250
        $outside = [PetProbe]::GetWindowLong($window,-20)
        [pscustomobject]@{topmost=[bool]($over -band 8);inputOnSprite=!( $over -band 32 );passthroughOutside=[bool]($outside -band 32)} | ConvertTo-Json -Compress
    } finally { [void][PetProbe]::SetCursorPos($saved.x,$saved.y) }
} else { throw 'Unknown acceptance operation' }
