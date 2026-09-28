# ADR-0039 — Guia de uso ("Como usar") e tour guiado

Status: aceito

O dono (2026-09-28) notou que o app pode ser difícil de aprender para parte dos usuários e pediu duas coisas: um **guia/tutorial de como usar** e um **tour "invasivo"** que escurece a tela, foca um componente por passo e mostra onde clicar, **com um jeito de dispensar**, porque nem todo mundo gosta. Os dois saem juntos. Termos no `CONTEXT.md` (**Guia de uso**, **Tour guiado**). Relaciona: ADR-0020 (locale na URL), ADR-0035/0036/0037 (Cardápio), ADR-0032 (Lista de compras), ADR-0027 (Salvar e coleções).

## Decisões

1. **O guia é uma página pública e indexável, `/guia` ("Como usar").** Texto por seção (encontrar receitas, criar com IA, página da receita, Salvos e coleções, Lista de compras, Cardápio, Comunidade, Conta), com índice por âncora e um botão "Fazer o tour guiado". Todo o texto vem de `messages.guia` (pt-BR e en-US). Links: rodapé (para todos) e menu da conta (logado). Entra no `sitemap.xml` como as outras páginas estáticas. **Rejeitado:** guia só para logados (o Visitante é justamente quem mais precisa entender o que ganha ao criar conta) e FAQ solto (o dono pediu "como usar", que é um passeio pelos recursos).

2. **O tour destaca a chrome, na home, em 7 passos (5 para o Visitante).** Boas-vindas → busca → Criar → Salvos → Cardápio → conta → fim. Os alvos são marcados com `data-tour` no header; o passo escolhe o primeiro alvo visível da sua lista, e no celular (nav dentro do drawer) cai no botão do menu com a linha "No celular, fica no menu ☰". Alvo nenhum visível ⇒ cartão centrado, o passo não some. O Visitante não vê Salvos e Cardápio (os links nem existem para ele). É informativo: o destaque não é clicável (o overlay bloqueia a página), para o tour não se perder no meio de uma navegação. **Rejeitado:** tour que navega entre páginas (cada passo dependeria de dados e do estado da página de destino; frágil e lento) e uma biblioteca de tour (driver.js, react-joyride etc.): o que precisamos é um Radix Dialog com um recorte, e a dependência nova não pagaria o custo.

3. **Dispensável em qualquer passo, e o desfecho fica no dispositivo (localStorage), sem migração.** "Agora não" (primeiro passo), "Pular tour", o X e o Esc fecham e gravam `dismissed`; chegar ao fim grava `done`. A chave é `refogando:tour:v1:<userId>`. Clicar fora não fecha (um clique acidental não perde o tour). Um "pular" depois de já ter concluído não rebaixa `done`. **Por que não no banco:** a outra frente aberta (#560, Despensa) carrega a migração em voo, e só pode haver uma por vez; e o custo do localStorage é pequeno: quem troca de dispositivo numa conta de até 14 dias vê o tour mais uma vez e pode dispensar. Se isso incomodar, uma coluna `users.tour_state` substitui a chave sem mudar o resto (o kernel já recebe o estado como entrada).

4. **Abre sozinho uma única vez, para conta nova, na home.** Regra pura em `shouldAutoStartTour`: logado, na home, conta criada há até 14 dias (`users.createdAt` da sessão), e sem registro neste dispositivo. Storage ilegível (modo privado, bloqueado) ⇒ **não** abre: sem memória, o tour voltaria a cada visita, o que é pior do que não abrir. Conta antiga nunca vê o tour sozinha (quem já usa o app não é interrompido); qualquer pessoa pode fazê-lo pelo guia. O Visitante nunca vê o tour sozinho (a busca é a porta de entrada e não pode ser bloqueada).

5. **Refazer o tour pelo guia usa um pedido no sessionStorage, não query string.** O botão grava o pedido e navega para a home; o `GuidedTour` (montado uma vez no layout, persiste entre navegações) consome o pedido ao chegar lá. A home já usa `?q=` para semear a busca; um parâmetro a mais entraria no histórico e em links compartilhados.

6. **Acessibilidade.** O cartão é um Radix Dialog modal: foco preso, título e texto do passo como nome e descrição acessíveis, o resto da página inerte. O botão principal recebe o foco a cada passo (Enter avança). As transições respeitam `prefers-reduced-motion` (`motion-safe:`).

## Consequências

- Domínio: `@/domain/onboarding-tour` (passos, âncoras, `shouldAutoStartTour`, `placeTourCard`), puro e testado.
- UI: `components/onboarding/guided-tour.tsx` (montado no layout), `tour-signal.ts` (pedido do guia), `usage-guide.tsx` + rota `[locale]/guia`. Header ganha os `data-tour`; o menu da conta e o rodapé ganham "Como usar".
- **Manter o guia em dia é parte de cada feature nova visível ao usuário**: uma seção ou um item em `messages.guia` (pt-BR e en-US, mesma quantidade de itens: o teste de paridade exige). Um recurso novo na nav ganha também um passo no tour se for central. A Despensa (#560) entra assim quando mergear.
- Mudar muito os passos ⇒ subir a versão da chave (`v1` → `v2`) para o tour abrir de novo uma vez para contas novas.
