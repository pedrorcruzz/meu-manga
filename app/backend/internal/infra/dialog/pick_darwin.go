//go:build darwin

package dialog

import (
	"context"
	"os/exec"
	"strings"
)

// Pick mostra o "choose folder" nativo do macOS via osascript.
// Retorna "" (sem erro) se o usuário cancelar.
func (OSAPicker) Pick(ctx context.Context, startDir string) (string, error) {
	script := `POSIX path of (choose folder with prompt "Escolha onde salvar os mangás")`
	if startDir != "" {
		script = `POSIX path of (choose folder with prompt "Escolha onde salvar os mangás" default location POSIX file "` + startDir + `")`
	}
	out, err := exec.CommandContext(ctx, "osascript", "-e", script).Output()
	if err != nil {
		if strings.Contains(err.Error(), "exit status 1") {
			return "", nil // cancelado
		}
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}
