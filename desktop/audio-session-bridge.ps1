param(
  [Parameter(Mandatory = $true)][int]$RootPid,
  [int]$SpotifyHostPid = 0,
  [string]$GroupingGuid = '5b9ce689-71e0-4bda-89df-126e572712fa',
  [string]$DisplayName = 'ShinaYuu Music',
  [string]$IconPath = ''
)

$ErrorActionPreference = 'SilentlyContinue'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace ShinaYuu.AudioSessions {
  enum EDataFlow { eRender, eCapture, eAll }
  enum ERole { eConsole, eMultimedia, eCommunications }
  enum AudioSessionState { Inactive = 0, Active = 1, Expired = 2 }

  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumeratorComObject { }

  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(EDataFlow dataFlow, uint stateMask, out IntPtr devices);
    int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice endpoint);
    int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
    int RegisterEndpointNotificationCallback(IntPtr client);
    int UnregisterEndpointNotificationCallback(IntPtr client);
  }

  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("D666063F-1587-4E43-81F1-B948E807363F")]
  interface IMMDevice {
    int Activate(ref Guid iid, uint clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
    int OpenPropertyStore(uint access, out IntPtr properties);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetState(out uint state);
  }

  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F")]
  interface IAudioSessionManager2 {
    int GetAudioSessionControl(ref Guid sessionGuid, uint streamFlags, out IntPtr sessionControl);
    int GetSimpleAudioVolume(ref Guid sessionGuid, uint streamFlags, out IntPtr audioVolume);
    int GetSessionEnumerator(out IAudioSessionEnumerator sessionEnumerator);
    int RegisterSessionNotification(IntPtr sessionNotification);
    int UnregisterSessionNotification(IntPtr sessionNotification);
    int RegisterDuckNotification([MarshalAs(UnmanagedType.LPWStr)] string sessionId, IntPtr duckNotification);
    int UnregisterDuckNotification(IntPtr duckNotification);
  }

  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8")]
  interface IAudioSessionEnumerator {
    int GetCount(out int count);
    int GetSession(int index, out IAudioSessionControl control);
  }

  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD")]
  interface IAudioSessionControl { }

  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D")]
  interface IAudioSessionControl2 {
    int GetState(out AudioSessionState state);
    int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string displayName);
    int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string displayName, ref Guid eventContext);
    int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string iconPath);
    int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string iconPath, ref Guid eventContext);
    int GetGroupingParam(out Guid groupingId);
    int SetGroupingParam(ref Guid groupingId, ref Guid eventContext);
    int RegisterAudioSessionNotification(IntPtr client);
    int UnregisterAudioSessionNotification(IntPtr client);
    int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string sessionIdentifier);
    int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string sessionInstanceIdentifier);
    int GetProcessId(out uint processId);
    int IsSystemSoundsSession();
    int SetDuckingPreference(bool optOut);
  }

  public static class AudioSessionBridge {
    const uint CLSCTX_ALL = 23;

    static void Release(object value) {
      if (value != null && Marshal.IsComObject(value)) {
        try { Marshal.ReleaseComObject(value); } catch { }
      }
    }

    public static int Apply(int[] processIds, string groupingGuid, string displayName, string iconPath) {
      if (processIds == null || processIds.Length == 0) return 0;
      var wanted = new HashSet<uint>();
      foreach (var pid in processIds) if (pid > 0) wanted.Add((uint)pid);
      Guid group = Guid.Parse(groupingGuid);
      Guid context = Guid.Empty;
      IMMDevice device = null;
      IAudioSessionManager2 manager = null;
      IAudioSessionEnumerator sessions = null;
      int changed = 0;
      try {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        try {
          Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out device));
          Guid managerId = typeof(IAudioSessionManager2).GUID;
          object managerObject;
          Marshal.ThrowExceptionForHR(device.Activate(ref managerId, CLSCTX_ALL, IntPtr.Zero, out managerObject));
          manager = (IAudioSessionManager2)managerObject;
          Marshal.ThrowExceptionForHR(manager.GetSessionEnumerator(out sessions));
          int count;
          Marshal.ThrowExceptionForHR(sessions.GetCount(out count));
          for (int i = 0; i < count; i++) {
            IAudioSessionControl control = null;
            IAudioSessionControl2 control2 = null;
            try {
              if (sessions.GetSession(i, out control) != 0 || control == null) continue;
              control2 = control as IAudioSessionControl2;
              if (control2 == null) continue;
              uint pid;
              if (control2.GetProcessId(out pid) != 0 || pid == 0 || !wanted.Contains(pid)) continue;
              control2.SetGroupingParam(ref group, ref context);
              if (!String.IsNullOrWhiteSpace(displayName)) control2.SetDisplayName(displayName, ref context);
              if (!String.IsNullOrWhiteSpace(iconPath)) control2.SetIconPath(iconPath, ref context);
              changed++;
            } catch { }
            finally {
              if (control2 != null) Release(control2);
              else Release(control);
            }
          }
        } finally { Release(enumerator); }
      } catch { }
      finally {
        Release(sessions);
        Release(manager);
        Release(device);
      }
      return changed;
    }
  }
}
'@

function Get-ApplicationProcessIds {
  param([int[]]$Roots)
  $rows = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
  $set = New-Object 'System.Collections.Generic.HashSet[int]'
  foreach ($id in $Roots) { if ($id -gt 0) { [void]$set.Add($id) } }
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($row in $rows) {
      if ($set.Contains([int]$row.ParentProcessId) -and -not $set.Contains([int]$row.ProcessId)) {
        [void]$set.Add([int]$row.ProcessId)
        $changed = $true
      }
    }
  }
  return @($set)
}

while (Get-Process -Id $RootPid -ErrorAction SilentlyContinue) {
  $roots = @($RootPid)
  if ($SpotifyHostPid -gt 0) { $roots += $SpotifyHostPid }
  $ids = Get-ApplicationProcessIds -Roots $roots
  [void][ShinaYuu.AudioSessions.AudioSessionBridge]::Apply($ids, $GroupingGuid, $DisplayName, $IconPath)
  Start-Sleep -Milliseconds 1500
}
