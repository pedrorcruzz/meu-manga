<p align="center">
  <img src="app/frontend/public/favicon.svg" width="120" alt="Meu Mangá" />
</p>

<h1 align="center">Meu Mangá</h1>

<p align="center">
  Baixador local de mangás com interface web. Busque, monte volumes e baixe direto no seu computador.
</p>

<p align="center">
  <img alt="Brasil" src="https://flagcdn.com/br.svg" width="60" />
</p>

<p align="center">
  <img alt="macOS" src="https://img.shields.io/badge/macOS-000000?logo=apple&logoColor=white" />
  <img alt="Linux" src="https://img.shields.io/badge/Linux-1a1a1a?logo=linux&logoColor=white" />
  <img alt="Windows" src="https://img.shields.io/badge/Windows-0078D6?logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2ZmZiI%2BPHBhdGggZD0iTTAgMy40IDkuOCAydjkuNUgwem0xMC45LTEuNUwyNCAwdjExLjRIMTAuOXpNMCAxMi42aDkuOHY5LjVMMCAyMC42em0xMC45IDBIMjRWMjRsLTEzLjEtMS45eiIvPjwvc3ZnPg%3D%3D" />
</p>

|  |  |
|:--:|:--:|
| ![Home](docs/screenshots/home.png) | ![Buscar](docs/screenshots/busca.png) |
| ![Montar volumes](docs/screenshots/volumes.png) | ![Downloads](docs/screenshots/downloads.png) |

<p align="center">
  <img src="docs/screenshots/preview.png" alt="Preview das páginas de um capítulo baixado" width="900" />
</p>

<br>

### Sobre

**Meu Mangá** é um app web local (roda na sua máquina) para baixar mangás de forma
organizada. Você busca a obra, vê os capítulos, monta volumes (inclusive com capa) e
baixa tudo em JPGs numerados, prontos pro seu leitor ou pro Kindle.

### Requisitos

- <a href="https://go.dev/dl/" target="_blank" rel="noreferrer">Go</a> 1.25 ou mais recente (backend)
- <a href="https://nodejs.org/" target="_blank" rel="noreferrer">Node</a> (serve o frontend)
- <a href="https://bun.sh/" target="_blank" rel="noreferrer">Bun</a> (build e dependências do frontend)
- Um navegador Chromium que você use (Chrome, Brave, Edge, Dia, Arc, Vivaldi, Opera)

### 1. Instalação

No terminal, clone o projeto, entre na pasta e instale as dependências:

```bash
git clone https://github.com/pedrorcruzz/meu-manga.git
cd meu-manga
make install
```

### 2. Como usar

No terminal, dentro da pasta do projeto, rode:

```bash
make
```

Isso compila e sobe tudo e abre o navegador em `http://localhost:3000`.

**Estrutura dos arquivos baixados:**

```
Downloads/
└── Nome do Mangá/
    └── Nome do Mangá V001/
        └── Cap 1/
            ├── 001.jpg
            ├── 002.jpg
            └── ...
```

### 3. Comandos

| Comando          | O que faz                                                        |
|------------------|------------------------------------------------------------------|
| `make`           | Compila e sobe backend e frontend (produção) e abre o navegador  |
| `make start`     | Igual ao `make`                                                  |
| `make localhost` | Sobe em modo dev (Vite HMR, hot-reload)                          |
| `make stop`      | Encerra tudo, libera as portas e apaga os builds                 |
| `make install`   | Baixa as dependências do backend e do frontend                   |

**Encerrar o programa:** dá pra encerrar de duas formas, rodando `make stop` no terminal
ou clicando no botão **Encerrar** no canto superior direito do app. Os dois desligam o
backend e o frontend e liberam as portas 8080 e 3000.

### 4. Conectores

O Meu Mangá busca os mangás através de conectores. Cada site é um conector.

<details open>
<summary>🌸 <strong>Sakura Mangás</strong></summary>

<br>

Mangás em PT-BR. O site é protegido por Cloudflare, então, uma vez, abra
<a href="https://sakuramangas.org/" target="_blank" rel="noreferrer">sakuramangas.org</a>
no seu navegador e passe o desafio "Um momento…". O app reaproveita esse cookie
automaticamente para acessar o site. Se o badge de sessão ficar vermelho, é só refazer
isso (tem um botão no aviso).

Ao baixar muitos capítulos, o site pode pedir um captcha do leitor. O app avisa qual
capítulo precisa; é só abrir ele no navegador e resolver.

</details>

<br>

<p align="center">
  ⭐ <strong>Se o Meu Mangá te ajudou, deixa uma estrela no repositório!</strong> Ajuda muito o projeto a crescer. ⭐
</p>
