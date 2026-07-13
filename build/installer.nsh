!ifndef MUI_BGCOLOR
  !define MUI_BGCOLOR "FFFFFF"
!endif
!ifndef MUI_TEXTCOLOR
  !define MUI_TEXTCOLOR "111217"
!endif
!ifndef MUI_DIRECTORYPAGE_BGCOLOR
  !define MUI_DIRECTORYPAGE_BGCOLOR "FFFFFF"
!endif
!ifndef MUI_DIRECTORYPAGE_TEXTCOLOR
  !define MUI_DIRECTORYPAGE_TEXTCOLOR "111217"
!endif
!ifndef MUI_INSTFILESPAGE_COLORS
  !define MUI_INSTFILESPAGE_COLORS "3257F7 FFFFFF"
!endif
!ifndef MUI_FINISHPAGE_LINK_COLOR
  !define MUI_FINISHPAGE_LINK_COLOR "3257F7"
!endif
!ifndef MUI_HEADERIMAGE
  !define MUI_HEADERIMAGE
!endif
!ifndef MUI_HEADERIMAGE_BITMAP_STRETCH
  !define MUI_HEADERIMAGE_BITMAP_STRETCH "FitControl"
!endif
!ifndef MUI_HEADERIMAGE_UNBITMAP_STRETCH
  !define MUI_HEADERIMAGE_UNBITMAP_STRETCH "FitControl"
!endif
!ifndef BUILD_UNINSTALLER
  !ifndef MUI_CUSTOMFUNCTION_GUIINIT
    !define MUI_CUSTOMFUNCTION_GUIINIT MineradioGuiInit
  !endif
!endif

!include LogicLib.nsh
!include FileFunc.nsh
!include StdUtils.nsh
!include nsDialogs.nsh
!include WinMessages.nsh
!include x64.nsh

!define MINERADIO_INSTALL_MARKER ".shinayuu-music-install-root"

!ifndef BUILD_UNINSTALLER
  Var MineradioWelcomePage
  Var MineradioHeroFont
  Var MineradioTitleFont
  Var MineradioBodyFont
  Var MineradioSmallFont
  Var MineradioDirectoryPage
  Var MineradioDirectoryInput
!endif

!macro customInit
  !ifndef BUILD_UNINSTALLER
    Call MineradioUsePreferredInstallDir
    Call MineradioDisableUnsafeOldUninstallers
    ${If} ${Silent}
      Call MineradioValidateInstallDir
    ${EndIf}
  !endif
!macroend

!macro customInstall
  Call ShinaYuuEnsureWebView2Runtime
  FileOpen $0 "$INSTDIR\${MINERADIO_INSTALL_MARKER}" w
  ${IfNot} ${Errors}
    FileWrite $0 "ShinaYuu Music install root$\r$\n"
    FileWrite $0 "appId=com.shinayuu.music$\r$\n"
    FileClose $0
  ${EndIf}
!macroend

!macro customRemoveFiles
  Call un.MineradioRemoveInstalledFiles
!macroend

!macro customWelcomePage
  Page custom MineradioWelcomeShow
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customPageAfterChangeDir
  Page custom MineradioDirectoryShow MineradioDirectoryLeave
!macroend

!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    Function MineradioFinishStartApp
      ${If} ${isUpdated}
        StrCpy $1 "--updated"
      ${Else}
        StrCpy $1 ""
      ${EndIf}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "MineradioFinishStartApp"
  !endif
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW MineradioTintCommonControls
  !insertmacro MUI_PAGE_FINISH
!macroend

!ifndef BUILD_UNINSTALLER
Function ShinaYuuReadWebView2Version
  StrCpy $R8 ""
  ${If} ${RunningX64}
    SetRegView 64
    ReadRegStr $R8 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
    ${If} $R8 == ""
      ReadRegStr $R8 HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
    ${EndIf}
    SetRegView 32
  ${Else}
    ReadRegStr $R8 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
    ${If} $R8 == ""
      ReadRegStr $R8 HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
    ${EndIf}
  ${EndIf}
  Push $R8
FunctionEnd

Function ShinaYuuEnsureWebView2Runtime
  Call ShinaYuuReadWebView2Version
  Pop $R8
  ${If} $R8 != ""
  ${AndIf} $R8 != "0.0.0.0"
    DetailPrint "Microsoft Edge WebView2 Runtime detected: $R8"
    Return
  ${EndIf}

  DetailPrint "Microsoft Edge WebView2 Runtime is missing. Installing the Evergreen Runtime..."
  StrCpy $R9 "$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe"
  ; Escape the PowerShell dollar sign for NSIS. $$ becomes a literal $ at runtime.
  nsExec::ExecToStack 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$$ProgressPreference = ''SilentlyContinue''; Invoke-WebRequest -UseBasicParsing -Uri ''https://go.microsoft.com/fwlink/p/?LinkId=2124703'' -OutFile ''$R9''"'
  Pop $R7
  Pop $R6
  ${If} $R7 != "0"
    MessageBox MB_ICONEXCLAMATION|MB_OK "ShinaYuu Music could not download Microsoft Edge WebView2 Runtime. Spotify playback may be unavailable until WebView2 Runtime is installed."
    Return
  ${EndIf}

  ExecWait '"$R9" /silent /install' $R7
  ${If} $R7 != "0"
  ${AndIf} $R7 != "3010"
    MessageBox MB_ICONEXCLAMATION|MB_OK "Microsoft Edge WebView2 Runtime installation returned code $R7. ShinaYuu Music will still be installed, but Spotify playback may require WebView2 Runtime."
  ${Else}
    DetailPrint "Microsoft Edge WebView2 Runtime installation completed."
  ${EndIf}
FunctionEnd

Function MineradioGuiInit
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4) i .r0'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 19, *i 1, i 4) i .r0'
  Call MineradioTintCommonControls
FunctionEnd

Function MineradioTintCommonControls
  SetCtlColors $HWNDPARENT "111217" "FFFFFF"

  GetDlgItem $0 $HWNDPARENT 1
  ${If} $0 <> 0
    SetCtlColors $0 "111217" "FFFFFF"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 2
  ${If} $0 <> 0
    SetCtlColors $0 "111217" "FFFFFF"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 3
  ${If} $0 <> 0
    SetCtlColors $0 "111217" "FFFFFF"
  ${EndIf}

  GetDlgItem $0 $HWNDPARENT 1028
  ${If} $0 <> 0
    SetCtlColors $0 "4B5263" "FFFFFF"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1256
  ${If} $0 <> 0
    SetCtlColors $0 "4B5263" "FFFFFF"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1034
  ${If} $0 <> 0
    SetCtlColors $0 "" "FFFFFF"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1035
  ${If} $0 <> 0
    SetCtlColors $0 "" "FFFFFF"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1037
  ${If} $0 <> 0
    SetCtlColors $0 "111217" "FFFFFF"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1038
  ${If} $0 <> 0
    SetCtlColors $0 "4B5263" "FFFFFF"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1039
  ${If} $0 <> 0
    SetCtlColors $0 "" "FFFFFF"
  ${EndIf}

  FindWindow $0 "#32770" "" $HWNDPARENT
  ${If} $0 <> 0
    SetCtlColors $0 "111217" "FFFFFF"

    GetDlgItem $1 $0 1000
    ${If} $1 <> 0
      SetCtlColors $1 "111217" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1001
    ${If} $1 <> 0
      SetCtlColors $1 "111217" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1004
    ${If} $1 <> 0
      SetCtlColors $1 "3257F7" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1006
    ${If} $1 <> 0
      SetCtlColors $1 "4B5263" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1016
    ${If} $1 <> 0
      SetCtlColors $1 "4B5263" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1019
    ${If} $1 <> 0
      SetCtlColors $1 "111217" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1020
    ${If} $1 <> 0
      SetCtlColors $1 "4B5263" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1023
    ${If} $1 <> 0
      SetCtlColors $1 "4B5263" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1024
    ${If} $1 <> 0
      SetCtlColors $1 "4B5263" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1027
    ${If} $1 <> 0
      SetCtlColors $1 "111217" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1201
    ${If} $1 <> 0
      SetCtlColors $1 "111217" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1202
    ${If} $1 <> 0
      SetCtlColors $1 "4B5263" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1203
    ${If} $1 <> 0
      SetCtlColors $1 "111217" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1204
    ${If} $1 <> 0
      SetCtlColors $1 "4B5263" "FFFFFF"
    ${EndIf}
  ${EndIf}
FunctionEnd

Function MineradioUsePreferredInstallDir
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/D=" $R1
  ${IfNot} ${Errors}
  ${AndIf} $R1 != ""
    StrCpy $INSTDIR "$R1"
  ${Else}
    Call MineradioUseRegisteredInstallDir
    Pop $R2
    ${If} $R2 != "1"
      Call MineradioUseFirstAvailableInstallDir
    ${EndIf}
  ${EndIf}
  Push "$INSTDIR"
  Call MineradioNormalizeInstallDir
  Pop $INSTDIR
FunctionEnd

Function MineradioUseFirstAvailableInstallDir
  IfFileExists "D:\*.*" driveD 0
  IfFileExists "E:\*.*" driveE 0
  IfFileExists "F:\*.*" driveF 0
  IfFileExists "G:\*.*" driveG 0
  IfFileExists "H:\*.*" driveH 0
  IfFileExists "I:\*.*" driveI 0
  IfFileExists "J:\*.*" driveJ 0
  IfFileExists "K:\*.*" driveK 0
  IfFileExists "L:\*.*" driveL 0
  IfFileExists "M:\*.*" driveM 0
  IfFileExists "N:\*.*" driveN 0
  IfFileExists "O:\*.*" driveO 0
  IfFileExists "P:\*.*" driveP 0
  IfFileExists "Q:\*.*" driveQ 0
  IfFileExists "R:\*.*" driveR 0
  IfFileExists "S:\*.*" driveS 0
  IfFileExists "T:\*.*" driveT 0
  IfFileExists "U:\*.*" driveU 0
  IfFileExists "V:\*.*" driveV 0
  IfFileExists "W:\*.*" driveW 0
  IfFileExists "X:\*.*" driveX 0
  IfFileExists "Y:\*.*" driveY 0
  IfFileExists "Z:\*.*" driveZ 0
  StrCpy $INSTDIR "C:\ShinaYuu Music"
  Return

  driveD:
    StrCpy $INSTDIR "D:\ShinaYuu Music"
    Return
  driveE:
    StrCpy $INSTDIR "E:\ShinaYuu Music"
    Return
  driveF:
    StrCpy $INSTDIR "F:\ShinaYuu Music"
    Return
  driveG:
    StrCpy $INSTDIR "G:\ShinaYuu Music"
    Return
  driveH:
    StrCpy $INSTDIR "H:\ShinaYuu Music"
    Return
  driveI:
    StrCpy $INSTDIR "I:\ShinaYuu Music"
    Return
  driveJ:
    StrCpy $INSTDIR "J:\ShinaYuu Music"
    Return
  driveK:
    StrCpy $INSTDIR "K:\ShinaYuu Music"
    Return
  driveL:
    StrCpy $INSTDIR "L:\ShinaYuu Music"
    Return
  driveM:
    StrCpy $INSTDIR "M:\ShinaYuu Music"
    Return
  driveN:
    StrCpy $INSTDIR "N:\ShinaYuu Music"
    Return
  driveO:
    StrCpy $INSTDIR "O:\ShinaYuu Music"
    Return
  driveP:
    StrCpy $INSTDIR "P:\ShinaYuu Music"
    Return
  driveQ:
    StrCpy $INSTDIR "Q:\ShinaYuu Music"
    Return
  driveR:
    StrCpy $INSTDIR "R:\ShinaYuu Music"
    Return
  driveS:
    StrCpy $INSTDIR "S:\ShinaYuu Music"
    Return
  driveT:
    StrCpy $INSTDIR "T:\ShinaYuu Music"
    Return
  driveU:
    StrCpy $INSTDIR "U:\ShinaYuu Music"
    Return
  driveV:
    StrCpy $INSTDIR "V:\ShinaYuu Music"
    Return
  driveW:
    StrCpy $INSTDIR "W:\ShinaYuu Music"
    Return
  driveX:
    StrCpy $INSTDIR "X:\ShinaYuu Music"
    Return
  driveY:
    StrCpy $INSTDIR "Y:\ShinaYuu Music"
    Return
  driveZ:
    StrCpy $INSTDIR "Z:\ShinaYuu Music"
    Return
FunctionEnd

Function MineradioHasPreferredInstallDrive
  IfFileExists "D:\*.*" hasPreferred 0
  IfFileExists "E:\*.*" hasPreferred 0
  IfFileExists "F:\*.*" hasPreferred 0
  IfFileExists "G:\*.*" hasPreferred 0
  IfFileExists "H:\*.*" hasPreferred 0
  IfFileExists "I:\*.*" hasPreferred 0
  IfFileExists "J:\*.*" hasPreferred 0
  IfFileExists "K:\*.*" hasPreferred 0
  IfFileExists "L:\*.*" hasPreferred 0
  IfFileExists "M:\*.*" hasPreferred 0
  IfFileExists "N:\*.*" hasPreferred 0
  IfFileExists "O:\*.*" hasPreferred 0
  IfFileExists "P:\*.*" hasPreferred 0
  IfFileExists "Q:\*.*" hasPreferred 0
  IfFileExists "R:\*.*" hasPreferred 0
  IfFileExists "S:\*.*" hasPreferred 0
  IfFileExists "T:\*.*" hasPreferred 0
  IfFileExists "U:\*.*" hasPreferred 0
  IfFileExists "V:\*.*" hasPreferred 0
  IfFileExists "W:\*.*" hasPreferred 0
  IfFileExists "X:\*.*" hasPreferred 0
  IfFileExists "Y:\*.*" hasPreferred 0
  IfFileExists "Z:\*.*" hasPreferred 0
  Push "0"
  Return

  hasPreferred:
    Push "1"
    Return
FunctionEnd

Function MineradioNormalizeInstallDir
  Exch $0
  Push "$0"
  Call MineradioTrimInstallDir
  Pop $0
  StrLen $1 "$0"
  ${If} $1 == 2
    StrCpy $2 "$0" 1 1
    ${If} $2 == ":"
      StrCpy $0 "$0\ShinaYuu Music"
    ${EndIf}
  ${ElseIf} $1 == 3
    StrCpy $2 "$0" 1 1
    StrCpy $3 "$0" 1 2
    ${If} $2 == ":"
    ${AndIf} $3 == "\"
      StrCpy $0 "$0ShinaYuu Music"
    ${EndIf}
  ${EndIf}

  StrLen $1 "$0"
  StrCpy $2 "$0" 15 -15
  StrCpy $3 "$0" 10 -10
  ${If} $3 == "\mineradio"
    ; Keep the legacy application folder unchanged.
  ${ElseIf} $1 >= 15
  ${AndIf} $2 == "\ShinaYuu Music"
    ; The selected path is already the dedicated application folder.
  ${Else}
    StrCpy $0 "$0\ShinaYuu Music"
  ${EndIf}
  Exch $0
FunctionEnd

Function MineradioTrimInstallDir
  Exch $0

  trim:
    StrLen $1 "$0"
    ${If} $1 > 3
      StrCpy $2 "$0" 1 -1
      ${If} $2 == "\"
        StrCpy $0 "$0" -1
        Goto trim
      ${EndIf}
    ${EndIf}

  Exch $0
FunctionEnd

Function MineradioInstallDirLooksOwned
  Exch $0
  StrCpy $1 "0"

  IfFileExists "$0\${MINERADIO_INSTALL_MARKER}" 0 +2
    StrCpy $1 "1"

  StrCpy $0 "$1"
  Exch $0
FunctionEnd

Function MineradioExistingInstallPathCanBeAdopted
  Exch $0
  StrCpy $1 "0"

  ${If} $0 == ""
    Goto done
  ${EndIf}

  Push "$0"
  Call MineradioTrimInstallDir
  Pop $2
  ${If} $2 == ""
    Goto done
  ${EndIf}

  Push "$2"
  Call MineradioNormalizeInstallDir
  Pop $3
  ${If} $2 != $3
    Goto done
  ${EndIf}

  IfFileExists "$2\*.*" 0 done
  IfFileExists "$2\${MINERADIO_INSTALL_MARKER}" adopt 0
  IfFileExists "$2\${PRODUCT_FILENAME}.exe" adopt 0
  IfFileExists "$2\resources\app.asar" adopt 0
  IfFileExists "$2\resources\app\package.json" adopt 0
  IfFileExists "$2\resources\app\server.js" adopt 0
  Goto done

  adopt:
    StrCpy $1 "1"

  done:
    StrCpy $0 "$1"
    Exch $0
FunctionEnd

Function MineradioUseRegisteredInstallDir
  ReadRegStr $0 HKCU "Software\${APP_GUID}" InstallLocation
  Push "$0"
  Call MineradioExistingInstallPathCanBeAdopted
  Pop $1
  ${If} $1 == "1"
    Push "$0"
    Call MineradioNormalizeInstallDir
    Pop $INSTDIR
    Push "1"
    Return
  ${EndIf}

  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
  Push "$0"
  Call MineradioExistingInstallPathCanBeAdopted
  Pop $1
  ${If} $1 == "1"
    Push "$0"
    Call MineradioNormalizeInstallDir
    Pop $INSTDIR
    Push "1"
    Return
  ${EndIf}

  ReadRegStr $0 HKLM "Software\${APP_GUID}" InstallLocation
  Push "$0"
  Call MineradioExistingInstallPathCanBeAdopted
  Pop $1
  ${If} $1 == "1"
    Push "$0"
    Call MineradioNormalizeInstallDir
    Pop $INSTDIR
    Push "1"
    Return
  ${EndIf}

  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
  Push "$0"
  Call MineradioExistingInstallPathCanBeAdopted
  Pop $1
  ${If} $1 == "1"
    Push "$0"
    Call MineradioNormalizeInstallDir
    Pop $INSTDIR
    Push "1"
    Return
  ${EndIf}

  Push "0"
FunctionEnd

Function MineradioRegisteredInstallDirCanBeAdopted
  Exch $0
  StrCpy $1 "0"

  ${If} $0 == ""
    Goto done
  ${EndIf}

  Push "$0"
  Call MineradioNormalizeInstallDir
  Pop $2

  ReadRegStr $3 HKCU "Software\${APP_GUID}" InstallLocation
  Push "$3"
  Call MineradioExistingInstallPathCanBeAdopted
  Pop $4
  ${If} $4 == "1"
    Push "$3"
    Call MineradioNormalizeInstallDir
    Pop $5
    ${If} $5 == $2
      StrCpy $1 "1"
      Goto done
    ${EndIf}
  ${EndIf}

  ReadRegStr $3 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
  Push "$3"
  Call MineradioExistingInstallPathCanBeAdopted
  Pop $4
  ${If} $4 == "1"
    Push "$3"
    Call MineradioNormalizeInstallDir
    Pop $5
    ${If} $5 == $2
      StrCpy $1 "1"
      Goto done
    ${EndIf}
  ${EndIf}

  ReadRegStr $3 HKLM "Software\${APP_GUID}" InstallLocation
  Push "$3"
  Call MineradioExistingInstallPathCanBeAdopted
  Pop $4
  ${If} $4 == "1"
    Push "$3"
    Call MineradioNormalizeInstallDir
    Pop $5
    ${If} $5 == $2
      StrCpy $1 "1"
      Goto done
    ${EndIf}
  ${EndIf}

  ReadRegStr $3 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
  Push "$3"
  Call MineradioExistingInstallPathCanBeAdopted
  Pop $4
  ${If} $4 == "1"
    Push "$3"
    Call MineradioNormalizeInstallDir
    Pop $5
    ${If} $5 == $2
      StrCpy $1 "1"
      Goto done
    ${EndIf}
  ${EndIf}

  done:
    StrCpy $0 "$1"
    Exch $0
FunctionEnd

Function MineradioInstallDirIsEmpty
  Exch $0
  FindFirst $1 $2 "$0\*.*"
  StrCpy $3 "1"

  loop:
    StrCmp $2 "" done
    StrCmp $2 "." next
    StrCmp $2 ".." next
    StrCpy $3 "0"
    Goto done

  next:
    FindNext $1 $2
    Goto loop

  done:
    FindClose $1
    StrCpy $0 "$3"
    Exch $0
FunctionEnd

Function MineradioOldInstallPathNeedsQuarantine
  Exch $0
  StrCpy $1 "0"

  ${If} $0 == ""
    Goto done
  ${EndIf}

  Push "$0"
  Call MineradioTrimInstallDir
  Pop $2
  Push "$2"
  Call MineradioNormalizeInstallDir
  Pop $3

  ${If} $2 != $3
    StrCpy $1 "1"
    Goto done
  ${EndIf}

  IfFileExists "$2\${MINERADIO_INSTALL_MARKER}" done 0
  Push "$2"
  Call MineradioExistingInstallPathCanBeAdopted
  Pop $4
  ${If} $4 == "1"
    Goto done
  ${EndIf}

  StrCpy $1 "1"

  done:
    StrCpy $0 "$1"
    Exch $0
FunctionEnd

Function MineradioDisableUnsafeOldUninstallers
  StrCpy $2 "0"

  ReadRegStr $0 HKCU "Software\${APP_GUID}" InstallLocation
  Push "$0"
  Call MineradioDeleteLegacyUninstallerFileIfMissingMarker
  Push "$0"
  Call MineradioOldInstallPathNeedsQuarantine
  Pop $1
  ${If} $1 == "1"
    DetailPrint "Skip unsafe legacy ShinaYuu Music uninstaller: $0"
    StrCpy $2 "1"
  ${EndIf}

  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
  Push "$0"
  Call MineradioDeleteLegacyUninstallerFileIfMissingMarker
  Push "$0"
  Call MineradioOldInstallPathNeedsQuarantine
  Pop $1
  ${If} $1 == "1"
    DetailPrint "Skip unsafe legacy ShinaYuu Music uninstaller: $0"
    StrCpy $2 "1"
  ${EndIf}

  ${If} $2 == "1"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
    DeleteRegKey HKCU "Software\${APP_GUID}"
  ${EndIf}

  StrCpy $2 "0"

  ReadRegStr $0 HKLM "Software\${APP_GUID}" InstallLocation
  Push "$0"
  Call MineradioDeleteLegacyUninstallerFileIfMissingMarker
  Push "$0"
  Call MineradioOldInstallPathNeedsQuarantine
  Pop $1
  ${If} $1 == "1"
    DetailPrint "Skip unsafe legacy ShinaYuu Music uninstaller: $0"
    StrCpy $2 "1"
  ${EndIf}

  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
  Push "$0"
  Call MineradioDeleteLegacyUninstallerFileIfMissingMarker
  Push "$0"
  Call MineradioOldInstallPathNeedsQuarantine
  Pop $1
  ${If} $1 == "1"
    DetailPrint "Skip unsafe legacy ShinaYuu Music uninstaller: $0"
    StrCpy $2 "1"
  ${EndIf}

  ${If} $2 == "1"
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
    DeleteRegKey HKLM "Software\${APP_GUID}"
  ${EndIf}
FunctionEnd

Function MineradioDeleteLegacyUninstallerFileIfMissingMarker
  Pop $0
  ${If} $0 != ""
    Push "$0"
    Call MineradioTrimInstallDir
    Pop $1
    ${If} $1 != ""
      IfFileExists "$1\${MINERADIO_INSTALL_MARKER}" done 0
      DetailPrint "Remove legacy ShinaYuu Music uninstaller file: $1"
      Delete "$1\Uninstall ${PRODUCT_FILENAME}.exe"
    ${EndIf}
  ${EndIf}

  done:
FunctionEnd

Function MineradioValidateInstallDir
  Push "$INSTDIR"
  Call MineradioNormalizeInstallDir
  Pop $INSTDIR

  Push "$INSTDIR"
  Call MineradioRegisteredInstallDirCanBeAdopted
  Pop $3

  Push "$INSTDIR"
  Call MineradioExistingInstallPathCanBeAdopted
  Pop $4

  StrCpy $0 "$INSTDIR" 1 0
  StrCpy $1 "$INSTDIR" 1 1
  ${If} $1 == ":"
    ${If} $0 == "C"
    ${OrIf} $0 == "c"
      Call MineradioHasPreferredInstallDrive
      Pop $2
      ${If} $2 == "1"
      ${AndIf} $3 != "1"
      ${AndIf} $4 != "1"
        MessageBox MB_ICONSTOP|MB_OK "Máy có ổ D-Z nên ứng dụng không cài vào ổ C. Hãy chọn D hoặc ổ khác. Nếu máy chỉ có ổ C, C:\ShinaYuu Music sẽ được chấp nhận."
        Abort
      ${EndIf}
    ${EndIf}
  ${EndIf}

  StrLen $0 "$INSTDIR"
  StrCpy $1 "$INSTDIR" 15 -15
  StrCpy $2 "$INSTDIR" 10 -10
  ${If} $2 == "\mineradio"
    Goto validInstallSuffix
  ${EndIf}
  ${If} $0 >= 15
  ${AndIf} $1 == "\ShinaYuu Music"
    Goto validInstallSuffix
  ${EndIf}
  MessageBox MB_ICONSTOP|MB_OK "Thư mục cài đặt phải dành riêng cho ShinaYuu Music. Chọn thư mục cha để trình cài đặt tự tạo thư mục ứng dụng."
  Abort

  validInstallSuffix:

  IfFileExists "$INSTDIR\*.*" 0 valid

  Push "$INSTDIR"
  Call MineradioInstallDirLooksOwned
  Pop $0
  ${If} $0 == "1"
    Goto valid
  ${EndIf}

  ${If} $3 == "1"
    Goto valid
  ${EndIf}

  ${If} $4 == "1"
    Goto valid
  ${EndIf}

  Push "$INSTDIR"
  Call MineradioInstallDirIsEmpty
  Pop $0
  ${If} $0 == "1"
    Goto valid
  ${EndIf}

  MessageBox MB_ICONSTOP|MB_OK "Để tránh xóa nhầm khi gỡ cài đặt, hãy chọn thư mục trống dành riêng cho ShinaYuu Music.$\r$\n$\r$\nĐường dẫn hiện tại: $INSTDIR"
  Abort

  valid:
FunctionEnd
Function MineradioWelcomeShow
  Call MineradioUsePreferredInstallDir

  nsDialogs::Create 1018
  Pop $MineradioWelcomePage
  ${If} $MineradioWelcomePage == error
    Abort
  ${EndIf}

  SetCtlColors $MineradioWelcomePage "111217" "FFFFFF"
  CreateFont $MineradioHeroFont "Segoe UI" 24 700
  CreateFont $MineradioTitleFont "Segoe UI" 11 700
  CreateFont $MineradioBodyFont "Segoe UI" 9 400
  CreateFont $MineradioSmallFont "Segoe UI" 8 400

  ${NSD_CreateLabel} 22u 20u 82u 10u "MINERADIO"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $MineradioSmallFont 1
  SetCtlColors $0 "3257F7" "FFFFFF"

  ${NSD_CreateLabel} 22u 42u 226u 30u "Cài đặt ShinaYuu Music / ShinaYuu Music Setup"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $MineradioHeroFont 1
  SetCtlColors $0 "111217" "FFFFFF"

  ${NSD_CreateLabel} 22u 78u 36u 2u ""
  Pop $0
  SetCtlColors $0 "" "3257F7"

  ${NSD_CreateLabel} 22u 96u 238u 24u "Cài ShinaYuu Music trên máy tính này. Mặc định: D:\ShinaYuu Music; bạn có thể chọn vị trí khác ở bước tiếp theo."
  Pop $0
  SendMessage $0 ${WM_SETFONT} $MineradioBodyFont 1
  SetCtlColors $0 "4B5263" "FFFFFF"

  ${NSD_CreateLabel} 22u 130u 238u 12u "默认位置：$INSTDIR"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $MineradioTitleFont 1
  SetCtlColors $0 "3257F7" "FFFFFF"

  nsDialogs::Show
FunctionEnd

Function MineradioDirectoryBrowse
  nsDialogs::SelectFolderDialog "Chọn thư mục cài đặt ShinaYuu Music / Choose install folder" "$INSTDIR"
  Pop $0
  ${If} $0 != error
  ${AndIf} $0 != ""
    Push "$0"
    Call MineradioNormalizeInstallDir
    Pop $0
    StrCpy $INSTDIR "$0"
    SendMessage $MineradioDirectoryInput ${WM_SETTEXT} 0 "STR:$INSTDIR"
  ${EndIf}
FunctionEnd

Function MineradioDirectoryShow
  Call MineradioUsePreferredInstallDir

  nsDialogs::Create 1018
  Pop $MineradioDirectoryPage
  ${If} $MineradioDirectoryPage == error
    Abort
  ${EndIf}

  SetCtlColors $MineradioDirectoryPage "111217" "FFFFFF"
  CreateFont $MineradioTitleFont "Segoe UI" 15 700
  CreateFont $MineradioBodyFont "Segoe UI" 9 400
  CreateFont $MineradioSmallFont "Segoe UI" 8 500

  ${NSD_CreateLabel} 22u 12u 238u 20u "选择安装位置"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $MineradioTitleFont 1
  SetCtlColors $0 "111217" "FFFFFF"

  ${NSD_CreateLabel} 22u 40u 238u 24u "你可以使用默认路径，也可以选择其它磁盘或文件夹。安装器会自动创建缺失的目录。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $MineradioBodyFont 1
  SetCtlColors $0 "4B5263" "FFFFFF"

  ${NSD_CreateLabel} 22u 76u 238u 10u "安装目录"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $MineradioSmallFont 1
  SetCtlColors $0 "3257F7" "FFFFFF"

  ${NSD_CreateText} 22u 94u 178u 15u "$INSTDIR"
  Pop $MineradioDirectoryInput
  SendMessage $MineradioDirectoryInput ${WM_SETFONT} $MineradioBodyFont 1
  SetCtlColors $MineradioDirectoryInput "111217" "FFFFFF"

  ${NSD_CreateBrowseButton} 210u 93u 50u 17u "浏览..."
  Pop $0
  SendMessage $0 ${WM_SETFONT} $MineradioSmallFont 1
  ${NSD_OnClick} $0 MineradioDirectoryBrowse

  ${NSD_CreateLabel} 22u 122u 238u 12u "Khuyến nghị: D:\ShinaYuu Music; thư mục sẽ được tạo tự động."
  Pop $0
  SendMessage $0 ${WM_SETFONT} $MineradioSmallFont 1
  SetCtlColors $0 "6B7280" "FFFFFF"

  nsDialogs::Show
FunctionEnd

Function MineradioDirectoryLeave
  ${NSD_GetText} $MineradioDirectoryInput $0
  ${If} $0 == ""
    MessageBox MB_ICONEXCLAMATION|MB_OK "请选择安装文件夹。"
    Abort
  ${EndIf}
  Push "$0"
  Call MineradioNormalizeInstallDir
  Pop $0
  StrCpy $INSTDIR "$0"
  SendMessage $MineradioDirectoryInput ${WM_SETTEXT} 0 "STR:$INSTDIR"
  Call MineradioValidateInstallDir
FunctionEnd
!endif

!ifdef BUILD_UNINSTALLER
!macro customUnInit
  Call un.MineradioValidateUninstallDir
!macroend

Function un.MineradioInstallDirLooksOwned
  Exch $0
  StrCpy $1 "0"

  IfFileExists "$0\${MINERADIO_INSTALL_MARKER}" 0 +2
    StrCpy $1 "1"

  StrCpy $0 "$1"
  Exch $0
FunctionEnd

Function un.MineradioNormalizeInstallDir
  Exch $0
  Push "$0"
  Call un.MineradioTrimInstallDir
  Pop $0
  StrLen $1 "$0"
  ${If} $1 == 2
    StrCpy $2 "$0" 1 1
    ${If} $2 == ":"
      StrCpy $0 "$0\ShinaYuu Music"
    ${EndIf}
  ${ElseIf} $1 == 3
    StrCpy $2 "$0" 1 1
    StrCpy $3 "$0" 1 2
    ${If} $2 == ":"
    ${AndIf} $3 == "\"
      StrCpy $0 "$0ShinaYuu Music"
    ${EndIf}
  ${EndIf}

  StrLen $1 "$0"
  StrCpy $2 "$0" 15 -15
  StrCpy $3 "$0" 10 -10
  ${If} $3 == "\mineradio"
    ; Keep the legacy application folder unchanged.
  ${ElseIf} $1 >= 15
  ${AndIf} $2 == "\ShinaYuu Music"
    ; The selected path is already the dedicated application folder.
  ${Else}
    StrCpy $0 "$0\ShinaYuu Music"
  ${EndIf}
  Exch $0
FunctionEnd

Function un.MineradioTrimInstallDir
  Exch $0

  trim:
    StrLen $1 "$0"
    ${If} $1 > 3
      StrCpy $2 "$0" 1 -1
      ${If} $2 == "\"
        StrCpy $0 "$0" -1
        Goto trim
      ${EndIf}
    ${EndIf}

  Exch $0
FunctionEnd

Function un.MineradioValidateUninstallDir
  Push "$INSTDIR"
  Call un.MineradioTrimInstallDir
  Pop $0
  Push "$0"
  Call un.MineradioNormalizeInstallDir
  Pop $1
  ${If} $0 != $1
    MessageBox MB_OK|MB_ICONSTOP "Đường dẫn hiện tại không phải thư mục riêng của ShinaYuu Music; thao tác gỡ cài đặt đã bị chặn để tránh xóa nhầm.$\r$\n$\r$\nHiện tại: $INSTDIR$\r$\nAn toàn: $0"
    SetErrorLevel 2
    Quit
  ${EndIf}
  StrCpy $INSTDIR "$0"

  Push "$INSTDIR"
  Call un.MineradioInstallDirLooksOwned
  Pop $0
  ${If} $0 != "1"
    MessageBox MB_OK|MB_ICONSTOP "Không thể xác nhận thư mục thuộc ShinaYuu Music; thao tác gỡ cài đặt đã bị chặn.$\r$\n$\r$\nĐường dẫn hiện tại: $INSTDIR"
    SetErrorLevel 2
    Quit
  ${EndIf}
FunctionEnd

Function un.MineradioRemoveInstalledFiles
  SetOutPath $TEMP

  Delete "$INSTDIR\${PRODUCT_FILENAME}.exe"
  Delete "$INSTDIR\Uninstall ${PRODUCT_FILENAME}.exe"
  Delete "$INSTDIR\uninstallerIcon.ico"

  Delete "$INSTDIR\chrome_100_percent.pak"
  Delete "$INSTDIR\chrome_200_percent.pak"
  Delete "$INSTDIR\d3dcompiler_47.dll"
  Delete "$INSTDIR\dxcompiler.dll"
  Delete "$INSTDIR\dxil.dll"
  Delete "$INSTDIR\ffmpeg.dll"
  Delete "$INSTDIR\icudtl.dat"
  Delete "$INSTDIR\libEGL.dll"
  Delete "$INSTDIR\libGLESv2.dll"
  Delete "$INSTDIR\LICENSE.electron.txt"
  Delete "$INSTDIR\LICENSES.chromium.html"
  Delete "$INSTDIR\resources.pak"
  Delete "$INSTDIR\snapshot_blob.bin"
  Delete "$INSTDIR\v8_context_snapshot.bin"
  Delete "$INSTDIR\vk_swiftshader.dll"
  Delete "$INSTDIR\vk_swiftshader_icd.json"
  Delete "$INSTDIR\vulkan-1.dll"

  RMDir "$INSTDIR\locales"
  RMDir "$INSTDIR\resources"
  RMDir "$INSTDIR\swiftshader"

  RMDir "$INSTDIR"
FunctionEnd
!endif
