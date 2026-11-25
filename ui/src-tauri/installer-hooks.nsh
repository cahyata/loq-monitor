; LOQ Monitor | NSIS installer hooks
; Author: cahyata
; Copyright (c) 2026 cahyata
;
; Registers the sensor service as a scheduled task after the files are copied, and removes it
; before they are deleted. The installer runs as administrator (installMode perMachine), which
; the task needs to start the service with the highest run level.

; The running service locks its files, so stop it before they are replaced. This also covers updates.
!macro NSIS_HOOK_PREINSTALL
  nsExec::ExecToLog 'schtasks.exe /End /TN "LOQ Monitor Service"'
  Pop $0
  nsExec::ExecToLog 'taskkill.exe /F /IM SensorService.exe'
  Pop $0
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; PawnIO is a separate signed driver from another project. It is installed only when missing, and
  ; the setup carries on without it: only the CPU power and effective clock readings need it.
  nsExec::ExecToLog 'sc.exe query PawnIO'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Installing the PawnIO driver with winget"
    nsExec::ExecToLog 'winget.exe install --id namazso.PawnIO --exact --silent --accept-source-agreements --accept-package-agreements'
    Pop $0
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONINFORMATION "The PawnIO driver was not installed (code $0). CPU power will show --. Install it later with: winget install --id namazso.PawnIO"
    ${EndIf}
  ${EndIf}

  ; A task from an earlier install means this is an update: keep the sign-in choice made before and
  ; do not ask again. Otherwise ask whether the service starts at sign in.
  nsExec::ExecToLog 'schtasks.exe /Query /TN "LOQ Monitor Service"'
  Pop $0
  ${If} $0 == 0
    StrCpy $1 " -Update"
  ${Else}
    StrCpy $1 ""
    MessageBox MB_YESNO|MB_ICONQUESTION "Start the LOQ Monitor sensor service automatically when you sign in?$\r$\n$\r$\nChoose No to start it yourself from the app (START SERVICE button)." IDYES +2
    StrCpy $1 " -NoAutoStart"
  ${EndIf}

  DetailPrint "Registering the LOQ Monitor sensor service"
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\service\install-service.ps1" -Exe "$INSTDIR\service\SensorService.exe"$1'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "The sensor service could not be registered (code $0). Run service\install-service.ps1 as administrator to try again."
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing the LOQ Monitor sensor service"
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\service\uninstall-service.ps1"'
  Pop $0
!macroend
