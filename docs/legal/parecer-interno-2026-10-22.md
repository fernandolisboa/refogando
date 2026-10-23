# Parecer interno de privacidade e PI — sign-off de 2026-10-22

> **O que é este documento.** É o sign-off interno das pendências jurídicas do Refogando, feito pelo Claude por delegação do controlador (Fernando Lisboa) em 2026-10-22, no lugar da revisão de advogado que os rascunhos de `docs/legal/` esperavam. **Não é parecer de advogado(a)** e não foi revisado por um. As decisões aqui valem como decisões do controlador: ele pediu que nada mais ficasse bloqueado esperando sign-off externo e reservou para si só os pontos muito sensíveis (§10).
>
> **Método.** Varredura política × prática (método `policy-monitor` do plugin `privacy-legal` da Anthropic), análise de lacunas regulatórias (`reg-gap-analysis`) e matriz severidade × probabilidade (`legal-risk-assessment` do plugin `Legal`), sobre: o código em `main` (`5b4580d`), a configuração da Vercel, os textos publicados em `/privacidade` e `/seus-direitos`, os Termos de Uso vigentes dos 11 sites da allowlist (lidos ao vivo em 2026-10-22) e a regulação vigente pesquisada na mesma data.
>
> **Fontes e etiquetas.** `[primária]` = texto oficial ou documento do próprio fornecedor consultado diretamente; `[secundária]` = reprodução, escritório ou imprensa; `[análise]` = juízo nosso. O planalto.gov.br estava fora do ar no dia da pesquisa: os textos de lei foram conferidos em páginas da ANPD, AGU e STJ que os transcrevem. Datas de vigência e números de artigo de normas de 2025–2026 merecem conferência antes de qualquer uso externo.

## 1. Enquadramento

| Ponto | Decisão | Fundamento |
|---|---|---|
| Controlador | Fernando Lisboa, pessoa física, sem CNPJ. | LGPD art. 5º, VI; art. 9º, III exige identificação e contato, não CNPJ. |
| Agente de pequeno porte | **Sim.** Pessoa natural com obrigações de controlador, receita zero, poucos titulares, sem tratamento de alto risco. | Res. CD/ANPD nº 2/2022, arts. 2º, I, 3º e 4º `[primária]`. IA e dado sensível são critérios **específicos**; alto risco exige também um critério **geral** (larga escala ou efeito significativo sobre direitos), ausente `[análise]`. |
| Encarregado | **Dispensado**; mantém-se o canal `privacidade@refogando.com`, atendido pelo controlador. A política deixa de chamá-lo de "encarregado (DPO)". | Res. 2/2022, art. 11, caput e § 1º `[primária]`. Autodesignar o próprio controlador esbarra no conflito de interesse da Res. CD/ANPD nº 18/2024, art. 19, § 1º, II `[secundária]`. |
| Prazos ao titular | Mantemos **15 dias corridos** para a resposta completa (mais protetivo que os 30 do pequeno porte); acesso simplificado imediato pela exportação self-service. | LGPD art. 19, I e II; Res. 2/2022, arts. 14, III e 15 `[primária]`. Corridos: a LGPD não qualifica e a leitura corrida é a conservadora `[análise]`. |
| Reavaliar o enquadramento | Ao ligar cobrança, abrir CNPJ, passar de ~10 mil contas ativas, ligar analytics ou abrir a Descoberta para a web aberta. | Res. 2/2022, arts. 3º e 16 `[primária]`. |

## 2. Descoberta na web (#276) — respostas às perguntas do pacote

Perguntas de `docs/legal/pacote-consulta-juridica.md` §5 e `docs/legal/takedown-e-remocao-titular.md` §9.

1. **Base legal do nome do autor + URL.** **Legítimo interesse (art. 7º, IX, com art. 10)**, documentado na LIA (`docs/legal/lia-descoberta-web.md`), que fica aprovada. O fato de o dado ter sido publicado pelo próprio titular (art. 7º, §§ 3º, 4º e 7º) **entra no teste de balanceamento** (expectativa alta, impacto baixo); não é uma base autônoma alternativa. A política deixa de citá-lo como "fundamento alternativo". Quando `source_name` é marca ou pessoa jurídica, nem há dado pessoal (art. 5º, V).
2. **Manter a URL depois de tirar o nome.** Por padrão, sim: o crédito é obrigatório (Lei 9.610/98, art. 24, II) e a URL aponta para o que o próprio autor publicou. **Escalar para `url_unlink`** quando (a) a URL identifica a pessoa (nome no domínio ou no caminho) e ela pede a remoção, ou (b) a pessoa se opõe ao tratamento como um todo (art. 18, § 2º): o direito de ser creditado é do autor, que pode preferir não ser nomeado. **Usar `record_deletion`** (apaga as cópias importadas) quando quem pede é o titular do site ou dos direitos sobre o conteúdo, alegando direito autoral ou violação dos Termos dele; nesse caso o domínio entra também na `TOS_DENYLIST`.
3. **LIA ou RIPD.** A LIA basta. RIPD dispensável: baixo risco, sem critério de alto risco. A ANPD pode exigi-lo (art. 38), e aí se faz.
4. **Política publicada atende o art. 9º?** Com as correções da v3 (§4), sim. Identificar o controlador como pessoa física sem CNPJ é suficiente.
5. **Pequeno porte e encarregado.** Ver §1.
6. **Contagem do prazo.** Corridos (§1).
7. **Retenção.** Ver §5 e ADR-0050: (a) conteúdo privado de conta eliminada é apagado na hora, o público fica anonimizado; (b) tickets de takedown encerrados são apagados 12 meses depois do encerramento; (c) auditoria DSAR por 5 anos, depois apagada.
8. **Domínios em revisão manual.** Ver §3.
9. **Titular estrangeiro e verificação de identidade.** Atende-se igual (a LGPD alcança o tratamento feito no Brasil qualquer que seja a nacionalidade do titular, art. 3º). O canal já é bilíngue. Verificação mínima, sem documento, como já está (art. 6º, III).
10. **Conteúdo mínimo do canal.** O que está publicado em `/seus-direitos` basta: tipo de pedido, identificação do conteúdo, pedido, contato opcional, prazo e protocolo.

**Achado novo (corrige a postura).** O importador copia o **texto dos passos** como o site publica (`parseInstructions` em `src/domain/recipe-import-parse.ts` só achata `recipeInstructions`); a postura documentada dizia "só fatos". Avaliação: risco **baixo** enquanto a cópia for privada, não publicável e creditada. Instruções funcionais têm proteção autoral fraca (Lei 9.610, art. 8º, I e VII exclui procedimentos e métodos), mas a cópia literal da redação não é "só fatos", e o argumento da cópia privada (art. 46, II) é fraco porque quem copia é o serviço `[análise]`. **Decisão:** aceito como está, com os documentos corrigidos. **Condição:** antes de qualquer plano pago que inclua a importação, reescrever os passos na importação (paráfrase) ou obter permissão escrita dos sites mantidos.

**Postura do ADR-0019: aprovada**, com a correção acima e a allowlist do §3. A feature já está ligada em produção (`webAvailable: true` na home em 2026-10-22); este sign-off a regulariza.

## 3. Allowlist: leitura dos Termos de Uso vigentes (2026-10-22)

Regra (de `docs/legal/revisao-tos-allowlist.md`): **excluir** quando os Termos vigentes têm cláusula verbatim que a importação viola (robôs para copiar ou baixar, armazenar em banco de dados, cópia por serviço de terceiro); **manter** quando o robots.txt libera a página de receita e os Termos não falam de automação nem de armazenamento; Termos ilegíveis ⇒ excluir.

| Domínio | Termos lidos | Cláusula decisiva | Decisão |
|---|---|---|---|
| tudogostoso.com.br | /termos-de-uso (sem data) | Veda cópia "com a intenção de propagação" e "uso comercial não autorizado". Nada sobre robôs ou armazenamento. | **Manter, condicionado** |
| receitasnestle.com.br | /termos-e-condicoes (sem data) | "Não use comercialmente nenhum conteúdo… a menos que… o faça por algum meio legalmente permitido". | **Manter, condicionado** |
| cybercook.com.br | — | Domínio inteiro redireciona para carrefour.com.br; não há receitas nem Termos. | **Excluir** |
| receiteria.com.br | /termos-de-uso (mod. 2026-07-03, via API do site) | §2: uso "para visualização dentro do site"; cópia parcial "em qualquer mídia" proibida. | **Excluir** |
| allrecipes.com, simplyrecipes.com, seriouseats.com | people.inc/brands-termsofservice (31/07/2025) | §3.3(e): proíbe robôs para "scrape, harvest, or download data"; exceção só para índice público de buscador. | **Excluir** |
| bbcgoodfood.com | immediate.co.uk/terms-and-conditions (set/2025) | §10: proíbe "copy, store in any medium" sem permissão escrita. | **Excluir** |
| panelinha.com.br | /termos-de-uso (04/07/2023) | 6.2 veda reprodução parcial; 6.3 autoriza só visualizar; 3.3 (robôs usados contra os Termos). | **Excluir (confirmado)** |
| guiadacozinha.com.br | /termos-de-uso/ (meta 2025-09-18) | Proíbe "download… para armazená-lo em banco de dados". | **Excluir (confirmado)** |
| foodnetwork.com | /site/terms + Visitor Agreement WBD (jan/2023), ao vivo | §3(B)(iii): robô para copiar "for any purpose" sem permissão escrita. | **Excluir (confirmado)** |

**Condição dos dois mantidos:** se "uso comercial do conteúdo" alcançar uma ferramenta paga que guarda cópias para os usuários, os dois caem juntos. Reavaliar (ou pedir permissão escrita) antes de a importação entrar num plano pago. Detalhe e trechos verbatim em `docs/legal/revisao-tos-allowlist.md` §4.

## 4. Política × prática (achados)

`OBRIGATÓRIO` = a política descreve mal a prática ou a omite (art. 6º, VI; art. 9º). `RECOMENDÁVEL` = a política é silente sem conflito, ou é boa prática. Risco = severidade × probabilidade (1–25).

| # | Achado | Classe | Risco | Decisão | Onde |
|---|---|---|---|---|---|
| 1 | Exportar e excluir a conta só existem como API; a política promete self-service. | OBRIGATÓRIO | 3×4=12 | Botões em Editar perfil → Seus dados; exportação completa. | #595 |
| 2 | Conta eliminada mantém conteúdo privado (transcrições, pedidos, receitas privadas, listas, salvos…), em parte não divulgado. | OBRIGATÓRIO | 3×3=9 | Apagar o privado na hora; o público fica anonimizado. | #473, ADR-0050 |
| 3 | `session` guarda IP e navegador e sessões vencidas nunca são apagadas; política não fala de IP. | OBRIGATÓRIO | 2×4=8 | Apagar sessão vencida todo dia; divulgar. | #473, v3 |
| 4 | Login com Google (e avatar servido pelo Google) fora da política. | OBRIGATÓRIO | 2×4=8 | Divulgar em 3.1 e §5. | v3 |
| 5 | Gemini recebe foto do usuário no modo de edição; Anthropic também traduz e escolhe o cenário da foto; busca de visitante vira embedding no Gemini. | OBRIGATÓRIO | 2×3=6 | Divulgar finalidades e dados. | v3 |
| 6 | Nenhuma linha sobre cookies. Só há cookies estritamente necessários (sessão, idioma, tema). | OBRIGATÓRIO | 2×3=6 | Seção de cookies; sem banner (Guia ANPD de cookies, 2022, p. 20 e 24 `[primária]`). | v3 |
| 7 | Registros técnicos de erro (#594) fora da política. | OBRIGATÓRIO | 2×3=6 | Seção de registros técnicos: legítimo interesse, mascarados, sem IP, até 30 dias na Vercel. | v3 |
| 8 | "Transferência internacional com as salvaguardas dos arts. 33 a 36" é genérico e, para a maioria dos fornecedores, impreciso. | OBRIGATÓRIO | 3×2=6 | Texto por fornecedor e mecanismo (§6). | v3 |
| 9 | Consentimento das restrições salvas não informa o caráter internacional (dado sensível não cabe no art. 33, IX). | OBRIGATÓRIO | 3×2=6 | Texto junto do botão passa a dizer que o app e a IA funcionam nos EUA (art. 33, VIII). | v3 |
| 10 | A política diz que mantemos registro das operações (art. 37), mas ele não existia. | OBRIGATÓRIO | 2×2=4 | `docs/legal/registro-de-operacoes.md` (modelo simplificado de pequeno porte). | este PR |
| 11 | Nota de rascunho publicada ("o inventário… ainda será fechado") e status "revisão jurídica em andamento". | OBRIGATÓRIO | 1×5=5 | Remover; status "revisão interna concluída em 2026-10-22" (sem alegar advogado). | v3 |
| 12 | Encarregado nomeado sem necessidade (§1). | RECOMENDÁVEL | 1×2=2 | Dispensa + canal. | v3 |
| 13 | Tickets de takedown e auditoria sem prazo. | OBRIGATÓRIO | 2×2=4 | 12 meses / 5 anos; divulgar. | #473, v3 |
| 14 | Avatar e foto de receita vão ao Blob público com EXIF/GPS (só a foto de avaliação é limpa no servidor). | RECOMENDÁVEL (segurança, art. 46) | 3×2=6 | Re-encode no servidor. | #596 |
| 15 | Dois pontos logam o objeto de erro inteiro (pode levar texto da conversa); um loga `err.message` cru. | RECOMENDÁVEL (art. 46) | 2×2=4 | Logar só nome e código. | #473 |
| 16 | Cadastro sem link para a política. | RECOMENDÁVEL | 1×3=3 | Linha informativa com link (sem checkbox: as bases são contrato e legítimo interesse). | #595 |
| 17 | Receita gerada por IA publicada não leva selo de IA (imagem e tradução levam). | RECOMENDÁVEL (CDC art. 6º, III; PL 2338 se aprovado) | 1×2=2 | Issue de produto. | #597 |
| 18 | Sem Termos de Uso e sem regra de idade (ECA Digital, §7). | decisão do controlador | 3×3=9 | Ver §10. | ADR-0051; Termos v1 |
| 19 | Incidente de 09/09 sem o registro do art. 10 da Res. 15/2024. | OBRIGATÓRIO | 3×3=9 | Registro escrito; comunicação: ver §10. | `docs/incidents/` |
| 20 | O Better Auth loga o e-mail digitado num login que falha (`"User not found"`, `"Credential account not found"` e `"Password not found"`, com `{ email }`). | OBRIGATÓRIO (art. 6º, III; art. 46) | 2×4=8 | Descartar as três linhas no logger do app (`authLog` em `src/lib/auth.ts`), como já se fazia com as do reset e do cadastro. | código, este PR |
| 21 | Perfil público fora da política: nome, @, foto, bio, links e as listas de quem a pessoa segue e de quem a segue ficam numa página aberta e indexável, e o nome e o @ aparecem nas receitas publicadas, nas avaliações, na busca de cozinheiros e nas notificações a terceiros. | OBRIGATÓRIO | 2×4=8 | Divulgar em 3.1; registro, operação 15. | v3 |
| 22 | A fila de revisão da curadoria mostra imagens geradas com pedido de estilo ou editadas por IA também de receitas privadas, com o título e o nome e o @ do dono, e a lista de ingredientes livres para o vocabulário agrega os pedidos de todos (sem nome). A política dizia "conteúdo privado visível só ao dono". | OBRIGATÓRIO (transparência, art. 6º, VI) | 2×3=6 | Divulgar em 3.3 e §4 (registro, operação 16); limitar a fila a receitas públicas. | v3; feito em #599 (política v3.2, Termos v1.2) |
| 23 | Título, descrição e ingredientes de cada receita, inclusive das privadas, vão ao Gemini para o vetor de busca; a política só falava do termo buscado. | OBRIGATÓRIO | 2×3=6 | Divulgar em 3.2, com a tradução pela Anthropic. | v3 |
| 24 | Cópias de segurança semanais do banco (3 guardadas) e cópias de preview por PR fora da política. | OBRIGATÓRIO | 1×3=3 | Divulgar em §4: o que é apagado sai das cópias em até 4 semanas; registro, operação 17. | v3 |
| 25 | Mudança que afeta o consentimento das restrições salvas (o app e a IA nos EUA) exige aviso destacado (art. 8º, §6), e não há registro de quando nem de qual texto foi consentido. | OBRIGATÓRIO | 2×2=4 | Aviso destacado no formulário das restrições, para quem já tinha restrições salvas, até salvar de novo ("Entendi" só esconde na tela); registrar data e versão do consentimento pede migração. | aviso: este PR; registro: feito em #600 (política v3.3; o aviso passou a usar a versão gravada) |
| 26 | O log cru do Next (mensagem e stack de um erro inesperado do servidor) pode trazer um trecho do dado processado; `[cache-tags]` e `[home]` passavam o objeto do erro inteiro. | RECOMENDÁVEL | 2×2=4 | Divulgar em 3.7; `[cache-tags]` e `[home]` passam a logar só nome e código. | v3; #473 (PR A) |

## 5. Retenção (resumo; a regra é o ADR-0050)

- **Eliminação da conta:** anonimiza a linha `users` e apaga na hora tudo o que é só da pessoa (receitas privadas, histórico de criação e conversas, salvos, coleções, listas de compras, Cardápio, Despensa, seguidores e seguidos, notificações, sessões e credenciais). Ficam, sem identificação, as receitas públicas e as avaliações (foto da avaliação apagada 180 dias depois) e os registros de custo. Contas já eliminadas são limpas pela passada diária. Base: art. 16 (eliminação ao fim do tratamento); o que fica é anonimizado (art. 12) e serve a terceiros que salvaram, avaliaram ou planejaram com o conteúdo público.
- **Registros de uso de IA:** 24 meses (custo e abuso); o de extração, 30 dias (só alimenta uma cota de 24 h).
- **Sessões:** valem 7 dias, renovados com o uso, e são apagadas em até 1 dia depois de vencer (o IP e o navegador vão junto). Rate limit por IP: até 2 horas após a última tentativa (o registro sai 50 minutos depois da última tentativa, na limpeza de hora em hora).
- **Cópias de segurança:** uma por semana, as 3 mais recentes (`.github/workflows/db-backup.yml`); o que é apagado ou anonimizado sai delas em até 4 semanas. As cópias de preview de cada PR são apagadas quando o PR fecha; branch sem PR: conferência manual (handoff 84).
- **Tickets de takedown encerrados:** 12 meses após o encerramento (o último registro de atendimento ou recusa na auditoria; sem ele, o recebimento). Abertos nunca são apagados automaticamente.
- **Auditoria DSAR:** 5 anos (prazo da ação punitiva da administração, Lei 9.873/1999, art. 1º, e o mesmo prazo do registro de incidentes), depois apagada.
- **Registro do encerramento de conta pela equipe** (#606, `account_closure`, política v3.4, item 3.6): 5 anos, depois apagado. Guarda só o motivo (lista fechada), a data, se o conteúdo público saiu, se o aviso por e-mail foi tentado e o admin que decidiu, ligado à conta já anonimizada. Base: exercício regular de direitos (art. 7º, VI), para a defesa se a pessoa contestar o encerramento; o prazo acompanha o da reparação pelo fato do serviço (CDC, art. 27) e o da ação punitiva da administração (Lei 9.873/1999, art. 1º) `[análise]`. Não é auditoria DSAR: a decisão é do controlador, não pedido do titular.
- **Registros técnicos (logs):** não vão ao banco; ficam na Vercel pelo prazo do plano (hoje 1 dia, 30 com Observability Plus).
- **Guarda de 6 meses do Marco Civil (art. 15):** não se aplica a pessoa física `[secundária]` e, pela leitura do STJ sobre MEI, provavelmente nem a MEI `[análise]`. Passa a valer com sociedade (SLU/Ltda): ver §9.

## 6. Transferência internacional

As funções da Vercel rodam em `iad1` (EUA, configuração do projeto em 2026-10-22); o banco Neon fica em `sa-east-1` (São Paulo); Anthropic, Google, Resend e Brave processam nos EUA.

> **Atualização (2026-10-23, ADR-0053, política v3.6):** as funções passaram para `gru1` (São Paulo), ao lado do banco; o store do Blob (imagens) já estava em `gru1`. Fica nos EUA a IA (Anthropic, Gemini), o e-mail, a busca e o que a Vercel e a Neon tratam como empresas americanas (suporte, registros técnicos). As conclusões abaixo não mudam: o art. 33, IX segue como mecanismo geral, agora com menos dado saindo do país. O risco aceito dos fluxos de legítimo interesse na Vercel diminui (IP, sessão e rate limit passam a ser processados no Brasil; só os registros técnicos podem ir aos EUA). Para as restrições salvas, o texto do consentimento passou a dizer "o app funciona no Brasil e a IA, nos Estados Unidos" (versão `2026-10-23`); a informação do caráter internacional exigida pelo art. 33, VIII continua presente, e quem consentiu com o texto anterior vê o aviso no formulário (art. 8º, §6), sem perder as restrições.

- **Mecanismo geral: art. 33, IX c/c art. 7º, V** (transferência necessária para executar o serviço que o próprio usuário pediu: hospedagem, conta, e-mail transacional, IA acionada por ele). Para a caixa do canal de privacidade na Proton (Suíça), art. 33, IX c/c art. 7º, II (atender pedidos de titulares). O Regulamento de Transferência (Res. CD/ANPD nº 19/2024, art. 9º, II, "c") trata essas hipóteses como mecanismo autônomo, sem cláusulas-padrão `[primária]`. Risco aceito: a ANPD não interpretou "necessário" e uma leitura restritiva é possível `[análise]`. Vercel, Neon/Databricks, Anthropic, Resend e Brave não oferecem cláusulas-padrão brasileiras nos DPAs públicos `[primária]`, e uma pessoa física não as negocia.
- **Google (Gemini):** no plano **pago**, os termos da Gemini API remetem ao DPA de processador do Google, que incorpora as cláusulas-padrão brasileiras (art. 33, II, "b") e proíbe usar prompts para melhorar produtos `[primária]`. No plano **gratuito**, o Google usa o conteúdo para melhorar produtos e pode haver revisão humana. **Confirmado pelo controlador em 2026-10-22:** a chave está num projeto com faturamento ativo no Google AI Studio, então vale o plano pago. Manter assim; se o faturamento cair, o app passa a operar no plano gratuito e a política fica falsa.
- **Restrições alimentares salvas (dado sensível):** o art. 33, IX só alcança bases do art. 7º; para dado sensível a hipótese é o **art. 33, VIII** (consentimento específico e em destaque, com informação prévia do caráter internacional). O texto junto do botão de salvar passa a informar isso. As restrições marcadas num pedido avulso são atributo da receita pedida (pode ser para outra pessoa), não declaração sobre a saúde do titular `[análise]`, e seguem a base do pedido.
- **Fluxos de legítimo interesse hospedados na Vercel (EUA):** o IP e o navegador da sessão, o rate limit e os registros técnicos têm base no legítimo interesse (art. 7º, IX), que o art. 33, IX não lista (só os incisos II, V e VI do art. 7º). **Risco aceito** `[análise]`: esses tratamentos existem para prestar com segurança o serviço que o próprio usuário pediu (sem eles não há login seguro nem app no ar), então a transferência se apoia no art. 7º, V, como o resto da hospedagem. Uma leitura restritiva da ANPD exigiria cláusulas-padrão que a Vercel não oferece (§11).
- **Treino de modelos:** Anthropic (Commercial Terms) e Gemini pago não treinam com o conteúdo da API `[primária]`. Prompts não levam nome, e-mail nem ids.

## 7. Crianças e adolescentes (ECA Digital)

A Lei 15.211/2025 está em vigor desde 17/03/2026, com a ANPD como autoridade `[secundária]`, e alcança serviços de "acesso provável" por crianças e adolescentes, sem isenção para pessoa física. As obrigações dos arts. 7º (padrão mais protetivo), 8º (avaliação de risco e faixa etária) e 22 (vedação de perfilamento para publicidade) valem independentemente do porte `[secundária]`. Com perfil público e "seguir cozinheiros", o Refogando pode ser lido como rede social (art. 2º, III), e aí menores de 16 precisariam de conta vinculada a responsável (art. 24) `[secundária]`.

O app já cumpre o que vale sem Termos: não há publicidade nem perfilamento, as restrições nascem desligadas, nada de localização, as receitas novas nascem privadas. Falta a regra de idade, que depende dos Termos de Uso: decisão do controlador (§10), que escolheu **16 anos**.

**Com 16 anos como idade mínima.** Fica fora o art. 24 (conta vinculada a responsável, para menores de 16). Para quem tem 16 ou 17 anos valem o melhor interesse do adolescente (LGPD, art. 14, caput) e o padrão mais protetivo do ECA Digital. O app já atende a esse padrão para todos: as receitas novas nascem privadas, sem publicidade, perfilamento ou localização, e restrições só com consentimento. O perfil público e as avaliações são públicos para toda conta (§11). Não é preciso consentimento dos pais, que a LGPD só exige para criança (art. 14, § 1º).

O adolescente de 16 ou 17 anos é relativamente incapaz (Código Civil, art. 4º, I). O contrato que ele aceita sozinho é anulável (art. 171, I), mas o risco é baixo num serviço gratuito. Os Termos pedem que ele use o app com o conhecimento do responsável.

A idade é autodeclarada no cadastro, sem data de nascimento: é a medida proporcional para um app de receitas, sem conteúdo impróprio a adolescentes `[análise]`.

**Publicado em 2026-10-23 (PR C2, ADR-0051):** Termos de Uso v1 em `/termos` (seção `termos` de `src/i18n/messages/`), com a idade mínima, o pedido de conhecimento do responsável e a regra de moderação; linha de autodeclaração no cadastro e no botão do Google; Política v3.1 com a seção 9 "Crianças e adolescentes"; aviso no app para as contas anteriores. A leitura do art. 24 ("até 16 anos" como "menores de 16"), o procedimento para conta de menor de 16 e os riscos aceitos estão no ADR-0051.

## 8. Conteúdo de usuário e moderação (Marco Civil, arts. 19 e 21, após o STF)

O STF declarou o art. 19 parcialmente inconstitucional (Temas 533 e 987, jun/2025; embargos em jun/2026): a regra geral passa a ser a responsabilidade após notificação extrajudicial (art. 21) para crimes e ilícitos, com dever de cuidado e obrigações de autorregulação reguladas pelo Decreto 12.975/2026 e supervisionadas pela ANPD `[secundária]`. O regime alcança provedor de aplicação pessoa física `[análise]`; a ANPD pode diferenciar plataformas pequenas `[primária]`.

O app tem denúncia de avaliação e de receita pública na interface (botão Reportar; o da receita desde #605, Termos v1.1), com curadoria; perfil e quem não tem conta denunciam por e-mail. Basta, para o porte atual: tratar denúncia de ilícito manifesto com remoção e decisão registrada, e publicar a regra de moderação nos Termos (§10). A regra está nos Termos, item 8: retirada com o motivo registrado, notificação no app com a categoria do motivo, de uma lista fechada, e um link para pedir nova análise por e-mail (desde #609, Termos v1.3; antes ia sem o motivo; não há e-mail automático de retirada; o encerramento de conta pela equipe, no Console desde #606, manda um na violação grave; perfil, que não tem notificação, é avisado por e-mail pelo operador, P5 do ADR-0051), mais detalhes e nova análise a pedido pelo canal de privacidade.

## 9. Itens fora de privacidade, com efeito jurídico

- **#471 (analytics):** liberado do ponto de vista jurídico para uma solução **sem cookie** (Vercel Web Analytics, já operador): legítimo interesse, uma linha na política (§3 e §5), sem banner. A escolha de fornecedor e custo segue com o produto.
- **#467 (PF × MEI × CNPJ):** decisão fiscal do controlador, com três efeitos jurídicos a pesar: (a) sociedade ativa a guarda de 6 meses de registros de acesso (Marco Civil, art. 15); (b) a venda on-line exige nome, CPF/CNPJ e **endereço físico** em destaque (Decreto 7.962/2013, art. 2º) — CNPJ com endereço comercial evita expor o endereço residencial; (c) com cobrança, os Termos de Uso (v1 desde 2026-10-23, ADR-0051) ganham as cláusulas de consumo (CDC, Decreto 7.962) e a condição dos dois domínios mantidos (§3) precisa ser revista.

## 10. Pontos levados ao controlador

1. **Comunicar o incidente de 09/09 à ANPD?** Recomendação: não; registrar com a justificativa (Res. 15/2024, art. 10, § 1º, VIII). Registro em `docs/incidents/2026-09-09-banco-apagado-por-agente-do-feudo.md`. **Decidido pelo controlador em 2026-10-22: só registrar, sem comunicar.**
2. **Termos de Uso com idade mínima de 18 anos?** Recomendação: sim, já. **Decidido pelo controlador em 2026-10-22: Termos de Uso com idade mínima de 16 anos** (ver §7). Implementado: Termos de Uso v1 (ADR-0051).
3. **Confirmação de fato:** a chave do Gemini está no plano pago? **Confirmado em 2026-10-22: faturamento ativo (plano pago).**

Os três pontos foram respondidos pelo controlador em 2026-10-22.

## 11. Riscos aceitos

| Risco | Por que se aceita | Reavaliar quando |
|---|---|---|
| Transferência aos EUA pelo art. 33, IX, sem cláusulas-padrão, para Vercel, Neon, Anthropic, Resend e Brave. | Única via disponível para quem não negocia contrato; necessidade real para o serviço pedido. | A ANPD interpretar o art. 33, IX, ou um fornecedor publicar cláusulas-padrão brasileiras. |
| Texto dos passos copiado na importação. | Cópia privada, creditada, não publicável. | Antes de cobrança que inclua a importação. |
| Consentimentos de restrições já dados sem o aviso internacional (versão gravada nula). As restrições seguem pré-marcando os pedidos. | Poucos titulares; o aviso aparece no formulário das restrições (só lá, não no app todo) até salvarem de novo, e a revogação é um clique. O registro guarda só o último consentimento e não o idioma: os textos de cada versão, nos dois idiomas, ficam em `docs/legal/consentimento-restricoes.md`. | Se a ANPD exigir novo consentimento para mudança de transferência: aí as restrições com versão antiga deixam de pré-marcar até salvarem de novo. |
| Receitas públicas e avaliações ficam anonimizadas após a eliminação. | Terceiros dependem delas; a pessoa pode apagá-las antes de eliminar a conta. | Se houver pedido individual fundamentado. |
| Contrato com adolescente de 16 ou 17 anos sem assistência do responsável. | Serviço gratuito, sem cobrança nem dado sensível obrigatório; os Termos pedem o conhecimento do responsável. | Ao ligar cobrança (pagamento exige maior de 18 ou responsável). |
| O perfil público (nome, @, foto, bio e links que a pessoa preencheu) aparece para toda conta confirmada, inclusive de adolescentes, mesmo sem nenhuma receita publicada. | Não mostra idade, contato nem localização; tudo além do nome e do @ é opcional. | Guia da ANPD sobre ECA Digital exigir perfil privado por padrão: aí o perfil passa a aparecer só depois da primeira publicação. |
| Transferência aos EUA dos fluxos de legítimo interesse hospedados na Vercel (IP da sessão, rate limit, registros técnicos) pelo art. 33, IX c/c art. 7º, V (§6). | São parte de prestar com segurança o serviço pedido; não há via contratual para pessoa física. | A ANPD interpretar o art. 33, IX, ou a Vercel publicar cláusulas-padrão brasileiras. |

## 12. Gatilhos para rever este parecer

Ligar cobrança; abrir CNPJ; ligar analytics; abrir a Descoberta para a web aberta; novo fornecedor de IA; guias finais da ANPD sobre ECA Digital, alto risco ou direitos dos titulares; aprovação do PL 2338/2023 (hoje na Câmara, aguardando parecer na comissão especial `[primária]`).
