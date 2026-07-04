# Meu Mangá — orquestração de dev.
# Backend Go em :8080, frontend TanStack em :3000.

BACKEND_DIR := app/backend
FRONTEND_DIR := app/frontend
RUN_DIR := .run
COVER_MIN := 90

GO ?= go
BUN ?= bun

.DEFAULT_GOAL := start

.PHONY: help
help: ## Lista os comandos disponíveis
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

.PHONY: start
start: $(RUN_DIR) ## Compila e sobe backend + frontend (produção, estável) e abre o navegador
	@echo "→ compilando frontend…"
	@cd $(FRONTEND_DIR) && $(BUN) run build > ../../$(RUN_DIR)/build.log 2>&1 || { echo "✗ build do frontend falhou — veja $(RUN_DIR)/build.log"; exit 1; }
	@echo "→ subindo backend (:8080)…"
	@cd $(BACKEND_DIR) && $(GO) run ./cmd/server > ../../$(RUN_DIR)/backend.log 2>&1 & echo $$! > $(RUN_DIR)/backend.pid
	@echo "→ subindo frontend (:3000)…"
	@cd $(FRONTEND_DIR) && PORT=3000 node .output/server/index.mjs > ../../$(RUN_DIR)/frontend.log 2>&1 & echo $$! > $(RUN_DIR)/frontend.pid
	@echo "→ aguardando o frontend subir…"
	@for i in $$(seq 1 40); do curl -s -o /dev/null http://localhost:3000 && break; sleep 1; done
	@echo "✓ app em http://localhost:3000 — abrindo no navegador…"
	@open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null || true

.PHONY: stop
stop: ## Para backend + frontend
	@-for name in backend frontend; do \
		if [ -f $(RUN_DIR)/$$name.pid ]; then \
			pid=$$(cat $(RUN_DIR)/$$name.pid); \
			echo "→ parando $$name (pid $$pid)"; \
			pkill -TERM -P $$pid 2>/dev/null; kill $$pid 2>/dev/null; \
			rm -f $(RUN_DIR)/$$name.pid; \
		fi; \
	done
	@-pkill -f 'cmd/server' 2>/dev/null; pkill -f 'exe/server' 2>/dev/null; pkill -f 'vite dev' 2>/dev/null; pkill -f '.output/server' 2>/dev/null; true
	@# fallback confiável: mata quem estiver ocupando as portas 8080/3000
	@-for port in 8080 3000; do \
		pids=$$(lsof -ti tcp:$$port 2>/dev/null); \
		[ -n "$$pids" ] && kill $$pids 2>/dev/null; \
	done; true
	@# apaga os artefatos de build para não ocupar espaço
	@-rm -rf $(FRONTEND_DIR)/.output $(FRONTEND_DIR)/.nitro $(FRONTEND_DIR)/dist 2>/dev/null; true
	@echo "✓ parado"

.PHONY: localhost
localhost: $(RUN_DIR) ## Igual ao start, mas em modo dev (Vite HMR, sem build)
	@echo "→ subindo backend (:8080)…"
	@cd $(BACKEND_DIR) && $(GO) run ./cmd/server > ../../$(RUN_DIR)/backend.log 2>&1 & echo $$! > $(RUN_DIR)/backend.pid
	@echo "→ subindo frontend em dev (:3000)…"
	@cd $(FRONTEND_DIR) && $(BUN) run dev > ../../$(RUN_DIR)/frontend.log 2>&1 & echo $$! > $(RUN_DIR)/frontend.pid
	@echo "→ aguardando o frontend subir…"
	@for i in $$(seq 1 40); do curl -s -o /dev/null http://localhost:3000 && break; sleep 1; done
	@echo "✓ dev em http://localhost:3000 (HMR) — abrindo no navegador…"
	@open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null || true

.PHONY: dev
dev: localhost ## Alias de localhost

.PHONY: install
install: ## Baixa as dependências do backend e frontend
	@echo "→ baixando dependências do backend…"
	@cd $(BACKEND_DIR) && $(GO) mod download
	@echo "→ baixando dependências do frontend…"
	@cd $(FRONTEND_DIR) && $(BUN) install
	@echo "✓ dependências instaladas"

.PHONY: build
build: ## Compila o binário do backend
	@cd $(BACKEND_DIR) && $(GO) build -o bin/mm-server ./cmd/server
	@echo "✓ $(BACKEND_DIR)/bin/mm-server"

.PHONY: test
test: test-go ## Roda todos os testes com cobertura

.PHONY: test-go
test-go: ## Testa o backend e exige cobertura >= 90% (pacotes puros; IO shells excluídos)
	@cd $(BACKEND_DIR) && $(GO) test ./... -coverprofile=coverage.out -covermode=atomic
	@# Filtra pacotes que precisam de browser/OS real (outro dev os cobre via integration tags)
	@cd $(BACKEND_DIR) && \
		grep -v -E 'meumanga/(cmd/|internal/infra/(browser|dialog|httpclient)/|internal/adapter/sakura/sakura\.go)' \
		coverage.out > coverage-pure.out; \
		total=$$($(GO) tool cover -func=coverage-pure.out | awk '/^total:/ {print substr($$3, 1, length($$3)-1)}'); \
		echo "cobertura total (pacotes puros): $$total%"; \
		awk "BEGIN {exit !($$total >= $(COVER_MIN))}" || { echo "✗ abaixo de $(COVER_MIN)%"; exit 1; }
	@echo "✓ cobertura OK"

.PHONY: cover
cover: test-go ## Abre o relatório de cobertura no navegador
	@cd $(BACKEND_DIR) && $(GO) tool cover -html=coverage.out

.PHONY: fmt
fmt: ## Formata o código Go e do frontend
	@cd $(BACKEND_DIR) && $(GO) fmt ./...
	@cd $(FRONTEND_DIR) && $(BUN) run prettier --write src 2>/dev/null || true

.PHONY: tidy
tidy: ## Ajusta go.mod/go.sum
	@cd $(BACKEND_DIR) && $(GO) mod tidy

.PHONY: check
check: ## Type-check do frontend
	@cd $(FRONTEND_DIR) && $(BUN) run tsc --noEmit

.PHONY: clean
clean: stop ## Remove artefatos de build e PIDs
	@rm -rf $(RUN_DIR) $(BACKEND_DIR)/bin $(BACKEND_DIR)/coverage.out
	@echo "✓ limpo"

$(RUN_DIR):
	@mkdir -p $(RUN_DIR)
