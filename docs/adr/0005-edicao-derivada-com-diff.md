# ADR-0005 — Edição de receita: derivada ligada à base, com diff

Status: aceito

Editar uma receita que **não pertence** ao usuário (catálogo ou de outra pessoa) **nunca muta a base** — cria uma **receita derivada** do usuário (`origin=user_edited`) com **ponteiro para a base** e um **diff** do que mudou (ingrediente removido/adicionado, quantidade alterada). Editar a **própria** receita privada é update normal, sem fork. O diff é exibido ao usuário e a quem vê a derivada.

A derivada guarda o **estado completo no momento do fork** mais o diff calculado contra a base, de modo que edições futuras da base não alterem a derivada silenciosamente.

## Por quê

Catálogo e receitas públicas são compartilhados; mutar quebraria para todos os outros. A derivada preserva a base intacta, dá ao usuário liberdade de adaptar, e o diff torna a adaptação transparente e auditável. Snapshot + diff (em vez de só overrides sobre a base viva) evita que a derivada mude sob os pés do usuário quando a base é editada.

## Consequências

- O Aviso de restrição (ADR-0004) também se aplica à derivada: editar e introduzir, por ex., trigo numa receita marcada "sem glúten" dispara o mesmo aviso amigável de contradição óbvia — sem bloquear o fork.
- Uma derivada é uma Receita como outra qualquer — pode ser tornada pública (ADR-0003) e segue as regras de i18n (ADR-0001).
