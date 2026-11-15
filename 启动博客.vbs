' 一键启动：后台跑本地服务，前台用 Edge/Chrome 的应用窗口打开（无控制台、无浏览器工具栏）
Option Explicit
Dim sh, fso, base, nodeExe, edgePath, chromePath
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = base

' 1) 后台启动本地服务
nodeExe = "node"
If fso.FileExists(sh.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")) Then
  nodeExe = """" & sh.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe") & """"
End If
sh.Run nodeExe & " """ & base & "\manager\server.mjs""", 0, False
WScript.Sleep 1600

' 2) 用应用窗口打开（Chrome/Edge 的 --app 模式没有标签栏和地址栏）
edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
If Not fso.FileExists(edgePath) Then edgePath = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
If Not fso.FileExists(chromePath) Then chromePath = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

If fso.FileExists(edgePath) Then
  sh.Run """" & edgePath & """ --app=http://127.0.0.1:5178 --window-size=1420,940", 1, False
ElseIf fso.FileExists(chromePath) Then
  sh.Run """" & chromePath & """ --app=http://127.0.0.1:5178 --window-size=1420,940", 1, False
Else
  sh.Run "http://127.0.0.1:5178", 1, False
End If
