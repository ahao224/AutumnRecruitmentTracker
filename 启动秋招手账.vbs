Option Explicit

Dim shell, fso, projectDir, http, serviceReady
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
serviceReady = False

On Error Resume Next
Set http = CreateObject("MSXML2.XMLHTTP")
http.Open "GET", "http://127.0.0.1:4311/api/health", False
http.Send
If Err.Number = 0 Then
  If http.Status = 200 Then serviceReady = True
End If
Err.Clear
On Error GoTo 0

If Not serviceReady Then
  shell.CurrentDirectory = projectDir
  shell.Run "cmd.exe /d /c npm run dev", 0, False
  WScript.Sleep 4500
End If

shell.Run "http://localhost:3000/", 1, False
