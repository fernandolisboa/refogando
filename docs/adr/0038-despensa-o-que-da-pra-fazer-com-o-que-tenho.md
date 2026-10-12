# ADR-0038 — Despensa: "o que dá pra fazer com o que eu tenho"

Status: aceito

O dono pediu (2026-09-28) "a próxima feature grande", pela quinta vez no dia. Não havia issue `ready-for-agent` aberta; os follow-ups que sobraram do Cardápio (gerar uma Receita para um buraco da semana, trocar um item da prévia da Sugestão) são polimento pequeno. O **modo despensa** era o segundo colocado da rodada 2 (handoff 55): a pessoa diz o que tem em casa e o app mostra o que dá pra cozinhar. É uma superfície nova que reaproveita o que o app já tem de forte — Ingrediente canônico e busca por ingrediente (#9), Lista de compras (ADR-0032), Criação por IA (`/create?q=`). Termo no `CONTEXT.md` (**Despensa**). Relaciona: ADR-0032 (Lista de compras), ADR-0027 (gate de Salvar), ADR-0035 (Cardápio), #9/#116 (busca por ingrediente e gate de leitura do viewer).

## Decisões

1. **A Despensa é UMA lista privada por Usuário, de NOMES, sem quantidade.** Tabela `pantry_item` (dono, `nome` como digitado e normalizado para exibição, `match_key`, criação), `UNIQUE(user_id, match_key)`: "Ovo" e "ovo" são o mesmo item (adicionar de novo é idempotente). Teto de 200 itens por Usuário. Privada como a Lista de compras: toda leitura escopa pelo `user_id` da sessão; "não é seu" e "não existe" são o mesmo 404. **Rejeitado: quantidade por item** ("6 ovos"). Ninguém mantém estoque de casa atualizado com número, e o casamento com a Receita precisaria converter unidade (proibido, ADR-0032 dec.2); o que a pessoa responde bem é "tenho ou não tenho". **Rejeitado: várias despensas nomeadas** (a casa é uma).

2. **O casamento é por NOME, com o eixo canônico por cima, nunca por IA.** Um item da Despensa cobre um Item de receita quando: (a) os dois resolvem ao mesmo Ingrediente canônico (o nome do item casa `ingredient_translation.nome`/`aliases` em qualquer locale por igualdade da forma normalizada, como a busca #9 — com a normalização mais larga daqui, que também dobra pontuação — e o Item de receita tem aquele `ingredient_id`); ou (b) o nome do Item de receita — o `raw_text` do locale de origem OU o nome traduzido do locale do viewer (ADR-0030, só quando ainda casa com o `raw_text`) — **contém o termo como palavra(s) inteira(s)**, aceitando o plural regular (`+s`/`+es`). Os termos de um item são o próprio nome **mais os nomes e aliases, em todos os locales, do canônico que ele resolve** — então "ovo" casa "eggs" numa Receita en-US quando o canônico existe. Como a FK `recipe_ingredient.ingredient_id` é quase sempre nula (CONTEXT.md, Item de receita), o eixo canônico rende sobretudo por essa **expansão de termos**, não pela FK. Plural no termo ("ovos", "tomates cereja") também tenta o singular da primeira palavra. Normalização dos dois lados em SQL (`lower` + `immutable_unaccent` + espaço e pontuação viram UM espaço), a mesma para o termo e o texto. "Farinha" cobre "farinha de trigo"; "sal" não cobre "salsinha". **Rejeitado: pedir ao modelo pra decidir o casamento** (custo por consulta, latência, cota; e a regra por palavra é explicável — o app mostra o que falta, a pessoa confere). **Aceito como limite:** plural irregular (limão/limões, pão/pães) só casa via canônico.

3. **"Tenho o básico" é uma opção ligada por padrão.** Quase toda Receita pede sal, água, óleo/azeite e pimenta-do-reino; sem isso na Despensa, nada ficaria "dá pra fazer agora". A lista fixa de básicos (pt-BR e en-US) entra como termos extras quando a opção está ligada, mas **só cobre a linha feita inteira de básicos** ("sal", "sal e pimenta-do-reino", "sal a gosto") — senão "água" cobriria "água de coco" e "óleo" cobriria "óleo de gergelim" — e **não conta como casamento que justifique mostrar a Receita**: uma Receita só aparece se ao menos um item REAL da Despensa (não básico) cobre algum Item dela. A opção vive na URL/estado da página, não no banco.

4. **Resultado = Receitas legíveis, ordenadas pelo que falta.** A consulta roda sobre o **gate de Salvar** (`eligibleToSaveByViewer` em SQL: leitura do viewer #116 + barreiras do pool — sem `playful`, sem removida por moderação, sem importada da web; o mesmo da Sugestão de cardápio), porque a ponte da dec.5a usa esse gate e uma Receita mostrada tem de poder ir para a lista. Por Receita: total de Itens com nome (`raw_text` não vazio; sem nome não há o que mostrar como faltando), quantos a Despensa cobre, e quais faltam. Entra quem tem **no máximo 3 faltando** e ao menos um item real coberto. Ordem: menos faltando → mais itens da Despensa usados → mais recente. Teto de 30 Receitas. A tela separa em **"Dá pra fazer agora"** (nada faltando) e **"Falta pouco"** (1–3), com os nomes do que falta no locale do viewer. **Rejeitado: mostrar tudo que usa algum item** (vira a Busca por ingrediente, que já existe; o valor aqui é "falta pouco").

5. **Duas pontes para fora, nada automático.** (a) **"Pôr o que falta na lista"**: o servidor RECALCULA quais Itens da Receita faltam (nunca confia numa lista vinda do cliente) e os adiciona na quantidade BASE à Lista de compras padrão do Usuário (ou a uma dele, se indicada), pelo MESMO núcleo de merge/agregação/snapshot do ADR-0032 e o mesmo gate de Salvar. (b) **"Criar receita com o que tenho"**: link para `/create?q=` com os nomes da Despensa (o mesmo atalho da Busca; nunca gera sozinho — cada geração custa e consome a cota). **Uma terceira ponte, "Pôr no cardápio" em cada Receita do resultado, foi feita no ADR-0040 (2026-10-01).**

6. **A Lista de compras alimenta a Despensa.** Na Lista, **"Guardar marcados na despensa"** copia os nomes dos itens marcados como comprados para a Despensa (idempotente; respeita o teto). Não apaga nada da Lista — "remover marcados" segue sendo a ação explícita (ADR-0032 dec.6).

7. **Dados do titular.** A Despensa entra no export LGPD, é apagada na eliminação da conta (privada, ninguém mais depende dela — como o Cardápio) e entra nas guardas do expurgo de cadastro pendente (FK nova para `users` com cascade).

## Consequências

- **Migração 0072** (`0072_pantry`): tabela `pantry_item` com FK cascade para `users`, `UNIQUE(user_id, match_key)` (serve também a leitura por dono) e CHECK de tamanho do nome (1–60).
- Domínio puro `@/domain/pantry`: `parsePantryName`, `pantryMatchKey`, `splitPantryInput`, `PANTRY_BASICS`, tetos, e a separação em seções.
- Servidor `@/server/pantry/pantry`: CRUD, `loadPantryMatches` (SQL cru parametrizado, como a Busca), `applyPantryMissingToShoppingList`, `applyCheckedItemsToPantry`. A Lista de compras ganha um núcleo para adicionar SÓ algumas linhas de uma Receita (mesmo upsert).
- Rotas privadas em `/api/me/pantry/*` e `POST /api/me/shopping-lists/[listId]/items/checked/to-pantry`.
- UI: página `/me/pantry` ("Despensa" na navegação logada), com o campo de adicionar (vários de uma vez, separados por vírgula), atalhos de itens comuns, a opção "Tenho o básico", as duas seções e as pontes; botão "Guardar marcados na despensa" na Lista.
- **Custo de consulta:** o casamento varre os Itens das Receitas legíveis (Seq Scan, como o ramo `raw_text` da Busca), mas casa por JOIN de igualdade na primeira palavra do termo contra as palavras da linha (só os básicos usam regex, ancorada na linha inteira), e roda com `statement_timeout` de 5 s. ~0,6 s num acervo sintético de 4.000 Receitas × 10 Itens com 200 itens na Despensa. Se o acervo crescer, materializar o texto normalizado dos Itens numa coluna gerada com índice.
- **Jurídico (dono, #276):** a política de privacidade não cita a Despensa no export — mesmo bloco pendente do Cardápio e da Lista.

## Alternativas rejeitadas

- **Quantidade e validade por item** — dec.1.
- **Casamento pela IA** — dec.2.
- **Básicos obrigatórios na Despensa** (a pessoa teria de digitar sal e água) — dec.3.
- **Mostrar toda Receita com algum item em comum** — dec.4.
- **Gerar a Receita automaticamente a partir da Despensa** — dec.5.
- **Mover (apagar da Lista) ao guardar na Despensa** — dec.6.
