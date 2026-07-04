//go:build windows

package dialog

import (
	"context"
	"os/exec"
	"strings"
)

// Pick usa o FolderBrowserDialog do Windows via PowerShell.
// Retorna "" (sem erro) se o usuário cancelar.
func (OSAPicker) Pick(ctx context.Context, startDir string) (string, error) {
	ps := `Add-Type -AssemblyName System.Windows.Forms; ` +
		`$d = New-Object System.Windows.Forms.FolderBrowserDialog; ` +
		`$d.SelectedPath = '` + strings.ReplaceAll(startDir, "'", "") + `'; ` +
		`if ($d.ShowDialog() -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }`
	out, err := exec.CommandContext(ctx, "powershell", "-NoProfile", "-STA", "-Command", ps).Output()
	if err != nil {
		return "", nil // cancelado / sem diálogo
	}
	return strings.TrimSpace(string(out)), nil
}
