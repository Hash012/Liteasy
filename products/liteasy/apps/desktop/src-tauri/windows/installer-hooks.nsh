!macro NSIS_HOOK_POSTINSTALL
  ; Update mode can preserve shortcuts created by an earlier Windows user context.
  IfFileExists "$SMPROGRAMS\${PRODUCTNAME}.lnk" 0 +2
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"

  IfFileExists "$DESKTOP\${PRODUCTNAME}.lnk" 0 +2
    CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
!macroend
