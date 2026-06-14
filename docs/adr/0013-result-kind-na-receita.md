# ADR-0013 — `result_kind` na Receita: distinguir sucesso, degradada e lúdica

Status: aceito

A Receita carrega um campo **`result_kind`** (`success | degraded | playful`), morando **na Receita** — não na CreationSession, senão a regra de publicação some quando o transcript é apagado (ADR-0006).

- **success / degraded** → receita real, **publicável** (degradada é apenas "não atendeu tudo"; qualidade é escolha do usuário — ADR-0009).
- **playful** (receita de zoeira) → **não-publicável**. Invariante de banco: `result_kind=playful` ⇒ `visibility` só pode ser **privada** (CHECK que bloqueia transição para pública).

`result_kind` é **ortogonal** a `origin` (a zoeira ainda é `ai_chat`/`ai_structured`) e a `visibility`. Existe como terceiro eixo porque degradada e lúdica saem do **mesmo schema** com o **mesmo origin** e precisam ser distinguíveis no dado.

## Por quê

Sem um campo nomeado e fixado na Receita, dois implementadores fariam diferente (`is_playful` na sessão vs na receita) e a proibição de publicar não viajaria com a receita. O CHECK garante que a zoeira nunca vaza pro pool da comunidade, mantendo o salvar privado (ADR-0009).
