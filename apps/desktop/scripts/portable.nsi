Unicode true
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
SetCompressor /SOLID lzma
Name "Quotern"
OutFile "${OUTPUT_EXE}"
Icon "..\src-tauri\icons\icon.ico"
!include FileFunc.nsh
Section
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\Quotern"
  File "${HOST_DIR}\Quotern.exe"
  File "${HOST_DIR}\quotern-node.exe"
  SetOutPath "$PLUGINSDIR\Quotern\node"
  File /r "${NODE_RESOURCES}\*"
  System::Call 'Kernel32::SetEnvironmentVariable(t "PORTABLE_EXECUTABLE_FILE", t "$EXEPATH")'
  ${GetParameters} $0
  ExecWait '"$PLUGINSDIR\Quotern\Quotern.exe" $0' $1
  SetErrorLevel $1
SectionEnd
