package dialog

import (
	"context"
	"os/exec"
	"strings"
)

// OSAPicker opens the native macOS folder chooser via osascript.
type OSAPicker struct{}

// New builds an OSAPicker.
func New() *OSAPicker { return &OSAPicker{} }

// Pick shows a native "choose folder" dialog and returns the POSIX path.
// Retorna "" (sem erro) se o usuário cancelar.
func (OSAPicker) Pick(ctx context.Context, startDir string) (string, error) {
	script := `POSIX path of (choose folder with prompt "Escolha onde salvar os mangás")`
	if startDir != "" {
		script = `POSIX path of (choose folder with prompt "Escolha onde salvar os mangás" default location POSIX file "` + startDir + `")`
	}
	out, err := exec.CommandContext(ctx, "osascript", "-e", script).Output()
	if err != nil {
		// exit != 0 quando o usuário cancela; não é um erro real
		if strings.Contains(err.Error(), "exit status 1") {
			return "", nil
		}
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}
