# Delta — "refogando-3-colunas-telas-maiores" (telas largas)

Importado do projeto Claude Design "Design do Feed Editorial" (`00bb42be-e223-4edb-b106-e59799b80ca9`)
via DesignSync. Evolui `refogando-final.dc.html` (PR#340, no ar) preenchendo o espaço lateral em telas
largas com uma **3ª coluna** de cozinheiros. Abaixo de ~1280px volta ao layout aprovado (2 colunas).

## Medidas EXATAS (transcritas do .dc.html — fonte de verdade da paridade)

| token            | 1080p (viewport 1920) | 1440p (viewport 2560) |
|------------------|-----------------------|-----------------------|
| trilha filtros   | 200px (12.5rem)       | 240px (15rem)         |
| coluna leitura   | 700px (43.75rem)      | 780px (48.75rem)      |
| trilho cozinheiros | 300px (18.75rem)    | 340px (21.25rem)      |
| gap entre colunas | 48px (3rem)          | 72px (4.5rem)         |
| padding do bloco | 38px 56px             | 52px 80px             |
| busca (pill) no header | flex:1; max-width 560px (35rem); margin:0 auto | max-width 620px |

- **Header (1 linha):** `wordmark · nav(Explorar/Seguindo/Minhas) · busca-pill-centrada · Criar · avatar`.
- **CreatorCard:** padding 16px, radius 14px. Topo: avatar 42px + (nome 14px semibold + `@handle · N receitas`
  numa linha 12px muted) + "Seguir" (contornado-páprica). Lista: cada receita = thumb 40px (radius 7px, selo
  ✦ branco 13px no canto quando IA) + título serif 14px (até 2 linhas).
- **Comportamento responsivo (nota do protótipo):** o trilho entra a partir de ~1080p (≥1280px). Abaixo
  disso recua pra baixo do feed ou some; a leitura re-centraliza com a trilha (= versão 880px aprovada). No
  mobile vira a seção "Cozinheiros em alta" no FIM do feed.

## Como o app real materializa (paridade, comportamento preservado)
- 3ª coluna = `CooksToFollowRail` (#278) repositionada (era faixa horizontal acima; agora coluna à direita
  em xl, fim do feed abaixo de xl). Cartões enriquecidos com 1–3 receitas (ADR-0024 emendado).
- Largura `--container-wide` (96rem) só quando o trilho VAI renderizar (`railVisible`) — anon/SSR/<MIN
  cozinheiros mantêm o layout 2-col aprovado (Modelo B; home indexável byte-idêntica).
- Busca inline no header em xl (DOM-last, ordem de foco aprovada preservada abaixo de xl).
