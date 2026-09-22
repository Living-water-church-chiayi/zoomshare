!macro customInstall
  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
    ${ifNot} ${isNoDesktopShortcut}
      ${ifNot} ${FileExists} "$newDesktopLink"
        CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
        ClearErrors
        WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
        System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
      ${endIf}
    ${endIf}
  !endif
!macroend
