@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 第一次上传到 GitHub：先把仓库地址粘进来
echo 格式：https://github.com/你的用户名/仓库名.git
echo.
set /p URL=仓库地址：
if "%URL%"=="" goto :eof
git init -b main >nul 2>&1
git add -A
git commit -m "初始化博客" 2>nul
git remote remove origin >nul 2>&1
git remote add origin %URL%
git push -u origin main
echo.
echo 完成。接着去 Vercel：Add New - Project，选中这个仓库，Deploy。
pause
