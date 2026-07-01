> **Rascunho para revisão jurídica — não constitui parecer.**
> Este é um documento interno do Refogando, preparado para ser **revisado, corrigido e assinado por um(a) advogado(a) de PI/LGPD brasileiro(a)** antes de a "Descoberta na web" ser ligada em produção (critério de aceite da issue #276, e caveat expresso do ADR-0019). As referências legais são a **nossa pesquisa interna**; onde a lei é incerta ou dependente de juízo profissional, o ponto está marcado com **[VALIDAR COM O ADVOGADO]**. Nada aqui deve ser tratado como aconselhamento jurídico definitivo.

---

# Relatório de Legítimo Interesse (LIA) — Armazenamento de "nome da fonte (publisher/autor) + URL de origem" nas receitas importadas da web

## Identificação

- **Atividade**: Armazenamento e exibição da **atribuição de fonte** (nome da fonte — publisher/site, subsidiariamente o autor — + URL de origem) de receitas importadas de sites de terceiros, para creditar a fonte e permitir o retorno de tráfego. Só afeta receitas com `origin = 'web_imported'`.
- **Controlador**: Refogando — [nome jurídico / CNPJ a preencher]. **[VALIDAR COM O ADVOGADO]** — hoje não há pessoa jurídica formalizada nem Encarregado (DPO) designado publicamente; ambos precisam existir antes do go-live.
- **Titular dos dados (quando houver)**: o campo `source_name` guarda **preferencialmente o nome do veículo/publisher** (ex.: "TudoGostoso", "Panelinha"), e só subsidiariamente o nome de uma **pessoa** (autor). A derivação em `src/domain/recipe-import-parse.ts` (L300-306) segue a ordem `publisher.name → publisher → author.name → author → host da URL`, e o provedor de busca (`src/server/web-search/web-search-provider.ts`, L146-150) prefere o `profile.name` do Brave (o publisher), caindo no host quando ausente; o próprio `src/db/schema.ts` (~L216) documenta o campo como "nome legível do **site/publisher**". Ou seja, **no caso típico o valor é uma MARCA/veículo, que não é dado pessoal de pessoa natural** — e sobre esse subconjunto a LGPD sequer incide neste campo. **Este LIA se aplica ao subconjunto** de importações em que `source_name` é, de fato, o **nome de uma pessoa natural** (autor identificável); nesse recorte, o titular é esse **autor da receita de terceiro**, e **não** o usuário do app. É uma análise **precaucional** para o recorte pessoal.
- **Data**: 2026-07-01
- **Versão**: 1 (rascunho pré-sign-off)
- **Próxima revisão**: no sign-off jurídico e, depois, a cada 12 meses **ou** antes, se a feature mudar (ex.: passar de allowlist para web aberta — ver §5 e ADR-0019).

**Base legal candidata (a confirmar):** **Art. 7º, IX** (legítimo interesse), regulado pelo **Art. 10** da LGPD — é a base que este LIA documenta. Reforço subsidiário possível: **Art. 7º, §4º** (dados tornados manifestamente públicos pelo titular) c/c **Art. 7º, §3º**. **[VALIDAR COM O ADVOGADO]** qual base ancorar como primária; ainda que se use o §4º, os demais princípios e direitos do titular permanecem (Art. 7º, §4º, parte final), então este LIA continua útil. **Nota técnica importante:** quando `source_name` é um nome de pessoa natural, trata-se de **dado pessoal comum**, não sensível (Art. 5º, II) — portanto a hipótese aplicável é **Art. 7º**, e **não** o Art. 11, §4º. O briefing interno (`docs/legal/briefing-juridico-descoberta-web.md`, item 6 da §2 — linha ~29 — e pergunta 4 da §5) apresenta o Art. 11, §4º como **candidata formal de base legal** (não é menção "de passagem"); entendemos que essa referência está **incorreta**: o Art. 11 rege **dados sensíveis**, e o seu §4º trata do compartilhamento/comunicação de dado de **saúde** — não da hipótese de "dado manifestamente público". A via correta para "dado tornado manifestamente público pelo titular" é o **Art. 7º, §4º**. Ajustar essa referência do briefing é um dos itens de validação.

---

## 1. Teste de Finalidade (Purpose Test)

**Qual o interesse legítimo perseguido?**
Creditar corretamente a **fonte externa** de uma receita importada, exibindo "fonte: … (link)", e mandar tráfego de volta ao site de origem. Concretamente, três finalidades encadeadas:
1. **Cumprir o direito moral de atribuição do autor** (Lei 9.610/98 — o crédito de autoria persiste mesmo onde o direito patrimonial é fraco), **quando** `source_name` é o nome de um autor pessoa natural. Quando o valor é o veículo/publisher, o crédito é **institucional** (à marca) e não envolve dado pessoal. Em ambos os casos, armazenar o nome existe *a favor* da fonte.
2. **Honestidade de proveniência com o usuário do app** — deixar explícito que a receita foi copiada de fora ("por fonte externa", nunca "por \<Usuário\>"), coerente com a Proveniência imutável do produto (`origin = 'web_imported'`).
3. **Devolver tráfego/atribuição à fonte** — o link "ver no site" derrota *passing-off* e beneficia o publisher.

**É um interesse lícito, específico e real (não hipotético)?**
Sim. É **lícito** (crédito de autoria é obrigação, não conveniência), **específico** (dois campos, uma finalidade — atribuição; sem uso secundário) e **real**: já implementado no código. A gravação ocorre em `src/server/import/persist-import.ts` (grava `sourceUrl`/`sourceName` junto com `origin='web_imported'`, `visibility='private'`), sobre os campos `recipe.source_url` / `recipe.source_name` definidos em `src/db/schema.ts` (~L213-222, "Atribuição da importação da web (#165, ADR-0019)"). Não há coleta especulativa para uso futuro.

**Quem se beneficia?**
- A **fonte/publisher** (e o **titular** autor, quando `source_name` é nome de pessoa): recebe crédito + link — atende ao direito moral (no recorte pessoal) e gera tráfego.
- O **usuário do app**: entende de onde veio a receita (proveniência honesta).
- O **controlador**: sustenta uma postura defensável de "importar ≠ republicar" e evita alegação de *passing-off*.

**Sem o tratamento, qual o prejuízo concreto?**
Sem armazenar o nome + URL, a receita importada ficaria **sem crédito** — exatamente o cenário que a LGPD e a Lei 9.610 querem evitar. Perder-se-ia a atribuição obrigatória (violaria o direito moral do autor, no recorte pessoal), a honestidade de proveniência com o usuário, e o link de retorno de tráfego. Ou seja: **não guardar** esse mínimo prejudicaria a própria fonte. Este é o ponto central do balanceamento (§3): o tratamento é *pró-fonte*.

---

## 2. Teste de Necessidade (Necessity Test)

**O tratamento é estritamente necessário para a finalidade?** (Art. 10, §1º — "somente os dados pessoais estritamente necessários para a finalidade pretendida poderão ser tratados"; a finalidade determinada é o Art. 6º, I)
Sim. A atribuição é impossível sem (a) *quem* — o nome da fonte (publisher/autor) — e (b) *onde* — a URL de origem. São os dois elementos irredutíveis de um crédito com link. O invariante "importada ⇒ tem atribuição" é imposto na rota de importação (ADR-0019), e o `source_url` **nunca** é zerado (ver §4).

**Há forma menos invasiva de atingir a mesma finalidade?**
- **Guardar só a URL, sem o nome?** A URL já é gravada e, quando o nome é removido, a atribuição **cai para o host derivado da URL** (`bareHost` em `src/domain/source-host.ts`). Ou seja, existe um modo de operar **sem** o dado pessoal nominal — e é justamente para onde a remoção leva. Mantemos o nome apenas porque um crédito **nominal** é mais fiel à fonte do que "fonte: exemplo.com". Isso é uma escolha *a favor* da fonte, e é reversível (§4). **[VALIDAR COM O ADVOGADO]** se o crédito nominal deve nascer opt-in/rebaixado ao host por padrão — hoje nasce nominal.
- **Não copiar nada e só linkar?** Já é o comportamento padrão da Busca (mostra links "da web" sem armazenar). O armazenamento só ocorre quando o usuário **clica e confirma** a importação — nunca em crawl de fundo (fetch só por ação explícita, ADR-0019).

**Os dados coletados são os mínimos para a finalidade?** (Art. 6º, III — princípio da necessidade)
Sim, e a minimização é **real, não declaratória**:
- Guardam-se **exatamente dois campos**: `source_name` (nome da fonte — publisher/site, subsidiariamente autor) e `source_url` (URL pública). Toda outra receita deixa esses campos `NULL`.
- **Não se copia a foto** (a receita importada nasce sem imagem) nem o **`description`/headnote autoral** (`descricao: null`, `persist-import.ts` L64-65). Essas são a camada expressiva/protegida e a maior superfície de dado de terceiro — e ficam de fora por design.
- A fonte de domínios é uma **allowlist curada** (teto `MAX_ALLOWLIST=50` em `src/domain/web-search-config.ts` — L40, aplicado no parse da allowlist em ~L71), consultada pelo provedor **Brave** (`src/server/web-search/web-search-provider.ts`), que busca `MAX_SITE_QUERIES=8` domínios por consulta e capa a saída em `MAX_WEB_RESULTS=5`, o que limita *de onde* qualquer dado pode vir.

Conclusão do teste de necessidade: **atende** ao Art. 10, §1º e ao Art. 6º, III. Não há coleta excessiva.

---

## 3. Teste de Balanceamento (Balancing Test)

| Fator | Avaliação |
|---|---|
| **Expectativa razoável do titular** | **ALTA — no subconjunto em que há pessoa natural.** Lembrando (§Identificação) que o campo guarda **preferencialmente o nome do veículo/publisher** (não-pessoal), a análise de expectativa só se coloca quando o valor é o **nome de um autor**. Nesse caso, o nome vem do campo `author` **publicado pela própria página** em JSON-LD schema.org/Recipe (que os sites já expõem para leitura e indexação pelo Google). Um autor que publica sob seu nome *espera* ser creditado quando citado — creditar é o oposto de surpreendê-lo. Reforça o Art. 7º, §3º (dado de acesso público, considerada a finalidade/boa-fé). |
| **Impacto potencial sobre direitos do titular** | **LEVE.** Não há decisão sobre a pessoa, não há perfil, não há exposição nova: o crédito **reduz** o risco de *passing-off* em vez de criar dano. A cópia é **privada e não-publicável** (`visibility='private'` sempre — `persist-import.ts` L45; ADR-0019 "importada nunca é pública"), então o nome não é reamplificado num pool público. Impacto residual: o nome fica associado, na coleção privada de um usuário, a uma receita que o autor de fato escreveu. |
| **Categoria do dado** | **Comum / contextual** (Art. 5º, I) — **no subconjunto pessoal**. No caso típico (`source_name` = nome de veículo/publisher) **não há dado pessoal de pessoa natural** e a LGPD sequer incide sobre o campo. Havendo nome de autor, é um nome de autoria num contexto profissional/editorial, **não sensível** (Art. 5º, II) — logo, Art. 7º, e não Art. 11. |
| **Vulnerabilidade do titular** | **Nenhuma presumida.** Autor/publisher de conteúdo publicado — não é criança, idoso ou hipossuficiente identificável como tal. **[VALIDAR COM O ADVOGADO]** o tratamento de casos-limite (ex.: blog pessoal de um menor) — mitigado pela curadoria manual do allowlist, que aprova domínios um a um. |
| **Forma de coleta** | **Transparente/observada, de página pública.** Coletado de dado estruturado que o site publica (JSON-LD), via `User-Agent` identificado (`RefogandoBot/1.0`), respeitando `robots.txt` (RFC 9309), com rate-limit (~1 req/s/domínio) e **só por ação explícita** do usuário. Não há inferência nem coleta oculta. |
| **Salvaguardas existentes** | (1) **Importação sempre privada e não-publicável**; (2) **exclusão da camada expressiva** — foto e headnote nunca copiados; (3) **atribuição obrigatória que beneficia a própria fonte** (`source_url` nunca é zerado); (4) **remoção do nome** disponível (`clearSourceAttribution`), com fallback gracioso para o host; (5) **allowlist curada** (veto site a site de robots.txt/ToS antes de entrar); (6) **minimização real** (dois campos, nada mais). |

**Conclusão do balanceamento:** o interesse do controlador **prevalece** sobre os direitos e liberdades do titular, porque (a) o tratamento é **a favor da fonte** — no recorte pessoal, atribuição é um direito moral do próprio autor, não uma apropriação; (b) a **expectativa é alta** (nome de autor publicado na própria página) e o **impacto é leve** (dado comum, cópia privada, sem perfil/decisão); (c) a **minimização é efetiva** (só nome + URL; foto e headnote fora); e (d) há **salvaguardas concretas no código**, inclusive um caminho de **oposição** (remoção do nome, com a atribuição sobrevivendo rebaixada ao host). Some-se a isso que, na maioria das importações, `source_name` guarda uma **marca/veículo** e, portanto, **nem há dado pessoal de pessoa natural** em jogo. O balanceamento respeita as legítimas expectativas do titular e os direitos e liberdades fundamentais exigidos pelo Art. 10, II. **[VALIDAR COM O ADVOGADO]** a conclusão e, em especial, os *gaps de exercício de direitos* apontados no §4 (o botão de remoção hoje só é acionável pelo dono da importação, não pelo próprio autor).

---

## 4. Salvaguardas adotadas (checklist)

- [ ] **Transparência ativa (informar na política de privacidade)** — **GAP.** Não existe Política de Privacidade publicada no produto (nenhuma rota `privacidade`/`termos` em `src/app`, nada em `public/`). O Art. 10, §2º **exige** transparência do tratamento por legítimo interesse, e o Art. 9º exige informar o titular. **Ação bloqueante antes do go-live:** publicar política mencionando esta coleta (usar a skill `lgpd-privacy-policy`).
- [ ] **Mecanismo de oposição fácil (opt-out em 1 clique)** — **PARCIAL.** Existe a rota `POST /api/recipes/[id]/clear-attribution` (`src/app/api/recipes/[id]/clear-attribution/route.ts` → `clearSourceAttribution`), que zera **só** `source_name` (nunca toca `origin`/`source_url`; idempotente; autorização por *ownership* com 404 leak-safe). **Porém** ela só é acionável pelo **dono logado da receita importada** — **não** pelo próprio **titular** (o autor da fonte). Não há canal público de takedown nem Encarregado anunciado para o titular exercer o direito de oposição (Art. 18, §2º). **Ação:** publicar canal de takedown/atendimento ao titular (e-mail/formulário) + prazo de resposta.
- [x] **Minimização de dados** — só `source_name` + `source_url`; foto e headnote nunca copiados (`persist-import.ts`); demais receitas com os campos `NULL`.
- [ ] **Limitação de retenção** — **GAP.** Não há prazo/critério de retenção definido para a atribuição. **[VALIDAR COM O ADVOGADO]** — provável posição: retenção enquanto a receita importada existir (a atribuição é condição da própria cópia), com eliminação junto da receita; documentar isso.
- [x] **Acesso restrito (need-to-know)** — a receita importada é `private`; o nome só aparece na coleção do dono e no crédito da própria receita, não em superfícies públicas/pool.
- [ ] **Criptografia** — em repouso conforme infra (Neon/Postgres gerenciado) e em trânsito (HTTPS). **[VALIDAR COM O ADVOGADO/infra]** se algo adicional é exigido — provavelmente não, dado o caráter público do dado.
- [ ] **Pseudonimização** — não aplicável (a finalidade *é* creditar o nome; pseudonimizar destruiria a finalidade). O caminho de "des-identificação" existente é a **remoção do nome** com queda para o host.
- [x] **Outras — camada expressiva excluída**: foto (nasce sem imagem) e `description`/headnote (nasce em branco) nunca são copiados; reduz drasticamente a superfície de dado de terceiro.
- [x] **Outras — coleta educada e por ação explícita**: `robots.txt` (RFC 9309), `User-Agent` identificado, rate-limit ~1 req/s/domínio, fetch só sob clique do usuário, allowlist curada.
- [x] **Outras — atribuição irremovível a favor do titular**: `source_url` nunca é zerado; mesmo após remover o nome, o crédito "ver no site" persiste (fonte: `clear-attribution.ts`, `source-host.ts`).

**Resumo dos GAPs bloqueantes (independem de código; dependem de decisão jurídica/publicação):** (1) Política de Privacidade publicada; (2) canal público de takedown + Encarregado (DPO) para o **titular** exercer oposição/eliminação; (3) prazo de retenção documentado. Enquanto não fechados, a feature permanece **atrás da flag de produção desligada** (também gated por `WEB_SEARCH_API_KEY`).

---

## 5. RIPD necessário? (Art. 10, §3º)

A ANPD **pode** solicitar Relatório de Impacto à Proteção de Dados Pessoais (RIPD) para tratamento fundado em legítimo interesse. Avaliação do caso:

- **Perfilamento?** Não. Nenhum perfil é construído sobre o autor.
- **Decisão automatizada com efeitos sobre a pessoa?** Não (Art. 20 não incide).
- **Vigilância/monitoramento?** Não. Coleta pontual de um nome de fonte público, por ação do usuário; nenhum monitoramento contínuo de pessoas.
- **Dados sensíveis (Art. 5º, II)?** Não. Nome de autoria = dado comum (e, no caso típico, sequer é dado pessoal — é o publisher/veículo).
- **Menores/crianças e adolescentes?** Não como público-alvo; risco marginal mitigado pela curadoria manual do allowlist (§3).
- **Larga escala (> 2 milhões de titulares)?** Não. Universo restrito (allowlist ≤ 50 domínios; importação individual e sob clique).

**Avaliação:** RIPD **provavelmente dispensável** — nenhum dos gatilhos de alto risco está presente. Ainda assim, **registra-se aqui a avaliação** (o próprio Art. 10, §3º faculta à ANPD exigi-lo), e recomenda-se manter este LIA + esta seção como o registro mínimo de accountability. **[VALIDAR COM O ADVOGADO]** a dispensa; se ele/ela entender necessário, produzir o RIPD (skill `lgpd-ripd`).

---

## 6. Decisão

> Esta seção é **para o(a) advogado(a)/Encarregado(a) preencher e assinar**. A recomendação interna abaixo é um insumo, não a decisão final (documento é rascunho).

**Recomendação interna (da equipe, sujeita a sign-off):** aprovar o uso de **legítimo interesse (Art. 7º, IX + Art. 10)** para armazenar `source_name` + `source_url` — no recorte em que `source_name` é dado pessoal —, **condicionado** ao fechamento dos três GAPs do §4 (Política de Privacidade publicada; canal de takedown + Encarregado para o titular; prazo de retenção documentado) **antes** de ligar a flag de produção.

- [ ] **Aprovo** o uso de legítimo interesse para esta atividade (com as condições acima).
- [ ] **Aprovo com ressalvas**: _______________________________________________
- [ ] **Rejeito** — recomendo migrar para: ☐ Art. 7º, §4º (dado manifestamente público) ☐ outra: __________

**Responsável pela decisão (Encarregado / Jurídico):** ____________________________ (a designar — hoje inexistente)
**Data:** ____ / ____ / ______
**Assinatura:** ____________________________

---

### Anexo — Fontes de verdade (código e docs)

- Campos de atribuição: `src/db/schema.ts` (~L213-222 — `source_url`, `source_name`, nullable, sem CHECK; comentário "nome legível do site/publisher" ~L216).
- Derivação de `source_name` (preferência publisher → autor → host): `src/domain/recipe-import-parse.ts` (L300-306) e `src/server/web-search/web-search-provider.ts` (L146-150, Brave `profile.name` → host).
- Gravação na importação: `src/server/import/persist-import.ts` (`origin='web_imported'`, `visibility='private'`, `descricao: null` L64-65 — headnote não copiado; nasce sem imagem).
- Remoção do nome: `src/server/recipe/clear-attribution.ts` (`clearSourceAttribution`) e a rota `src/app/api/recipes/[id]/clear-attribution/route.ts`.
- Regra "o nome é só o host?": `src/domain/source-host.ts` (`sourceNameIsHost`, `bareHost`).
- Allowlist (teto): `src/domain/web-search-config.ts` (`MAX_ALLOWLIST=50`, L40; cap aplicado em `parseAllowlist`, ~L71).
- Provedor / limites de busca: `src/server/web-search/web-search-provider.ts` (`MAX_SITE_QUERIES=8`, `MAX_WEB_RESULTS=5`, Brave — a constante `MAX_ALLOWLIST` só é mencionada em comentário aqui).
- Postura e caveat de sign-off: `docs/adr/0019-descoberta-federada-links-web-importacao-privada.md`.
- Briefing de consulta ao advogado: `docs/legal/briefing-juridico-descoberta-web.md`.

*Artigos citados (LGPD, Lei 13.709/2018): Art. 5º, I/II; Art. 6º, I/III/VI; Art. 7º, IX, §3º e §4º; Art. 9º; Art. 10, caput, I, II, §1º, §2º, §3º; Art. 18, §2º; Art. 20. Direito moral de atribuição: Lei 9.610/98 (arts. 8º e 24). Referências são pesquisa interna, a validar pelo(a) advogado(a).*
