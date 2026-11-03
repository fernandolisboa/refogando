# ADR-0059 — Preview sem dados reais: banco, Blob, chaves e segredos próprios

Status: aceito (2026-11-03)

Issue #646 (achado da auditoria SAST, `.security-audit/REPORT.md`). Escolha do Fernando: "separar tudo, inclusive
os dados" (2026-11-03). Relaciona: ADR-0058 (papel de runtime), `db-backup.yml`, `cleanup-neon-preview-branch.yml`.

## Contexto

Verificado pela API da Vercel em 2026-11-02 e 2026-11-03:

- O Preview e a Production compartilham as mesmas entradas de `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`,
  `WEB_SEARCH_API_KEY`, `BLOB_*`, `BETTER_AUTH_SECRET`, `CRON_SECRET` e `GOOGLE_*`. Só a `RESEND_API_KEY` é separada.
- O banco vem da integração nativa Neon (store `refogando`, conexão com ambientes `production` e `preview` e a ação
  de deploy "Neon" nos dois). Em cada Preview ela cria `preview/<git-branch>` **a partir da branch default**, ou seja,
  uma cópia integral dos dados pessoais. A documentação do Neon diz que a parent é sempre a default e não dá opção.
- Com a cópia dos dados e o token do Blob de produção, um Preview apaga fotos reais: eliminar conta, trocar imagem
  ou apagar receita.
- Um Preview roda código de PR ainda não revisado, com acesso a tudo isso.

## Decisão

1. **Banco:** o Preview usa uma branch fixa, `preview-sem-dados`, criada como *schema only* (branch raiz, sem os
   dados do `main`) pelo workflow manual `.github/workflows/preview-db.yml`.
   - O workflow copia do `main` três coisas que não são dado pessoal e sem as quais o app não sobe:
     - `drizzle.__drizzle_migrations`, sem o qual o `db:migrate` do build tentaria recriar tudo desde a 0000;
     - `app_config`;
     - `vocabulary_term` com `status = 'active'`.
   - Travas:
     - lê o `main` só com `default_transaction_read_only=on`;
     - recusa se a preview for a default, se não for schema only (`init_source`) ou se tiver o host de produção;
     - **troca a senha de todos os papéis na preview** (só nessa branch) quando ela tem a mesma senha do `main`. O
       Neon copia os papéis para a branch nova com a senha, e sem a troca a `DATABASE_URL` do Preview daria acesso
       de dono à produção trocando só o host. Depois recusa se as senhas ainda forem iguais;
     - enquanto falta copiar algo, recusa se a preview tiver qualquer linha nas tabelas de `public` (fora as duas de
       configuração). Numa rodada seguinte, com as cópias feitas, as contas de teste do Preview não travam;
     - copia cada tabela só se ela estiver vazia na preview;
     - nada de DROP, TRUNCATE ou reset.
   - Na Vercel, a conexão do store Neon fica só em Production, sem a ação de branch no Preview. O Preview recebe
     `DATABASE_URL` (pooled) e `DATABASE_URL_UNPOOLED` da `preview-sem-dados`, como variáveis comuns só do Preview.
   - Não mudamos a branch default do Neon para a preview, que seria o outro caminho. O `db-backup.yml` faz backup
     da default, e trocá-la arriscaria a produção.
2. **Blob:** um store novo, `refogando-blob-preview`, conectado só ao Preview com o mesmo prefixo `BLOB`. O store de
   produção fica só em Production.
3. **Chaves de IA:** chaves de teste próprias do Preview: workspace `refogando-preview` da Anthropic com limite de
   gasto e projeto Google próprio para o Gemini. `WEB_SEARCH_API_KEY` e `GOOGLE_*` saem do Preview. Sem busca na
   web nem login Google no Preview.
4. **Segredos:** `BETTER_AUTH_SECRET` e `CRON_SECRET` próprios do Preview. Uma sessão ou chamada de cron de Preview
   não vale em produção, e o contrário também não.
5. **Cópias antigas:** as branches `preview/*` que já existem (cópias com dados reais) são apagadas à mão no Console
   do Neon, no último passo. O workflow lista quais restam. O `cleanup-neon-preview-branch.yml` fica: é inofensivo
   sem branches novas e cobre um eventual religamento.

## Consequências

- **Previews entre o corte e o religamento:** do momento em que a conexão do store sai do Preview até as duas
  variáveis novas existirem, os Previews ficam sem banco e o build falha no `db:migrate`. É esperado.
- **PR com migração:** aplica a migração na `preview-sem-dados` no build do Preview. Com uma migração em voo por vez
  (convenção do repo), o `main` e a preview convergem no merge. Se um PR com migração for abandonado, a preview
  diverge: apagar a branch no Console, rodar o workflow de novo e trocar as duas variáveis do Preview, porque o host
  muda.
- **A preview começa vazia:** sem receitas, contas nem catálogo. Quem testa cria conta no próprio Preview (o Resend
  do Preview é separado) e, se precisar, roda `npm run seed-catalog` contra a preview. Essas contas são dados de
  teste da equipe.
- **Plano free do Neon:** limite de 3 branches raiz. Hoje são `main` e `main_old_feudo_wipe_2026-09-18`; a preview é
  a terceira. Para recriar a preview, apague a antiga primeiro.
- **Regra para mudanças futuras:** tabela nova de configuração não pessoal que o app precise para subir entra na
  lista do workflow, na mesma PR. Tabela com dado de pessoa nunca entra.
- **Privacidade:** a operação 17 do registro de operações encolhe (atualização de 2026-11-03). A política não muda
  de versão, porque a mudança é a favor do titular.
