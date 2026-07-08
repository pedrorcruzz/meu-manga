#!/usr/bin/env bash
# Instala o toolchain do Meu Mangá (go, node, bun) e as libs de runtime do
# Chromium no Linux, instalando só o que estiver faltando. Suporta macOS e Linux.
set -euo pipefail

# Go precisa bater com a diretiva `go` do go.mod (apt costuma trazer uma versão
# antiga demais, por isso no Linux baixamos o tarball oficial nesta versão).
GO_VERSION="1.25.4"

OS="$(uname -s)"
ARCH="$(uname -m)"

have() { command -v "$1" >/dev/null 2>&1; }

# Instala pacotes usando o gerenciador disponível na máquina.
pkg_install() {
	if have brew; then brew install "$@";
	elif have apt-get; then sudo apt-get update && sudo apt-get install -y "$@";
	elif have dnf; then sudo dnf install -y "$@";
	elif have yum; then sudo yum install -y "$@";
	elif have pacman; then sudo pacman -Sy --noconfirm "$@";
	elif have zypper; then sudo zypper install -y "$@";
	else return 1; fi
}

install_go() {
	if have go; then echo "✓ go já instalado ($(go version | awk '{print $3}'))"; return; fi
	echo "→ go ausente — instalando ${GO_VERSION}…"
	if [ "$OS" = "Darwin" ] && have brew; then brew install go; return; fi
	# Linux (ou macOS sem brew): tarball oficial na versão exata do go.mod.
	local garch gos url tmp
	case "$ARCH" in
		x86_64|amd64) garch=amd64;;
		aarch64|arm64) garch=arm64;;
		*) echo "✗ arquitetura '$ARCH' sem instalação automática de go — instale manualmente"; exit 1;;
	esac
	case "$OS" in
		Darwin) gos=darwin;;
		Linux)  gos=linux;;
		*) echo "✗ SO '$OS' não suportado — instale go manualmente"; exit 1;;
	esac
	url="https://go.dev/dl/go${GO_VERSION}.${gos}-${garch}.tar.gz"
	tmp="$(mktemp -d)"
	curl -fsSL "$url" -o "$tmp/go.tgz"
	sudo rm -rf /usr/local/go
	sudo tar -C /usr/local -xzf "$tmp/go.tgz"
	rm -rf "$tmp"
	export PATH="/usr/local/go/bin:$PATH"
	echo "✓ go ${GO_VERSION} instalado em /usr/local/go (adicione /usr/local/go/bin ao PATH)"
}

install_node() {
	if have node; then echo "✓ node já instalado ($(node -v))"; return; fi
	echo "→ node ausente — instalando…"
	if have brew; then brew install node; return; fi
	# nodejs cobre a maioria das distros; npm em separado onde não vem junto.
	pkg_install nodejs npm || pkg_install nodejs || {
		echo "✗ não consegui instalar node automaticamente — instale manualmente"; exit 1;
	}
}

install_bun() {
	if have bun || [ -x "$HOME/.bun/bin/bun" ]; then echo "✓ bun já instalado"; return; fi
	echo "→ bun ausente — instalando…"
	curl -fsSL https://bun.sh/install | bash
	export PATH="$HOME/.bun/bin:$PATH"
	echo "✓ bun instalado em ~/.bun/bin (adicione ~/.bun/bin ao PATH)"
}

# No Linux o Chromium que o rod baixa precisa de libs do sistema; no macOS não.
install_browser_deps() {
	[ "$OS" = "Linux" ] || return 0
	echo "→ garantindo libs do Chromium (headless) no Linux…"
	if have apt-get; then
		sudo apt-get update && sudo apt-get install -y \
			libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
			libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
			libpango-1.0-0 libcairo2 fonts-liberation 2>/dev/null \
			|| echo "⚠ não consegui instalar todas as libs do Chromium — se o download falhar, instale-as manualmente";
	elif have dnf || have yum; then
		pkg_install nss atk at-spi2-atk cups-libs libdrm libxkbcommon libXcomposite \
			libXdamage libXfixes libXrandr mesa-libgbm alsa-lib pango cairo 2>/dev/null \
			|| echo "⚠ instale as libs do Chromium manualmente se o download falhar";
	elif have pacman; then
		pkg_install nss atk at-spi2-atk cups libdrm libxkbcommon libxcomposite \
			libxdamage libxfixes libxrandr mesa alsa-lib pango cairo 2>/dev/null \
			|| echo "⚠ instale as libs do Chromium manualmente se o download falhar";
	else
		echo "⚠ gerenciador de pacotes não reconhecido — se o Chromium falhar, instale as libs do headless manualmente";
	fi
}

install_go
install_node
install_bun
install_browser_deps

# Confere o essencial (bun pode ainda não estar no PATH desta sessão).
if have go && have node && { have bun || [ -x "$HOME/.bun/bin/bun" ]; }; then
	echo "✓ ferramentas prontas"
else
	echo "✗ ainda faltam ferramentas — veja os erros acima. Talvez seja preciso reabrir o terminal para o PATH atualizar."
	exit 1
fi
