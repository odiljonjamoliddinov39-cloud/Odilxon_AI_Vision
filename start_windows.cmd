@echo off
where node >nul 2>nul || (echo Node.js 22+ required & pause & exit /b 1)
if not exist config.json copy config.example.json config.json
call npm.cmd install || exit /b 1
call npm.cmd start
