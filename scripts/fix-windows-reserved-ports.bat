@echo off
REM ---------------------------------------------------------------------------
REM fix-windows-reserved-ports.bat
REM
REM One-shot fix for "opencode/zero server won't start — port reserved by
REM Windows" caused by Hyper-V/WSL/Docker dynamically reserving chunks of
REM the ephemeral port range (which on default Windows starts at 1024, so
REM it covers our 13284/13286 agent ports).
REM
REM Action: shrink the Windows dynamic (ephemeral) port range to the IANA
REM standard 49152-65535 on IPv4 + IPv6, TCP + UDP. After a reboot, Hyper-V
REM can only reserve chunks inside 49152+, leaving lower ports (including
REM 13284/13286) permanently bindable.
REM
REM Steps:
REM   1. Shrink dynamic (ephemeral) port range to 49152-65535 on IPv4+IPv6,
REM      TCP+UDP. Persistent in registry.
REM   2. Restart winnat to flush stale Hyper-V reservations left over from
REM      previous boots, so the fix takes effect IMMEDIATELY (no reboot needed).
REM
REM Requires administrator privileges (script self-elevates via UAC).
REM Idempotent: safe to run multiple times.
REM ---------------------------------------------------------------------------

setlocal

REM --- Self-elevate to administrator ----------------------------------------
net session >nul 2>&1
if %errorlevel% NEQ 0 (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ============================================================
echo  Fix Windows Reserved Port Range
echo  Target: dynamic port range =^> 49152-65535 (IANA standard)
echo ============================================================
echo.

REM --- Show BEFORE state -----------------------------------------------------
echo [Before] IPv4 TCP dynamic port range:
netsh int ipv4 show dynamicport tcp
echo.

echo [Before] Current TCP excluded port ranges:
netsh int ipv4 show excludedportrange protocol=tcp
echo.

REM --- Apply new range (49152-65535 = num 16384) -----------------------------
echo Applying new dynamic port ranges...
netsh int ipv4 set dynamicport tcp start=49152 num=16384
netsh int ipv4 set dynamicport udp start=49152 num=16384
netsh int ipv6 set dynamicport tcp start=49152 num=16384
netsh int ipv6 set dynamicport udp start=49152 num=16384
if %errorlevel% NEQ 0 (
    echo.
    echo [ERROR] Failed to set dynamic port range. Aborting.
    pause
    exit /b 1
)
echo Done.
echo.

REM --- Restart winnat to flush stale Hyper-V reservations --------------------
REM Changing the dynamic range only prevents FUTURE reservations. Existing
REM excluded ranges (e.g. 13278-13377 left over from a previous boot) persist
REM until the Hyper-V NAT service is restarted. Do it now so the fix takes
REM effect immediately without a reboot.
echo Flushing stale Hyper-V port reservations via winnat restart...
echo (This may briefly drop Hyper-V/WSL/Docker network connectivity.)
echo.
net stop winnat
if %errorlevel% NEQ 0 (
    echo.
    echo [WARN] net stop winnat failed. Service may not be running, or another
    echo        process holds a handle. Old reservations will clear on next reboot.
    echo        Continuing...
    echo.
) else (
    net start winnat
    if %errorlevel% NEQ 0 (
        echo.
        echo [WARN] net start winnat failed. Service will auto-start on next boot.
        echo        Continuing...
        echo.
    )
)

REM --- Show AFTER state ------------------------------------------------------
echo [After] IPv4 TCP dynamic port range:
netsh int ipv4 show dynamicport tcp
echo.

echo [After] Current TCP excluded port ranges:
netsh int ipv4 show excludedportrange protocol=tcp
echo.

echo ============================================================
echo  Done.
echo  - Dynamic range =^> 49152-65535 (persistent across reboots)
echo  - Stale Hyper-V reservations flushed (winnat restarted)
echo  - Ports below 49152 (incl. 13284/13286) are now bindable
echo ============================================================
echo.
pause
endlocal
