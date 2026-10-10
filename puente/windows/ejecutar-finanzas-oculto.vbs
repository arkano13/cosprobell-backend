Option Explicit
Dim shell, resultado, archivos
Set shell = CreateObject("WScript.Shell")
Set archivos = CreateObject("Scripting.FileSystemObject")
shell.CurrentDirectory = archivos.GetParentFolderName(WScript.ScriptFullName)
resultado = shell.Run("cmd.exe /d /c """ & shell.CurrentDirectory & "\ejecutar-finanzas.cmd""", 0, True)
WScript.Quit resultado
