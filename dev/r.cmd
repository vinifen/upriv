@echo off
rem r means run. It is the dev workspace runner and starts scripts/run.mjs.
node "%~dp0scripts\run.mjs" %*
exit /b %ERRORLEVEL%
