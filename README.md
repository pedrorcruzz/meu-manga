<p align="center">
  <img src="app/frontend/public/favicon.svg" width="120" alt="Meu Mangá" />
</p>

<h1 align="center">Meu Mangá</h1>

<p align="center">
  Baixador local de mangás com interface web — busque, monte volumes e baixe direto no seu computador.
</p>

<p align="center">
  <img alt="Go" src="https://img.shields.io/badge/backend-Go-00ADD8?logo=go&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/frontend-React%2019-0b0b0b?logo=react" />
  <img alt="macOS" src="https://img.shields.io/badge/macOS-000000?logo=apple&logoColor=white" />
  <img alt="Linux" src="https://img.shields.io/badge/Linux-1a1a1a?logo=linux&logoColor=white" />
  <img alt="Windows" src="https://img.shields.io/badge/Windows-0078D6?logo=windows&logoColor=white" />
</p>

---

## Sobre

**Meu Mangá** é um app web **local** (roda na sua máquina) para baixar mangás de forma
organizada: você busca a obra, vê os capítulos, monta volumes (inclusive com capa) e
baixa tudo em JPGs numerados, prontos pro seu leitor ou pro Kindle.

> ⚠️ **Aviso**
> Por enquanto o app usa **apenas o conector do [Sakura Mangás](https://sakuramangas.org/)**,
> então só encontra mangás em **PT-BR**. A arquitetura já é feita para **múltiplos conectores** —
> no futuro podem entrar outros sites (inclusive em inglês). A ideia é ser um **"WeebCentral"**
> para a comunidade — começando pelo PT-BR.

---

## Screenshots

|  |  |
|:--:|:--:|
| ![Home](docs/screenshots/home.png) | ![Buscar mangá](docs/screenshots/busca.png) |
| ![Montar volumes](docs/screenshots/volumes.png) | ![Downloads](docs/screenshots/downloads.png) |

<p align="center">
  <em>Preview das páginas baixadas (dá pra remover as que não quiser):</em><br />
  <img src="docs/screenshots/preview.png" alt="Preview das páginas de um capítulo baixado" width="900" />
</p>


---

## Requisitos

- **[Go](https://go.dev/dl/)** ≥ 1.25 — backend
- **[Node](https://nodejs.org/)** — serve o frontend
- **[Bun](https://bun.sh/)** — build e dependências do frontend
- Um navegador **Chromium** que você use (Chrome, Brave, Edge, Dia, Arc, Vivaldi, Opera…)

> **Sistemas:** roda em **macOS, Linux e Windows** — o app lê o cookie do seu
> navegador para passar o Cloudflare (Keychain no macOS, Secret Service no Linux,
> DPAPI no Windows). Testado principalmente no macOS; feedback de Linux/Windows é
> bem-vindo. No Windows, versões recentes do Chrome com *app-bound encryption*
> podem não funcionar — nesse caso use outro navegador Chromium (Brave, Edge…).

---

## Instalação

```bash
# 1. Clone o repositório
git clone https://github.com/pedrorcruzz/meu-manga.git
cd meu-manga

# 2. Baixe as dependências (backend + frontend)
make install
```

---

## Como usar

```bash
make
```

Isso compila e sobe tudo e **abre o navegador** em `http://localhost:3000`.

### Sakura Mangás

Mangás em PT-BR. O site é protegido por Cloudflare — então, **uma vez**, abra
[sakuramangas.org](https://sakuramangas.org/) **no seu navegador** e passe o desafio
"Um momento…". O app reaproveita esse cookie automaticamente para acessar o site. Se o
badge de sessão ficar vermelho, é só refazer isso (tem um botão no aviso).

> Ao baixar muitos capítulos, o site pode pedir um **captcha do leitor** — o app avisa
> claramente qual capítulo precisa; é só abrir ele no navegador e resolver.

### Estrutura dos arquivos baixados

```
Downloads/
└── Nome do Mangá/
    └── Nome do Mangá V001/
        └── Cap 1/
            ├── 001.jpg
            ├── 002.jpg
            └── ...
```

---

## Comandos

| Comando          | O que faz                                                        |
|------------------|------------------------------------------------------------------|
| `make`           | Compila e sobe backend + frontend (produção) e abre o navegador  |
| `make start`     | Igual ao `make`                                                  |
| `make localhost` | Sobe em modo dev (Vite HMR, hot-reload)                          |
| `make stop`      | **Encerra tudo**, libera as portas e apaga os builds            |
| `make install`   | Baixa as dependências do backend e do frontend                  |

### Encerrar o programa

Você pode encerrar de duas formas:

- Rodando **`make stop`** no terminal; **ou**
- Clicando no botão **Encerrar** no canto superior direito do app.

Qualquer um dos dois desliga o backend e o frontend e libera as portas 8080/3000.

---

## Conectores

O Meu Mangá busca os mangás através de **conectores** — cada site é um conector.

- **Sakura Mangás** — mangás em **português (PT-BR)**. É o conector disponível hoje.

Novos conectores podem entrar no futuro (inclusive de sites em outros idiomas) — a
ideia é reunir várias fontes num só lugar.

---

<p align="center">
  ⭐ <strong>Se o Meu Mangá te ajudou, deixa uma estrela no repositório!</strong> Ajuda muito o projeto a crescer. ⭐
</p>
</content>
