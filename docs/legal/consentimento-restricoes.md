# Textos de consentimento das restrições salvas

Registro dos textos que a pessoa vê junto do botão de salvar as restrições (`restricoesPerfil.consentimento`, ADR-0041)
em cada versão. A conta guarda a data e a versão do último consentimento (`users.restricoes_consentidas_em` e
`users.restricoes_consentimento_versao`, #600), e é por aqui que se sabe o que ela leu (LGPD art. 8º, §2º).

Mudou o texto? Acrescente uma seção nova com a data como versão, troque `RESTRICOES_CONSENTIMENTO_VERSAO`
(`src/domain/restricoes-perfil.ts`) e o hash em `test/unit/restricoes-consentimento-versao.test.ts`. Nunca edite
uma seção que já existe: o teste confere cada uma contra o hash dela.

## 2026-10-22

- pt-BR: Ao salvar, você autoriza o Refogando a guardar estas restrições só para pré-marcar os seus pedidos e a enviá-las à IA (Anthropic) quando você gerar com elas marcadas. O app e a IA funcionam nos Estados Unidos. Desmarque tudo e salve para apagar.
- en-US: By saving, you allow Refogando to keep these restrictions only to pre-select your requests and to send them to the AI (Anthropic) when you generate with them selected. The app and the AI run in the United States. Clear them all and save to delete.
