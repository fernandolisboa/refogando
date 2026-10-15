# ADR-0043 — Seções da navegação: 3 entradas no header, subabas dentro de cada uma

Status: aceito

O header crescia um link por feature: Explorar, Seguindo, Minhas criações, Salvos, Cardápio e Despensa, mais "Criar", o sino e a conta. Com 6 links ele já quebrava em duas linhas entre ~640 e ~1000 px (o container usa `flex-wrap`), e duas páginas ficavam sem entrada: a Descoberta de Cozinheiros (`/cooks`, só alcançável pelo estado vazio do Seguindo e pelo trilho da home) e as Listas de compras (escondidas no menu da conta, longe do Cardápio e da Despensa, que são o mesmo fluxo). O dono pediu para agrupar por função (2026-10-15) e aprovou esta proposta. Relaciona: ADR-0020 (a Descoberta é a home), ADR-0024 (Seguindo e Cozinheiros), ADR-0035/0038/0040 (Cardápio, Despensa e as pontes), ADR-0039 (tour guiado e guia).

## Decisões

1. **O header mostra 3 seções; as páginas viram subabas.** **Explorar** (Descobrir `/`, Seguindo `/following`, Cozinheiros `/cooks`), **Minhas receitas** (Criações `/me/recipes`, Salvos `/me/saved`) e **Planejar** (Cardápio `/me/meal-plan`, Listas de compras `/me/shopping-lists`, Despensa `/me/pantry`). O Visitante vê só Explorar, sem a aba Seguindo. **Nenhuma URL muda**: as seções só agrupam rotas que já existiam (sem redirect, sem efeito em SEO). A estrutura mora num kernel puro (`domain/nav-sections.ts`); header, tira e drawer só traduzem ids em rótulos.

2. **Subabas numa tira abaixo do header, não um dropdown.** O Cardápio, a página mais usada, segue a um clique (dec.3); um menu no hover custaria um clique a mais, funciona mal no toque e esconde as opções. A tira (`SectionTabs`) mora no layout, fora do header sticky (não rouba altura ao rolar), e segue a largura do HEADER, não a da página: as páginas têm larguras diferentes (`reading` e `page`) e uma tira dentro de cada uma pularia de lugar ao trocar de aba. Na home, alarga junto com o header quando as 3 colunas abrem. Fora das seções (receita, perfil, `/create`, `/admin`, `/guia`, `/me/profile`) não há tira.

3. **O link das seções pessoais volta à última aba visitada.** Minhas receitas e Planejar lembram a aba (por dispositivo, `localStorage`, chave `refogando:nav:ultima-aba:v1`); Explorar é a home e leva sempre a `/`. O valor lido só vira href se for uma aba da própria seção (`parseLastTabs`/`sectionEntryHref`); qualquer outra coisa cai na 1ª aba. O snapshot de servidor é vazio, então o HTML e a hidratação usam o destino padrão e o cliente troca logo depois, sem erro de hidratação.

4. **Estado ativo por seção.** A seção fica ativa em qualquer aba dela (e nas subrotas: o detalhe de uma lista é a aba Listas). `aria-current="page"` só quando a rota é o próprio destino do link; nas demais, `aria-current="true"` (item atual do conjunto).

5. **Sem pular de altura.** Numa seção pessoal a tira aparece já durante o carregamento da sessão (quem abre `/me/*` quase sempre está logado), para não empurrar a página quando a sessão resolve; anônimo ou erro de sessão, sem tira (a página mostra o próprio estado de Visitante). Em Explorar a aba Seguindo espera a sessão, para o Visitante nunca a ver piscar.

6. **Drawer mobile agrupado.** O mesmo conjunto de abas, sob o título de cada seção (`role="group"` rotulado, como a `SectionNav` do Console, #268), seguido de "Criar" e da conta.

7. **Menu da conta só com o que é da conta**: ver perfil público, editar perfil, Como usar, Painel (curador+) e Sair. As Listas de compras saíram dali.

8. **Tour e guia acompanham.** O tour guiado (ADR-0039) troca os passos Salvos, Cardápio e Despensa por um passo por seção (Minhas receitas, Planejar), com âncoras `nav-minhas-receitas` e `nav-planejar`; são 7 passos para quem está logado. A chave do tour não sobe de versão: os passos mudaram de lugar, não de assunto, e reabrir o tour para todas as contas novas por isso seria ruído. O guia "Como usar" diz onde cada coisa fica ("em Planejar, na aba Cardápio"), nos dois idiomas.

## Consequências

- Novos: `src/domain/nav-sections.ts`, `src/components/nav/section-tabs.tsx`, `src/components/nav/last-tab-store.ts`, `src/components/nav/nav-labels.ts`. Chaves `nav.minhasReceitas`, `nav.planejar`, `nav.descobrir`, `nav.cozinheiros`, `nav.criacoes`; as demais abas reusam rótulos existentes (`nav.seguindo`, `colecoes.titulo`, `nav.cardapio`, `listaDeCompras.indiceTitulo`, `nav.despensa`).
- A aba de Criações se chama "Criações", mas o `<h1>` da página segue "Minhas criações".
- Feature nova numa seção existente vira uma aba em `NAV_SECTIONS`, não um link no header. Uma 4ª seção só se a feature não couber em nenhuma das 3.

## Alternativas rejeitadas

- **Dropdown por seção no header** — dec.2.
- **Manter os links soltos com divisórias entre grupos** — muda pouco, mas com Listas e Cozinheiros seriam 8 links e o header ficaria mais largo, não menos.
- **Tira de abas dentro de cada página** — pularia de lugar entre páginas `reading` e `page` (dec.2).
- **Barra de abas fixa no rodapé do celular** — mudança maior de layout; o drawer agrupado resolve o mesmo problema sem mexer no restante da tela.
