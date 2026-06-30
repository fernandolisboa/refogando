# ADR-0003 — Publicação dirigida pelo usuário e pool da comunidade

Status: aceito

> **Emendado por ADR-0027 (2026-06-30):** o **Voto** binário foi **aposentado** — a Popularidade que ordena o pool virou uma **mistura ponderada** (saves + nota Bayesiana + frescor) e entrou a **Avaliação** (nota genuína de 1–5★). Os invariantes deste ADR seguem intactos: publicação dirigida pelo usuário, seções catálogo×comunidade separadas, e popularidade **sem autoridade sobre segurança**.

Uma receita é **privada por padrão**. O **próprio usuário** a torna **pública** (autoriza a publicação) — sem curadoria obrigatória. Receita pública entra no **pool da comunidade**, é ordenada por **popularidade/votos** e exibida a outros com **atribuição** a quem publicou. O **catálogo curado** (`origin=catalog`) permanece editorial e **separado**: uma receita de usuário nunca vira `origin=catalog` — ela ganha visibilidade pública, não muda de origem.

A busca tem **entrada única** mas resultados **seccionados por origem**: catálogo curado e comunidade em seções distintas, selo de origem sempre visível — **nunca** um ranking cego misturando conteúdo curado confiável com conteúdo de IA não-verificado.

## Por quê

Publicação por curadoria não escala e o produto quer descoberta social. Mas misturar catálogo curado com receitas de IA publicadas por estranhos num ranking único vaza confiança — uma receita de IA popular pareceria tão confiável quanto uma curada. Seccionar preserva a descoberta e mantém a confiança **estrutural**, não só um selo.

## Consequências

- **Votos = sinal de popularidade**, não autoridade sobre segurança (ver ADR-0004).
- Conteúdo público de IA exige o selo de origem sempre visível; o Aviso de restrição (ADR-0004) o acompanha como disclaimer, **não** como gate de publicação.
- `visibility` (privada | pública) é eixo persistido, ortogonal a `origin`.
