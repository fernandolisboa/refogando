# ADR-0006 — Sessão de Criação: agregado único com modo, receita durável, transcript persistido e apagável

Status: aceito

O ato de criar com IA é **uma** entidade `CreationSession` com `mode` (`conversation | structured`) — não dois conceitos soltos. A **receita destilada é durável e de primeira classe** (`origin=ai_*`); a sessão **aponta para a receita por referência fraca, nunca o contrário**. Regeneração produz uma **nova versão imutável**, nunca um UPDATE destrutivo.

No **modo conversa**, o **transcript é persistido** (sem TTL no MVP) para o usuário **retomar e continuar** a criação depois ("agora deixa pra 8 porções"). O usuário pode **apagar o transcript** a qualquer momento; apagar a conversa **não apaga a receita** resultante (que é de primeira classe e pode estar salva/publicada). Carimbos de tempo (criação / última atividade) são gravados desde já, para que uma política de **retenção/TTL** possa ser ligada no futuro sem migração.

## Por quê

Retomar uma conversa anterior é o que faz a criação por IA parecer mágica, então o transcript precisa persistir. Sem TTL agora mantém o MVP simples; gravar os timestamps desde o início mantém o TTL como decisão **reversível** — sem eles, "ligar TTL depois" seria impossível. O botão de apagar dá ao usuário controle sobre os próprios dados.

## Consequências

- Acúmulo indefinido de transcript é **PII**: o botão de apagar cobre a erasure iniciada pelo usuário, mas uma **política de retenção (LGPD)** fica como item **deferido explícito**, não esquecido.
- `mode=structured` é função quase pura: guarda um **Briefing de geração** (o que foi pedido) em vez de mensagens — modelagem do brief em definição (próxima decisão).
