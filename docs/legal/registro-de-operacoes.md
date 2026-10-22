# Registro das operações de tratamento (LGPD art. 37) — versão simplificada de agente de pequeno porte

> Formato simplificado permitido pela Res. CD/ANPD nº 2/2022, art. 9º. Controlador: Fernando Lisboa (pessoa física). Canal do titular: `privacidade@refogando.com` (sem encarregado indicado, Res. 2/2022, art. 11). Atualizado em 2026-10-22, junto com o parecer interno (`docs/legal/parecer-interno-2026-10-22.md`) e o ADR-0049. **Atualize este arquivo no mesmo PR que mudar dado, finalidade, fornecedor ou prazo.**

## Operadores e onde os dados ficam

| Operador | Para quê | País | Mecanismo de transferência |
|---|---|---|---|
| Vercel Inc. | Hospedagem, funções (`iad1`), crons, armazenamento de imagens (Blob público com URL não listada), registros técnicos | EUA | LGPD art. 33, IX c/c art. 7º, V |
| Neon / Databricks | Banco de dados Postgres (`sa-east-1`) | Brasil (suporte pode acessar dos EUA) | art. 33, IX, se houver acesso remoto |
| Anthropic PBC | Geração e conversa de receitas, extração de ingredientes, Sugestão de cardápio, tradução, escolha do cenário da foto | EUA | art. 33, IX; para restrições salvas, art. 33, VIII |
| Google LLC (Gemini API) | Geração e edição de imagens, embeddings de busca | EUA | Cláusulas-padrão da ANPD no DPA do Google (plano pago), art. 33, II, "b" |
| Google LLC (login) | "Continuar com o Google" (opcional) e avatar servido por `googleusercontent.com` | EUA | art. 33, IX |
| Resend Inc. | E-mail transacional (confirmação, senha, alertas ao controlador) | EUA | art. 33, IX |
| Brave Software | Busca dos links da Descoberta na web (só o termo, enviado pelo servidor) | EUA | Termo de busca não é dado pessoal segundo o fornecedor; se for, art. 33, IX |
| Proton AG | Caixa de e-mail que recebe `privacidade@refogando.com` | Suíça | art. 33, IX c/c art. 7º, II (atender pedidos de titular) |

## Operações

| # | Operação | Titulares | Dados | Finalidade | Base legal | Retenção | Segurança |
|---|---|---|---|---|---|---|---|
| 1 | Conta e autenticação | Usuários | e-mail, nome, handle, senha (hash), foto, bio, links, idioma, nível padrão; tokens do Google se usar o login do Google | Criar e manter a conta | Contrato (art. 7º, V) | Enquanto a conta existir; na eliminação, anonimização imediata | Senha com hash pelo better-auth; sessão em cookie HttpOnly |
| 2 | Sessões e proteção contra abuso | Usuários e visitantes | IP e navegador da sessão; IP no rate limit | Segurança da conta, prevenção de abuso | Legítimo interesse (art. 7º, IX), LIA A | Sessão: até vencer (apagada todo dia). Rate limit: até 2 h (limpeza de hora em hora) | Acesso só pelo banco |
| 3 | Conteúdo do usuário | Usuários | Receitas, traduções, imagens enviadas, avaliações e fotos, salvos, coleções, listas de compras, Cardápio (com anotações), Despensa e básicos | Entregar o app | Contrato (art. 7º, V) | Até o usuário apagar ou eliminar a conta (ADR-0049: privado apagado na hora; público anonimizado; foto de avaliação 180 dias depois) | Toda leitura escopada por dono (404 a terceiros) |
| 4 | Criação com IA | Usuários | Pedidos (texto livre, briefing, restrições do pedido), conversa, prompts de imagem, foto-base no modo de edição | Gerar receitas e imagens | Contrato (art. 7º, V) | Enquanto a conta existir; apagado na eliminação; o usuário apaga a conversa por sessão | Prompts sem nome, e-mail ou ids; fornecedores não treinam com API |
| 5 | Registros de uso de IA | Usuários | data, modelo, tokens, custo (sem conteúdo) | Cotas, custo, abuso | Legítimo interesse (art. 7º, IX), LIA A | 24 meses; extração 30 dias | — |
| 6 | Restrições alimentares salvas | Usuários | Lista fixa (vegana, sem glúten…) — dado sensível | Pré-marcar os pedidos | Consentimento específico e destacado (art. 11, I); transferência pelo art. 33, VIII | Até desmarcar ou eliminar a conta | Não aparece no perfil público |
| 7 | Descoberta na web | Autores de receitas externas | Nome do autor/site e URL de origem | Crédito obrigatório à fonte | Legítimo interesse (art. 7º, IX), LIA em `lia-descoberta-web.md` | Enquanto a importação existir ou até pedido de remoção | Remoção pelo dono e pelo operador; auditoria com hash |
| 8 | Atendimento a titulares (takedown/DSAR) | Qualquer pessoa | Tipo de pedido, URL/nome informado, mensagem, e-mail opcional, idioma | Responder a pedidos (art. 18) | Obrigação legal (art. 7º, II) | Ticket encerrado: 12 meses após o encerramento | Formulário sem documento; e-mail de contato não aparece no painel |
| 9 | Auditoria DSAR | Titulares que pediram | Tipo de evento, canal, datas, hash do que foi removido, motivo de recusa | Provar o atendimento | Obrigação legal (art. 7º, II) e exercício regular de direitos (art. 7º, VI) | 5 anos | Só inserção; nunca o dado removido em claro |
| 10 | Registros técnicos de erro | Usuários e visitantes | Forma da rota, tipo de erro, código; do navegador, mensagem mascarada | Manter o app funcionando e seguro | Legítimo interesse (art. 7º, IX), LIA A | Prazo do plano da Vercel (1 dia; 30 com Observability Plus) | Sem IP, sem query, sem cookie; e-mail, handle, ids e números longos mascarados |
| 11 | Denúncias e moderação | Usuários | Denúncia (motivo), decisão do curador | Moderar conteúdo público | Legítimo interesse (art. 7º, IX), LIA A | Enquanto o conteúdo existir; fica anonimizada se a conta for eliminada | Só curador e admin |
| 12 | Busca | Visitantes e usuários | Termo de busca (vira embedding no Gemini) | Encontrar receitas | Legítimo interesse (art. 7º, IX) para visitante; contrato para usuário | Não é guardado | — |
| 13 | Cadastro pendente | Pessoas que não confirmaram o e-mail | e-mail, nome, senha (hash) | Confirmar o cadastro | Procedimentos preliminares ao contrato (art. 7º, V) | 48 h; depois só um hash do e-mail por 90 dias, contra reenvio abusivo | HMAC com segredo do servidor |
| 14 | Cookies e armazenamento local | Usuários e visitantes | Cookie de sessão, `locale`, `theme`; chaves de interface no localStorage/sessionStorage | Funcionamento do app | Estritamente necessários (contrato e legítimo interesse; Guia ANPD de cookies) | Sessão: até vencer; preferências: 1 ano | Sem cookie de terceiros, sem rastreamento |

## LIA A — Segurança, abuso, custo e moderação (operações 2, 5, 10 e 11)

Formato breve, admitido pelo Guia de Legítimo Interesse da ANPD (2024, p. 30) para tratamento de baixo impacto.

1. **Finalidade.** Interesse concreto e legítimo do controlador e dos próprios usuários: manter as contas seguras, evitar uso abusivo de recursos pagos (IA, busca), diagnosticar erros e moderar conteúdo público. Nada disso é marketing ou perfilamento.
2. **Necessidade.** Dados mínimos: IP e navegador só enquanto a sessão vale; no rate limit, até 2 horas; registros de uso sem conteúdo; logs sem IP e com mascaramento; denúncia com o motivo e o alvo. Não há alternativa menos invasiva que cumpra a mesma finalidade.
3. **Balanceamento.** Expectativa alta (é o que qualquer serviço on-line faz), impacto baixo (nenhuma decisão sobre o titular, nada público), prazos curtos e definidos, oposição possível pelo canal. Nenhum dado sensível nem de criança. **Resultado: o legítimo interesse prevalece.**
