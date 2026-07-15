; Force mushroom desktop/start-menu icons via app.ico shipped next to the exe.
!macro customInstall
  File "/oname=$INSTDIR\app.ico" "${BUILD_RESOURCES_DIR}\app.ico"
  CreateShortCut "$DESKTOP\MOGU AI.lnk" "$INSTDIR\MOGU AI.exe" "" "$INSTDIR\app.ico" 0
  CreateDirectory "$SMPROGRAMS\MOGU AI"
  CreateShortCut "$SMPROGRAMS\MOGU AI\MOGU AI.lnk" "$INSTDIR\MOGU AI.exe" "" "$INSTDIR\app.ico" 0
!macroend
