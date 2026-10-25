!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!undef APP_FILENAME
!define APP_FILENAME "Hegy"

!define HEGY_LAST_INSTALL_KEY "Software\Hegy"
!define HEGY_LAST_INSTALL_VALUE "LastInstallDir"
!define HEGY_INSTALL_REG_KEY "Software\${APP_GUID}"

!ifndef BUILD_UNINSTALLER
Var CreateDesktopShortcutCheckbox
Var CreateStartMenuShortcutCheckbox
Var CreateDesktopShortcutState
Var CreateStartMenuShortcutState

Var HegyDirEdit
Var HegyDirBrowseButton
Var HegyDirPreview
Var HegyWorkDir
Var HegyDirInitialized
Var HegySkipMemory

Function HegyNormalizeWorkDir
  ${Do}
    StrCpy $1 $HegyWorkDir 1 -1
    ${If} $1 != "\"
      ${ExitDo}
    ${EndIf}
    StrLen $2 $HegyWorkDir
    ${If} $2 <= 3
      ${ExitDo}
    ${EndIf}
    StrCpy $HegyWorkDir $HegyWorkDir -1
  ${Loop}

  StrLen $2 $HegyWorkDir
  ${If} $2 >= 4
    IntOp $3 $2 - 4
    StrCpy $4 $HegyWorkDir 4 $3
  ${Else}
    StrCpy $4 ""
  ${EndIf}
  ${If} $4 != "Hegy"
    StrCpy $HegyWorkDir "$HegyWorkDir\Hegy"
  ${EndIf}
FunctionEnd

Function HegyEnsureInstallDir
  StrCpy $HegyWorkDir $INSTDIR
  Call HegyNormalizeWorkDir
  StrCpy $INSTDIR $HegyWorkDir
FunctionEnd

Function HegyDirEditChange
  Pop $0
  ${NSD_GetText} $HegyDirEdit $1
  ${If} $1 == ""
    ${NSD_SetText} $HegyDirPreview "将安装到：（请填写文件夹）"
    Return
  ${EndIf}
  StrCpy $HegyWorkDir $1
  Call HegyNormalizeWorkDir
  ${NSD_SetText} $HegyDirPreview "将安装到：$HegyWorkDir"
FunctionEnd

Function HegyDirBrowse
  Pop $0
  ${NSD_GetText} $HegyDirEdit $1
  nsDialogs::SelectFolderDialog "选择安装位置" "$1"
  Pop $1
  ${If} $1 == "error"
    Return
  ${EndIf}
  ${If} $1 == ""
    Return
  ${EndIf}
  StrCpy $HegyWorkDir $1
  Call HegyNormalizeWorkDir
  ${NSD_SetText} $HegyDirEdit "$HegyWorkDir"
  ${NSD_SetText} $HegyDirPreview "将安装到：$HegyWorkDir"
FunctionEnd

!macro customInit
  StrCpy $CreateDesktopShortcutState ${BST_CHECKED}
  StrCpy $CreateStartMenuShortcutState ${BST_CHECKED}

  ${StdUtils.GetParameter} $R0 "D" ""
  ${If} $R0 != ""
    StrCpy $HegySkipMemory "1"
  ${Else}
    ReadRegStr $0 HKCU "${HEGY_INSTALL_REG_KEY}" InstallLocation
    ${If} $0 == ""
      ReadRegStr $0 HKCU "${HEGY_LAST_INSTALL_KEY}" "${HEGY_LAST_INSTALL_VALUE}"
      ${If} $0 != ""
        StrCpy $INSTDIR $0
      ${EndIf}
    ${EndIf}
  ${EndIf}

  Call HegyEnsureInstallDir
!macroend

!macro customPageAfterChangeDir
  Page custom HegyDirectoryPageCreate HegyDirectoryPageLeave
  Page custom HegyShortcutPageCreate HegyShortcutPageLeave
!macroend

Function HegyDirectoryPageCreate
  ${If} $HegyDirInitialized != "1"
    ${If} $HegySkipMemory != "1"
      ReadRegStr $0 HKCU "${HEGY_INSTALL_REG_KEY}" InstallLocation
      ${If} $0 == ""
        ReadRegStr $0 HKCU "${HEGY_LAST_INSTALL_KEY}" "${HEGY_LAST_INSTALL_VALUE}"
      ${EndIf}
      ${If} $0 != ""
        StrCpy $INSTDIR $0
      ${EndIf}
    ${EndIf}
    StrCpy $HegyDirInitialized "1"
  ${EndIf}
  Call HegyEnsureInstallDir

  !insertmacro MUI_HEADER_TEXT "选定安装位置" "选定 何解 要安装的文件夹。"

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "Setup 将安装 何解 到下面的文件夹。选择父文件夹后，会自动在其下创建 Hegy 子文件夹。"
  Pop $0

  ${NSD_CreateGroupBox} 0 30u 100% 52u "目标文件夹"
  Pop $0

  ${NSD_CreateText} 10u 44u 200u 14u "$INSTDIR"
  Pop $HegyDirEdit
  ${NSD_OnChange} $HegyDirEdit HegyDirEditChange

  ${NSD_CreateBrowseButton} 218u 44u 62u 14u "浏览(B)..."
  Pop $HegyDirBrowseButton
  ${NSD_OnClick} $HegyDirBrowseButton HegyDirBrowse

  ${NSD_CreateLabel} 0 90u 100% 24u "将安装到：$INSTDIR"
  Pop $HegyDirPreview

  ${NSD_CreateLabel} 0 116u 100% 28u "提示：如果所选文件夹的名称不是 Hegy，安装程序会自动在其下创建 Hegy 子文件夹。"
  Pop $0

  nsDialogs::Show
FunctionEnd

Function HegyDirectoryPageLeave
  ${NSD_GetText} $HegyDirEdit $0
  ${If} $0 == ""
    MessageBox MB_ICONEXCLAMATION "请选择安装文件夹。"
    Abort
  ${EndIf}
  StrCpy $INSTDIR $0
  Call HegyEnsureInstallDir
FunctionEnd

Function HegyShortcutPageCreate
  Call HegyEnsureInstallDir

  !insertmacro MUI_HEADER_TEXT "选择附加任务" "请选择要为「何解」创建哪些快捷方式。"

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 22u "安装位置：$INSTDIR"
  Pop $0

  ${NSD_CreateCheckbox} 0 32u 100% 14u "创建桌面快捷方式"
  Pop $CreateDesktopShortcutCheckbox
  ${NSD_SetState} $CreateDesktopShortcutCheckbox $CreateDesktopShortcutState

  ${NSD_CreateCheckbox} 0 54u 100% 14u "创建开始菜单快捷方式"
  Pop $CreateStartMenuShortcutCheckbox
  ${NSD_SetState} $CreateStartMenuShortcutCheckbox $CreateStartMenuShortcutState

  nsDialogs::Show
FunctionEnd

Function HegyShortcutPageLeave
  ${NSD_GetState} $CreateDesktopShortcutCheckbox $CreateDesktopShortcutState
  ${NSD_GetState} $CreateStartMenuShortcutCheckbox $CreateStartMenuShortcutState
FunctionEnd

!macro customInstall
  WriteRegStr HKCU "${HEGY_LAST_INSTALL_KEY}" "${HEGY_LAST_INSTALL_VALUE}" "$INSTDIR"

  ${If} $CreateDesktopShortcutState == ${BST_CHECKED}
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${Else}
    Delete "$newDesktopLink"
  ${EndIf}

  ${If} $CreateStartMenuShortcutState == ${BST_CHECKED}
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    StrCpy $launchLink "$newStartMenuLink"
  ${Else}
    Delete "$newStartMenuLink"
    StrCpy $launchLink "$appExe"
  ${EndIf}

  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!endif

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customUnInstall
  ${ifNot} ${isKeepShortcuts}
    WinShell::UninstShortcut "$newDesktopLink"
    Delete "$newDesktopLink"
    WinShell::UninstShortcut "$newStartMenuLink"
    Delete "$newStartMenuLink"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${endif}
!macroend
