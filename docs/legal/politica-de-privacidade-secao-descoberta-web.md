# Política de Privacidade — rascunho substituído pelo texto publicado

> **Atualizado em 2026-09-24.** A versão de 2026-07-01 deste arquivo era o rascunho de uma Política que ainda não existia. Desde então a Política foi implementada (PR #405) e **publicada** (PR #418), incluindo a seção sobre a "Descoberta na web". Para não manter dois textos divergentes, o rascunho foi retirado daqui; ele continua no histórico do git (commit `58453fd`).
>
> **Status (2026-10-22): revisada.** O texto publicado foi revisado no sign-off interno de 2026-10-22 (`docs/legal/parecer-interno-2026-10-22.md`, §4), feito pelo Claude por delegação do controlador, sem revisão de advogado(a), e saiu como **v3**.

## Onde está o texto

- **Página no ar:** `/privacidade` (com versão em inglês), linkada no rodapé e indexável.
- **Texto-fonte (único lugar a editar):** `src/i18n/messages/pt-BR.ts` e `src/i18n/messages/en-US.ts`, chave `privacidade`. O componente é `src/components/legal/privacy-policy.tsx`.
- **Seções relevantes para a Descoberta na web:** item 3.4 (atribuição de receitas importadas) e **Parte (b)** inteira (b.1 a b.5: o que é, quem é o titular, dados, finalidade, base legal, retenção e como pedir remoção).

## O que o texto publicado (v3) afirma

- **Controlador:** Fernando Lisboa, pessoa física. Sem razão social nem CNPJ.
- **Encarregado:** não indicado (agente de pequeno porte, Res. CD/ANPD nº 2/2022, art. 11); o canal `privacidade@refogando.com`, atendido pelo controlador, cumpre essa função.
- **Prazo de resposta:** 15 dias corridos (Art. 19, II).
- **Base legal da atribuição:** legítimo interesse (Art. 7º, IX), com o teste de balanceamento documentado; a publicação do nome pelo próprio autor pesa a favor no balanceamento (não é mais citada como base alternativa).
- **Retenção da atribuição:** enquanto a receita importada existir, até o autor pedir a remoção do nome, ou até o usuário apagar a receita.
- **Remoção:** padrão só o nome; também a URL quando ela identifica a pessoa ou quando ela se opõe ao tratamento como um todo; as cópias, quando quem pede é o dono do site (que sai da allowlist).
- A ressalva antiga ("o inventário… ainda será fechado") saiu: o inventário está no item 3 (3.1 a 3.9) e em `docs/legal/registro-de-operacoes.md`.

## Como mudar

PR que muda dado pessoal coletado, finalidade, fornecedor, prazo de retenção ou conteúdo de log atualiza no mesmo PR as strings da chave `privacidade` (com nova versão no histórico da seção 9), o `docs/legal/registro-de-operacoes.md` e, se mudar uma decisão, o parecer (regra em `CLAUDE.md`, seção "Privacidade").

*Documento interno do Refogando — não é aconselhamento jurídico.*
