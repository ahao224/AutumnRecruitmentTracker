Option Explicit

Dim shell, fso, launcher
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
launcher = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "启动秋招手账网页版.vbs")
shell.Run "wscript.exe """ & launcher & """", 0, False
