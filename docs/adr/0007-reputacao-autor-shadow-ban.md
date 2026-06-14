# ADR-0007 — Reputação do autor e shadow-ban: anti-abuso separado da segurança por receita

Status: parado (deferido) — revisitar só se abuso real aparecer

> Revisado após a decisão de manter o app leve (ver ADR-0004): isto **não** é um subsistema a construir agora, apenas uma direção registrada caso o abuso vire um problema real. Com o aviso de restrição leve, o gatilho pesado deixou de existir.

A integridade do conteúdo público tem **duas camadas distintas**, que não devem ser confundidas:

1. **Segurança, por receita** — o Aviso de restrição (ADR-0004) é um disclaimer leve numa receita específica ("declarado, não verificado"); **não** suprime selo nem trava nada.
2. **Reputação, por autor** — um sinal por usuário, derivado do histórico de alertas, que pode levar a **shadow-ban**: as receitas **públicas** de um autor de baixa reputação deixam de ser exibidas no pool da comunidade.

O gatilho do shadow-ban é **insistência deliberada**, não contagem de flags: o sinal forte é o autor **re-afirmar uma declaração após um admin analisar e corrigir**. Engano honesto se corrige; reincidência após correção se pune. O shadow-ban é **silencioso**, **reversível** (admin levanta) e afeta **apenas o conteúdo público** — o uso privado do autor continua intacto.

## Por quê

Misturar segurança (proteger o celíaco numa receita) com anti-abuso (lidar com o autor mal-intencionado) levaria a punir usuários honestos por engano e a tratar reincidência deliberada como mero erro. Separar as camadas mantém cada mecanismo proporcional.

## Escopo

O sistema de reputação **não é construído no MVP**, e **nenhuma tabela de reputação/evento é criada agora**. Como o Aviso de restrição (ADR-0004) é leve e **não persiste estado**, não existe um "histórico de alertas" como fonte — o gatilho pesado proposto aqui ficou sem mecânica. Se um dia o abuso justificar, a única coisa a capturar seria um evento mínimo de "correção de admin"; por ora, parado.

## Consequências

- Se um dia for construído, dependeria de um evento auditável de "correção de admin" — hoje nada disso é persistido.
- O shadow-ban operaria sobre `visibility` pública (ADR-0003), sem alterar `origin` nem apagar conteúdo.
