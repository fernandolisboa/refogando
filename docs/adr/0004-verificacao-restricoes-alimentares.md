# ADR-0004 — Restrições alimentares: aviso leve, não verificação pesada

Status: aceito (revisa uma versão pesada anterior)

Refogando é um app de receitas, **não** um sistema de conformidade alimentar. Restrições declaradas (pelo usuário ou pela IA) recebem um **aviso leve e honesto**, não uma máquina de verificação:

- Uma restrição numa receita aparece como **"declarado, não verificado — confira se você tem restrição séria"**. Simples e honesto.
- Se o nosso dado **acidentalmente** flagra uma contradição óbvia (ex.: farinha de trigo numa receita marcada "sem glúten"), mostramos um **aviso amigável** — sem suprimir a receita, sem bloquear publicação, sem gating.
- **Sem** "não-resolvido derruba verificação", **sem** suprimir selo, **sem** travar nada, **sem** admin-gating obrigatório. A responsabilidade final é do usuário (sobretudo com restrição séria), e o app deixa isso claro com um aviso, não com burocracia.

## Por quê

A versão anterior transformava um app de receitas numa luta jurídica por segurança alimentar — desproporcional ao produto. Um disclaimer honesto, mais um aviso quando há contradição óbvia, cobre o risco real sem sufocar a experiência. Verificação dura, curadoria obrigatória de alérgenos e gating ficam **fora de escopo** até (e se) o produto pedir.

## Consequências

- O dado de alérgeno no ingrediente canônico é **opcional/oportunista** — alimenta um aviso quando existe, não é pré-requisito.
- Não há "selo verificado" a defender; logo, nada de admin-gating nem de cobertura-de-resolução como pré-condição.
- O mecanismo de reputação/shadow-ban (ADR-0007) perde seu gatilho pesado e fica **parado**.
