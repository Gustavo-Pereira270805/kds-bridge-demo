# Monitoramento de disponibilidade do KDS — Design (spec)

> **Data:** 2026-09-09
> **Status:** Implementado em `feature/monitoramento-disponibilidade` (2026-09-10; testes locais no corpo do commit). Itens §10.1–10.2 seguem abertos (destino de alerta e hospedagem do heartbeat).
> **Autor:** Muse Spark + Milena
> **Escopo:** distinguir “processo vivo” de “sistema saudável”, vigiar Oracle/Supabase/DNS/TLS e registrar falhas acionáveis. Sem recriar infraestrutura automaticamente.

## 1. Objetivo e escopo

O KDS pode continuar com a mesma carga do restaurante e, ainda assim, parar por causas externas: reboot da VM, remoção por ociosidade no Always Free, pausa do Supabase, expiração de TLS, mudança de IP/DNS, disco cheio ou credencial inválida.

Objetivos:

- Separar claramente:
  - **liveness:** o processo Node está respondendo;
  - **readiness:** o processo responde **e** consegue falar com o Postgres.
- Detectar falhas de VM, banco, DNS, TLS e pressão de disco/logs.
- Registrar falhas em formato auditável e permitir alerta opcional.
- Manter a recuperação documentada, sem automação perigosa.

Fora de escopo:

- Recriar automaticamente instância Oracle removida.
- Reativar a tentativa automática da instância ARM.
- Mudar regras de negócio, fila, SLA, RBAC ou telas da cozinha/salão.
- Migrar para Supabase pago ou redesenhar autenticação.
- Novo painel administrativo completo de observabilidade.

## 2. Estado atual e lacunas

- O Compose já usa `restart: unless-stopped` para `app` e `caddy` em `docker-compose.yml:5-16`.
- O setup da VM habilita o Docker no boot em `scripts/setup-instance.sh:14-18`.
- O endpoint atual `/health` verifica apenas o processo:

```ts
fastify.get('/health', async (_request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});
```

`src/server.ts:118-120`

Ou seja, hoje um monitor externo pode dizer “OK” mesmo com o banco inacessível.

- O script de saúde usa, por padrão, um domínio diferente do ambiente produtivo:

```powershell
[string]$Url = "https://kds.duckdns.org/health"
```

`scripts/oracle-server-health.ps1:6-8`

Enquanto o deploy e o Compose usam `kds-framboa.duckdns.org` em `scripts/deploy-kds.bat:42-44` e `docker-compose.yml:20-23`.

- O `scripts/check-health.bat:20-23` contém IP público fixo. Isso quebra quando o IP muda.
- Os logs do Docker e os logs locais em `.opencode/stack-jobs` não têm política explícita de rotação neste repositório.
- A limpeza diária toca o banco em `src/server.ts:422-443` e `src/services/cleanup.service.ts:24-59`, mas isso não deve ser tratado como garantia contratual contra a pausa do Supabase.

## 3. Arquitetura proposta

```text
[monitor externo/independente]
  |-- GET /health ---> processo Node vivo?
  |-- GET /ready  ---> processo + SELECT 1 no Supabase?
  |
  v
[Caddy :443] --> [app:3000] --> [Supabase Postgres]

[OCI CLI / status-oracle] --> instância RUNNING/STOPPED/TERMINATED + IP público
[E-mail do dono do Supabase] --> aviso de pausa e restauração manual
[logs locais + webhook opcional] <-- scripts de verificação
```

Princípios:

- Nada no monitoramento deve alterar dados operacionais.
- `/health` continua sendo liveness.
- `/ready` passa a ser readiness.
- O monitor mais importante deve rodar fora da VM de produção.
- Nenhum segredo vai para log, URL, repositório ou resposta HTTP.

## 4. Requisitos funcionais

### 4.1 Novo endpoint `GET /ready`

Criar `GET /ready`, público e sem autenticação, com `Cache-Control: no-store`.

Comportamento:

- Executa apenas `SELECT 1` no pool existente.
- Timeout do banco em `2500ms`.
- Não executa seed, migração, limpeza ou escrita.
- Mede a latência da consulta em milissegundos.
- Retorna HTTP `200` quando o banco responde.
- Retorna HTTP `503` quando o banco está inacessível, lento além do timeout ou com erro.
- Nunca retorna `DATABASE_URL`, chaves, stack de erro ou dados de restaurante.

Formato proposto:

```json
{
  "status": "ok",
  "timestamp": "2026-09-09T12:00:00.000Z",
  "checks": {
    "app": { "status": "ok" },
    "database": {
      "status": "ok",
      "latencyMs": 87
    }
  }
}
```

Em falha:

```json
{
  "status": "down",
  "timestamp": "2026-09-09T12:00:00.000Z",
  "checks": {
    "app": { "status": "ok" },
    "database": {
      "status": "down",
      "latencyMs": 2500,
      "error": "timeout"
    }
  }
}
```

Valores permitidos para `database.error`:

- `timeout`
- `connection`
- `dns`
- `auth`
- `unknown`

Não incluir mensagem bruta do driver.

### 4.2 Endurecimento do Compose e dos logs

Alterações previstas no `docker-compose.yml`:

- Manter `restart: unless-stopped`.
- Adicionar rotação explícita para `app` e `caddy`:

```yaml
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
```

- Manter o `HEALTHCHECK` atual do app.
- Não mudar portas, rede, domínio ou política de restart nesta spec.

Resultado esperado:

- Um container que trava repetidamente continua sendo reiniciado.
- Os logs deixam de ser uma causa silenciosa de disco cheio.
- `docker ps` continua sendo a fonte operacional para estado e contagem de restarts.

### 4.3 Scripts canônicos de verificação

Criar a variável operacional:

```text
KDS_PUBLIC_URL=https://kds-framboa.duckdns.org
```

Alterações previstas:

- `scripts/oracle-server-health.ps1`
  - Trocar o padrão incorreto por `$env:KDS_PUBLIC_URL`, com fallback para `https://kds-framboa.duckdns.org`.
  - Adicionar modos:
    - `Liveness`: verifica `/health`.
    - `Readiness`: verifica `/ready` e exige HTTP `200`.
  - Registrar timestamp, endpoint, código HTTP e latência.
  - Retornar código diferente de zero em falha.
  - Suportar webhook opcional de alerta via variável de ambiente, sem valor padrão no repositório.
- `scripts/check-health.bat`
  - Usar `KDS_PUBLIC_URL` em vez de repetir o domínio em vários pontos.
  - Substituir o IP público fixo por variável opcional, por exemplo `KDS_DIRECT_IP`.
  - Incluir `/ready` na checagem rápida.
- `scripts/status-oracle.bat`
  - Manter como verificação de plataforma.
  - Documentar a interpretação de `RUNNING`, `STOPPED`, `TERMINATED` e mudança de IP público.
- Não replicar tokens do DuckDNS em novos scripts.
- Não imprimir segredos nos logs.

### 4.4 Agendamento e heartbeat

Separar três responsabilidades:

1. **Monitor do serviço**
   - Origem independente da VM de produção.
   - `GET /ready` de 3 a 4 vezes por dia, no mínimo.
   - Falha em duas verificações consecutivas gera alerta/log operacional.

2. **Monitor da plataforma Oracle**
   - Verificação semanal do ciclo de vida da instância.
   - Verificação imediata após qualquer indisponibilidade.
   - Ações possíveis:
     - `RUNNING`: investigar app, banco, DNS ou TLS.
     - `STOPPED`: iniciar e investigar a causa.
     - `TERMINATED`: seguir o runbook de recriação com os scripts existentes.

3. **Vigilância do Supabase**
   - O dono do projeto deve monitorar os e-mails de aviso de pausa.
   - A restauração continua manual pelo painel do Supabase.
   - O heartbeat externo ajuda a manter atividade, mas não substitui o monitoramento do estado do projeto.

Não criar carga sintética para enganar métricas da Oracle. O heartbeat é monitoramento legítimo, não mineração, loop artificial ou tentativa de burlar política de ociosidade.

### 4.5 Runbook mínimo de indisponibilidade

Para “página não abre ou cozinha sem dados”:

1. Checar `https://kds-framboa.duckdns.org/ready`.
   - `200`: serviço e banco acessíveis; investigar DNS, TLS, rede local ou navegador do quiosque.
   - `503`: investigar Supabase antes da VM.
2. Checar estado da instância Oracle.
3. Checar containers:
   - `docker ps`
   - `docker logs kds-bridge --since 30m`
   - `docker logs kds-caddy --since 30m`
4. Checar disco e memória da VM.
5. Checar DNS e certificado do domínio público.
6. Se o Supabase estiver pausado, restaurar pelo painel e validar `/ready`.
7. Registrar causa, horário, ação e resultado no log operacional.

## 5. Segurança

- `/ready` não exige token porque monitores externos precisam consultá-lo sem sessão.
- `/ready` não pode expor:
  - `DATABASE_URL`;
  - `SUPABASE_URL`;
  - `SUPABASE_ANON_KEY`;
  - tokens;
  - e-mails;
  - dados de demandas, produtos, métricas ou usuários.
- RBAC atual permanece inalterado.
- CORS atual permanece inalterado.
- Secrets de alerta só via ambiente local, nunca comitados.
- A conexão com o banco continua com TLS verificado em produção.

## 6. Alertas e retenção de logs

Classificação mínima de eventos:

- `PROCESS_DOWN`
- `DB_DOWN`
- `VM_STOPPED`
- `VM_TERMINATED`
- `TLS_FAILED`
- `DNS_MISMATCH`
- `DISK_PRESSURE`

Limiares iniciais sugeridos:

- `/ready` diferente de `200` em duas verificações consecutivas.
- Certificado TLS com menos de `14 dias` para expirar.
- Disco da VM acima de `80%`.
- Aumento anormal na contagem de restarts dos containers.

Retenção sugerida:

- Logs do Docker: `10m`, até `3` arquivos por container.
- Logs locais de saúde: um arquivo por dia, por `30 dias`.
- Logs de deploy/stack: manter os marcadores `DEPLOY_OK` e `DEPLOY_AMD_OK`.

## 7. Testes e critérios de aceite

Após implementar:

- `npx tsc --noEmit` passa.
- `npm run build` passa.
- `/health` continua retornando `200`.
- `/ready` retorna `200` com banco acessível.
- Com banco local indisponível em ambiente de teste, `/ready` retorna `503` dentro do timeout e sem vazar segredo.
- Scripts com domínio errado retornam falha explícita.
- Logs do Docker respeitam o limite configurado.
- Deploy de validação mantém containers em execução e domínio respondendo após `30s` e `120s`.

Proibido simular queda do Supabase de produção para validar `/ready`. Usar banco local ou ambiente de teste.

## 8. Implantação e rollback

Ordem sugerida:

1. Implementar backend e scripts em branch.
2. Validar localmente e em ambiente de teste.
3. Fazer deploy fora do horário de pico com o fluxo existente.
4. Atualizar checagens externas para o domínio canônico.
5. Habilitar heartbeat independente e destino de alerta.
6. Observar por `48h` antes de considerar concluído.

Rollback:

- Esta feature não cria nem altera tabelas.
- O rollback é voltar o código anterior e republicar o Compose.
- O runbook e os marcadores de deploy devem permanecer mesmo após rollback.

## 9. Fora de escopo nesta spec

- Recriação automática de VM.
- Reativação da tentativa automática da ARM.
- Novo painel `/admin` para saúde operacional.
- Controle remoto adicional dos Pis.
- Refresh automático de token do Supabase.
- Assinatura paga do Supabase.
- Mudança no pipeline de deploy além da documentação de risco.

## 10. Perguntas abertas

1. Qual destino de alerta devemos usar: apenas log local, e-mail, webhook ou monitor externo com notificação?
2. Quem hospeda o heartbeat independente: tarefa do Windows, workflow externo, monitor de uptime ou outro serviço?
3. Devemos instalar `avahi` nos Pis para usar `cozinha-quente-kds.local` e `cozinha-fria-kds.local`, ou manter SSH por Tailnet/IP?
4. Qual o horário oficial de fechamento para amarrar o futuro timer de desligamento dos quiosques?
