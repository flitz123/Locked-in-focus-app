; NSIS Installer Configuration for Locked In
; This file should be placed in build/installer.nsh

!macro customInstall
  ; Create registry entries for proper Windows integration
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "LockedIn" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  
  ; Set file associations (if needed)
  WriteRegStr HKCR ".lockedin" "" "LockedInSession"
  WriteRegStr HKCR "LockedInSession" "" "Locked In Session File"
  WriteRegStr HKCR "LockedInSession\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCR "LockedInSession\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  
  ; Create additional shortcuts
  CreateShortCut "$DESKTOP\Locked In.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  
  ; Set UAC execution level in registry
  WriteRegStr HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "RUNASADMIN"
!macroend

!macro customUnInstall
  ; Remove registry entries
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "LockedIn"
  DeleteRegKey HKCR ".lockedin"
  DeleteRegKey HKCR "LockedInSession"
  DeleteRegValue HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  
  ; Remove additional shortcuts
  Delete "$DESKTOP\Locked In.lnk"
  
  ; Optionally remove user data
  MessageBox MB_YESNO "Do you want to remove all user data and settings?" IDNO skip_userdata
    RMDir /r "$APPDATA\locked-in-app"
    RMDir /r "$LOCALAPPDATA\locked-in-app"
  skip_userdata:
!macroend

!macro customInit
  ; Check Windows version
  ${If} ${AtMostWinVista}
    MessageBox MB_OK "This application requires Windows 7 or later."
    Quit
  ${EndIf}
  
  ; Check for existing installation
  ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\{app-id}" "UninstallString"
  StrCmp $R0 "" done
  
  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION \
  "Locked In is already installed. $\n$\nClick 'OK' to remove the \
  previous version or 'Cancel' to cancel this upgrade." \
  IDOK uninst
  Abort
  
uninst:
  ClearErrors
  ExecWait '$R0 _?=$INSTDIR'
  
  IfErrors no_remove_uninstaller done
    no_remove_uninstaller:
  
done:
!macroend

!macro customHeader
  ; Custom header for installer window
  !define MUI_HEADERIMAGE
  !define MUI_HEADERIMAGE_BITMAP "assets\installer-header.bmp"
  !define MUI_WELCOMEFINISHPAGE_BITMAP "assets\installer-welcome.bmp"
  
  ; Custom installer properties
  VIProductVersion "${VERSION}.0"
  VIAddVersionKey "ProductName" "Locked In"
  VIAddVersionKey "ProductVersion" "${VERSION}"
  VIAddVersionKey "CompanyName" "Locked In Team"
  VIAddVersionKey "FileDescription" "Focus & App Blocker for Windows"
  VIAddVersionKey "FileVersion" "${VERSION}.0"
  VIAddVersionKey "LegalCopyright" "Copyright © 2024 Locked In Team"
  VIAddVersionKey "OriginalFilename" "Locked-In-Setup-${VERSION}.exe"
!macroend

; Post-installation tasks
!macro customInstallMode
  ; Set installation mode to require admin rights
  RequestExecutionLevel admin
  
  ; Check if running as admin
  UserInfo::GetAccountType
  pop $0
  ${If} $0 != "admin" 
    MessageBox mb_iconstop "Administrator rights required!"
    SetErrorLevel 740 ;ERROR_ELEVATION_REQUIRED
    Quit
  ${EndIf}
!macroend