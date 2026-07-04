//go:build linux

package dialog

import (
	"context"
	"os/exec"
	"strings"
)

// Pick usa zenity (GTK) ou kdialog (KDE) para o seletor de pasta nativo.
// Retorna "" (sem erro) se o usuário cancelar.
func (OSAPicker) Pick(ctx context.Context, startDir string) (string, error) {
	if _, err := exec.LookPath("zenity"); err == nil {
		args := []string{"--file-selection", "--directory", "--title=Escolha onde salvar os mangás"}
		if startDir != "" {
			args = append(args, "--filename="+strings.TrimRight(startDir, "/")+"/")
		}
		out, err := exec.CommandContext(ctx, "zenity", args...).Output()
		if err != nil {
			return "", nil // cancelado
		}
		return strings.TrimSpace(string(out)), nil
	}
	if _, err := exec.LookPath("kdialog"); err == nil {
		out, err := exec.CommandContext(ctx, "kdialog", "--getexistingdirectory", startDir).Output()
		if err != nil {
			return "", nil
		}
		return strings.TrimSpace(string(out)), nil
	}
	return "", nil // sem zenity/kdialog: o usuário digita o caminho manualmente
}
