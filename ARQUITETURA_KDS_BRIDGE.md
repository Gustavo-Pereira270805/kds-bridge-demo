# KDS Bridge — Documento Técnico de Arquitetura e Funcionamento Interno

> **Versão:** 1.0 — Junho 2025
> **Projeto:** Sistema de Comunicação Cozinha-Salão para Restaurante Self-Service
> **Stack:** Node.js + Fastify + Socket.IO + SQLite + TypeScript

---

## Índice

1. [Visão Geral do Sistema](#1-visão-geral-do-sistema)
2. [O Problema que o Sistema Resolve](#2-o-problema-que-o-sistema-resolve)
3. [Arquitetura Geral](#3-arquitetura-geral)
4. [Stack Tecnológica — Decisões e Justificativas](#4-stack-tecnológica--decisões-e-justificativas)
5. [Estrutura de Arquivos e Responsabilidades](#5-estrutura-de-arquivos-e-responsabilidades)
6. [Fluxo de Inicialização do Servidor](#6-fluxo-de-inicialização-do-servidor)
7. [O Banco de Dados — SQLite com better-sqlite3](#7-o-banco-de-dados--sqlite-com-better-sqlite3)
8. [Camada de Tipos — TypeScript como Contrato](#8-camada-de-tipos--typescript-como-contrato)
9. [As Rotas REST — API de Produtos e Demandas](#9-as-rotas-rest--api-de-produtos-e-demandas)
10. [A Camada de Tempo Real — Socket.IO](#10-a-camada-de-tempo-real--socketio)
11. [O Modelo de Eventos — Quem Emite e Quem Ouve](#11-o-modelo-de-eventos--quem-emite-e-quem-ouve)
12. [As Três Telas — Anatomia Completa](#12-as-três-telas--anatomia-completa)
13. [Ciclo de Vida de uma Demanda — Fim a Fim](#13-ciclo-de-vida-de-uma-demanda--fim-a-fim)
14. [Sistema de Alertas Sonoros — Web Audio API](#14-sistema-de-alertas-sonoros--web-audio-api)
15. [Reconexão e Resiliência](#15-reconexão-e-resiliência)
16. [O Sistema de Cardápio e Produtos](#16-o-sistema-de-cardápio-e-produtos)
17. [Métricas e Painel do Gerente](#17-métricas-e-painel-do-gerente)
18. [Tratamento de Erros e Edge Cases](#18-tratamento-de-erros-e-edge-cases)
19. [Segurança e Boas Práticas](#19-segurança-e-boas-práticas)
20. [Guia de Execução e Teste](#20-guia-de-execução-e-teste)

---

## 1. Visão Geral do Sistema

O **KDS Bridge** (Kitchen Display System) é um sistema web de comunicação interna em tempo real para restaurantes self-service. Ele substitui a comunicação verbal entre o salão e a cozinha por uma interface digital que:

1. **Registra demandas** — o atendente do salão notifica a cozinha digitalmente com produto, quantidade e nível de urgência quando um item do buffet está acabando.
2. **Exibe em tempo real** — a cozinha vê as demandas instantaneamente em um monitor (ou dois, via splitter HDMI), sem precisar recarregar a página.
3. **Mantém histórico** — todas as demandas ficam registradas no banco de dados para análise posterior pelo gerente.
4. **Permite gestão do cardápio** — o gerente pode ativar ou desativar produtos do cardápio do dia, e a mudança se propaga em tempo real para o salão.

O sistema opera como uma **aplicação web monolítica** — um único servidor Node.js serve as três interfaces HTML e também gerencia a comunicação em tempo real e a API REST.

---

## 2. O Problema que o Sistema Resolve

Em um restaurante self-service típico, quando um item do buffet acaba, o atendente do salão precisa:

1. Ir fisicamente até a cozinha (ou gritar) para avisar
2. A cozinha pode não ouvir ou esquecer
3. Não há registro de quantas vezes cada item precisou ser reposto
4. O gerente não tem dados para decidir quais itens produzir em maior quantidade

O KDS Bridge resolve isso transformando o processo em um fluxo digital completo: **solicitação → exibição → conclusão → histórico**.

---

## 3. Arquitetura Geral

```
┌─────────────────────────────────────────────────────────┐
│                    SERVIDOR NODE.JS                       │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │   Fastify    │  │  Socket.IO   │  │  better-      │  │
│  │  (HTTP/REST) │  │  (WebSocket) │  │  sqlite3      │  │
│  │              │  │              │  │  (Database)   │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                 │                   │          │
│         │    ┌────────────┘                   │          │
│         │    │                                │          │
│         ▼    ▼                                ▼          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              ROTAS (routes/)                       │   │
│  │  - demands.ts  (CRUD + métricas + emit eventos)    │   │
│  │  - products.ts (listar + toggle ativo/inativo)     │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              VIEWS (views/)                        │   │
│  │  - salao.html   - tablet do atendente             │   │
│  │  - cozinha.html - monitor(es) da cozinha          │   │
│  │  - gerente.html - painel de controle              │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
   ┌─────────┐         ┌──────────┐         ┌──────────┐
   │ TABLET  │         │ MONITOR  │         │ CELULAR  │
   │ Salão   │         │ Cozinha  │         │ Gerente  │
   │ /salao  │         │ /cozinha │         │ /gerente │
   └─────────┘         └──────────┘         └──────────┘
```

### Princípios arquiteturais

1. **Servidor único, múltiplos papéis** — o mesmo processo Node.js atua como servidor HTTP, servidor WebSocket e motor de banco de dados. Isso elimina a complexidade de orquestrar múltiplos serviços para a demo.
2. **Renderização no cliente (CSR)** — as telas são HTML puro com JavaScript. O servidor apenas entrega o HTML estático (lido do disco uma vez no startup e cacheado em memória). Toda a lógica de UI, renderização de cards e atualização em tempo real ocorre no navegador.
3. **Comunicação bidirecional híbrida** — o cliente faz requisições REST para operações CRUD (criar demanda, concluir demanda, listar produtos) e recebe atualizações em tempo real via WebSocket. As duas camadas cooperam: uma rota REST que cria uma demanda também emite um evento Socket.IO para notificar todos os clientes conectados.
4. **SQLite como banco embedded** — o banco de dados é um único arquivo (`demo.db`) no sistema de arquivos. Sem servidor de banco de dados separado, sem configuração de rede. O modo WAL (Write-Ahead Logging) permite leituras e escritas concorrentes sem bloqueios.

---

## 4. Stack Tecnológica — Decisões e Justificativas

### 4.1 Node.js + TypeScript

**Por que Node.js e não Python (FastAPI)?**

O desenvolvedor tem experiência primária em Python, mas optou por Node.js neste projeto por duas razões:
- **Aprendizado prático** — o projeto serve como oportunidade de dominar o ecossistema Node/TypeScript
- **Ecossistema WebSocket superior** — o Socket.IO é a biblioteca mais madura para comunicação em tempo real, com reconexão automática, fallback para long-polling, e suporte a "rooms" nativo. O ecossistema Python tem alternativas (como `python-socketio`), mas a implementação Node.js é a referência canônica.

**TypeScript** foi escolhido sobre JavaScript puro porque:
- Tipagem estática previne erros comuns em runtime (ex.: passar string onde se espera número)
- As interfaces (`Product`, `Demand`, `CreateDemandBody`, `UpdateStatusBody`) funcionam como documentação viva do contrato da API
- O `strict: true` no `tsconfig.json` força verificação completa de nulos e tipos

### 4.2 Fastify (servidor HTTP)

**Por que Fastify e não Express?**

| Característica | Fastify | Express |
|---|---|---|
| Performance | ~2x mais rápido | Referência |
| Validação de schema | Nativa (JSON Schema) | Via middleware |
| Plugins | Sistema assíncrono robusto | Middleware linear |
| TypeScript | Suporte de primeira classe | Via `@types/express` |
| Logging | Pino integrado (JSON estruturado) | Via Morgan (texto) |

Para este projeto, o Fastify oferece:
- **Registro de plugins** como `@fastify/cors` com uma linha: `fastify.register(cors, { origin: '*' })`
- **Rotas com genéricos TypeScript** para tipar `request.body` e `request.params`
- **Servidor HTTP nativo** que pode ser compartilhado com o Socket.IO

### 4.3 Socket.IO (tempo real)

**Por que Socket.IO e não WebSockets nativos?**

| Característica | Socket.IO | WebSocket nativo |
|---|---|---|
| Reconexão automática | Sim, configurável | Não, manual |
| Fallback | Long-polling se WebSocket falhar | Sem fallback |
| Rooms/Broadcast | Nativo, uma linha | Implementação manual |
| Heartbeat | Automático (ping/pong) | Manual |
| Client library | CDN incluída (`/socket.io/socket.io.js`) | API nativa do navegador |

Socket.IO é particularmente importante para este sistema porque:
- A cozinha pode estar em uma rede Wi-Fi instável — a reconexão automática é crítica
- O modelo de "rooms" permite agrupar clientes por perfil (`salao`, `cozinha`, `gerente`)
- O servidor Fastify compartilha o mesmo `http.Server`, então Socket.IO e REST operam na mesma porta

### 4.4 better-sqlite3 (banco de dados)

**Por que SQLite e não PostgreSQL (Supabase)?**

Para a **demo**, SQLite oferece vantagens decisivas:
- **Zero configuração** — o banco é criado automaticamente no primeiro `npm run dev`
- **Zero custo** — sem conta em serviço cloud, sem fatura
- **Portabilidade** — o arquivo `demo.db` pode ser copiado, versionado (excluído pelo `.gitignore`), ou deletado para resetar tudo
- **Síncrono e rápido** — `better-sqlite3` é uma biblioteca síncrona 2-5x mais rápida que drivers async. Para um sistema local, a simplicidade do modelo síncrono elimina complexidade de `async/await` no acesso a dados.

O **modo WAL** (Write-Ahead Logging) é ativado via `db.pragma('journal_mode = WAL')`. Isso permite que múltiplos leitores acessem o banco simultaneamente enquanto um escritor está ativo — essencial quando o servidor está processando uma requisição REST (escrita) e a cozinha está renderizando (várias leituras).

**Na produção**, o plano é migrar para PostgreSQL via Supabase, mantendo exatamente as mesmas queries SQL — o `better-sqlite3` será substituído por `pg` ou `postgres.js`, e as queries parametrizadas (`?`) serão convertidas para `$1, $2`.

### 4.5 dotenv

Carrega variáveis de ambiente do arquivo `.env` para `process.env`. É chamado no topo do `server.ts` via `import 'dotenv/config'` e também em `db/client.ts`. As variáveis configuráveis são:

| Variável | Padrão | Uso |
|---|---|---|
| `PORT` | `3000` | Porta do servidor HTTP |
| `DB_PATH` | `./demo.db` | Caminho para o arquivo do banco SQLite |

---

## 5. Estrutura de Arquivos e Responsabilidades

```
kds_demo/
├── .env                          ← Variáveis de ambiente (PORT, DB_PATH)
├── .gitignore                    ← Exclui node_modules/, *.db, .env
├── package.json                  ← Dependências e scripts
├── tsconfig.json                 ← Configuração do compilador TypeScript
├── demo.db                       ← Banco SQLite (gerado automaticamente)
├── demo.db-shm / demo.db-wal     ← Arquivos auxiliares do modo WAL
│
└── src/
    ├── server.ts                 ← PONTO DE ENTRADA: inicializa tudo
    ├── types.ts                  ← Interfaces e tipos TypeScript
    │
    ├── db/
    │   ├── client.ts             ← Conexão com SQLite + dotenv
    │   ├── migrations.ts         ← Criação das tabelas (CREATE TABLE IF NOT EXISTS)
    │   └── seed.ts               ← Dados iniciais (10 produtos de exemplo)
    │
    ├── routes/
    │   ├── demands.ts            ← CRUD de demandas + métricas + eventos Socket.IO
    │   └── products.ts           ← Listagem e toggle de produtos
    │
    ├── socket/
    │   └── handlers.ts           ← Eventos de conexão/identificação/desconexão
    │
    └── views/
        ├── salao.html            ← Interface do atendente do salão
        ├── cozinha.html          ← Monitor(es) da cozinha
        └── gerente.html          ← Painel de controle do gerente
```

### Responsabilidade de cada arquivo

| Arquivo | Responsabilidade | Dependências |
|---|---|---|
| `server.ts` | Orquestrador: importa tudo, registra plugins, inicia o servidor | Todos os módulos abaixo |
| `types.ts` | Define os contratos de dados (interfaces TypeScript) | Nenhuma |
| `db/client.ts` | Cria e exporta a conexão SQLite com modo WAL | `better-sqlite3`, `dotenv` |
| `db/migrations.ts` | Cria as tabelas se não existirem | `db/client.ts` |
| `db/seed.ts` | Popula o banco com dados de demonstração na primeira execução | `db/client.ts` |
| `routes/demands.ts` | Endpoints REST para demandas + emissão de eventos Socket.IO | `db/client.ts`, `types.ts` |
| `routes/products.ts` | Endpoints REST para produtos + toggle de ativo/inativo | `db/client.ts`, `types.ts` |
| `socket/handlers.ts` | Gerencia conexões Socket.IO: `connection`, `identify`, `disconnect` | `socket.io` |
| `views/salao.html` | UI do salão: formulário de demanda + lista ativa + botão concluir | Nenhuma (carrega socket.io do CDN do servidor) |
| `views/cozinha.html` | UI da cozinha: cards + alertas sonoros + tempo decorrido | Nenhuma |
| `views/gerente.html` | UI do gerente: métricas + histórico + toggle de produtos | Nenhuma |

---

## 6. Fluxo de Inicialização do Servidor

Quando você executa `npm run dev`, o arquivo `src/server.ts` é executado pelo `ts-node-dev`. A sequência de inicialização é:

```
1. import 'dotenv/config'
   └─ Carrega .env para process.env (PORT=3000, DB_PATH=./demo.db)

2. import Fastify from 'fastify'
   └─ Cria instância: const fastify = Fastify({ logger: true })
   └─ Logger = Pino, output JSON estruturado no console

3. fastify.register(cors, { origin: '*' })
   └─ Habilita CORS para todas as origens em todas as rotas REST
   └─ Necessário se o frontend e backend estiverem em portas diferentes
   └─ Para a demo (mesmo servidor), é redundante mas inofensivo

4. createTables()
   └─ Executa db/migrations.ts
   └─ Cria 3 tabelas: products, demands, daily_menus
   └─ Usa CREATE TABLE IF NOT EXISTS — idempotente

5. seedDatabase()
   └─ Executa db/seed.ts
   └─ Verifica se a tabela products está vazia (COUNT(*) = 0)
   └─ Se vazia: insere 10 produtos de exemplo + cardápio do dia
   └─ Se já populada: não faz nada (idempotente)
   └─ Usa transação SQLite para inserir todos os 10 produtos atomicamente

6. const io = new Server(fastify.server, { cors: { origin: '*' } })
   └─ Cria o servidor Socket.IO anexado ao servidor HTTP do Fastify
   └─ Socket.IO e Fastify compartilham a mesma porta (3000)
   └─ CORS configurado para Socket.IO também

7. (fastify as any).io = io
   └─ Anexa a instância do Socket.IO ao objeto Fastify
   └─ Permite que as rotas acessem io.emit() via (fastify as any).io
   └─ O cast `as any` é necessário porque FastifyInstance não tem tipo nativo para .io

8. registerSocketHandlers(io)
   └─ Registra os listeners: connection, identify (join room), disconnect

9. Leitura e cache dos HTMLs
   └─ fs.readFileSync para salao.html, cozinha.html, gerente.html
   └─ Armazenados no objeto `views` em memória
   └─ Servidos nas rotas GET /salao, /cozinha, /gerente

10. Registro das rotas
    └─ fastify.register(productRoutes, { prefix: '/api/products' })
    └─ fastify.register(demandRoutes, { prefix: '/api/demands' })
    └─ Cada plugin de rota recebe uma instância isolada do Fastify com o prefixo

11. fastify.listen({ port: PORT, host: '0.0.0.0' })
    └─ Inicia o servidor HTTP na porta 3000
    └─ Host 0.0.0.0 = aceita conexões de qualquer interface de rede
    └─ Se falhar, loga o erro e encerra o processo (process.exit(1))
```

### Por que a ordem importa

1. **dotenv precisa ser carregado antes de db/client.ts** — o `DB_PATH` do `.env` determina onde o banco é criado.
2. **createTables() antes de seedDatabase()** — o seed insere dados nas tabelas, que precisam existir.
3. **seedDatabase() antes das rotas** — as rotas consultam o banco. Se o seed rodasse depois, a primeira requisição GET /api/products poderia retornar array vazio.
4. **Socket.IO antes das rotas** — as rotas emitem eventos Socket.IO (`io.emit()`). O servidor Socket.IO precisa estar inicializado e anexado ao Fastify (`(fastify as any).io = io`) antes que qualquer rota tente emitir.

---

## 7. O Banco de Dados — SQLite com better-sqlite3

### 7.1 Conexão (db/client.ts)

```typescript
import Database from 'better-sqlite3';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const dbPath = process.env.DB_PATH || path.resolve(__dirname, '../../demo.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

export default db;
```

**Detalhes importantes:**

- **`dotenv.config()`** é chamado aqui também (redundante com o `import 'dotenv/config'` do server.ts, mas garante que o módulo funcione isoladamente).
- **`new Database(dbPath)`** cria o arquivo `demo.db` automaticamente se ele não existir. Não é necessário nenhum comando `CREATE DATABASE`.
- **`db.pragma('journal_mode = WAL')`** ativa o modo Write-Ahead Logging. No modo WAL:
  - Leitores não bloqueiam escritores e vice-versa
  - Arquivos auxiliares `demo.db-wal` e `demo.db-shm` são criados
  - O `--ignore-watch` no script `dev` evita que o `ts-node-dev` reinicie o servidor quando esses arquivos mudam
- **A instância `db` é um singleton** — exportada como default e importada por todos os módulos que precisam acessar o banco. O sistema de módulos do Node.js (CommonJS) garante que o módulo seja executado apenas uma vez.

### 7.2 Tabelas (db/migrations.ts)

#### Tabela `products`

```sql
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    unit TEXT NOT NULL,
    active INTEGER DEFAULT 1
);
```

| Coluna | Tipo | Descrição | Exemplo |
|---|---|---|---|
| `id` | INTEGER | Chave primária autoincrementada | `1` |
| `name` | TEXT | Nome do produto | `"Arroz Branco"` |
| `category` | TEXT | Categoria (para agrupamento) | `"Guarnição"` |
| `unit` | TEXT | Unidade de medida/recipiente | `"Bandeja"` |
| `active` | INTEGER | 1 = disponível no cardápio, 0 = indisponível | `1` |

A coluna `active` é o mecanismo de controle do cardápio do dia. Quando o gerente desativa um produto via `/gerente`, o `active` muda para `0`, e o produto some do `<select>` do salão sem ser deletado do banco.

#### Tabela `demands`

```sql
CREATE TABLE IF NOT EXISTS demands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    priority TEXT DEFAULT 'normal',
    notes TEXT,
    completed_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY(product_id) REFERENCES products(id)
);
```

| Coluna | Tipo | Descrição | Exemplo |
|---|---|---|---|
| `id` | INTEGER | Chave primária autoincrementada | `42` |
| `product_id` | INTEGER | FK para products.id | `3` |
| `product_name` | TEXT | Nome do produto no momento da demanda (denormalizado por segurança histórica) | `"Frango Grelhado"` |
| `quantity` | INTEGER | Quantidade solicitada | `2` |
| `status` | TEXT | `'pending'`, `'completed'` ou `'cancelled'` | `'completed'` |
| `priority` | TEXT | `'normal'` ou `'urgent'` | `'urgent'` |
| `notes` | TEXT | Observações opcionais | `"Sem sal"` |
| `completed_by` | TEXT | Quem concluiu (para auditoria futura) | `null` |
| `created_at` | DATETIME | Timestamp de criação (UTC, automático) | `"2025-06-25 14:30:00"` |
| `completed_at` | DATETIME | Timestamp de conclusão (preenchido no PATCH) | `"2025-06-25 14:32:00"` |

**Por que denormalizar `product_name`?**

Se o produto for renomeado ou deletado no futuro, as demandas históricas continuam mostrando o nome original. Isso é uma prática comum em sistemas de log/auditoria: o registro histórico deve ser imutável e autocontido.

#### Tabela `daily_menus` (preparação para o futuro)

```sql
CREATE TABLE IF NOT EXISTS daily_menus (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    menu_name TEXT NOT NULL
);
```

Esta tabela existe como preparação para o sistema de 14 cardápios rotativos descrito no documento de especificação. Na versão atual da demo, ela não é usada por nenhuma rota ou frontend — apenas recebe um registro inicial no seed. A constraint `UNIQUE` na coluna `date` garante que só exista um cardápio por dia.

### 7.3 Seed — Dados de Demonstração (db/seed.ts)

O seed insere 10 produtos de exemplo cobrindo categorias variadas:

| Categoria | Produtos |
|---|---|
| Guarnição | Arroz Branco, Feijão Carioca |
| Proteína | Frango Grelhado, Bife Acebolado, Peixe Frito |
| Acompanhamento | Batata Frita, Farofa |
| Salada | Salada de Alface, Tomate Picado |
| Massa | Macarrão ao Sugo |

**Técnica usada: transação em lote**

```typescript
const insertManyProducts = db.transaction((products) => {
    for (const product of products) {
        insertProduct.run(...product);
    }
});
insertManyProducts(mockProducts);
```

`db.transaction()` cria uma transação SQLite que envolve todas as 10 inserções. Se qualquer uma falhar, todas são revertidas (rollback). Isso garante atomicidade: ou todos os 10 produtos são inseridos, ou nenhum é. Além disso, transações em lote são ordens de magnitude mais rápidas que 10 inserções individuais porque o SQLite só precisa sincronizar com o disco uma vez (no commit).

**Idempotência do seed:**

```typescript
const checkProducts = db.prepare('SELECT COUNT(*) as count FROM products').get();
if (checkProducts.count === 0) {
    // ... inserir dados
}
```

O seed verifica se já existem produtos antes de inserir. Isso é crítico porque o `ts-node-dev` com `--respawn` reinicia o servidor a cada alteração de arquivo — sem essa verificação, o seed tentaria inserir duplicatas a cada restart.

---

## 8. Camada de Tipos — TypeScript como Contrato

O arquivo `src/types.ts` define todas as interfaces e tipos que formam o contrato entre backend e frontend:

```typescript
export interface Product {
  id: number;
  name: string;
  category: string;
  unit: string;
  active: number;        // SQLite não tem boolean nativo → 0 ou 1
}

export type DemandStatus = 'pending' | 'completed' | 'cancelled';
export type DemandPriority = 'normal' | 'urgent';

export interface Demand {
  id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  status: DemandStatus;
  priority: DemandPriority;
  notes: string | null;
  completed_by: string | null;
  created_at: string;        // SQLite retorna string, não Date
  completed_at: string | null;
}

export interface CreateDemandBody {
    product_id: number;
    quantity: number;
    priority?: DemandPriority;   // opcional, default 'normal'
    notes?: string;
}

export interface UpdateStatusBody {
    status: DemandStatus;
    completed_by?: string;
}
```

### Por que `active: number` e não `active: boolean`?

SQLite não tem tipo booleano nativo. O `better-sqlite3` retorna `0` ou `1` como números. Manter como `number` no TypeScript reflete fielmente o que o banco retorna e evita surpresas de coerção.

### Por que `created_at: string` e não `Date`?

SQLite armazena timestamps como texto no formato `"YYYY-MM-DD HH:MM:SS"`. O `better-sqlite3` retorna esse valor como string. A conversão para `Date` é feita no frontend (JavaScript no navegador) usando `new Date(dateStr + 'Z')`, onde o sufixo `Z` instrui o parser a tratar a string como UTC.

### Type Aliases vs Enums

`DemandStatus` e `DemandPriority` são definidos como **type aliases** (`type X = 'a' | 'b'`) e não como **enums**. Isso é uma escolha deliberada:
- Type aliases de união de literais são mais leves (não geram código JavaScript)
- Oferecem melhor inferência de tipo em parâmetros de função
- São diretamente compatíveis com os valores de string que o SQLite retorna

---

## 9. As Rotas REST — API de Produtos e Demandas

### 9.1 Rotas de Produtos (`routes/products.ts`)

Registradas com prefixo `/api/products`:

| Método | Caminho | Descrição | Resposta |
|---|---|---|---|
| `GET` | `/api/products` | Lista produtos ativos (cardápio do dia) | `Product[]` |
| `GET` | `/api/products/all` | Lista todos os produtos (ativos e inativos) | `Product[]` |
| `PATCH` | `/api/products/:id` | Alterna o status ativo/inativo do produto | `Product` atualizado |

#### GET /api/products

```sql
SELECT * FROM products WHERE active = 1
```

Esta é a rota usada pelo `<select>` do salão. Retorna apenas produtos com `active = 1`. Se o gerente desativar um produto, ele desaparece desta lista instantaneamente (após o evento `product:updated` disparar o reload).

#### GET /api/products/all

```sql
SELECT * FROM products ORDER BY category, name
```

Usada pelo painel do gerente. Retorna **todos** os produtos, inclusive os inativos (`active = 0`), ordenados por categoria e nome. Isso permite que o gerente veja o estado completo do cardápio e reative produtos.

#### PATCH /api/products/:id — Toggle Ativo/Inativo

Fluxo interno:

```
1. Busca o produto pelo ID
2. Se não encontrado → 404 "Produto não encontrado"
3. Calcula o novo valor: product.active ? 0 : 1 (toggle)
4. Executa UPDATE products SET active = ? WHERE id = ?
5. Busca o produto atualizado
6. Emite evento Socket.IO: io.emit('product:updated', updated)
7. Retorna o produto atualizado como JSON
```

**Por que toggle e não um valor explícito?**

A rota não recebe `{ active: true/false }` no body — ela simplesmente alterna o estado atual. Isso simplifica o frontend: o botão no gerente não precisa saber o estado atual, apenas chama `PATCH /api/products/:id`. O backend lê o estado atual do banco e inverte.

### 9.2 Rotas de Demandas (`routes/demands.ts`)

Registradas com prefixo `/api/demands`:

| Método | Caminho | Descrição | Evento Socket.IO emitido |
|---|---|---|---|
| `GET` | `/api/demands` | Lista demandas pendentes | — |
| `POST` | `/api/demands` | Cria uma nova demanda | `demand:new` ou `demand:urgent` |
| `PATCH` | `/api/demands/:id` | Atualiza o status de uma demanda | `demand:updated` |
| `GET` | `/api/demands/history` | Histórico das últimas 100 demandas | — |
| `GET` | `/api/demands/metrics` | Métricas do dia (total, tempo médio, top item) | — |

#### GET /api/demands

```sql
SELECT * FROM demands
WHERE status = 'pending'
ORDER BY priority DESC, created_at ASC
```

**Lógica de ordenação:**
- `priority DESC` — urgentes (`'urgent'` > `'normal'` em ordem alfabética) aparecem primeiro
- `created_at ASC` — dentro da mesma prioridade, as mais antigas primeiro (FIFO)

Essa é a rota usada pela cozinha e pelo salão para carregar a fila inicial ao abrir a página.

#### POST /api/demands — Criação de Demanda

Este é o endpoint mais complexo do sistema. Fluxo completo:

```
1. Recebe o body: { product_id, quantity, priority?, notes? }

2. Busca o nome do produto:
   SELECT name FROM products WHERE id = ?
   Se não encontrado → 404 "Produto Não Encontrado..."

3. Insere a demanda:
   INSERT INTO demands (product_id, product_name, quantity, priority, notes)
   VALUES (?, ?, ?, ?, ?)
   O product_name é armazenado denormalizado (ver seção 7.2)

4. Busca a demanda recém-criada:
   SELECT * FROM demands WHERE id = ?
   Usando result.lastInsertRowid (o ID gerado pelo AUTOINCREMENT)

5. Determina o evento Socket.IO:
   priority === 'urgent' ? 'demand:urgent' : 'demand:new'

6. Emite o evento para TODOS os clientes conectados:
   io.emit(eventName, newDemand)

7. Retorna 201 Created com a demanda completa
```

**Por que `io.emit()` e não `io.to('cozinha').emit()`?**

O sistema usa broadcast global. Isso significa que:
- A cozinha recebe o evento para exibir a nova demanda
- O salão recebe o evento para atualizar sua lista de demandas ativas
- O gerente recebe o evento para atualizar métricas e histórico

As "rooms" do Socket.IO (`socket.join('cozinha')`) estão implementadas em `handlers.ts` mas não são usadas para filtrar eventos porque, no modelo atual, **todos os perfis se beneficiam de receber todos os eventos**. No futuro, se houver necessidade de enviar eventos diferentes para perfis diferentes, o `io.to('cozinha').emit(...)` pode ser adotado.

#### PATCH /api/demands/:id — Atualização de Status

```
1. Recebe params: { id } e body: { status, completed_by? }

2. Verifica se a demanda existe:
   SELECT * FROM demands WHERE id = ?
   Se não encontrada → 404 "Demanda não encontrada"

3. Determina se o status é terminal:
   isTerminal = status === 'completed' || status === 'cancelled'

4. Executa o UPDATE:
   Se terminal:
     UPDATE demands SET status = ?, completed_by = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?
   Se não-terminal (ex.: reabrir para 'pending'):
     UPDATE demands SET status = ?, completed_by = ? WHERE id = ?
   (Sem tocar em completed_at — preserva o timestamp original)

5. Busca a demanda atualizada

6. Emite io.emit('demand:updated', updatedDemand)

7. Retorna a demanda atualizada
```

**Por que `completed_at` condicional?**

Se o gerente reabrir uma demanda (mudar de `'completed'` para `'pending'`), não faz sentido sobrescrever `completed_at` com um novo timestamp. O `completed_at` só é definido quando a demanda atinge um estado terminal pela primeira vez. Isso preserva a precisão da métrica de tempo médio de atendimento.

#### GET /api/demands/history

```sql
SELECT * FROM demands ORDER BY created_at DESC LIMIT 100
```

Retorna as 100 demandas mais recentes (qualquer status), ordenadas da mais nova para a mais antiga. Usada pela tabela de histórico no painel do gerente.

#### GET /api/demands/metrics

Três queries SQL executadas em série:

**1. Total de demandas do dia:**
```sql
SELECT COUNT(*) as count FROM demands
WHERE date(created_at) = date('now')
```
Usa a função `date()` do SQLite para comparar apenas a parte da data, ignorando o horário. `date('now')` retorna a data atual em UTC.

**2. Tempo médio de atendimento (em minutos):**
```sql
SELECT ROUND(AVG(
    (julianday(completed_at) - julianday(created_at)) * 24 * 60
)) as avg_minutes
FROM demands
WHERE status = 'completed'
  AND completed_at IS NOT NULL
  AND date(created_at) = date('now')
```
- `julianday()` converte o timestamp para um número de dias julianos (float)
- A diferença entre dois dias julianos, multiplicada por 24 e 60, dá a diferença em minutos
- `ROUND(AVG(...))` calcula a média arredondada
- A condição `completed_at IS NOT NULL` é uma proteção extra (demandas concluídas sempre têm `completed_at`, mas a condição previne divisão por zero conceitual)
- Filtrado apenas para demandas do dia atual

**3. Item mais pedido do dia:**
```sql
SELECT product_name, SUM(quantity) as total_qty
FROM demands
WHERE date(created_at) = date('now')
GROUP BY product_name
ORDER BY total_qty DESC
LIMIT 1
```
Agrupa por nome de produto, soma as quantidades, ordena do maior para o menor, e retorna apenas o primeiro.

A resposta é um objeto JSON:
```json
{
  "total": 17,
  "avgTimeMinutes": 4,
  "topProduct": "Arroz Branco"
}
```

---

## 10. A Camada de Tempo Real — Socket.IO

### 10.1 Handlers de Conexão (`socket/handlers.ts`)

```typescript
export function registerSocketHandlers(io: Server) {
    io.on('connection', (socket: Socket) => {
        console.log(`[Socket.io] Nova Conexão Estabelecida: ${socket.id}`);

        socket.on('identify', (profile: string) => {
            socket.join(profile);
            console.log(`[Socket.io] Socket ${socket.id} registou-se na sala: ${profile}`);
        });

        socket.on('disconnect', () => {
            console.log(`[socket.io] Conexão Encerrada: ${socket.id}`);
        });
    });
}
```

**Fluxo de conexão:**

1. Cliente abre a página → browser carrega `/socket.io/socket.io.js` → `const socket = io()` cria a conexão WebSocket
2. Servidor detecta `connection` → loga o `socket.id` (ex.: `"abc123def456"`)
3. Cliente emite `socket.emit('identify', 'cozinha')` → servidor coloca o socket na room `'cozinha'` via `socket.join('cozinha')`
4. Quando o cliente fecha a página ou perde conexão → servidor detecta `disconnect` → loga

**O modelo de rooms:**

Cada socket pertence a uma room baseada no perfil:
- `/salao` → `socket.join('salao')`
- `/cozinha` → `socket.join('cozinha')`
- `/gerente` → `socket.join('gerente')`

Atualmente, as rooms são usadas apenas para organização lógica. Todos os `io.emit()` são broadcast global. No futuro, isso permite evoluir para eventos segmentados: por exemplo, `io.to('cozinha').emit('alerta_sonoro', ...)` para enviar um alerta apenas para os monitores da cozinha.

### 10.2 Configuração do Socket.IO Client

No lado do cliente, a configuração varia por tela:

**Salão e Gerente (conexão padrão):**
```javascript
const socket = io();
```

**Cozinha (conexão com reconexão explícita):**
```javascript
const socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
});
```

A cozinha tem configuração explícita de reconexão porque é a tela mais crítica — se a rede Wi-Fi cair e voltar, a cozinha precisa se reconectar automaticamente e reassumir a exibição da fila. Os parâmetros:
- `reconnectionAttempts: Infinity` — nunca desiste de reconectar
- `reconnectionDelay: 1000` — primeira tentativa após 1 segundo
- `reconnectionDelayMax: 5000` — atraso máximo entre tentativas (backoff exponencial até 5s)

### 10.3 Eventos de Reconexão no Cliente

A cozinha escuta três eventos do ciclo de vida da conexão:

```javascript
socket.on('connect', () => {
    document.getElementById('reconnectBanner').style.display = 'none';
    socket.emit('identify', 'cozinha');
    carregarDemandasPendentes();
});

socket.on('disconnect', () => {
    document.getElementById('reconnectBanner').style.display = 'block';
});

socket.on('reconnect_attempt', () => {
    document.getElementById('reconnectBanner').style.display = 'block';
});
```

Quando a conexão cai:
1. `disconnect` dispara → banner amarelo "Reconectando ao servidor..." aparece
2. Socket.IO tenta reconectar a cada 1-5s (backoff)
3. `reconnect_attempt` dispara a cada tentativa → mantém o banner visível
4. Quando reconecta:
   - `connect` dispara → banner some
   - Reenvia `identify` (necessário porque é uma nova conexão)
   - Recarrega a fila de demandas via REST (`carregarDemandasPendentes()`)

Isso garante que, ao reconectar, a cozinha sempre tenha a fila atualizada, mesmo que demandas tenham sido criadas ou concluídas durante o período offline.

---

## 11. O Modelo de Eventos — Quem Emite e Quem Ouve

### 11.1 Tabela completa de eventos

| Evento | Direção | Quem emite | Quem ouve | Quando |
|---|---|---|---|---|
| `connection` | Cliente→Servidor | Socket.IO (automático) | `handlers.ts` | Cliente conecta |
| `disconnect` | Cliente→Servidor | Socket.IO (automático) | `handlers.ts` | Cliente desconecta |
| `identify` | Cliente→Servidor | Cada tela HTML | `handlers.ts` | Após conexão/identificação |
| `demand:new` | Servidor→Todos | `demands.ts` POST | salao, cozinha, gerente | Demanda normal criada |
| `demand:urgent` | Servidor→Todos | `demands.ts` POST | salao, cozinha, gerente | Demanda urgente criada |
| `demand:updated` | Servidor→Todos | `demands.ts` PATCH | salao, cozinha, gerente | Status de demanda alterado |
| `product:updated` | Servidor→Todos | `products.ts` PATCH | salao, gerente | Produto ativado/desativado |
| `connect` | Servidor→Cliente | Socket.IO (automático) | cozinha, salao, gerente | (Re)conexão estabelecida |

### 11.2 O que cada tela faz com cada evento

#### Salão (`salao.html`)

| Evento | Ação |
|---|---|
| `demand:new` | Adiciona ao array `demands[]` e re-renderiza a lista de ativas |
| `demand:urgent` | Idem |
| `demand:updated` | Se completada/cancelada: remove do array. Senão: atualiza. Re-renderiza. |
| `product:updated` | Recarrega a lista de produtos do `<select>`, preservando seleção atual |
| `connect` | Reenvia `identify('salao')` e recarrega demandas ativas |

#### Cozinha (`cozinha.html`)

| Evento | Ação |
|---|---|
| `demand:new` | Adiciona ao array, re-renderiza grid, toca som normal |
| `demand:urgent` | Adiciona ao array, re-renderiza grid, toca alarme urgente |
| `demand:updated` | Se completada/cancelada: remove do array e re-renderiza |
| `connect` | Esconde banner, reenvia `identify('cozinha')`, recarrega fila |
| `disconnect` | Mostra banner "Reconectando..." |
| `reconnect_attempt` | Mantém banner visível |

#### Gerente (`gerente.html`)

| Evento | Ação |
|---|---|
| `demand:new` | Chama `refreshAll()` — recarrega métricas, histórico e produtos |
| `demand:urgent` | Idem |
| `demand:updated` | Idem |
| `product:updated` | Recarrega apenas a lista de produtos |
| `connect` | Reenvia `identify('gerente')` e chama `refreshAll()` |

### 11.3 Sincronização REST + Socket.IO

O sistema usa um padrão de **dupla garantia**:

1. **Carga inicial via REST** — quando a página abre, um `fetch()` para a API REST carrega o estado completo do banco (fila de demandas pendentes, lista de produtos, métricas).
2. **Atualizações incrementais via Socket.IO** — após a carga inicial, todas as mudanças chegam via eventos WebSocket, mantendo a UI atualizada sem novas requisições HTTP.

Isso garante que:
- Se o WebSocket falhar temporariamente, a carga inicial via REST ainda funciona
- Se o REST falhar mas o WebSocket estiver ok, as atualizações incrementais mantêm a tela funcional
- No reconectar, ambos os mecanismos são acionados: REST para carga completa + Socket.IO para eventos futuros

---

## 12. As Três Telas — Anatomia Completa

### 12.1 Tela do Salão (`/salao`)

**Dispositivo-alvo:** Tablet Android fixo no balcão do restaurante
**Permissões:** Criar demanda, ver fila ativa, concluir demanda
**Autenticação:** Nenhuma (acesso livre pela URL)

#### Estrutura visual

```
┌──────────────────────────────┐
│     REGISTRAR DEMANDA         │
│  ┌──────────────────────────┐│
│  │ Seletor de Produto    ▼  ││
│  ├──────────────────────────┤│
│  │ Quantidade [  1  ]       ││
│  ├──────────────────────────┤│
│  │ ☐ Marcar como Urgente    ││
│  ├──────────────────────────┤│
│  │ [ ENVIAR PARA COZINHA ]  ││
│  └──────────────────────────┘│
│                               │
│     DEMANDAS ATIVAS           │
│  ┌──────────────────────────┐│
│  │ 2x Arroz Branco  NORMAL  ││
│  │ há 3 min        [Concluir]││
│  ├──────────────────────────┤│
│  │ 1x Bife Acebolado URGENTE││
│  │ há 1 min        [Concluir]││
│  └──────────────────────────┘│
└──────────────────────────────┘
```

#### Funcionamento interno

**Inicialização:**
1. `socket = io()` → conecta ao servidor
2. `socket.emit('identify', 'salao')` → registra na room `salao`
3. `loadProducts()` → `GET /api/products` → popula o `<select>`
4. `loadActiveDemands()` → `GET /api/demands` → popula a lista de ativas

**Criação de demanda:**
1. Usuário seleciona produto, define quantidade, marca urgente (se aplicável)
2. Ao submeter o formulário: botão desabilita, texto muda para "Enviando..."
3. `POST /api/demands` com o payload JSON
4. Em caso de sucesso: campos resetam (quantidade = 1, checkbox desmarcada)
5. Em caso de erro: log no console, botão reabilitado
6. O servidor emite `demand:new` ou `demand:urgent` → o próprio salão recebe o evento e atualiza a lista

**Conclusão de demanda:**
1. Usuário clica "Concluir" em um card
2. Event delegation (`demandList.addEventListener('click', ...)`) captura o clique
3. Extrai o `data-id` do botão
4. Botão desabilita, texto muda para "..."
5. `PATCH /api/demands/:id` com `{ status: 'completed' }`
6. Servidor emite `demand:updated` → o salão remove o card da lista

**Atualização de tempo:**
- A função `renderDemands()` inicia um `setInterval` de 30 segundos
- A cada 30s, todos os elementos `.time[data-created]` têm seu texto atualizado via `timeAgo(el.dataset.created)`
- Quando a lista é re-renderizada (nova demanda, conclusão), o intervalo antigo é limpo (`clearInterval`) e um novo é criado

### 12.2 Tela da Cozinha (`/cozinha`)

**Dispositivo-alvo:** Monitor(es) conectados a um Orange Pi Zero 3 rodando Chromium em modo quiosque
**Permissões:** Somente visualização (tela passiva, sem formulários)
**Autenticação:** Nenhuma

#### Estrutura visual

```
┌──────────────────────────────────────────────┐
│          DEMANDAS ATIVAS                      │
│                                               │
│  ┌─────────────┐  ┌─────────────┐  ┌───────┐ │
│  │  URGENTE    │  │     3x      │  │  1x   │ │
│  │    2x       │  │             │  │       │ │
│  │ Bife        │  │ Arroz       │  │ Feijão│ │
│  │ Acebolado   │  │ Branco      │  │ Cario.│ │
│  │ ⏲ há 1 min  │  │ ⏲ há 3 min  │  │⏲ há 5m│ │
│  └─────────────┘  └─────────────┘  └───────┘ │
│  (pulsando)                                   │
└──────────────────────────────────────────────┘
```

#### Funcionamento interno

**Inicialização e renderização:**
1. Conexão Socket.IO com configuração explícita de reconexão
2. `carregarDemandasPendentes()` → `GET /api/demands` → popula o grid
3. Se falhar e o array estiver vazio: banner de erro + retry em 5 segundos
4. `render()` processa o array `demands[]`:
   - Ordena: urgentes primeiro, depois por `created_at` (mais antigas primeiro)
   - Gera HTML dos cards com `innerHTML`

**Cada card contém:**
- Quantidade em destaque (36px, bold)
- Nome do produto
- Tempo decorrido com ícone de relógio (⏲)
- Se urgente: label "URGENTE" + fundo vermelho + animação CSS pulse

**Sistema de áudio (detalhado na seção 14):**
- Demanda normal: 3 tons ascendentes (sine wave)
- Demanda urgente: 6 beeps (square wave) por 1.5 segundos

**Atualização de tempo:**
- Igual ao salão: `setInterval` de 30s que atualiza elementos `.elapsed[data-created]`

**Reconexão:**
- Banner amarelo "Reconectando ao servidor..." aparece na desconexão
- Na reconexão: reenvia `identify`, recarrega fila completa, esconde banner

### 12.3 Painel do Gerente (`/gerente`)

**Dispositivo-alvo:** Celular ou computador do gerente
**Permissões:** Ver métricas, histórico, gerenciar cardápio
**Autenticação:** Planejada para versão futura (atualmente sem login)

#### Estrutura visual

```
┌──────────────────────────────────────────────┐
│    PAINEL DE CONTROLE OPERACIONAL             │
│                                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ Total: 17│ │Tempo Med:│ │Item Mais Ped:│ │
│  │          │ │  4 min   │ │ Arroz Branco │ │
│  └──────────┘ └──────────┘ └──────────────┘ │
│                                               │
│  CARDÁPIO DO DIA                              │
│  ┌──────────────────────────────────────────┐│
│  │ Arroz Branco (Guarnição)    [Ativo]      ││
│  │ Feijão Carioca (Guarnição)  [Ativo]      ││
│  │ Frango Grelhado (Proteína)  [Ativo]      ││
│  │ Peixe Frito (Proteína)      [Inativo]    ││
│  └──────────────────────────────────────────┘│
│                                               │
│  HISTÓRICO DE DEMANDAS                        │
│  ┌──────────────────────────────────────────┐│
│  │ #42 Arroz Branco   2  Normal  Concluído  ││
│  │ #41 Bife Acebolado 1  Urgente Pendente   ││
│  └──────────────────────────────────────────┘│
└──────────────────────────────────────────────┘
```

#### Funcionamento interno

**Inicialização:**
1. `refreshAll()` → dispara 3 fetch em paralelo:
   - `fetchMetrics()` → `GET /api/demands/metrics`
   - `fetchHistory()` → `GET /api/demands/history`
   - `fetchProducts()` → `GET /api/products/all`
2. `Promise.all()` garante que as 3 chamadas rodem concorrentemente

**Atualização em tempo real:**
- Todos os 4 eventos Socket.IO disparam refresh:
  - `demand:new`, `demand:urgent`, `demand:updated` → `refreshAll()` (recarrega tudo)
  - `product:updated` → apenas `fetchProducts()` (mais eficiente)
- Na reconexão: `refreshAll()` é chamado para garantir sincronização

**Toggle de produtos:**
- Event delegation em `productList` captura cliques em `.toggle-btn`
- `PATCH /api/products/:id` alterna o status
- O próprio evento `product:updated` emitido pelo backend dispara `fetchProducts()`, que re-renderiza a lista com o novo estado
- Botão desabilita durante a requisição para evitar cliques duplos

---

## 13. Ciclo de Vida de uma Demanda — Fim a Fim

Vamos rastrear o caminho completo de uma demanda, desde o clique no tablet do salão até a conclusão e registro no histórico:

### Fase 1: Criação (Salão)

```
1. [Tablet - Salão] Atendente seleciona "Arroz Branco", qtd=2, marca URGENTE
   └─ submit do formulário → POST /api/demands
      Body: { "product_id": 1, "quantity": 2, "priority": "urgent" }

2. [Servidor - Node.js] Rota POST /api/demands
   └─ Busca nome: SELECT name FROM products WHERE id = 1 → "Arroz Branco"
   └─ Insere demanda:
      INSERT INTO demands (product_id, product_name, quantity, priority)
      VALUES (1, 'Arroz Branco', 2, 'urgent')
      → SQLite define: id=42, status='pending', created_at='2025-06-25 14:30:00'
   └─ Busca demanda criada: SELECT * FROM demands WHERE id = 42
   └─ Determina evento: priority='urgent' → 'demand:urgent'
   └─ io.emit('demand:urgent', { id: 42, product_name: 'Arroz Branco', ... })
   └─ Responde 201 Created

3. [Socket.IO] Evento 'demand:urgent' é enviado para TODOS os clientes conectados
```

### Fase 2: Recepção e Exibição

```
4. [Monitor - Cozinha] socket.on('demand:urgent', ...)
   └─ demands.push(demand)
   └─ render() → ordena fila, gera HTML do card vermelho pulsante
   └─ audioCtx.resume() → playUrgentAlert() → 6 beeps em 880Hz
   └─ Card exibe: "2x Arroz Branco ⏲ agora" em fundo vermelho

5. [Tablet - Salão] socket.on('demand:urgent', ...)
   └─ demands.push(demand)
   └─ renderDemands() → card aparece na seção "Demandas Ativas"
   └─ Card exibe: "2x Arroz Branco [URGENTE] há 0 min [Concluir]"

6. [Celular - Gerente] socket.on('demand:urgent', refreshAll)
   └─ fetchMetrics() → total sobe de 16 para 17
   └─ fetchHistory() → nova linha #42 aparece no topo da tabela
   └─ fetchProducts() → (sem alteração)
```

### Fase 3: Conclusão (Salão)

```
7. [Tablet - Salão] Atendente clica "Concluir" no card #42
   └─ Event delegation captura clique em button.complete-btn[data-id="42"]
   └─ PATCH /api/demands/42
      Body: { "status": "completed" }

8. [Servidor - Node.js] Rota PATCH /api/demands/:id
   └─ Verifica existência: SELECT * FROM demands WHERE id = 42 → existe
   └─ isTerminal = true (status = 'completed')
   └─ UPDATE demands SET status = 'completed',
        completed_by = NULL, completed_at = CURRENT_TIMESTAMP
        WHERE id = 42
      → completed_at = '2025-06-25 14:33:00'
   └─ Busca atualizada: SELECT * FROM demands WHERE id = 42
   └─ io.emit('demand:updated', { id: 42, status: 'completed', ... })
   └─ Responde 200 OK
```

### Fase 4: Limpeza e Atualização

```
9. [Monitor - Cozinha] socket.on('demand:updated', ...)
   └─ status === 'completed' → demands = demands.filter(d => d.id !== 42)
   └─ render() → card #42 desaparece do grid

10. [Tablet - Salão] socket.on('demand:updated', ...)
    └─ status === 'completed' → demands.splice(idx, 1)
    └─ renderDemands() → card #42 desaparece da lista

11. [Celular - Gerente] socket.on('demand:updated', refreshAll)
    └─ fetchMetrics() → tempo médio recalculado (3min entre 14:30 e 14:33)
    └─ fetchHistory() → #42 agora mostra "Concluído"
```

### Fase 5: Persistência

```
12. [SQLite] A demanda #42 permanece no banco com status='completed'
    └─ Visível em GET /api/demands/history
    └─ Contribui para métricas em GET /api/demands/metrics
    └─ Disponível para análise futura (nunca é deletada)
```

---

## 14. Sistema de Alertas Sonoros — Web Audio API

### 14.1 Por que Web Audio API e não `<audio>` tag?

| Abordagem | Vantagens | Desvantagens |
|---|---|---|
| `<audio>` + URL externa | Simples de implementar | Dependente de rede, arquivos podem ser removidos, sem controle de volume/tom |
| Web Audio API | Offline, controle total (frequência, duração, tipo de onda, volume), sem dependências | Código mais complexo |

Para um sistema de cozinha que precisa funcionar mesmo sem internet (rede local apenas), a Web Audio API é a escolha correta.

### 14.2 Como o som é gerado

O coração do sistema de áudio é a função `playTone()`:

```javascript
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playTone(frequency, duration, type = 'square', volume = 0.3) {
    const osc = audioCtx.createOscillator();   // 1. Cria um oscilador
    const gain = audioCtx.createGain();         // 2. Cria controle de volume

    osc.type = type;                            // 3. Define forma de onda
    osc.frequency.value = frequency;            // 4. Define frequência (Hz)

    gain.gain.setValueAtTime(volume, audioCtx.currentTime);           // 5. Volume inicial
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration); // 6. Fade out

    osc.connect(gain);                          // 7. Conecta: oscilador → gain
    gain.connect(audioCtx.destination);         // 8. Conecta: gain → saída de áudio

    osc.start();                                // 9. Inicia o som
    osc.stop(audioCtx.currentTime + duration);  // 10. Para após a duração
}
```

**Explicação detalhada de cada etapa:**

1. **`createOscillator()`** — Cria um nó de áudio que gera uma forma de onda periódica. É o "motor" do som.
2. **`createGain()`** — Cria um nó de controle de volume. Funciona como um "potenciômetro" digital.
3. **`osc.type`** — Define o timbre:
   - `'sine'` (senoidal) = som suave, como um sino. Usado para demandas normais.
   - `'square'` (quadrada) = som áspero, como um alarme. Usado para urgentes.
   - Também disponíveis: `'sawtooth'`, `'triangle'`
4. **`osc.frequency.value`** — A frequência em Hertz determina a altura do tom:
   - 800 Hz = tom médio-agudo
   - 1200 Hz = tom mais agudo
   - 880 Hz = tom de alarme padrão
5. **`setValueAtTime()`** — Define o volume inicial. 0.3 = 30% do volume máximo.
6. **`exponentialRampToValueAtTime()`** — Cria um fade-out exponencial. O volume decai de 0.3 até quase 0 (0.001) ao longo da duração do som. Isso evita "clicks" (estalos) quando o som para abruptamente.
7-8. **`connect()`** — Constrói o grafo de áudio: Oscilador → Gain → Alto-falante.
9-10. **`start()` / `stop()`** — Inicia e agenda a parada do oscilador.

### 14.3 As duas funções de alerta

#### Alerta Normal — `playNormalAlert()`

```javascript
function playNormalAlert() {
    playTone(800, 0.15, 'sine', 0.3);                          // Tom 1: 800Hz, 150ms
    setTimeout(() => playTone(1000, 0.15, 'sine', 0.3), 200);  // Tom 2: 1000Hz após 200ms
    setTimeout(() => playTone(1200, 0.2, 'sine', 0.3), 400);   // Tom 3: 1200Hz após 400ms
}
```

Três tons senoidais ascendentes (800 → 1000 → 1200 Hz), espaçados por 200ms. Produz um som similar a um "ding-ding-ding" suave. A progressão ascendente transmite a ideia de "chegou algo novo" sem alarmar.

#### Alerta Urgente — `playUrgentAlert()`

```javascript
function playUrgentAlert() {
    for (let i = 0; i < 6; i++) {
        setTimeout(() => {
            playTone(880, 0.12, 'square', 0.4);
        }, i * 250);
    }
}
```

Seis beeps em 880 Hz com onda quadrada, espaçados a cada 250ms. Duração total: 6 × 250ms = 1.5 segundos. A onda quadrada cria um timbre áspero e penetrante. Volume 0.4 (mais alto que o normal). O padrão repetitivo de 6 beeps é difícil de ignorar — adequado para situações que exigem atenção imediata.

### 14.4 Política de Autoplay

Navegadores modernos bloqueiam reprodução automática de áudio antes da primeira interação do usuário. A Web Audio API também é afetada: o `AudioContext` começa no estado `'suspended'`.

Para contornar isso:

```javascript
if (audioCtx.state === 'suspended') audioCtx.resume();
```

Antes de cada alerta, verificamos o estado do contexto. Se estiver suspenso, chamamos `resume()`. Após o primeiro `resume()` bem-sucedido (que geralmente ocorre na primeira demanda), o contexto permanece ativo.

**Nota:** Em um ambiente de produção com Chromium em modo quiosque (Orange Pi), o flag `--autoplay-policy=no-user-gesture-required` pode ser passado para eliminar completamente essa restrição.

---

## 15. Reconexão e Resiliência

### 15.1 Estratégia de reconexão

O sistema foi projetado para ambientes de rede instável (Wi-Fi de restaurante). A estratégia de resiliência opera em duas camadas:

#### Camada 1: Socket.IO (transporte)

- **Reconexão automática** habilitada com `reconnection: true`
- **Tentativas infinitas** (`reconnectionAttempts: Infinity`) — o monitor da cozinha nunca desiste
- **Backoff exponencial** — começa em 1 segundo, dobra até o máximo de 5 segundos
- **Heartbeat** — Socket.IO envia ping/pong automaticamente para detectar desconexões

#### Camada 2: Aplicação (sincronização de estado)

Quando a conexão é restaurada:
1. O evento `connect` dispara
2. O cliente reenvia `identify` (nova conexão = nova room)
3. O cliente faz uma requisição REST para recarregar o estado completo
4. O banner de "Reconectando..." desaparece
5. Eventos Socket.IO futuros mantêm a sincronização

### 15.2 Tratamento de falhas REST

Todas as chamadas `fetch()` no frontend são envolvidas em `try/catch`:

```javascript
async function loadActiveDemands() {
    try {
        const response = await fetch('/api/demands');
        demands = await response.json();
        renderDemands();
    } catch (err) {
        console.error('Erro ao carregar demandas ativas:', err);
    }
}
```

Na cozinha, há uma camada extra de resiliência:

```javascript
async function carregarDemandasPendentes() {
    try {
        const response = await fetch('/api/demands');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        demands = await response.json();
        render();
        document.getElementById('reconnectBanner').style.display = 'none';
    } catch (error) {
        console.error('Falha ao buscar fila do banco:', error);
        if (demands.length === 0) {
            document.getElementById('reconnectBanner').textContent =
                'Erro ao carregar demandas. Tentando novamente...';
            document.getElementById('reconnectBanner').style.display = 'block';
            setTimeout(carregarDemandasPendentes, 5000);
        }
    }
}
```

Se `carregarDemandasPendentes()` falhar e o array `demands` estiver vazio (carga inicial), o sistema:
1. Mostra um banner de erro
2. Agenda uma nova tentativa em 5 segundos
3. Repete até conseguir

Se o array não estiver vazio (já temos dados de uma carga anterior), o erro é logado mas a UI continua funcional com os dados existentes.

### 15.3 Proteção contra cliques duplos

Nos botões de ação (criar demanda, concluir, toggle produto), o botão é desabilitado imediatamente ao ser clicado:

```javascript
btn.disabled = true;
btn.textContent = '...';  // ou 'Enviando...'
try {
    await fetch(...);
} catch (err) {
    btn.disabled = false;
    btn.textContent = 'Concluir';  // restaura estado original
}
```

Isso previne que o usuário clique múltiplas vezes enquanto a requisição está em andamento, o que poderia criar demandas duplicadas ou causar race conditions.

---

## 16. O Sistema de Cardápio e Produtos

### 16.1 Modelo de dados simplificado

Para a demo, o sistema de cardápio é simplificado: não há menus rotativos, apenas uma lista plana de produtos com controle de ativo/inativo via a coluna `active`.

```
products
├── id=1, name="Arroz Branco",    active=1  ← visível no salão
├── id=2, name="Feijão Carioca",  active=1  ← visível no salão
├── id=3, name="Frango Grelhado", active=0  ← oculto no salão
└── ...
```

### 16.2 Fluxo de ativação/desativação

1. Gerente acessa `/gerente` → `fetchProducts()` carrega `GET /api/products/all` (todos, inclusive inativos)
2. Gerente clica no botão "Ativo" ao lado de "Peixe Frito"
3. `PATCH /api/products/10` → backend alterna `active` de 1 para 0
4. Backend emite `io.emit('product:updated', { id: 10, active: 0, ... })`
5. **No gerente:** `socket.on('product:updated', fetchProducts)` → lista recarregada, botão agora mostra "Inativo"
6. **No salão:** `socket.on('product:updated', ...)` → `loadProducts()` recarrega o `<select>`, "Peixe Frito" desaparece
7. **Na cozinha:** não afetada (cozinha só exibe demandas, não gerencia cardápio)

### 16.3 Preservação de seleção no salão

Quando o `<select>` é recarregado via `loadProducts()`, o valor selecionado é preservado:

```javascript
socket.on('product:updated', async () => {
    const select = document.getElementById('productSelect');
    const selectedValue = select.value;
    await loadProducts();
    if (selectedValue) select.value = selectedValue;
});
```

Isso evita que o atendente perca a seleção atual se estiver no meio do preenchimento do formulário quando o gerente alterar o cardápio.

### 16.4 Preparação para o futuro: `daily_menus`

A tabela `daily_menus` foi criada visando a evolução para o sistema de 14 cardápios rotativos. O plano completo (fora do escopo da demo) inclui:

- Tabela `menus` — 14 cardápios base imutáveis
- Tabela `menu_products` — relação N:N entre menus e products
- Tabela `daily_menus` — qual cardápio está ativo em cada data (já existe)
- Tabela `daily_menu_overrides` — adições/remoções manuais por dia
- View `daily_menu_effective` — lista final do dia (base + overrides)

A query `GET /api/products` seria alterada de:
```sql
SELECT * FROM products WHERE active = 1
```
para:
```sql
SELECT p.* FROM daily_menu_effective dme
JOIN products p ON p.id = dme.product_id
WHERE dme.date = date('now')
```

---

## 17. Métricas e Painel do Gerente

### 17.1 As três métricas

O endpoint `GET /api/demands/metrics` calcula três indicadores operacionais:

#### Total de Demandas (Hoje)

Contagem simples de todas as demandas criadas na data atual, independente do status. Útil para o gerente entender o volume de trabalho do dia.

#### Tempo Médio de Atendimento

```sql
ROUND(AVG(
    (julianday(completed_at) - julianday(created_at)) * 24 * 60
))
```

**Como funciona `julianday()`:**

SQLite não tem um tipo nativo de intervalo de tempo. `julianday()` converte uma data/hora para o número de dias desde o meio-dia de 24 de novembro de 4714 AEC no calendário juliano proléptico.

Exemplo:
- `julianday('2025-06-25 14:33:00')` = 2460932.10625
- `julianday('2025-06-25 14:30:00')` = 2460932.10417
- Diferença = 0.00208 dias
- Convertendo para minutos: 0.00208 × 24 × 60 = 3.0 minutos

O `ROUND()` arredonda para o inteiro mais próximo. Se o tempo médio for 3.7 minutos, o painel mostra "4 min".

**Proteções:**
- Só considera demandas com `status = 'completed'` — demandas pendentes ou canceladas não entram no cálculo
- `completed_at IS NOT NULL` — garantia extra (demandas concluídas sempre têm o campo, mas a condição previne edge cases)
- `date(created_at) = date('now')` — apenas demandas do dia atual

**O que acontece se não houver demandas concluídas hoje?**

`AVG()` sobre um conjunto vazio retorna `NULL`. O código lida com isso:
```typescript
avgTimeMinutes: avgTime ?? 0
```
O operador `??` (nullish coalescing) substitui `null` por `0`. O frontend então mostra `-` quando `avgTimeMinutes` é 0.

#### Item Mais Pedido

```sql
SELECT product_name, SUM(quantity) as total_qty
FROM demands
WHERE date(created_at) = date('now')
GROUP BY product_name
ORDER BY total_qty DESC
LIMIT 1
```

Agrupa por nome de produto e soma as quantidades. O `LIMIT 1` com `ORDER BY total_qty DESC` retorna apenas o campeão.

**Edge case: empate**

Se dois produtos tiverem a mesma quantidade total, o SQLite retorna um deles (não-determinístico, dependendo da ordem de inserção). Para um sistema de restaurante, isso é aceitável.

### 17.2 Atualização em tempo real vs Polling

O painel do gerente originalmente usava `setInterval(fetchMetricsAndHistory, 5000)` — polling a cada 5 segundos. Isso foi substituído por eventos Socket.IO:

- Cada `demand:new`, `demand:urgent` ou `demand:updated` dispara `refreshAll()`
- `refreshAll()` executa 3 fetch em paralelo via `Promise.all()`

**Vantagens da abordagem por eventos:**
- Atualização instantânea (não espera o próximo ciclo de 5 segundos)
- Menos tráfego de rede (só consulta quando algo muda)
- Menos carga no servidor (sem polling constante)

---

## 18. Tratamento de Erros e Edge Cases

### 18.1 Backend

| Cenário | Tratamento |
|---|---|
| Produto não encontrado no POST | 404 "Produto Não Encontrado..." |
| Demanda não encontrada no PATCH | 404 "Demanda não encontrada" |
| Produto não encontrado no PATCH | 404 "Produto não encontrado" |
| Erro de socket/HTTP ao iniciar | `fastify.log.error(err)` + `process.exit(1)` |
| Seed: cardápio duplicado | `catch` loga "[Seed] Cardápio do dia já existe..." |
| Query retorna vazia (métricas) | `avgTime ?? 0`, `topProduct?.product_name ?? '-'` |

### 18.2 Frontend

| Cenário | Tratamento |
|---|---|
| Falha no fetch (rede offline) | `try/catch` + console.error. Botão reabilitado. |
| Array de demandas vazio | Exibe estado "Nenhuma demanda ativa" |
| Carga inicial da cozinha falha | Banner de erro + retry automático em 5s |
| Clique duplo em botão | Botão desabilita imediatamente (`disabled = true`) |
| Reconexão após queda de rede | Recarrega estado completo via REST |
| AudioContext suspenso (autoplay) | `audioCtx.resume()` antes de tocar som |
| Produto desativado enquanto selecionado | Seleção preservada se ainda existir no novo `<select>` |
| Demanda completada por outro dispositivo | `demand:updated` remove o card de todas as telas |

### 18.3 Banco de Dados

| Cenário | Tratamento |
|---|---|
| Banco não existe | `better-sqlite3` cria automaticamente |
| Tabelas já existem | `CREATE TABLE IF NOT EXISTS` (idempotente) |
| Seed já executado | Verifica `COUNT(*) = 0` antes de inserir |
| WAL files crescem | SQLite faz checkpoint automático. Pode ser forçado com `db.pragma('wal_checkpoint(RESTART)')` |

---

## 19. Segurança e Boas Práticas

### 19.1 O que está implementado

- **SQL parametrizado** — todas as queries usam placeholders `?` com `db.prepare().run(valor)`. Isso previne SQL injection completamente, pois o `better-sqlite3` trata os valores como dados, nunca como código SQL.
- **CORS configurado** — `origin: '*'` permite acesso de qualquer origem (apropriado para ambiente de desenvolvimento/local). Em produção, deve ser restrito ao domínio específico.
- **Sem secrets no código** — `PORT` e `DB_PATH` vêm do `.env` (não commitado, listado no `.gitignore`).
- **Tratamento de erros** — todos os fluxos críticos têm `try/catch` ou verificações de existência.

### 19.2 O que NÃO está implementado (conhecido e aceito para a demo)

| Item | Risco | Plano para produção |
|---|---|---|
| Autenticação no `/gerente` | Qualquer pessoa com a URL acessa o painel | Adicionar login (JWT ou sessão) |
| Autenticação no `/salao` e `/cozinha` | Acesso irrestrito (por design, conforme documento) | N/A (decisão de projeto: sem login para operação) |
| Validação de body nas rotas | `product_id` pode ser string, `quantity` pode ser 0 ou negativo | Adicionar `fastify-type-provider-zod` para schema validation |
| Rate limiting | Um cliente pode disparar milhares de POSTs | Adicionar `@fastify/rate-limit` |
| HTTPS | Tráfego em texto puro na rede local | Para demo local é aceitável. Com ngrok ou Railway, HTTPS é automático |
| `(fastify as any).io` | TypeScript não reconhece `.io` no FastifyInstance | Usar module augmentation (`declare module 'fastify'`) |
| `.env` no repositório | `.env` contém apenas PORT e DB_PATH (não sensível), mas ainda está no `.gitignore` | OK |

### 19.3 Boas práticas aplicadas

- **Idempotência** — `CREATE TABLE IF NOT EXISTS`, seed verifica `COUNT(*) = 0`
- **Atomicidade** — seed usa `db.transaction()` para inserir 10 produtos em lote
- **Denormalização seletiva** — `product_name` é armazenado na tabela `demands` para imutabilidade histórica
- **Separação de responsabilidades** — rotas REST não contêm lógica de Socket.IO, e handlers de Socket.IO não acessam o banco
- **Event delegation** — listeners de clique nos containers, não em cada botão individual
- **Estados de UI** — loading (texto do botão muda), empty (mensagem "Nenhuma demanda"), error (banner amarelo), disabled (botão durante requisição)
- **Cache de recursos estáticos** — HTML lido uma vez no startup e mantido em memória

---

## 20. Guia de Execução e Teste

### 20.1 Instalação

```bash
npm install
```

Isso instala todas as dependências listadas em `package.json`. O `better-sqlite3` compila código nativo — requer Python e um compilador C++ (Visual Studio Build Tools no Windows, Xcode no Mac, build-essential no Linux).

### 20.2 Execução

```bash
npm run dev
```

O script `dev` executa: `ts-node-dev --respawn --transpile-only --ignore-watch demo.db --ignore-watch demo.db-wal --ignore-watch demo.db-shm src/server.ts`

- `ts-node-dev` — executa TypeScript diretamente, com hot reload
- `--respawn` — reinicia o processo quando arquivos mudam
- `--transpile-only` — pula verificação de tipos para inicialização mais rápida (use `npx tsc --noEmit` separadamente para verificar tipos)
- `--ignore-watch demo.db*` — não reinicia quando o banco SQLite é modificado

### 20.3 Verificação de Tipos

```bash
npx tsc --noEmit
```

Compila o TypeScript sem emitir arquivos. Se houver erros de tipo, eles aparecem aqui.

### 20.4 Build para Produção

```bash
npm run build   # compila TypeScript → JavaScript em dist/
npm start       # executa node dist/server.js
```

### 20.5 Teste Local

1. Execute `npm run dev`
2. Abra `http://localhost:3000/salao` no navegador
3. Abra `http://localhost:3000/cozinha` em outra aba ou dispositivo
4. Abra `http://localhost:3000/gerente` em uma terceira aba
5. Crie uma demanda no salão → verifique que aparece instantaneamente na cozinha
6. Marque como urgente → verifique o alerta sonoro e o card vermelho pulsante
7. Conclua a demanda no salão → verifique que desaparece de ambas as telas
8. No gerente, desative um produto → verifique que some do `<select>` do salão
9. Verifique o histórico e métricas no gerente

### 20.6 Teste com Múltiplos Dispositivos

1. Descubra o IP do computador: `ipconfig` (Windows) ou `ifconfig` (Linux/Mac)
2. Conecte outros dispositivos à mesma rede Wi-Fi
3. Acesse `http://192.168.x.x:3000/salao` no tablet/celular
4. O Socket.IO e as requisições REST funcionarão normalmente via rede local

### 20.7 Reset do Banco de Dados

Para resetar a demo ao estado inicial:

```bash
# Opção 1: Deletar apenas o banco
rm demo.db demo.db-shm demo.db-wal

# Opção 2: Deletar o banco e reiniciar
rm demo.db demo.db-shm demo.db-wal && npm run dev
```

Na próxima execução, o `createTables()` criará as tabelas vazias e o `seedDatabase()` populará com os 10 produtos de exemplo.

---

## Apêndice A: Glossário de Código

| Termo | Significado no contexto do sistema |
|---|---|
| **Demanda** | Uma solicitação da cozinha para repor um item do buffet. Registro na tabela `demands`. |
| **Card** | Representação visual de uma demanda na tela da cozinha ou do salão. |
| **Toggle** | Ação de alternar o status ativo/inativo de um produto. |
| **Room** | Agrupamento lógico de sockets no Socket.IO. Ex.: room `'cozinha'` contém todos os sockets de monitores da cozinha. |
| **Evento** | Mensagem enviada via Socket.IO. Pode ser do servidor para clientes (`demand:new`) ou do cliente para o servidor (`identify`). |
| **WAL** | Write-Ahead Logging — modo do SQLite que permite leituras e escritas concorrentes. |
| **Seed** | Dados iniciais inseridos no banco na primeira execução. |
| **Migration** | Script SQL que cria a estrutura do banco (tabelas, índices). Executado toda vez que o servidor inicia (idempotente). |
| **Event delegation** | Técnica onde um listener de evento é adicionado a um elemento pai, e o `event.target` determina qual filho foi clicado. Usado nos botões "Concluir" e "Ativo/Inativo". |
| **parseDate()** | Função JavaScript que converte a string de timestamp do SQLite (`"2025-06-25 14:30:00"`) para um objeto `Date` UTC, adicionando o sufixo `'Z'`. |

---

## Apêndice B: Comandos Úteis do Dia a Dia

| Situação | Comando |
|---|---|
| Iniciar servidor dev | `npm run dev` |
| Verificar tipos | `npx tsc --noEmit` |
| Ver IP na rede | `ipconfig` (Windows) |
| Resetar banco | `rm demo.db demo.db-shm demo.db-wal` |
| Expor para internet (demo remota) | `npx ngrok http 3000` |

---

> **KDS Bridge** · Documento Técnico de Arquitetura v1.0 · Junho 2025
> Sistema desenvolvido com Node.js + Fastify + Socket.IO + SQLite + TypeScript
