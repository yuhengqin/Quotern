!define QUOTERN_LEGACY_GUID "77c89c13-52a6-5b46-b7b1-f5b025d10759"
!define QUOTERN_LEGACY_INSTALL "Software\${QUOTERN_LEGACY_GUID}"
!define QUOTERN_LEGACY_UNINSTALL "Software\Microsoft\Windows\CurrentVersion\Uninstall\${QUOTERN_LEGACY_GUID}"

Var QuoternInstallDir
Var QuoternInstallMode
Var QuoternLegacy
Var QuoternLegacyRestart
Var QuoternAllUsersOption

!macro QuoternRememberInstallation MODE
  ${If} $QuoternInstallDir != ""
    Call QuoternAbortMigration
  ${EndIf}
  StrCpy $QuoternInstallDir $R0
  StrCpy $QuoternInstallMode "${MODE}"
!macroend

!macro QuoternReadLegacy ROOT MODE
  ReadRegStr $R0 ${ROOT} "${QUOTERN_LEGACY_INSTALL}" "InstallLocation"
  ReadRegStr $R1 ${ROOT} "${QUOTERN_LEGACY_UNINSTALL}" "DisplayName"
  ${If} $R0 != ""
  ; Electron Builder writes a versioned, sometimes localized DisplayName.
  ; The stable GUID and the installed Electron files identify this product.
  ${AndIf} $R1 != ""
    ${If} ${FileExists} "$R0\${MAINBINARYNAME}.exe"
    ${AndIf} ${FileExists} "$R0\resources\app.asar"
      !insertmacro QuoternRememberInstallation "${MODE}"
      StrCpy $QuoternLegacy 1
    ${EndIf}
  ${EndIf}
!macroend

!macro QuoternReadTauri ROOT MODE
  ReadRegStr $R0 ${ROOT} "${MANUPRODUCTKEY}" ""
  ReadRegStr $R1 ${ROOT} "${UNINSTKEY}" "MainBinaryName"
  ${If} $R0 != ""
  ${AndIf} $R1 == "${MAINBINARYNAME}.exe"
  ${AndIf} ${FileExists} "$R0\${MAINBINARYNAME}.exe"
    !insertmacro QuoternRememberInstallation "${MODE}"
  ${EndIf}
!macroend

!macro QUOTERN_ELECTRON_MIGRATION
LangString QuoternMigrationError ${LANG_ENGLISH} "Quotern could not update the existing installation. Close Quotern and retry with the original Windows user. For an all-users installation, run the installer as an administrator."
LangString QuoternMigrationError ${LANG_SIMPCHINESE} "Quotern 无法更新现有安装。请关闭应用后，以原 Windows 用户重试。更新全用户安装时，请以管理员身份运行安装程序。"
LangString QuoternMigrationError ${LANG_JAPANESE} "既存の Quotern を更新できませんでした。Quotern を終了し、元の Windows ユーザーでやり直してください。全ユーザー向けの更新には管理者としてインストーラーを実行してください。"
LangString QuoternMigrationError ${LANG_KOREAN} "기존 Quotern 설치를 업데이트할 수 없습니다. 앱을 종료하고 원래 Windows 사용자로 다시 시도하세요. 모든 사용자용 설치를 업데이트하려면 설치 프로그램을 관리자로 실행하세요."

Function QuoternAbortMigration
  SetErrorLevel 1
  MessageBox MB_ICONSTOP "$(QuoternMigrationError)" /SD IDOK
  Abort
FunctionEnd

Function QuoternDetectMigration
  ; Tauri updates must stay in the registered scope even if the updater
  ; is launched without the privileges that created the installation.
  ${If} $UpdateMode = 1
    !insertmacro QuoternReadTauri HKCU CurrentUser
    !insertmacro QuoternReadTauri HKLM AllUsers
    ${If} $QuoternInstallDir == ""
      Call QuoternAbortMigration
    ${EndIf}
    Return
  ${EndIf}
  !insertmacro QuoternReadLegacy HKCU CurrentUser
  !insertmacro QuoternReadLegacy HKLM AllUsers
  ${If} $QuoternLegacy = 1
    ; The replacement executable has the same name and path. Retain existing
    ; links and preserve the user's choice to omit a desktop shortcut.
    StrCpy $NoShortcutMode 1
  ${EndIf}
  ${GetOptions} $CMDLINE "--updated" $R0
  ${IfNot} ${Errors}
    ${If} $QuoternLegacy != 1
      Call QuoternAbortMigration
    ${EndIf}
    StrCpy $PassiveMode 1
    SetSilent silent
    ${GetOptions} $CMDLINE "--force-run" $R0
    ${IfNot} ${Errors}
      StrCpy $QuoternLegacyRestart 1
    ${EndIf}
  ${EndIf}
FunctionEnd

Function QuoternSelectInstalledScope
  ${If} $QuoternInstallDir == ""
    Return
  ${EndIf}
  ${If} $QuoternInstallMode == "AllUsers"
    Call MultiUser.InstallMode.AllUsers
  ${Else}
    Call MultiUser.InstallMode.CurrentUser
  ${EndIf}
  ${If} $MultiUser.InstallMode != $QuoternInstallMode
    Call QuoternAbortMigration
  ${EndIf}
  StrCpy $INSTDIR $QuoternInstallDir
FunctionEnd

Function QuoternElevate
  ${GetOptions} $CMDLINE "/QuoternElevated" $R0
  ${IfNot} ${Errors}
    Call QuoternAbortMigration
  ${EndIf}
  ${GetParameters} $R0
  ClearErrors
  ExecShell "runas" "$EXEPATH" "/QuoternElevated /AllUsers $R0"
  ${If} ${Errors}
    Call QuoternAbortMigration
  ${EndIf}
  Quit
FunctionEnd

Function QuoternElevateIfNeeded
  ${GetOptions} $CMDLINE "/AllUsers" $R0
  ${If} ${Errors}
  ${AndIf} $QuoternInstallMode != "AllUsers"
    Return
  ${EndIf}
  UserInfo::GetAccountType
  Pop $R0
  ${If} $R0 != "Admin"
    Call QuoternElevate
  ${EndIf}
FunctionEnd

Function QuoternSkipInstallChoice
  ${If} $QuoternInstallDir != ""
  ${OrIf} $PassiveMode = 1
    Abort
  ${EndIf}
FunctionEnd

Function QuoternUnelevatedChoice
  Call QuoternSkipInstallChoice
  ${If} $MultiUser.Privileges == "Admin"
  ${OrIf} $MultiUser.Privileges == "Power"
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "$(MULTIUSER_TEXT_INSTALLMODE_TITLE)" "$(MULTIUSER_TEXT_INSTALLMODE_SUBTITLE)"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 2u 100% 42u "$(MULTIUSER_INNERTEXT_INSTALLMODE_TOP)"
  Pop $0
  ${NSD_CreateRadioButton} 15u 50u -15u 10u "$(MULTIUSER_INNERTEXT_INSTALLMODE_ALLUSERS)"
  Pop $QuoternAllUsersOption
  ${NSD_CreateRadioButton} 15u 70u -15u 10u "$(MULTIUSER_INNERTEXT_INSTALLMODE_CURRENTUSER)"
  Pop $0
  ${NSD_Check} $0
  nsDialogs::Show
FunctionEnd

Function QuoternUnelevatedChoiceLeave
  ${NSD_GetState} $QuoternAllUsersOption $0
  ${If} $0 = ${BST_CHECKED}
    Call QuoternElevate
  ${EndIf}
FunctionEnd

Function un.QuoternSelectInstalledScope
  ReadRegStr $R0 HKLM "${MANUPRODUCTKEY}" ""
  ${If} $R0 == $INSTDIR
    StrCpy $QuoternInstallDir $INSTDIR
    StrCpy $QuoternInstallMode "AllUsers"
    UserInfo::GetAccountType
    Pop $R0
    ${If} $R0 != "Admin"
      ${GetOptions} $CMDLINE "/QuoternElevated" $R0
      ${If} ${Errors}
        ${GetParameters} $R0
        ClearErrors
        ExecShell "runas" "$INSTDIR\uninstall.exe" "/QuoternElevated /AllUsers $R0"
        ${IfNot} ${Errors}
          Quit
        ${EndIf}
      ${EndIf}
      SetErrorLevel 1
      MessageBox MB_ICONSTOP "$(MULTIUSER_INIT_TEXT_ALLUSERSNOTPOSSIBLE)" /SD IDOK
      Abort
    ${EndIf}
  ${Else}
    ReadRegStr $R0 HKCU "${MANUPRODUCTKEY}" ""
    ${If} $R0 == $INSTDIR
      StrCpy $QuoternInstallDir $INSTDIR
      StrCpy $QuoternInstallMode "CurrentUser"
    ${EndIf}
  ${EndIf}
FunctionEnd

Function QuoternBackupLegacyExecutable
  ${If} $QuoternLegacy = 1
    InitPluginsDir
    System::Call 'kernel32::CopyFileW(w "$QuoternInstallDir\${MAINBINARYNAME}.exe", w "$PLUGINSDIR\quotern-electron.exe", i 0) i.r0'
    ${If} $0 = 0
      Call QuoternAbortMigration
    ${EndIf}
  ${EndIf}
FunctionEnd

Function QuoternFinishMigration
  ${If} $QuoternLegacy != 1
    Return
  ${EndIf}
  ; Validate the replacement registration before discarding the previous installation record.
  ReadRegStr $R0 SHCTX "${UNINSTKEY}" "UninstallString"
  ${If} $R0 != "$\"$INSTDIR\uninstall.exe$\""
    Call QuoternAbortMigration
  ${EndIf}
  ${IfNot} ${FileExists} "$INSTDIR\uninstall.exe"
    Call QuoternAbortMigration
  ${EndIf}
  Delete "$QuoternInstallDir\Uninstall ${PRODUCTNAME}.exe"
  DeleteRegKey SHCTX "${QUOTERN_LEGACY_UNINSTALL}"
  DeleteRegKey SHCTX "${QUOTERN_LEGACY_INSTALL}"
FunctionEnd

Function .onInstFailed
  ${If} $QuoternLegacy = 1
  ${AndIf} ${FileExists} "$PLUGINSDIR\quotern-electron.exe"
    System::Call 'kernel32::CopyFileW(w "$PLUGINSDIR\quotern-electron.exe", w "$QuoternInstallDir\${MAINBINARYNAME}.exe", i 0) i.r0'
    ${If} $0 = 0
      DetailPrint "$(QuoternMigrationError)"
    ${EndIf}
  ${EndIf}
FunctionEnd
!macroend
