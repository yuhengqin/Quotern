!ifndef BUILD_UNINSTALLER
  !include nsDialogs.nsh

  Var quoternDesktopShortcut
  Var quoternDesktopCheckbox
  Var quoternOptionsShown

  !macro customHeader
    LangString quoternOptionsTitle ${LANG_ENGLISH} "Installation options"
    LangString quoternOptionsTitle ${LANG_SIMPCHINESE} "安装选项"
    LangString quoternOptionsTitle ${LANG_JAPANESE} "インストールオプション"
    LangString quoternOptionsTitle ${LANG_KOREAN} "설치 옵션"
    LangString quoternOptionsSubtitle ${LANG_ENGLISH} "Choose how to access Quotern."
    LangString quoternOptionsSubtitle ${LANG_SIMPCHINESE} "选择访问 Quotern 的方式。"
    LangString quoternOptionsSubtitle ${LANG_JAPANESE} "Quotern へのアクセス方法を選択してください。"
    LangString quoternOptionsSubtitle ${LANG_KOREAN} "Quotern에 액세스하는 방법을 선택하세요."
    LangString quoternDesktopLabel ${LANG_ENGLISH} "Create a desktop shortcut"
    LangString quoternDesktopLabel ${LANG_SIMPCHINESE} "创建桌面快捷方式"
    LangString quoternDesktopLabel ${LANG_JAPANESE} "デスクトップにショートカットを作成する"
    LangString quoternDesktopLabel ${LANG_KOREAN} "바탕 화면 바로 가기 만들기"
  !macroend

  !macro customInit
    StrCpy $quoternDesktopShortcut ${BST_CHECKED}
    StrCpy $quoternOptionsShown "0"
    ${If} ${isNoDesktopShortcut}
      StrCpy $quoternDesktopShortcut ${BST_UNCHECKED}
    ${EndIf}
    # Changing scope after going Back may spawn an elevated installer instance.
    ${If} ${UAC_IsInnerInstance}
      !insertmacro UAC_AsUser_GetGlobalVar $quoternDesktopShortcut
    ${EndIf}
  !macroend

  !macro customPageAfterChangeDir
    Page custom quoternOptionsCreate quoternOptionsLeave

    Function quoternOptionsCreate
      # Updater installs must preserve the existing shortcut choice.
      ${If} ${isUpdated}
        Abort
      ${EndIf}

      !insertmacro MUI_HEADER_TEXT "$(quoternOptionsTitle)" "$(quoternOptionsSubtitle)"
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}

      ${NSD_CreateCheckbox} 0 0 100% 18u "$(quoternDesktopLabel)"
      Pop $quoternDesktopCheckbox
      ${NSD_SetState} $quoternDesktopCheckbox $quoternDesktopShortcut
      ${NSD_OnClick} $quoternDesktopCheckbox quoternDesktopChanged
      nsDialogs::Show
    FunctionEnd

    Function quoternDesktopChanged
      Pop $0
      ${NSD_GetState} $quoternDesktopCheckbox $quoternDesktopShortcut
    FunctionEnd

    Function quoternOptionsLeave
      ${NSD_GetState} $quoternDesktopCheckbox $quoternDesktopShortcut
      StrCpy $quoternOptionsShown "1"
    FunctionEnd
  !macroend

  !macro customInstall
    # Run after electron-builder's shortcut handling, in the selected user's
    # shell context. No custom action during silent installs or auto-updates.
    ${If} $quoternOptionsShown == "1"
      ${If} $quoternDesktopShortcut == ${BST_CHECKED}
        CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
        WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
      ${Else}
        WinShell::UninstShortcut "$newDesktopLink"
        Delete "$newDesktopLink"
      ${EndIf}
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
    ${EndIf}
  !macroend
!endif
