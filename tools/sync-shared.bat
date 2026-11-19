@echo off
rem Copies shared\ into website\assets\shared and extension\assets\shared (plain copy, not a build step).
set ROOT=%~dp0..
for %%D in ("%ROOT%\website\assets\shared" "%ROOT%\extension\assets\shared") do (
  if exist %%D rmdir /s /q %%D
  mkdir %%D
  xcopy /e /i /q "%ROOT%\shared\ui" %%D\ui >nul
  xcopy /e /i /q "%ROOT%\shared\branding" %%D\branding >nul
  xcopy /e /i /q "%ROOT%\shared\icons" %%D\icons >nul
  echo synced to %%D
)
