# ADR-0032 — Lista de compras: múltiplas listas nomeadas, agregação por ingrediente, snapshot escalado

Status: aceito

Feature de retenção nº1 da categoria (issue #474): "adicionar à lista" a partir de 1..N Receitas, com agregação de ingredientes. Fecha um fork de schema irreversível (duas tabelas novas) grelhado com o dono. Degrau para o planejador semanal (futuro). Termos no `CONTEXT.md` (**Lista de compras**). Relaciona: ADR-0012/0009 (medida Direção B — quantidade/unidade fonte única), ADR-0027 (Salvar/Coleção — privado, múltiplas nomeadas), ADR-0001 (Ingrediente canônico), #452 (escalador de porções `quantidade × ratio`).

## Decisões

1. **Múltiplas listas NOMEADAS por Usuário, privadas — espelha a Coleção (`UNIQUE(user_id, name)`), com uma lista-PADRÃO auto-criada no 1º uso.** Uma pessoa tem N listas ("Churrasco", "Semana"); nome único por pessoa. A lista-padrão "Lista de compras" nasce no primeiro "adicionar" (1 toque sem nomear); o usuário cria/renomeia outras. Privada como Salvos/Coleção (nunca pública no v1). **Rejeitado: lista única por usuário** (o dono escolheu múltiplas — mais próximo do uso real e do planejador).

2. **Agregação por Ingrediente canônico quando conhecido, senão pelo NOME normalizado; soma SÓ com unidade idêntica.** A FK `recipe_ingredient.ingredient_id` é **quase sempre nula** (resolução best-effort, CONTEXT.md "Item de receita"), então agregar só por ela mal mesclaria — a **chave de agregação** é `ingredient_id` quando presente, senão `normalize(nome)` (minúsculo, sem acento, trim). As quantidades **SOMAM apenas quando a `unidade` COINCIDE exatamente** (g com g); **NUNCA** converte g↔kg/ml↔l nem chuta por heurística (invariante da medida). Mesmo ingrediente com unidades diferentes ⇒ **linhas separadas**; item sem quantidade (`a gosto`/`q.b.`) ⇒ linha própria sem número. **Rejeitado: conversão de unidade** (heurística de conversão é fonte de erro em receita — nunca).

3. **Cada item é um SNAPSHOT do momento de adicionar (não vínculo vivo), com quantidade já ESCALADA por porções-alvo.** Adicionar uma Receita escala seus ingredientes por **porções-alvo** ("pra 8") → `ratio = alvo ÷ receita.porcoes`, `quantidade escalada = quantidade × ratio` (aritmética pura, o escalador do #452 — **nunca IA**). Receita **sem `porcoes`** ⇒ entra na **base** (sem escala) + aviso. O snapshot guarda a quantidade **escalada** — editar/apagar/regenerar a Receita depois **não mexe** na lista (é artefato de compra, não espelho vivo). **Rejeitado: vínculo vivo ao `recipe_ingredient`** (a lista mudaria sob os pés do usuário; e a Receita pode sumir).

4. **Storage = LINHAS AGREGADAS (uma por chave-de-agregação + unidade DENTRO da lista), não um registro por receita-de-origem.** O check-off e a edição à mão agem na **linha consolidada** que o usuário vê — então a unidade de armazenamento é essa linha, não o lançamento cru. Adicionar = **upsert** por `(lista, chave-de-agregação, unidade)`: soma na linha existente ou cria. Proveniência = `source_recipe_id` **nullable best-effort** (dica "da Feijoada" quando a linha veio de UMA receita; nulo quando mesclada de várias ou avulsa). **Rejeitado: lançamentos crus + agregar-na-leitura** (o check-off/edição teriam de se ancorar na chave agregada, não na linha — mais complexo, e o snapshot já congela o valor).

5. **Edição à mão: item avulso + editar quantidade + remover.** Além de adicionar de Receita, o usuário digita item avulso — **nome obrigatório + quantidade e unidade OPCIONAIS** (mesmo enum de unidade; ad-hoc pode não ter unidade). Item avulso **agrega por nome** com os demais (mesma chave da decisão 2). Editar a quantidade de uma linha e remover linhas são ações diretas.

6. **Check-off PERSISTENTE, sem expiração automática.** Marcar/desmarcar um item persiste (carimbo de "comprado" na linha); ações **"remover marcados"** e **"limpar lista"** são explícitas. **Nada expira sozinho** (nem a lista, nem os marcados). **Rejeitado: auto-limpar marcados após X** (o usuário é dono do ciclo da lista).

7. **Fluxo de adicionar:** de UMA Receita → **seletor de lista** (escolher existente ou "criar nova" inline) + **porções-alvo** (escala, dec.3). **Multi-seleção de N Receitas** de uma vez → adiciona na **base** (sem seletor de porções por receita — evita um seletor por item). Re-adicionar a mesma Receita **mescla** nas linhas existentes (dec.4).

## Invariantes que este trabalho NÃO pode quebrar

- **Medida = fonte única, Direção B** (ADR-0012 Adendo 2): a lista carrega `quantidade` (numeric) + `unidade` (enum) estruturadas + o **nome sem a medida**; nunca re-embute a medida no nome, nunca flexiona nome por código.
- **Nunca converte unidade** por heurística — soma só unidade idêntica (dec.2).
- **Privada** (como Salvar/Coleção, ADR-0027): ninguém vê a lista de ninguém; sem toggle público no v1.
- **Escala é aritmética** (`quantidade × ratio`), jamais geração por IA.
- **Snapshot** (dec.3): a lista não reflete edições posteriores da Receita.

## Consequências

- **Duas tabelas novas** (migração): `shopping_list` (dono `user_id`, `name`, `UNIQUE(user_id, name)`) e `shopping_list_item` (FK `list_id` ON DELETE cascade; a **chave de agregação** = `ingredient_id` nullable + `nome` + `unidade` nullable; `quantidade` nullable; `source_recipe_id` nullable ON DELETE set null; carimbo de check-off nullable; timestamps). O merge idempotente usa uma unicidade por `(list_id, chave-de-agregação, unidade)` (ad-hoc sem unidade tratado com `NULLS NOT DISTINCT`/sentinela — detalhe de implementação).
- **Domínio puro** novo: `normalize(nome)` (a mesma normalização já usada em tags/handle — reusar, não reimplementar) + a regra de merge (chave + soma-se-unidade-igual) — testável sem banco. Escala reusa o helper do #452.
- Rotas privadas (CRUD de lista + adicionar-de-receita + editar/remover/check-off item), gateadas por dono; UI (a lista, o seletor ao adicionar, o item avulso).
- Preserva o caminho para o **planejador semanal** (as porções-alvo e a agregação já existem).

## Alternativas rejeitadas

- **Lista única por usuário** — rejeitada pelo dono em favor de múltiplas nomeadas.
- **Agregar só por `ingredient_id`** — rejeitada: a FK é quase sempre nula, mesclaria quase nada; fallback por nome cobre a maioria.
- **Conversão de unidade** (g↔kg, colher↔ml) — rejeitada: heurística de conversão erra em receita; só soma unidade idêntica.
- **Vínculo vivo à Receita** (não-snapshot) — rejeitada: a lista mudaria sob o usuário e quebraria se a Receita sumisse.
- **Lançamentos crus + agregação na leitura** — rejeitada: check-off e edição agem na linha consolidada; armazenar agregado é o casamento natural.
- **Auto-expiração de marcados/lista** — rejeitada: o usuário controla o ciclo.
