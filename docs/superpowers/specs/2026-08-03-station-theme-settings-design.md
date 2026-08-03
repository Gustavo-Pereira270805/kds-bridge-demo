# Design Spec: Tema por Estação Operacional

**Date:** 2026-08-03
**Topic:** Persistência de tema claro/escuro para Salão, Cozinha Quente A, Cozinha Quente B e Cozinha Fria

## 1. Objetivo

Permitir que o gerente escolha, na aba existente `Cozinhas` do gerenciamento avançado,
se cada tela operacional deve usar o tema claro ou escuro. A escolha deve ser persistida
no banco e aplicada a todos os terminais que abrirem aquela estação.

Esta entrega cobre quatro destinos:

- Salão, rota `/salao`.
- Cozinha Quente A, rota `/cozinha-quente`, filtrada pelo código `quente_a`.
- Cozinha Quente B, rota `/cozinha-quente`, filtrada pelo código `quente_b`.
- Cozinha Fria, rota `/cozinha-fria`, filtrada pelo código `fria`.

O gerente continuará usando o toggle próprio de gerente/dashboard/admin. O novo controle
da aba `Cozinhas` define apenas o tema das telas operacionais.

## 2. Decisões aprovadas

- Persistência principal: banco de dados.
- Estações de cozinha: campo `theme` em `kitchen_stations`.
- Salão: chave própria em `system_settings`, porque Salão não é uma estação de cozinha.
- Valor inicial de todas as telas: `dark`.
- Interface: linha fixa `Salão` junto de Quente A, Quente B e Fria na aba `Cozinhas`.
- Salvamento: select `Claro/Escuro` e botão `Salvar` na própria linha.
- Carregamento operacional: endpoint público consultado pela tela ao abrir.
- Fallback de segurança: se o endpoint falhar ou retornar valor inválido, usar `dark`.
- Sem atualização em tempo real nesta primeira versão; novas aberturas consultam o valor atual.
- Sem `localStorage` para substituir o banco nas telas operacionais.

## 3. Estado atual relevante

- `src/routes/kitchen-stations.ts` já expõe `GET /api/v1/kitchen-stations` e atualiza capacidade via `PATCH /api/v1/kitchen-stations/:id`.
- `src/views/admin.html` já renderiza a tabela `#stationsTable` na aba `Cozinhas` e possui a função `loadStations()`.
- `kitchen_stations` já possui códigos `quente_a`, `quente_b` e `fria`.
- `src/views/cozinha-quente.html` resolve as estações pelo objeto `stationIds` e usa os códigos para filtrar demandas.
- `src/views/cozinha-fria.html` resolve a estação fria por código.
- `src/views/salao.html` não depende de `kitchen_stations`.
- `src/views/scripts/theme.js` já fornece `KDSTheme.apply(theme)`, mas a preferência operacional deverá ser obtida do endpoint antes de aplicar o atributo final.
- `src/server.ts` já serve `/scripts/` e `/styles/`.
- `src/db/migrations.ts` não executa migrations automaticamente; o schema é gerenciado manualmente pelo SQL do Supabase. A alteração de schema deverá ser documentada em arquivo SQL versionado.

## 4. Modelo de dados

### 4.1 Cozinhas

Adicionar uma coluna ao schema de `kitchen_stations`:

```sql
ALTER TABLE kitchen_stations
  ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'dark';

ALTER TABLE kitchen_stations
  ADD CONSTRAINT kitchen_stations_theme_check
  CHECK (theme IN ('dark', 'light'));

UPDATE kitchen_stations
SET theme = 'dark'
WHERE theme IS NULL OR theme NOT IN ('dark', 'light');
```

O arquivo SQL deve ser idempotente. Se o schema inicial também for atualizado, a coluna
deve aparecer com `DEFAULT 'dark'` e a mesma restrição.

### 4.2 Salão

Usar a tabela existente `system_settings`:

```sql
INSERT INTO system_settings (key, value)
VALUES ('station_theme_salao', 'dark')
ON CONFLICT (key) DO NOTHING;
```

O valor aceito é somente `dark` ou `light`. O serviço deve normalizar qualquer valor
inválido para `dark` antes de responder ou aplicar no HTML.

## 5. API

### 5.1 Listar estações administrativas

Manter `GET /api/v1/kitchen-stations` retornando `theme` junto dos campos existentes.
Não remover nem renomear campos usados pela aba de produtos ou gerente.

Resposta esperada:

```json
[
  {
    "id": "uuid",
    "code": "quente_a",
    "name": "Cozinha Quente A",
    "capacity": 4,
    "theme": "dark"
  }
]
```

### 5.2 Atualizar estação

Expandir `PATCH /api/v1/kitchen-stations/:id` para aceitar `capacity` e/ou `theme`.

Contrato:

```json
{
  "capacity": 4,
  "theme": "light"
}
```

Regras:

- Pelo menos um campo deve ser enviado.
- `capacity`, quando presente, deve continuar sendo inteiro maior ou igual a 1.
- `theme`, quando presente, deve ser exatamente `dark` ou `light`.
- Atualizar somente os campos enviados.
- Manter `updated_at = now()`.
- Retornar o registro completo atualizado.
- Erro de validação: HTTP 400.
- Estação inexistente: HTTP 404.

### 5.3 Tema operacional por código

Adicionar endpoint público:

```text
GET /api/v1/station-themes/:stationCode
```

Valores aceitos para `stationCode`:

- `salao`: lê `system_settings.key = 'station_theme_salao'`.
- `quente_a`: lê `kitchen_stations.code = 'quente_a'`.
- `quente_b`: lê `kitchen_stations.code = 'quente_b'`.
- `fria`: lê `kitchen_stations.code = 'fria'`.

Resposta:

```json
{
  "stationCode": "quente_a",
  "theme": "dark"
}
```

Para código desconhecido, retornar HTTP 404. Para falhas internas, retornar HTTP 500;
as telas devem aplicar `dark` como fallback.

Não exigir autenticação neste endpoint porque as telas operacionais precisam abrir em
terminais sem sessão administrativa. A alteração continua protegida pelo fluxo existente
do gerenciamento, conforme o padrão atual do projeto.

### 5.4 Atualizar tema do salão

Adicionar endpoint administrativo:

```text
PATCH /api/v1/station-themes/salao
```

Body:

```json
{ "theme": "light" }
```

Validar `dark`/`light`, fazer upsert em `system_settings` e retornar a mesma resposta
do endpoint de leitura.

## 6. Aba `Cozinhas` no gerenciamento avançado

Atualizar o painel `#panel-cozinhas`:

- Título: `Configuração das Estações`.
- Colunas: `Estação`, `Código`, `Capacidade`, `Tema`, `Salvar`.
- Primeira linha fixa: `Salão`, código visual `salao`, capacidade `—`, select de tema e botão `Salvar`.
- Linhas seguintes: estações vindas de `GET /api/v1/kitchen-stations`.
- O select deve ter exatamente `Escuro` e `Claro`.
- O valor inicial vem do banco.
- Para o Salão, o botão chama `PATCH /api/v1/station-themes/salao`.
- Para cozinhas, o botão chama `PATCH /api/v1/kitchen-stations/:id` com o tema atual e a capacidade atual, preservando a operação já existente.
- Enquanto salva, desabilitar o botão da linha e mostrar estado `Salvando...`.
- Em sucesso, restaurar `Salvar` e exibir o toast existente.
- Em erro, restaurar o botão e exibir a mensagem de erro existente.
- Não salvar automaticamente ao trocar o select.

O HTML dinâmico deve usar tokens de `theme.css`, incluindo estado do select, bordas,
botões e linhas alternadas nos temas do próprio admin.

## 7. Aplicação nas telas operacionais

### 7.1 Helper compartilhado

Criar em `src/views/scripts/station-theme.js` um helper pequeno, separado do toggle de
tema do gerente:

```js
(function () {
  function normalizeTheme(theme) {
    return theme === 'light' ? 'light' : 'dark';
  }

  function apply(theme) {
    var normalized = normalizeTheme(theme);
    document.documentElement.setAttribute('data-theme', normalized);
    return normalized;
  }

  function load(stationCode) {
    return fetch('/api/v1/station-themes/' + encodeURIComponent(stationCode))
      .then(function (response) {
        if (!response.ok) throw new Error('Falha ao carregar tema da estação');
        return response.json();
      })
      .then(function (payload) { return apply(payload.theme); })
      .catch(function () { return apply('dark'); });
  }

  window.KDSStationTheme = { apply: apply, load: load };
})();
```

O helper não deve gravar `localStorage`, para não criar preferência local divergente.

### 7.2 Anti-flash e carregamento

Como o tema vem do banco, o anti-flash inicial deve assumir `dark`:

```html
<script>document.documentElement.setAttribute('data-theme', 'dark');</script>
```

Depois de carregar `station-theme.js`, chamar:

- `salao.html`: `KDSStationTheme.load('salao')`.
- `cozinha-quente.html`: `KDSStationTheme.load('quente_a')` e `KDSStationTheme.load('quente_b')` em paralelo; aplicar o tema recebido antes de renderizar ou manter o mesmo tema para a view compartilhada.
- `cozinha-fria.html`: `KDSStationTheme.load('fria')`.

### 7.3 View compartilhada da cozinha quente

Como Quente A e Quente B usam a mesma rota e a mesma view, o tema deve ser resolvido
antes de renderizar a tela. Se os dois temas forem diferentes, a view não pode representar
duas superfícies simultâneas no mesmo documento. A regra explícita será:

- A rota deve receber um parâmetro `?station=quente_a` ou `?station=quente_b`.
- Se ausente, manter o comportamento atual compatível e usar `quente_a` como padrão.
- A view filtra/renderiza somente a estação selecionada quando o parâmetro estiver presente.
- O tema consultado corresponde ao código selecionado.
- Links/aberturas existentes devem ser atualizados para incluir o código quando direcionarem
  para Quente A ou B.

Essa alteração evita que a configuração de Quente A seja aplicada por engano à tela de
Quente B e torna o tema determinístico por terminal.

## 8. Tokens e componentes visuais

- `theme.css` continua sendo a fonte de tokens para ambos os temas.
- Telas operacionais devem aplicar `data-theme="light"` ou `data-theme="dark"` antes de
  renderizar conteúdo dependente de cor.
- Cores atualmente fixas em cozinhas e salão devem ser substituídas apenas quando impedirem
  a composição clara/escura; não alterar cores de alerta sem necessidade funcional.
- Botões de ação mantêm a linguagem touch atual, com texto `--c-on-primary` quando o fundo
  for emerald, danger ou amber.
- A tela clara deve usar superfícies Clean White e textos escuros; a escura deve usar
  Warm Obsidian e textos claros.

## 9. Migração e compatibilidade

- Criar um SQL versionado em `supabase/` ou no local de schema já usado pelo projeto,
  seguindo a convenção existente.
- Atualizar tipos TypeScript de `KitchenStation` para incluir `theme: 'dark' | 'light'`.
- O seed deve garantir `theme = 'dark'` para estações criadas/seedadas.
- O carregamento da aplicação não deve falhar se a coluna ainda não existir em um ambiente
  não migrado; a implementação deve documentar a migration como pré-requisito de deploy,
  sem esconder erro de schema em produção.
- Valores inválidos armazenados devem resultar em dark no endpoint e na UI.

## 10. Verificação

### Build e API

1. `npm run build` passa.
2. `GET /api/v1/kitchen-stations` retorna `theme`.
3. `PATCH` de cozinha aceita troca de tema e preserva capacidade.
4. `GET /api/v1/station-themes/salao` retorna dark por padrão.
5. `PATCH /api/v1/station-themes/salao` alterna e persiste o tema.
6. Códigos inválidos retornam 404 ou fallback dark conforme o endpoint.

### Interface administrativa

1. Aba `Cozinhas` mostra as quatro linhas.
2. Select de cada linha inicia com o valor do banco.
3. Salvar cozinha atualiza tema e capacidade sem perder dados.
4. Salvar Salão atualiza `system_settings`.
5. Estados de sucesso/erro aparecem no toast existente.

### Telas operacionais

1. Salão abre dark por padrão e muda para light após configuração no admin.
2. Quente A e Quente B podem ter temas diferentes quando abertas com `?station=` correspondente.
3. Fria respeita seu próprio tema.
4. Falha de rede ou valor inválido aplica dark.
5. Nenhuma tela operacional usa `localStorage` para substituir a preferência do banco.
6. Funcionalidade de demandas, Socket.IO, filtros e botões permanece intacta.

### Webwright e screenshots

Capturar e visualizar:

- Admin com aba `Cozinhas` em dark e light.
- Salão em dark e light.
- Quente A em dark e light.
- Quente B em dark e light.
- Fria em dark e light.
- Viewport desktop `1280x1800` e touch `768x1024`.

Validar visualmente contraste, ausência de flash claro, botões touch, labels, cards de
alerta, navegação e consistência com `gerente.html`.
