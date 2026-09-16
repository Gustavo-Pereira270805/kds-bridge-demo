# Exportação de Relatórios do Dashboard

> **Para agentes de implementação:** executar as tarefas em sequência e validar cada etapa antes de continuar.

**Objetivo:** corrigir a exportação PDF em branco e tornar PDF/Excel consistentes, legíveis e alinhados ao design do KDS.

**Arquitetura:** o exportador passa a montar um relatório próprio em um DOM temporário, usando o JSON do endpoint de analytics, sem depender do elemento legado `#content` ou de `buildContent`. PDF consolidado e diário usam a mesma estrutura de relatório; Excel usa uma coleção padronizada de abas com títulos em pt-BR e formatação de números.

**Tecnologias:** HTML/CSS/JavaScript vanilla, `html2canvas`, `jsPDF`, SheetJS/XLSX.

## Tarefas

- [x] Identificar a causa raiz: `#content` oculto/vazio e `buildContent` sem retorno HTML.
- [x] Criar renderizador de relatório temporário com cabeçalho, KPIs e tabelas por seção.
- [x] Fazer o PDF consolidado e diário usarem o renderizador temporário.
- [x] Padronizar abas, nomes de colunas e formatação do Excel.
- [x] Executar typecheck/build e validar os caminhos de exportação.
