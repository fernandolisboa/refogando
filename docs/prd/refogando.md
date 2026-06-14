# PRD — Refogando

## Problema

Quem cozinha quer só duas coisas: **achar** uma receita boa ou **criar** uma nova. Hoje as ferramentas falham nas duas pontas.

A busca é burra. Procura por palavra exata e não entende intenção. Se você digita "algo rápido sem forno com frango", ela trava. Se a receita está noutra língua, some do resultado — mesmo sendo o prato certo. Quem fala português perde receitas em inglês, e o contrário também.

A IA é o oposto: cria fácil, mas você vira **refém** dela. Ela inventa, promete o que não cumpre, e some quando você fecha a aba. Não dá pra confiar: ela diz "vegano" sem você saber se é afirmação dela ou fato. E o que ela gera não fica seu — não dá pra salvar, voltar, comparar versões nem editar com calma.

Falta um meio-termo honesto. Buscas existentes não criam nada; ferramentas de IA não respeitam o que já existe nem deixam claro **de onde veio cada receita** — se é de um catálogo cuidado, de outra pessoa, ou de uma máquina. Sem essa clareza, quem cozinha não sabe em quem confiar.

E nada disso fala duas línguas de verdade. Ou é só português, ou só inglês — nunca o **mesmo prato** servido na língua de quem lê.

## Solução

Refogando junta as duas pontas num **núcleo único de receita**, bilíngue pt-BR/en-US desde o dia 0. A mesma receita existe nas duas línguas; muda só a língua de apresentação, nunca o prato. Você procura em português e acha receita escrita em inglês — e vice-versa.

São **três modos** sobre esse mesmo núcleo:

- **Buscar** — encontra receitas que já existem por nome, ingrediente ou pela sua intenção difusa. A busca é híbrida: junta a camada precisa (texto, ingrediente, facetas) com a semântica, num só ranking. Entende "algo leve sem forno". Os resultados vêm **seccionados**: catálogo curado de um lado, comunidade do outro — nunca tudo misturado.
- **Criar conversando** — você fala com a IA em vários turnos no Modo conversa (multi-turno). A conversa fica salva e dá pra retomar. No fim, a IA destila uma Receita de verdade, sua, durável.
- **Criar estruturada** — você monta um Briefing de geração por campos (ingredientes, restrições, porções, dificuldade, cozinha) e a IA gera a partir do que você pediu. Quem decide é você.

**Receita é o centro.** Toda receita carrega um selo de proveniência sempre visível: de onde veio (catálogo, conversa com IA, geração estruturada ou editada por alguém). Você sempre sabe em quem confiar.

A segurança é **toque leve**. Quando você diz "sem glúten" e a IA usa farinha de trigo, aparece um aviso amigável — "declarado, não verificado". Ele não trava, não esconde, não bloqueia. A decisão final é sua.

E nada some. Logado, o que a IA gera já vira Receita sua, **privada por padrão**. Você publica quando quiser — aí entra no pool da comunidade. Pode editar, e editar receita de outro cria uma cópia sua, sem mexer na original.

## Histórias de Usuário

### Busca

1. Como Visitante, quero buscar uma receita digitando parte do nome ("chili"), para encontrar pratos sem precisar saber o título exato.
2. Como Usuário, quero que o nome ORIGINAL da receita apareça sempre nos resultados, com a tradução localizada confiável entre parênteses ("Texas Chili (chili do Texas)"), para reconhecer o prato na minha língua sem perder o nome real.
3. Como Usuário no locale pt-BR, quero buscar "tomate" e achar receitas mesmo escritas com acento ou variação ("tomáte"), para que acentuação não atrapalhe meus resultados.
4. Como Usuário, quero buscar por nome usando a busca de texto completo do MEU idioma (portuguese ou english), para que plurais e variações da palavra ("biscoitos" acha "biscoito") sejam tratados corretamente.
5. Como Usuário, quero que, quando minha busca por nome não casar com nada exato, a camada semântica ainda traga receitas parecidas, para eu não terminar com tela vazia quando há algo relevante.
6. Como Usuário, quero buscar receitas que levam um ingrediente ("frango"), para aproveitar o que tenho em casa.
7. Como Usuário, quero combinar vários ingredientes numa só busca ("frango, limão, alho"), para achar receitas que usem o que eu tenho junto.
8. Como Usuário, quero que a busca por ingrediente use o Ingrediente canônico (id estável), para achar o mesmo insumo mesmo escrito de jeitos diferentes ("cebola roxa", "cebola-roxa").
9. Como Usuário no locale pt-BR, quero buscar por um ingrediente em português e achar receitas cujo Item de receita foi escrito em inglês, para que a busca por ingrediente funcione cross-locale via canônico language-neutral.
10. Como Usuário, quero que, quando o ingrediente que digitei NÃO resolve pro Ingrediente canônico, a busca degrade para a busca de texto completo sobre o raw_text do Item de receita, para eu ainda achar receitas mesmo sem o vínculo canônico.
11. Como Usuário, quero que a quantidade e a unidade do Item de receita NUNCA atrapalhem a busca por ingrediente, para que "2 dentes de alho" seja achado por "alho" sem ruído de número ou unidade.
12. Como Usuário, quero descrever o que quero em linguagem solta ("algo asiático e leve"), para que o Perfil culinário traduza minha intenção em Cozinha + Categoria + Tag e me devolva receitas adequadas.
13. Como Usuário, quero que "leve" vire a Tag certa e "asiático" aponte pra um conjunto de Cozinhas (japonesa, tailandesa, etc.), para que minha intenção difusa caia no vocabulário controlado sem eu precisar conhecer os nomes exatos.
14. Como Usuário, quero que a intenção difusa acione a camada semântica (embeddings) junto da camada precisa, para achar receitas que "combinam com a vibe" mesmo sem casar palavra por palavra.
15. Como Usuário, quero que o Perfil culinário seja só uma lente de UX da busca, sem virar filtro travado, para eu poder ajustar livremente depois de ver os resultados.
16. Como Usuário, quero que a Busca híbrida combine a camada precisa (texto completo por idioma + ingrediente canônico + facetas) com a camada semântica (embeddings) num ÚNICO ranking, para receber os resultados mais relevantes sem escolher "modo exato" ou "modo parecido".
17. Como Usuário, quero que a busca NUNCA seja puramente vetorial, para que um casamento exato de nome ou ingrediente não fique soterrado abaixo de resultados só "parecidos".
18. Como Usuário, quero filtrar por facetas (Cozinha, Categoria, Tag) junto da busca por texto, para estreitar resultados sem perder o ranking híbrido.
19. Como Usuário, quero filtrar também por Restrição alimentar atendida ("vegano", "sem glúten") usando o array de restrições da Receita, para achar só receitas que se declaram adequadas a mim.
20. Como Usuário, quero filtrar por dificuldade e porções (Vocabulário culinário) na busca, para achar receitas no meu nível e no tamanho certo.
21. Como Usuário, quero que os resultados venham SECCIONADOS entre Catálogo (origin=catalog) e Comunidade (receitas públicas dos usuários), para entender de onde vem cada receita e não misturar curadoria editorial com conteúdo da comunidade.
22. Como Usuário, quero que o selo de Proveniência (catalog | ai_chat | ai_structured | user_edited) fique SEMPRE visível em cada resultado, para saber como aquela receita surgiu antes de abrir.
23. Como Usuário, quero que a Busca NUNCA faça um ranking cego misturando catálogo e comunidade num só monte, para que a separação editorial seja clara nos resultados.
24. Como Usuário, quero ver a atribuição (Autoria) nos resultados da comunidade, para saber quem é creditado por aquela receita pública.
25. Como Usuário no locale pt-BR, quero achar uma receita do Texas ("Texas Chili") buscando em português, para que a identidade única da receita (mesmo prato em todos os locales) me devolva o prato independentemente da língua em que digitei.
26. Como Usuário, quero que a busca por nome use a Tradução de receita do meu locale quando ela existe, para ver títulos e textos na minha língua.
27. Como Usuário num locale SEM tradução da receita, quero que a camada precisa ainda me ache via Ingrediente canônico language-neutral + texto completo, e a camada semântica caia pro embedding de um locale disponível, para que a falta de tradução não esconda o prato da minha busca.
28. Como Usuário, quero ver no resultado que a tradução exibida é automática e não revisada quando for o caso (tradução SINALIZADA), para eu saber que o texto na minha língua pode não ter sido conferido.
29. Como Usuário, quero que cada linha de Tradução tenha seu próprio Embedding por locale, para que a camada semântica funcione bem dentro do meu idioma quando há tradução.
30. Como Usuário, quero que, dentro da seção Comunidade, eu possa ordenar por Popularidade/Votos, para descobrir as receitas públicas mais bem avaliadas.
31. Como Usuário, quero que o Voto sirva só pra ordenar e alimentar a descoberta social, sem virar garantia de segurança nem promover a receita ao Catálogo, para que popularidade não seja confundida com curadoria ou verificação.
32. Como Usuário, quero alternar a ordenação da Comunidade entre Relevância (ranking híbrido) e Popularidade, para escolher entre "melhor casamento" e "mais votada".
33. Como Usuário, quero que a ordenação por Popularidade valha SÓ na seção Comunidade, já que o Catálogo é editorial e não ordenado por votos, para manter a separação editorial coerente.
34. Como Visitante, quero buscar receitas sem criar conta, para experimentar o app antes de me cadastrar.
35. Como Visitante, quero ver resultados seccionados (catálogo e comunidade), selos de origem e facetas como qualquer Usuário, para ter a experiência completa de busca sem login.
36. Como Visitante, quero entender que ações como salvar, favoritar ou votar exigem conta quando eu tentar usá-las a partir de um resultado, para saber o que ganho ao me cadastrar sem ser bloqueado de buscar.
37. Como Usuário, quero uma resposta clara de "nenhuma receita encontrada" quando minha busca não casa com nada em nenhuma das duas camadas, para saber que não há resultado em vez de ficar olhando tela em branco.
38. Como Usuário com busca sem resultado exato, quero sugestões da camada semântica ("talvez você queira") quando houver algo só parecido, para ter um próximo passo em vez de um beco sem saída.
39. Como Usuário, quero buscar com uma Consulta vazia ou só com espaços e receber um estado neutro (ex.: receitas em destaque ou facetas), em vez de erro, para não quebrar a busca por engano.
40. Como Usuário, quero que uma busca com termos muito longos, caracteres estranhos ou só pontuação seja tratada com segurança e devolva resultado vazio ou neutro, sem erro de sistema, para a busca nunca quebrar com entrada ruim.
41. Como Usuário, quero que facetas que não casam com nenhuma receita (ex.: Cozinha sem receitas) devolvam seção vazia e me deixem afrouxar os filtros, para eu não ficar preso num filtro sem saída.
42. Como Usuário, quero que, se a camada semântica falhar (ex.: indisponibilidade do serviço de embedding), a busca ainda retorne pela camada precisa (texto completo + ingrediente canônico + facetas), para a busca degradar com elegância em vez de cair por inteiro.
43. Como Usuário, quero que a Busca trate Receita derivada (origin=user_edited) e receitas geradas por IA (ai_chat, ai_structured) como receitas normais nos resultados, com seu selo de origem, para que todo conteúdo público apareça de forma consistente.
44. Como Usuário, quero que Receitas privadas NUNCA apareçam na busca de outras pessoas, para que só conteúdo público (Catálogo + Comunidade) entre no pool de busca.
45. Como Usuário, quero que receitas com result_kind=playful (zoeira) NÃO apareçam na busca pública, já que são privadas por invariante, para que humor salvo no privado nunca vaze pros resultados de outros.
46. Como Usuário, quero que a Busca apenas encontre e ranqueie, nunca crie nada (Busca = encontrar; Consulta = os parâmetros), para que buscar jamais gere uma Receita por engano.
47. Como Usuário, quero que apenas a versão CORRENTE de uma receita na sua linhagem entre na busca, e que versões superadas (regeneradas) fiquem fora dos resultados, para eu não ver versões antigas competindo nos resultados.
48. Como Usuário num resultado com Item de receita não resolvido pro canônico (só raw_text), quero que ele ainda apareça pela degradação para texto completo, para que receitas com ingredientes não-canônicos não fiquem invisíveis.
49. Como Usuário com Aviso de restrição numa receita ("declarado, não verificado"; contradição óbvia como farinha de trigo em "sem glúten"), quero que o aviso amigável apareça no resultado sem ser bloqueado nem suprimido da busca, para eu decidir por conta própria.

### Modo conversa

50. Como Usuário, quero abrir uma Sessão de criação em Modo conversa e descrever o prato em linguagem natural ("quero um bolo de cenoura fofinho sem lactose"), para a IA entender minha intenção sem eu preencher campos.
51. Como Usuário, quero conversar em várias mensagens, uma puxando a outra, para ir refinando a ideia até chegar na Receita que quero.
52. Como Usuário, quero que a IA me devolva texto na hora, aparecendo palavra por palavra (streaming token-a-token), para eu acompanhar o raciocínio e não ficar olhando uma tela parada.
53. Como Usuário, quero que, ao fim de uma rodada, a IA destile a Receita numa única chamada constrita ao schema canônico, para o que eu salvar ser sempre uma Receita completa e válida (título, ingredientes com quantidade+unidade, passos, porções, dificuldade, cozinha, restrições atendidas).
54. Como Usuário, quero ver o Comentário consultivo da IA exibido junto da Receita mas FORA dela ("troquei manteiga por azeite porque você pediu sem lactose"), para entender as escolhas sem que esse conselho vire parte do objeto Receita.
55. Como Usuário, quero falar nos dois locales (pt-BR/en-US) e receber a Receita na mesma identidade única, para o prato existir nos dois idiomas sem virar duas receitas.
56. Como Usuário, quero declarar Restrições alimentares durante a conversa ("tem que ser vegano"), para a IA gerar uma Receita que afirma atender essas restrições.
57. Como Usuário, quero que a IA me aconselhe mas respeite minha decisão final (exceto onde colide com segurança), para eu manter o controle do que vai virar a Receita.
58. Como Usuário, quero que o transcript da conversa fique salvo, para eu fechar o app e voltar depois sem perder o que já conversei.
59. Como Usuário, quero retomar uma Sessão de criação antiga e continuar de onde parei ("agora deixa pra 8 porções"), para ajustar a Receita sem recomeçar do zero.
60. Como Usuário, quero que cada ajuste que eu peço gere uma nova versão da Receita, para a versão corrente sempre refletir meu último pedido.
61. Como Usuário, quero pedir para regenerar a Receita, para tentar um resultado diferente quando o atual não me agradou.
62. Como Usuário, quero que regenerar crie uma nova versão imutável ligada por linhagem (lineage_kind=regenerated, parent_recipe_id apontando pra versão anterior), para nenhuma versão anterior ser sobrescrita de forma destrutiva.
63. Como Usuário, quero que só a versão corrente entre na busca (seja embedada), para versões superadas ficarem guardadas na linhagem mas não poluírem os resultados.
64. Como Usuário, quero ver que a Tradução de receita do locale que editei foi marcada como desatualizada e que o Embedding daquele locale será re-gerado, para entender que a camada semântica daquela tradução vai ser recalculada.
65. Como Usuário, quero voltar a uma Sessão e ver tanto o transcript quanto a Receita corrente que ela produziu, para ter o contexto inteiro do episódio de criação.
66. Como Usuário, quero apagar o transcript de uma Sessão de criação sem apagar a Receita que ela gerou, para limpar o histórico de conversa e mesmo assim manter o prato salvo.
67. Como Usuário, quero que apagar o transcript também leve junto o Comentário consultivo (que mora no registro da geração), para o conselho sumir com a conversa enquanto o sinal que precisa durar (degradado) continua na Receita via result_kind.
68. Como Usuário, quero ser avisado de que apagar o transcript é irreversível e não toca na Receita, para eu confirmar com consciência do que vai sumir e do que fica.
69. Como Usuário, quero que quando a IA gera uma Receita válida e publicável (SUCCESS), o chat mostre a Receita pronta para salvar, para eu seguir em frente com confiança.
70. Como Usuário, quero que quando a Receita não atende tudo que pedi (DEGRADED), o chat mostre a Receita gerada junto de um Comentário consultivo explicando o que não deu, para eu decidir se aceito (ela continua publicável, qualidade é minha escolha).
71. Como Usuário, quero que quando eu faço um pedido brincalhão ou absurdo e a IA responde com uma Receita de zoeira (PLAYFUL), o chat deixe claro que é humor e que ela só pode ser salva no privado, nunca publicada, para a personalidade do produto aparecer sem me confundir.
72. Como Usuário, quero que quando meu pedido é impossível de virar Receita (IMPOSSIBLE), a IA dê uma resposta honesta de parada (hard stop) sem inventar uma Receita, para eu não receber lixo disfarçado de prato.
73. Como Usuário, quero que quando a destilação falha no schema mesmo após retry/repair (INVALID), o chat mostre um erro de sistema claro e nunca exiba uma Receita quebrada, para eu nunca ver dado lixo apresentado como prato.
74. Como Usuário, quero que uma Receita de zoeira (result_kind=playful) nunca possa ser tornada pública, para o banco garantir (CHECK) que humor fica no privado.
75. Como Visitante, quero criar uma Receita conversando com a IA de forma efêmera (client-only, nunca persistida no servidor), para experimentar o Modo conversa sem precisar de conta.
76. Como Visitante, quero compartilhar o que criei exportando/copiando o texto (não um link), para mostrar a Receita a alguém mesmo sem ela existir no servidor.
77. Como Visitante, quero ser convidado a criar uma conta quando tento salvar, para eu entender que persistir a Receita e o transcript exige login.
78. Como Visitante, quero que minha conversa efêmera não deixe rastro no servidor ao fechar a aba, para minha sessão anônima respeitar o limite de não-persistência.
79. Como Usuário logado, quero que minha geração persista já como Receita (visibility=private, com o result_kind da taxonomia), para nunca existir um estado intermediário de "Sugestão" — o que a IA gera já é Receita salva no meu privado.
80. Como Usuário logado, quero salvar tanto a Receita quanto o transcript da Sessão de criação, para retomar a conversa depois e manter o prato.
81. Como Usuário, quero publicar (tornar pública) uma Receita criada no chat quando ela for publicável (SUCCESS ou DEGRADED), para ela entrar no pool da comunidade — lembrando que publicar é um ato separado de salvar.
82. Como Usuário, quero que se a conexão cair no meio do streaming, eu veja um aviso claro e possa retomar ou tentar de novo, para não ficar sem saber se a Receita foi gerada.
83. Como Usuário, quero que se a IA recusar destilar (refusal) ou estourar o limite de tokens (max_tokens) na chamada de destilação, eu veja um erro de sistema claro (cai em INVALID) e nenhuma Receita parcial ou lixo seja exibida, para eu nunca receber uma Receita meia-feita disfarçada de pronta.
84. Como Usuário, quero que se a destilação final falhar mas o texto do chat tiver vindo, eu possa pedir para destilar de novo, para aproveitar a conversa sem recomeçar.
85. Como Usuário, quero que se eu retomar uma Sessão muito antiga cujo schema canônico mudou, a Receita corrente continue válida ou seja migrada com clareza, para versões antigas não quebrarem a experiência.
86. Como Usuário, quero que se eu pedir algo que colide com segurança (mesmo de forma leve), a IA me avise com o Aviso de restrição honesto ("declarado, não verificado") sem bloquear nem travar, para a responsabilidade final continuar minha.
87. Como Usuário, quero que se a IA detecta contradição óbvia no que pedi (farinha de trigo num prato "sem glúten"), o chat mostre um alerta amigável sem suprimir nem impedir a geração, para eu corrigir se quiser, mas seguir se insistir.
88. Como Usuário, quero que se eu tentar publicar uma Receita lúdica (playful), o sistema recuse de forma clara, para eu entender que zoeira fica no privado.
89. Como Usuário, quero que se a Sessão fica muito longa, o transcript continue legível e retomável, para conversas extensas não atrapalharem o desempenho nem a clareza.
90. Como Visitante, quero que se eu tentar retomar uma conversa efêmera depois de fechar a aba, o sistema deixe claro que ela não foi salva, para eu não esperar um histórico que nunca existiu no servidor.
91. Como Usuário, quero que se eu apagar o transcript por engano, o aviso prévio de irreversibilidade me proteja, para eu não perder a conversa sem confirmar.

### Modo estruturado

92. Como Usuário, quero montar um Briefing escolhendo cozinha, categoria, porções e dificuldade por campos, para pedir uma Receita sem precisar descrever tudo por texto livre.
93. Como Usuário, quero adicionar ingredientes ao Briefing e marcar a FORÇA de cada um (obrigatório ou preferido), para deixar claro o que a Receita NÃO pode deixar de ter e o que é só desejável.
94. Como Usuário, quero, ao digitar um ingrediente, ver sugestões do Ingrediente canônico (com nome traduzido no meu locale), para que o item do Briefing aponte pro canônico e a busca cross-locale funcione depois.
95. Como Usuário, quero digitar um ingrediente livre que ainda não existe na base canônica, para não ficar travado quando o insumo não está catalogado (o item guarda só o raw_text, FK ao canônico fica vazia).
96. Como Usuário, quero marcar restrições alimentares no Briefing (sem glúten, vegano, sem lactose) a partir do Vocabulário culinário, para pedir uma Receita que atenda às minhas condições.
97. Como Usuário, quero escrever observações livres no Briefing ("uso pouco sal", "tenho air fryer"), para passar contexto que não cabe nos campos estruturados.
98. Como Usuário, quero ajustar as porções num intervalo válido, para a Receita sair no tamanho que eu preciso.
99. Como Usuário, quero escolher a dificuldade a partir do Vocabulário culinário, para pedir algo dentro do meu nível.
100. Como Usuário, quero remover ou trocar a FORÇA de um ingrediente já adicionado antes de gerar, para corrigir o Briefing sem recomeçar.
101. Como Usuário, quero ver o Briefing montado de forma clara antes de gerar, para conferir o que estou pedindo.
102. Como Usuário, quero que a IA gere a Receita numa única chamada constrita a partir do meu Briefing, para receber a Receita pronta sem conversa de ida e volta.
103. Como Usuário, quero que a Receita gerada saia no mesmo schema canônico de saída do Modo conversa, para que pareça e funcione igual independentemente de como foi criada.
104. Como Usuário logado, quero que a Receita gerada já seja salva como Receita (visibility=private, origin=ai_structured), para que ela exista de verdade e eu decida depois se publico.
105. Como Visitante, quero gerar pelo Modo estruturado de forma efêmera (só no cliente, sem tocar o servidor), para experimentar antes de criar conta; e quero poder exportar/copiar o texto da Receita gerada.
106. Como Usuário, quero ver o Comentário consultivo junto da Receita ("usei azeite no lugar de manteiga porque você pediu vegano"), para entender as escolhas da IA fora do objeto Receita.
107. Como Usuário, quero que o Briefing fique guardado na Sessão de criação (mode=structured) como proveniência da geração, para que dê pra ver depois o que foi PEDIDO.
108. Como Usuário, quero ver o que pedi (Briefing) separado do que recebi (Receita), para comparar o pedido com o entregue sem confundir os dois.
109. Como Usuário, quero que a IA me avise quando dois ingredientes obrigatórios não combinam bem ("morango com alho não casa"), mas ainda gere o que pedi, para eu manter o controle da decisão.
110. Como Usuário, quero poder ignorar o conselho da IA e gerar mesmo assim, para que minha escolha prevaleça quando não há risco de segurança.
111. Como Usuário, quero que a IA respeite o que marquei como obrigatório como autoritativo, para que ingrediente obrigatório nunca seja silenciosamente removido da Receita.
112. Como Usuário, quero que a IA trate o "preferido" como flexível, para que ela possa ajustar um preferido quando ele atrapalha o resultado, explicando no Comentário consultivo.
113. Como Usuário, quero que, SÓ quando o pedido colide com segurança, a IA não obedeça cegamente (ex.: ingrediente obrigatório que contradiz uma restrição obrigatória), para que o conflito seja sinalizado com honestidade em vez de gerar algo enganoso.
114. Como Usuário, quero receber um resultado SUCCESS quando a IA atende tudo que pedi, para ter uma Receita válida e publicável.
115. Como Usuário, quero receber um resultado DEGRADED quando a IA não consegue atender tudo (ex.: não dá pra honrar todos os obrigatórios juntos), com a Receita gerada mais o Comentário consultivo explicando o que faltou, para eu decidir se aproveito mesmo assim (qualidade é minha escolha; continua publicável).
116. Como Usuário, quero receber um resultado IMPOSSIBLE com um hard stop honesto quando o pedido não tem como virar Receita, para não receber algo inventado ou enganoso (não gera Receita).
117. Como Usuário, quero que um pedido brincalhão/absurdo gere um resultado PLAYFUL (zoeira), salvável no meu privado mas NÃO publicável, para que o humor do produto exista sem poluir o pool da comunidade.
118. Como Usuário, nunca quero ver uma Receita-lixo quando a geração falha o schema mesmo após retry/repair (INVALID), para que o erro seja tratado como falha de sistema e não exiba dado quebrado.
119. Como Usuário, quero um aviso claro quando meu Briefing está vazio ou sem nenhum ingrediente/campo mínimo, para saber que preciso preencher antes de gerar.
120. Como Usuário, quero um Aviso de restrição leve quando meu próprio Briefing tem contradição óbvia (marquei "sem glúten" mas adicionei farinha de trigo como obrigatório), honesto e sem travar, para eu corrigir se quiser, mantendo a responsabilidade comigo.
121. Como Usuário, quero que porções ou dificuldade fora do intervalo válido sejam recusadas no app antes da chamada à IA, para não desperdiçar uma geração com Briefing inválido.
122. Como Usuário, quero uma mensagem clara e a chance de tentar de novo quando a chamada à IA falha por rede/timeout, para não perder o Briefing que montei.
123. Como Usuário, quero que o Briefing que montei seja preservado quando uma geração falha (INVALID/erro de sistema), para tentar de novo sem remontar tudo.
124. Como Usuário, quero poder regenerar a partir do mesmo Briefing, para tentar um resultado melhor sem refazer o pedido (cada regeneração é uma nova versão imutável na linhagem, e só a versão corrente é embedada).
125. Como Usuário, quero poder ajustar o Briefing e gerar de novo, para iterar o pedido quando o primeiro resultado não me serviu.
126. Como Usuário, quero que um ingrediente do Briefing sem FK canônica ainda funcione (degrada pro raw_text), para que insumos não catalogados não quebrem a geração nem a proveniência.
127. Como Usuário, quero que restrições duplicadas ou ingredientes repetidos no Briefing sejam tratados sem erro (dedup amigável), para não ser punido por um descuido no preenchimento.
128. Como Usuário, quero que observações muito longas sejam limitadas ou avisadas, para o Briefing não estourar limites de forma silenciosa.
129. Como Curador, quero que ingredientes livres recorrentes que aparecem nos Briefings sejam visíveis pra eventual promoção à base canônica, para que a curadoria faça a base crescer com o uso real.

### Papéis e acesso

130. Como Visitante, quero buscar receitas existentes (por nome, ingrediente ou Perfil culinário) sem criar conta, para experimentar o app antes de me comprometer.
131. Como Visitante, quero ver os resultados da Busca seccionados por origem (catálogo vs comunidade), para entender de onde vem cada receita mesmo sem estar logado.
132. Como Visitante, quero abrir e ler qualquer receita pública (catálogo ou comunidade) com todos os detalhes — ingredientes, passos, Aviso de restrição, selo de Proveniência — para decidir se serve antes de me cadastrar.
133. Como Visitante, quero criar uma receita conversando com a IA (Modo conversa) de forma EFÊMERA (só no meu navegador, nunca no servidor), para testar a criação sem deixar rastro nem conta.
134. Como Visitante, quero criar uma receita pelo Modo estruturado de forma EFÊMERA, para gerar algo sob medida sem precisar me cadastrar.
135. Como Visitante, quero compartilhar uma receita que gerei efêmera EXPORTANDO ou COPIANDO o texto (e, quando houver, a imagem), para mandar pra alguém sem depender de um link do servidor.
136. Como Visitante, quero ser avisado de forma clara que minha criação efêmera some se eu fechar ou recarregar a página, para não perder algo importante por engano.
137. Como Visitante, quero que o app me ofereça criar conta no exato momento em que tento salvar, publicar, votar ou favoritar, para só me cadastrar quando realmente precisar persistir algo.
138. Como Visitante, quero que, ao criar conta no meio de uma criação efêmera, o conteúdo que está no meu navegador seja oferecido para virar uma Receita salva (visibility=private), para não perder o trabalho na transição.
139. Como Visitante, quero que, se eu recusar criar conta ao tentar salvar, eu volte exatamente pra onde estava sem perder a criação efêmera atual, para não ser punido por dizer "agora não".
140. Como Visitante, quero compartilhar uma receita PÚBLICA que encontrei na Busca copiando seu texto, para divulgar mesmo sem conta.
141. Como Visitante, quero NÃO conseguir votar, favoritar, salvar nem publicar, para que essas ações fiquem reservadas a quem tem conta (e o app me explique isso sem travar minha navegação).
142. Como Visitante, quero que minha criação efêmera marcada como Receita de zoeira (lúdica) também possa ser exportada por texto, mas nunca publicada, para que o limite de "zoeira não é publicável" valha desde o anônimo.
143. Como Usuário, quero criar conta no momento em que tento persistir algo, para começar a salvar sem um cadastro antecipado e burocrático.
144. Como Usuário, quero salvar uma receita que gerei com a IA como minha Receita (origin=ai_chat ou ai_structured, visibility=private), para guardá-la e voltar nela depois.
145. Como Usuário, quero ser o Owner das receitas que crio (owner_id = meu id), para controlar a linha — editar, publicar ou apagar.
146. Como Usuário, quero publicar uma das minhas receitas (mudar visibility de private para public) por minha própria conta, sem curadoria obrigatória, para colocá-la no pool da comunidade.
147. Como Usuário, quero entender que "salvar" e "publicar" são ações diferentes — salvar guarda no privado, publicar torna público — para não expor uma receita sem querer.
148. Como Usuário, quero despublicar uma receita minha (voltar visibility para private), para tirá-la do pool da comunidade quando eu quiser.
149. Como Usuário, quero votar em receitas públicas da comunidade, para ajudar a ordenar a descoberta social (Popularidade) sem que isso vire garantia de segurança.
150. Como Usuário, quero favoritar receitas (minhas ou de outros, públicas), para montar minha coleção pessoal de acesso rápido.
151. Como Usuário, quero ver o crédito de Autoria de cada receita pública na exibição, para saber quem é creditado mesmo que o Owner seja outro ou o sistema.
152. Como Usuário, quero que minha Autoria apareça na receita que publiquei mesmo depois de ações futuras na linha, para receber o crédito do que criei.
153. Como Usuário, quero editar uma receita PRÓPRIA (privada ou pública) com update in-place, porque eu controlo a linha, para corrigir e melhorar sem criar cópia.
154. Como Usuário, quero que, ao editar uma receita que NÃO é minha (do catálogo ou de outro), o app crie uma Receita derivada minha (origin=user_edited, lineage_kind=edited) com ponteiro pra base e diff, para eu ter minha versão sem nunca mutar a base alheia.
155. Como Usuário, quero retomar uma Sessão de criação (Modo conversa) salva e continuar de onde parei, para evoluir a receita em vários momentos.
156. Como Usuário, quero apagar o transcript de uma Sessão de criação sem apagar a Receita que ela gerou, para limpar a conversa mantendo o resultado.
157. Como Usuário, quero apagar uma receita minha, para remover de vez algo que não quero mais (respeitando que derivadas de terceiros ficam com o snapshot e só perdem o ponteiro — ON DELETE SET NULL).
158. Como Usuário, quero que uma receita marcada como Receita de zoeira (result_kind=playful) eu só possa salvar no privado e NUNCA publicar, para que o app respeite o limite da zoeira (CHECK de banco).
159. Como Usuário, quero reportar uma receita pública que me pareça problemática, para acionar a revisão reativa do Curador sem que o app bloqueie a publicação preventivamente.
160. Como Usuário, quero ser avisado de forma leve quando uma receita tem contradição óbvia de restrição (Aviso de restrição "declarado, não verificado"), para decidir por conta própria, já que o app não trava nem suprime.
161. Como Usuário, quero que tentar publicar uma receita falhe de forma clara se ela for playful, para entender o porquê em vez de um erro genérico.
162. Como Usuário, quero NÃO conseguir editar a config do app nem curar o catálogo, para que esses poderes fiquem com Curador e Admin.
163. Como Usuário, quero que minhas votações sejam idempotentes (um voto por receita), para que repetir o clique não infle a Popularidade.
164. Como Usuário, quero desfazer um voto ou um favorito, para corrigir uma ação feita por engano.
165. Como Usuário, quero que ao perder a sessão de login no meio de salvar/publicar, o app me peça pra reautenticar e retome a ação, para não perder o que eu ia persistir.
166. Como Curador, quero revisar receitas reportadas ou com Aviso de restrição na minha fila de revisão, para cuidar da qualidade de forma REATIVA (depois do report), nunca como gate de publicação.
167. Como Curador, quero manter (aprovar/ignorar o report) uma receita revisada, para encerrar a revisão quando ela está dentro do aceitável.
168. Como Curador, quero remover uma receita pública problemática do pool da comunidade, para proteger os usuários sem precisar de aprovação prévia para publicações.
169. Como Curador, quero curar o catálogo editorial (origin=catalog) — incluir, editar e organizar receitas do catálogo curado, que é separado do pool da comunidade, para manter a coleção oficial com qualidade.
170. Como Curador, quero crescer a base de Ingrediente canônico (resolver Itens de receita sem FK, criar/ajustar nomes e aliases traduzidos), para melhorar a busca por ingrediente cross-locale.
171. Como Curador, quero ver a Proveniência (origin) e o result_kind de cada receita na fila, para priorizar revisão com contexto.
172. Como Curador, quero que a moderação seja reativa e não bloqueie a self-publish dos usuários, para respeitar o princípio de publicação sem curadoria obrigatória.
173. Como Curador, quero NÃO ter acesso à configuração do app, para que meu poder fique restrito à curadoria e revisão, separado do Admin.
174. Como Curador, quero registrar o motivo ao remover uma receita pública, para deixar rastro do porquê da ação de moderação.
175. Como Curador, quero que, ao remover uma receita pública da comunidade, o Owner continue dono da linha no privado quando aplicável, para que moderar o público não signifique destruir o trabalho da pessoa de forma silenciosa.
176. Como Curador, quero atuar tanto em conteúdo pt-BR quanto en-US (a Receita é a mesma em todos os locales), para revisar o prato como entidade única, não uma versão por idioma.
177. Como Admin, quero ter todos os poderes do Curador mais o acesso à configuração do app, para administrar a plataforma por inteiro.
178. Como Admin, quero editar a configuração do app (ex.: parâmetros de geração, modelo default claude-opus-4-8 vs opção de custo claude-sonnet-4-6, taxonomias do Vocabulário culinário), para ajustar o comportamento do sistema sem mexer no código.
179. Como Admin, quero gerenciar papéis dos usuários (promover a Curador, rebaixar, conceder Admin), para controlar quem tem cada poder.
180. Como Admin, quero atribuir receitas de sistema/catálogo a owner_id = NULL, para que o catálogo curado não pertença a um usuário específico.
181. Como Admin, quero acessar todas as ferramentas do Curador (fila de revisão, curadoria do catálogo, base canônica), para atuar quando faltar Curador disponível.
182. Como Admin, quero que ações sensíveis de config fiquem restritas só a mim, para evitar que Curador ou Usuário alterem o comportamento do sistema.
183. Como pessoa qualquer, quero que salvar, publicar, votar e favoritar SEMPRE exijam conta, para que essas ações tenham um dono identificável.
184. Como pessoa qualquer, quero que o app distinga Owner (controla a linha), Autoria (crédito na exibição) e Proveniência (como surgiu) como três eixos separados, para que controle, crédito e origem nunca sejam confundidos.
185. Como Usuário recém-criado, quero que minha conta tenha id estável desde a criação, para que minha propriedade e autoria sejam consistentes ao longo do tempo.
186. Como pessoa qualquer, quero que tentar uma ação acima do meu papel (ex.: Usuário tentando curar, Curador tentando mexer em config) seja negada de forma clara, para entender o limite sem um erro confuso.
187. Como Usuário, quero que, ao criar conta durante uma criação efêmera, a Receita persistida nasça com owner_id = meu id e a Autoria me creditando, para que controle e crédito comecem corretos.
188. Como Visitante que vira Usuário, quero que apenas a criação efêmera que está no meu navegador AGORA possa ser persistida (não há histórico efêmero no servidor para recuperar), para que a fronteira "anônimo = nada no servidor" fique honesta.

### i18n e tradução

189. Como Usuário, quero ver qualquer Receita no meu locale (pt-BR ou en-US), para ler título, descrição e passos na minha língua sem perder o prato que escolhi.
190. Como Usuário, quero que a Receita seja sempre o MESMO prato em qualquer locale, para que trocar de idioma nunca me devolva outra receita parecida no lugar.
191. Como Usuário, quero que o link de uma Receita seja o mesmo independente do locale, para que ao compartilhar com alguém de outro idioma a pessoa caia na mesma Receita, só apresentada na língua dela.
192. Como Visitante, quero ver as Receitas já no locale detectado do meu navegador, para entender o conteúdo sem precisar configurar nada antes.
193. Como Usuário, quero ver SEMPRE o nome original da Receita como nome primário, para reconhecer o prato pelo nome que o autor deu.
194. Como Usuário, quero ver a tradução localizada confiável do nome entre parênteses ao lado do original ("Texas Chili (chili do Texas)"), para entender do que se trata sem perder o nome de origem.
195. Como Usuário, quero que, quando não existe tradução confiável do nome, apareça só o nome original sem parênteses vazios, para a tela não mostrar lixo.
196. Como Usuário, quero que uma tradução automática crua do nome NUNCA vire o nome oficial, para o prato não ganhar um nome inventado pela máquina.
197. Como Usuário cujo locale é o mesmo do nome original, quero ver só o nome original sem repetir a tradução entre parênteses, para evitar redundância ("Feijoada (feijoada)").
198. Como Usuário, quero ler descrição, textos de passo e notas traduzidos por completo no meu locale, para seguir a receita inteira sem trechos na língua de origem.
199. Como Usuário, quero que a Tradução de receita cubra exatamente os campos que variam por locale (título, descrição, textos de passo, notas), para o conteúdo localizado ser consistente.
200. Como Usuário, quero que, se um locale ainda não tem Tradução de receita, eu veja o conteúdo num locale disponível (com o nome original sempre presente), para não ficar com a tela vazia.
201. Como Usuário, quero que uma Tradução de receita parcial (alguns passos traduzidos, outros não) deixe claro quais trechos ainda estão na língua de origem, para eu não achar que esqueceram de um passo.
202. Como Usuário, quero ver um sinal claro de que a Tradução de receita foi feita por máquina e ainda não foi revisada, para eu calibrar minha confiança no texto.
203. Como Usuário, quero que esse sinal de "tradução automática" seja leve e honesto, sem travar ou esconder o conteúdo, para eu seguir usando a receita por minha conta.
204. Como Usuário, quero que a Tradução de receita revisada por uma pessoa NÃO carregue o sinal de automática, para eu distinguir o que já foi conferido.
205. Como Curador, quero revisar uma Tradução de receita automática e marcá-la como revisada, para remover o sinal de "não revisada" das traduções que conferi.
206. Como Usuário, quero ver a proveniência e a confiança de cada Tradução de receita (automática não revisada, automática revisada, escrita por pessoa), para julgar o texto que estou lendo.
207. Como Usuário, quero que, quando o original da Receita muda, as Traduções de receita afetadas fiquem marcadas como "desatualizada", para eu saber que aquela língua pode estar atrás do original.
208. Como Usuário, quero ver um aviso leve de Tradução de receita desatualizada (sem bloquear a leitura), para decidir se confio no texto ou volto ao original.
209. Como Usuário lendo uma Tradução de receita desatualizada, quero poder ver o original no locale de origem, para conferir o que mudou.
210. Como Curador, quero ver quais Traduções de receita estão desatualizadas, para priorizar a re-tradução das que mais importam.
211. Como Sistema, quero re-gerar o Embedding da linha de tradução quando a Tradução de receita muda, para a camada semântica da busca refletir o texto atual.
212. Como Usuário, quero que uma Tradução de receita marcada como desatualizada mas ainda legível continue aparecendo (com o aviso), para eu não ficar sem nada enquanto a re-tradução não vem.
213. Como Usuário, quero que quantidade e unidade de cada Item de receita sejam IGUAIS em todos os locales, para a medida nunca mudar quando troco de idioma.
214. Como Usuário, quero que porções e dificuldade sejam invariantes entre locales (só o rótulo de exibição muda de língua, o valor não), para a receita render o mesmo em qualquer idioma.
215. Como Usuário, quero que o valor de dificuldade e de porções venha do Vocabulário culinário e seja exibido com rótulo traduzido, para ler "médio"/"medium" sem que o dado em si mude.
216. Como Usuário, quero que a nota livre de um Item de receita (que é texto) possa ser traduzida, mas a quantidade e a unidade nunca, para o texto fazer sentido na minha língua sem alterar a medida.
217. Como Usuário, quero que o raw_text de um Item de receita continue ligado ao mesmo prato em qualquer locale, para a busca por ingrediente funcionar cross-locale.
218. Como Usuário, quero um seletor de locale claro na interface, para alternar entre pt-BR e en-US quando quiser.
219. Como Usuário, quero que, ao trocar de locale numa Receita aberta, eu continue na MESMA Receita, só reapresentada na nova língua, para não perder o que estava vendo.
220. Como Usuário logado, quero que minha preferência de locale fique salva, para não precisar trocar de novo a cada visita.
221. Como Visitante, quero que minha escolha de locale persista na sessão do navegador, para não voltar ao padrão a cada página.
222. Como Usuário, quero que toda a interface (botões, rótulos, mensagens) acompanhe o locale escolhido, para a experiência ser consistente, não só o conteúdo da receita.
223. Como Usuário, quero que a Busca respeite meu locale (FTS na config do idioma — portuguese/english + unaccent), para encontrar receitas pela forma como escrevo na minha língua.
224. Como Usuário, quero que um locale não suportado caia num padrão sensato (o locale disponível mais próximo ou o original), para nunca ver tela quebrada por idioma faltando.
225. Como Usuário, quero que uma Receita sem nenhuma Tradução de receita em nenhum locale ainda mostre o nome original e o conteúdo de origem, para a Receita nunca ficar invisível por falta de tradução.
226. Como Usuário, quero que campos sem tradução dentro de uma Tradução de receita parcial caiam para o texto de origem (não para vazio), para eu sempre ter algo legível.
227. Como Usuário, quero que a troca de locale não dispare nenhuma criação ou edição de Receita, para alternar idioma ser uma ação só de apresentação, nunca de identidade.
228. Como Sistema, quero impedir que se crie uma segunda Receita "em outra língua" para o mesmo prato, para a identidade única language-neutral nunca ser bifurcada por locale.
229. Como Usuário, quero que, se a Tradução de receita automática falhar ao ser gerada, eu ainda veja o original e nenhuma mensagem de erro técnica assustadora, para a falha de tradução nunca quebrar a leitura da Receita.
230. Como Curador, quero que ao editar o original de uma Receita o sistema marque as Traduções de receita afetadas como desatualizadas automaticamente, para nenhuma tradução ficar silenciosamente atrás do original.
231. Como Usuário, quero que mudar SÓ um campo invariante (ex.: quantidade de um Item de receita) NÃO marque as Traduções de receita como desatualizadas, para não disparar re-tradução à toa quando a língua não mudou.
232. Como Usuário, quero que o nome original entre parênteses só apareça quando a tradução for confiável, e que a tradução automática não revisada apareça com seu sinal (não como nome oficial), para o sinal de confiança ser coerente em toda a tela.

### Publicação e comunidade

233. Como Usuário, quero que toda Receita que eu salvo nasça privada por padrão, para que nada meu vá pro público sem eu mandar.
234. Como Usuário, quero publicar minha Receita por uma ação minha (self-publish), sem passar por curadoria, para que eu decida sozinho quando ela entra no pool da comunidade.
235. Como Usuário, quero entender que "salvar" e "publicar" são coisas diferentes, para que eu não exponha sem querer uma Receita que só queria guardar.
236. Como Usuário, quero despublicar uma Receita pública e voltá-la a privada, para que eu retome o controle do que mostro à comunidade.
237. Como Usuário, quero ver claramente o estado de Visibilidade (privada ou pública) de cada Receita minha, para que eu saiba a todo momento quem pode vê-la.
238. Como Usuário, quero que minha Receita pública apareça no pool da comunidade com atribuição a mim (Autoria), para que eu receba o crédito do que criei.
239. Como Visitante, quero saber que preciso de conta pra salvar ou publicar, para que eu entenda por que a ação não está disponível pra mim.
240. Como Visitante, quero criar uma Receita com a IA de forma efêmera e só exportar/copiar o texto, para que eu use o produto sem conta, ciente de que nada fica salvo no servidor.
241. Como Usuário, quero votar numa Receita pública da comunidade, para que eu ajude a destacar o que é bom.
242. Como Usuário, quero que a Popularidade (votos) ordene a descoberta de Receitas públicas, para que eu encontre primeiro o que a comunidade mais gostou.
243. Como Usuário, quero favoritar uma Receita pública, para que eu volte a ela depois sem depender da busca.
244. Como Usuário, quero retirar meu voto de uma Receita, para que eu corrija um voto que dei por engano.
245. Como Usuário, quero ver a Autoria de cada Receita no pool da comunidade, para que eu saiba quem a criou.
246. Como Visitante, quero navegar e ver o pool da comunidade ordenado por Popularidade, para que eu descubra boas Receitas mesmo sem conta.
247. Como Visitante, quero saber que preciso de conta pra votar ou favoritar, para que eu entenda por que essas ações pedem login.
248. Como Usuário, quero ver o selo de Proveniência (origin: catalog, ai_chat, ai_structured, user_edited) em toda Receita, inclusive no pool da comunidade, para que eu saiba de onde aquela Receita surgiu.
249. Como Usuário, quero distinguir, já na listagem do pool, uma Receita vinda da IA de uma Receita editada por usuário, para que eu pondere a confiança antes de abrir.
250. Como Usuário, quero que a Busca me mostre resultados seccionados por origem (catálogo curado x comunidade), para que eu não confunda o editorial com o que a comunidade enviou.
251. Como Usuário, quero que o selo de origem nunca suma quando a Receita está no pool, para que a Proveniência continue sendo informação sempre presente.
252. Como Curador, quero curar o catálogo (origin=catalog) como uma trilha editorial separada do pool da comunidade, para que o catálogo mantenha um padrão próprio.
253. Como Usuário, quero que minha Receita publicada nunca vire origin=catalog automaticamente, para que o catálogo continue sendo editorial e não um destino de promoção por Popularidade.
254. Como Usuário, quero entender que muitos votos não promovem minha Receita ao catálogo, para que eu não espere uma curadoria automática que não existe.
255. Como Curador, quero que o catálogo curado não se misture no mesmo ranking cego das Receitas da comunidade, para que o leitor sempre saiba qual seção está vendo.
256. Como Usuário, quero que uma Receita de zoeira (result_kind=playful) nunca possa ser publicada, para que o pool da comunidade não receba conteúdo de humor como se fosse Receita séria.
257. Como Usuário, quero salvar uma Receita lúdica no meu espaço privado, para que eu guarde a brincadeira sem expô-la à comunidade.
258. Como Usuário, quero que a opção de publicar nem apareça (ou apareça desabilitada e explicada) numa Receita lúdica, para que eu entenda de cara por que não dá pra publicar.
259. Como Usuário, quero que, se eu tentar forçar a publicação de uma Receita lúdica, o sistema recuse de forma honesta (o banco garante: playful implica privada), para que a regra valha mesmo num erro de cliente.
260. Como Usuário, quero que a Popularidade nunca seja lida como garantia de segurança ou de adequação a Restrição alimentar, para que eu não confie numa Receita muito votada só por causa dos votos.
261. Como Usuário, quero que o Aviso de restrição ("declarado, não verificado") continue visível mesmo numa Receita muito popular, para que muitos votos não escondam o aviso honesto.
262. Como Usuário, quero que votos não removam nem suavizem o alerta amigável de contradição óbvia (ex.: farinha de trigo em "sem glúten"), para que a Popularidade não atropele a honestidade do Aviso.
263. Como Curador, quero revisar Receitas reportadas ou com Aviso de forma reativa, sem que isso vire um portão de publicação, para que a moderação não trave o self-publish.
264. Como Usuário, quero que, ao despublicar, quem favoritou minha Receita pública deixe de vê-la no pool, mas eu entenda que quem já favoritou pode ter guardado um ponto que some, para que o comportamento de despublicação seja previsível.
265. Como Usuário, quero que editar minha própria Receita pública atualize a mesma linha in-place e fique visível a quem favoritou, para que eu corrija algo sem criar uma Receita derivada.
266. Como Usuário, quero que, ao editar uma Receita pública de outro, o sistema crie uma Receita derivada privada minha (origin=user_edited), em vez de mexer na original, para que a Receita base nunca seja mutada.
267. Como Usuário, quero que minha Receita derivada (origin=user_edited) também possa ser publicada por mim, com selo de origem próprio e atribuição a mim, para que minha versão entre no pool como criação minha, separada da base.
268. Como Usuário, quero que tentar votar duas vezes na mesma Receita conte como um voto só (ou troque meu voto), para que a Popularidade não seja inflada por cliques repetidos.
269. Como Usuário, quero não conseguir votar na minha própria Receita, para que a Popularidade reflita o interesse da comunidade, não autovotos.
270. Como Usuário, quero que, ao tentar publicar uma Receita sem estar logado (sessão expirada no meio da ação), o sistema peça login e preserve minha intenção de publicar, para que eu não perca o que ia fazer.
271. Como Usuário, quero que uma Receita despublicada saia do pool e da ordenação por Popularidade, mas mantenha os votos que já recebeu, para que, se eu republicar, o histórico não se perca.
272. Como Usuário, quero que uma Receita pública continue mostrando a Tradução automática SINALIZADA quando ainda não revisada, para que a comunidade veja o mesmo aviso de confiança que eu vejo.
273. Como Usuário, quero que, se eu apagar minha Receita pública, ela saia do pool da comunidade, para que nada meu fique no público depois de eu remover.
274. Como Visitante, quero que, ao tentar votar/favoritar/publicar, eu seja convidado a criar conta no fluxo, para que a transição de Visitante pra Usuário seja suave.

### Edição e restrições

275. Como Usuário, quero editar a minha própria receita privada e ver as mudanças salvas na mesma receita (update in-place), para corrigir e melhorar o que é meu sem criar cópias.
276. Como Usuário, quero editar a minha própria receita pública e ver as mudanças salvas na mesma receita (update in-place), para manter o que publiquei atualizado sem virar uma receita nova.
277. Como Usuário, quero entender que, ao editar a minha própria receita pública, a mudança fica visível para quem favoritou, para eu decidir com consciência antes de salvar.
278. Como Usuário, quero editar uma receita do catálogo e, com isso, gerar automaticamente uma Receita derivada minha (origin=user_edited), para adaptar a receita ao meu gosto sem mexer no catálogo.
279. Como Usuário, quero editar uma receita de outro usuário e, com isso, gerar automaticamente uma Receita derivada minha (origin=user_edited), para adaptar a receita de outra pessoa sem alterar a original.
280. Como Usuário, quero que a base nunca mude quando eu crio uma derivada, para a receita original continuar intacta para todo mundo.
281. Como Usuário, quero que a minha derivada guarde o estado completo dos itens de receita no momento do fork, para a minha cópia não mudar sob os pés se a base mudar depois.
282. Como Usuário, quero ver o diff da derivada (o que mudou em relação à base), para entender de relance a minha adaptação frente à original.
283. Como Usuário, quero ver o ponteiro da derivada para a base (de onde ela veio), para saber qual é a receita original que adaptei.
284. Como Usuário, quero que a derivada apareça com selo de proveniência user_edited, para ficar claro que é uma adaptação minha, não um original.
285. Como Usuário, quero publicar a minha Receita derivada, para compartilhar a minha adaptação com a comunidade.
286. Como Usuário, quero que a minha derivada nasça privada por padrão, para eu decidir depois se publico ou não.
287. Como Usuário, quero adaptar a mesma receita base mais de uma vez, gerando derivadas separadas, para ter variações diferentes sem que uma atrapalhe a outra.
288. Como Usuário, quero que a minha derivada continue funcionando mesmo se a base for apagada (ON DELETE SET NULL no ponteiro), para eu não perder a minha adaptação quando a original some.
289. Como Usuário, quero saber, quando a base da minha derivada deixou de existir, que o vínculo com a original foi perdido mas o conteúdo da minha receita continua completo, para eu não estranhar a ausência do diff.
290. Como Visitante, quero ser convidado a entrar para salvar a edição quando tento adaptar uma receita, para eu entender que adaptar e guardar exige conta.
291. Como Usuário, quero que a linhagem da minha derivada use parent_recipe_id + lineage_kind=edited, para a adaptação ser rastreável pela mesma query de ancestralidade que cobre a regeneração.
292. Como Usuário, quero que o diff só viaje quando o caso for lineage_kind=edited, para não carregar diff em linhagem de regeneração, onde ele não faz sentido.
293. Como Usuário, quero editar uma derivada que é minha como update in-place, para refinar a minha adaptação sem gerar mais uma camada de cópia.
294. Como Usuário, quero buscar e encontrar a minha derivada como uma receita normal, para ela conviver de igual para igual com as outras receitas na busca.
295. Como Curador, quero que editar uma receita reportada ou do catálogo siga as mesmas regras (própria = in-place; não-própria = derivada), para a moderação não criar mutações silenciosas na base.
296. Como Usuário, quero que a tentativa de editar uma receita que não é minha deixe claro que vou criar uma cópia (derivada), não alterar a original, para eu não esperar que minha mudança apareça para os outros na receita base.
297. Como Usuário, quero que, ao editar uma receita não-própria, o título, ingredientes, passos e demais campos venham pré-preenchidos com o estado atual da base, para eu partir do conteúdo existente em vez de recomeçar do zero.
298. Como Usuário, quero que a minha derivada exista em todos os locales como qualquer receita (identidade única, sem bifurcar por idioma), para a adaptação seguir as mesmas regras de tradução das demais.
299. Como Usuário, quero ver as restrições atendidas por uma receita exibidas como "declarado, não verificado", para eu entender que é uma afirmação, não uma garantia checada.
300. Como Usuário, quero ver as restrições atendidas (sem glúten, vegano, sem lactose) como facetas leves na receita, para filtrar e reconhecer rápido o que ela diz atender.
301. Como Usuário, quero que, numa receita gerada por IA, o "atende tal restrição" apareça como afirmação da IA e não como garantia verificada, para eu saber que a responsabilidade final é minha.
302. Como Usuário, quero que, quando houver contradição óbvia (ex.: farinha de trigo numa receita marcada "sem glúten"), apareça um Aviso de restrição amigável, para eu ser alertado de forma honesta sem ser tratado como incapaz.
303. Como Usuário, quero que o Aviso de restrição NÃO bloqueie nem trave a receita, para eu continuar usando, salvando e publicando mesmo com a contradição sinalizada.
304. Como Usuário, quero que o Aviso de restrição NÃO suprima nem esconda a receita, para eu sempre ter acesso ao conteúdo e decidir por conta própria.
305. Como Usuário, quero que a responsabilidade final pela adequação da receita seja claramente minha, para eu entender que o Aviso é um lembrete leve, não um selo de conformidade.
306. Como Usuário, quero que a contradição seja detectada por um lookup estático que liga alérgeno do ingrediente canônico à restrição (ex.: trigo/glúten contradiz "sem glúten"), para o aviso disparar só quando há dado confiável de alérgeno.
307. Como Usuário, quero que, quando o ingrediente não estiver resolvido para o canônico (só raw_text), o aviso simplesmente não dispare em vez de chutar uma contradição, para eu não receber alertas falsos por falta de dado.
308. Como Usuário, quero que, ao editar uma receita e introduzir uma contradição (ex.: adicionar trigo numa "sem glúten"), o mesmo Aviso de restrição apareça, para eu ser avisado no momento em que crio o problema.
309. Como Usuário, quero que, ao editar e remover o ingrediente que causava a contradição, o Aviso desapareça, para o sinal refletir o estado atual da receita.
310. Como Usuário, quero que adicionar ou tirar uma restrição atendida na edição reavalie a contradição na hora, para o aviso acompanhar a minha mudança.
311. Como Usuário, quero que o Aviso de restrição apareça com a mesma linguagem amigável tanto na exibição quanto na edição, para a experiência ser consistente em qualquer tela.
312. Como Usuário, quero salvar e até publicar uma receita mesmo com Aviso de restrição ativo, para a qualidade e a responsabilidade da decisão ficarem comigo, não no sistema.
313. Como Usuário, quero que o alérgeno no ingrediente canônico seja tratado como dado opcional e oportunista, para a ausência dele nunca virar um falso "tudo certo" nem um falso alerta.
314. Como Curador, quero crescer a base de ingredientes canônicos com dados de alérgeno, para que mais contradições óbvias possam ser sinalizadas com o tempo, sem virar verificação obrigatória.
315. Como Usuário, quero que o Aviso de restrição seja o mesmo em pt-BR e en-US (mesma identidade de receita, só muda a língua), para a sinalização não depender do locale.
316. Como Usuário, quero que uma receita sem nenhuma restrição declarada simplesmente não mostre facetas de restrição nem aviso, para a tela ficar limpa quando não há nada a sinalizar.
317. Como Usuário, quero que o Aviso de restrição apareça também em receitas do catálogo e da comunidade quando há contradição com dado de alérgeno, para o tratamento ser igual independentemente da origem.
318. Como Usuário, quero que múltiplas restrições atendidas sejam avaliadas cada uma contra os ingredientes (ex.: "sem glúten" e "vegano" juntas), para cada contradição possível ser sinalizada de forma independente.
319. Como Usuário, quero que, mesmo numa Receita derivada, o Aviso de restrição seja recalculado sobre o estado atual da cópia, para a minha adaptação ter o aviso certo para o conteúdo que ela tem agora.

## Decisões de Implementação

Esta seção fixa COMO o Refogando se materializa. Tudo aqui honra os 13 ADRs e as decisões travadas; nada reabre o domínio.

### (a) Modelo de dados — entidades e relações

O coração é a **Receita** (Recipe), entidade ÚNICA e language-neutral. Ela carrega:
- `origin` — enum imutável de Proveniência (`catalog | ai_chat | ai_structured | user_edited`), sempre visível, dirige o selo de confiança;
- `visibility` — eixo SEPARADO da proveniência (`private | public`), privada por padrão, pública só quando o próprio usuário autoriza;
- `result_kind` — enum (`success | degraded | playful`) que MORA na Receita (ADR-0013), ortogonal a `origin` e a `visibility`;
- `owner_id` — NULLABLE: NULL para catálogo/sistema, preenchido para `ai_*` e `user_edited`. Quem controla a linha;
- `parent_recipe_id` — self-FK para a linhagem, mais `lineage_kind` (`regenerated | edited`) — uma única árvore para os dois casos;
- **restrições atendidas** — ARRAY de enum do Vocabulário culinário, com índice GIN para faceta. Sem junction.

A **Tradução de receita** (RecipeTranslation) é uma linha por `(receita, locale)`, com os campos que variam por locale (título, descrição, textos de passo, notas) mais flags de proveniência/confiança da tradução (escrita por pessoa | automática revisada | automática não revisada) e o estado `stale` (desatualizada). Identidade nunca bifurca por locale: a mesma Receita existe em todos os locales; a tradução só muda a língua de apresentação. O nome original é PRIMÁRIO; tradução localizada confiável aparece entre parênteses; tradução automática crua nunca vira nome oficial.

O estado `stale` (desatualizada) NUNCA mora na Receita. Ele vive (1) na linha de Tradução de receita, marcada quando o original muda, e (2) na coluna `stale` da tabela lateral `recipe_embedding`, por locale. O único estado nomeado de nível Receita é `result_kind`. Editar uma tradução marca o EMBEDDING daquele locale como stale e dispara o re-embedding daquela linha — não toca na identidade da Receita.

**Gatilho de tradução do segundo locale.** Para uma Receita gerada/criada num locale (ex.: o usuário conversa em pt-BR), a Tradução de receita do **locale de origem** nasce de primeira classe (escrita pela pessoa / saída direta da geração, não sinalizada). A Tradução do **segundo locale** (en-US) nasce como **tradução automática SINALIZADA** (automática, não revisada), **gerada sob demanda no primeiro acesso àquele locale** — não na criação. É esse ponto que escreve a flag de proveniência da tradução (auto, não-revisada) e alimenta o Embedding daquele locale (lacuna 7). Curador pode depois revisar e remover a sinalização.

O **Item de receita** (RecipeIngredient) é a ocorrência de um Ingrediente numa Receita: `quantidade` numérica + `unidade` + `nota` + `raw_text`, com FK OPCIONAL (best-effort) ao Ingrediente canônico. Quantidade e unidade são INVARIANTES — não traduzíveis. Item não-resolvido fica só com `raw_text`.

O **Ingrediente canônico** (Ingredient) é o insumo reutilizável language-neutral, de id estável, com nome/aliases traduzidos por locale e alérgeno OPCIONAL. É a base da busca por ingrediente cross-locale.

A **Sessão de criação** (CreationSession) é o agregado de um episódio de criação com a IA: `mode` (`conversation | structured`), `user_id` NOT NULL, transcript (no modo conversa), timestamps gravados desde já (para ligar TTL no futuro), e o registro de geração que guarda o **comentário consultivo** da IA. Aponta para a Receita por referência fraca (sessão → receita, NUNCA o contrário). Apagar o transcript NÃO apaga a Receita.

O **Briefing** de geração pertence à CreationSession (campos: porções, dificuldade, cozinha, restrições, observações), com **BriefingItem** que tem FK OPCIONAL ao Ingrediente canônico, `strength` (`required | preferred`) e `raw_text`. É o que foi PEDIDO, autoritativo sobre o obrigatório, distinto da Receita ENTREGUE.

A **recipe_embedding** é uma tabela LATERAL: `(recipe_id, locale, embedding vector, model, stale)`, 1:1 com cada linha de tradução. Mantém a linha de tradução leve e permite versionar o modelo do embedding.

O **Voto** (Vote) é entidade de primeira classe: `(user_id, recipe_id)` com **UNIQUE(user_id, recipe_id)** — é isso que torna o voto idempotente (um por receita; repetir não infla a Popularidade). Regra de **não-autovoto**: o `user_id` do voto nunca pode ser o `owner_id` da receita. Despublicar uma receita a tira do pool, mas **preserva os votos** já recebidos (republicar não perde o histórico). O **Favorito** (Favorite) é `(user_id, recipe_id)`, também único por par.

A **moderação** precisa de duas coisas no schema, distintas de `visibility`: um **Report** (quem reportou, motivo, receita alvo, estado) que alimenta a fila reativa do Curador; e um estado de **removida-do-pool-pelo-curador** separado de `visibility` — quando o Curador remove uma receita pública, o Owner continua dono da linha no privado (não é o mesmo que o Owner despublicar). Quem despublica é o Owner (toca `visibility`); quem remove do pool é o Curador (toca o estado de moderação). Ambos saem do pool, mas por caminhos diferentes e rastreáveis.

### (b) As 9 lacunas — resolvidas

1. **Linhagem unificada**: regeneração e derivada compartilham `parent_recipe_id` + `lineage_kind` (`regenerated | edited`). Uma única query de ancestralidade serve os dois. O diff só viaja quando `edited`.
2. **Sem estado "Sugestão"**: não existe entidade nem estado de candidato. Logado → a geração já persiste como Receita (`visibility=private`, `result_kind` da taxonomia). Anônimo → geração EFÊMERA, client-only, nunca toca o servidor. Só a versão CORRENTE é embedada; versões superadas ficam na linhagem mas não entram na busca.
3. **Comentário consultivo**: PERSISTIDO, mas FORA da Receita — no registro de geração dentro da CreationSession; exibido junto da receita; apagável com o transcript. O sinal durável (degradado) já mora na Receita via `result_kind`.
4. **Diff da derivada**: JSONB APRESENTACIONAL, congelado no fork. A derivada já guarda os RecipeIngredient estruturados completos (snapshot); o diff é só para exibir. Sem tabela de diff.
5. **Briefing**: pertence à CreationSession, com BriefingItem (FK opcional ao Ingrediente, `strength` `required | preferred`, `raw_text`). CHECK de banco: `mode=structured ⇒ briefing presente`.
6. **ON DELETE do parent_recipe_id**: o mesmo self-FK serve aos dois `lineage_kind`, mas o comportamento de delete precisa ser pensado para cada um. Para a DERIVADA (`lineage_kind=edited`), **ON DELETE SET NULL** é correto e seguro: a derivada guarda snapshot completo + diff congelado, então sobrevive sem a base — perde só o ponteiro (lacuna 4). Para a REGENERAÇÃO (`lineage_kind=regenerated`), a versão corrente NÃO guarda snapshot da versão anterior; apagar um nó interno da cadeia não pode comprometer dado da versão corrente. **Decisão congelada**: aceita-se que **SET NULL** também na regeneração — apagar um nó superado apenas **corta a ancestralidade naquele ponto** (a query de ancestralidade para ali), sem nenhuma perda de dado da versão corrente, que é autossuficiente. Versões superadas não são alvo de delete na UX do MVP; se um nó interno for removido, a consequência é só uma linhagem mais curta, nunca dado quebrado. Editar a PRÓPRIA receita (privada ou pública) é update in-place (você controla a linha); fork-para-derivada só para receita NÃO-própria. Editar a própria pública fica visível a quem favoritou — aceitável num app leve.
7. **Embedding**: tabela lateral `recipe_embedding(recipe_id, locale, embedding, model, stale)`, 1:1 com cada linha de tradução (honra ADR-0008). Locale SEM tradução: a camada precisa ancora via ingrediente canônico language-neutral + FTS; a semântica cai para o embedding de um locale disponível (modelo multilíngue torna o cosseno cross-locale útil).
8. **Restrições atendidas**: ARRAY de enum do Vocabulário culinário na Receita, com índice GIN para faceta — leve (ADR-0004). O mapa alérgeno→restrição (trigo/glúten ⇒ contradiz sem_glúten) é lookup ESTÁTICO em código; dispara só o Aviso amigável quando há dado de alérgeno canônico. Sem junction, sem subsistema de verificação.
9. **Zoeira on-device**: segue DEFERIDA / fora de escopo (ADR-0009). Se sair do deferido, fica fora do schema canônico, do i18n e da busca. O CHECK `result_kind=playful ⇒ privada` (ADR-0013) cobre o comportamento em escopo agora.

### (c) Invariantes de banco

Estas invariantes ficam no esquema, não só no código:
- **CHECK `result_kind=playful ⇒ visibility=private`**: Receita de zoeira nunca é publicável (ADR-0013).
- **CHECK `mode=structured ⇒ briefing presente`**: o modo estruturado sempre guarda seu Briefing.
- **ON DELETE SET NULL** no `parent_recipe_id`: a derivada (`edited`) mantém seu snapshot e perde só o ponteiro; a regeneração (`regenerated`) apenas tem a ancestralidade cortada no nó deletado, sem perda de dado da versão corrente (ver lacuna 6).
- **UNIQUE(user_id, recipe_id)** no Voto (idempotência) e no Favorito; regra de **não-autovoto** (`voter != owner`).
- **`origin` imutável**: a Proveniência é gravada uma vez e nunca muda (ADR-0002).

### (d) Contrato de geração

Existe UM schema canônico de Receita, derivado da mesma fonte (Zod/Drizzle), usado por structured outputs. Chat e estruturado COMPARTILHAM o mesmo schema de saída; muda só a entrada. As faixas numéricas (porções, dificuldade etc.) são validadas no app, não delegadas ao modelo. A taxonomia de resultado é:
- **SUCCESS** — válida e publicável;
- **DEGRADED** — não atendeu tudo, gera + comentário consultivo, publicável (qualidade é escolha do usuário);
- **PLAYFUL** — humor/zoeira, NÃO publicável, salvável no privado;
- **IMPOSSIBLE** — hard stop honesto, não gera receita;
- **INVALID** — falhou o schema mesmo após retry/repair; erro de sistema, nunca exibe lixo.

**Apenas `success | degraded | playful` persistem como Receita e são, portanto, os ÚNICOS valores de `result_kind` (ADR-0013).** `impossible` e `invalid` são desfechos de geração que NÃO produzem Receita e NÃO existem como estado de banco — nunca devem ser adicionados ao enum `result_kind`.

**Refusal e max_tokens caem em INVALID.** Se o modelo recusar (refusal) ou estourar `max_tokens` na chamada de destilação, isso é tratado como falha honesta (INVALID), erro de sistema — NUNCA como Receita parcial silenciosa. O app não exibe receita meia-feita; mostra erro claro e permite tentar de novo (ADR-0009).

No modo conversa, a IA STREAMA texto e DESTILA a receita numa chamada constrita ao fim. O comentário consultivo fica fora do objeto Receita. Modelo default `claude-opus-4-8` (qualidade); `claude-sonnet-4-6` como opção de custo.

**Versão do schema canônico.** O schema canônico é versionado. Mudar o schema é uma **migração de dados** das Receitas já persistidas — não uma quebra silenciosa. Ao retomar uma Sessão muito antiga cujo schema mudou, a Receita corrente continua válida ou é migrada com clareza. Escrever as rotinas de migração de schema para Receitas existentes fica **fora do escopo do MVP** (não há histórico de schema ainda); o que o MVP fixa é que o schema carrega versão desde já, para a migração futura não ser dolorosa.

### (e) Busca

Busca híbrida num só ranking: a camada PRECISA combina FTS por idioma (tsvector `portuguese`/`english` + `unaccent`, índice GIN), ingrediente canônico e facetas; a camada SEMÂNTICA usa pgvector (HNSW, distância de cosseno). Embeddings POR LOCALE, re-gerados quando a tradução muda. A Busca NUNCA cria — no máximo ranqueia/interpreta.

**Princípio de fusão (não fórmula).** Um casamento exato de nome ou ingrediente NUNCA pode ser superado por um resultado só-semântico: a camada precisa garante um piso de relevância, e a semântica desempata e expande o conjunto. A busca nunca é puramente vetorial (ADR-0008).

**Seccionamento antes do ranking.** A separação catálogo (origin=catalog) vs comunidade (públicas dos usuários) é aplicada ANTES e independente do ranking: cada seção é rankeada por relevância híbrida dentro de si. NÃO é um corte cosmético de um pool misturado — nunca há um ranking cego juntando as duas fontes (ADR-0003/0008). A ordenação por Popularidade vale só dentro da seção Comunidade; o Catálogo é editorial.

### (f) Auth e papéis

Três eixos distintos: **Owner** (controla a linha, `owner_id` NULLABLE), **Autoria** (quem é creditado na exibição) e **Proveniência** (`origin`, como surgiu).

**Materialização da Autoria.** Para conteúdo de usuário (`ai_*`, `user_edited`), a Autoria é **derivada do `owner_id`** — o autor é o owner. Para o catálogo (`origin=catalog`, `owner_id` NULL), a Autoria é um **campo de atribuição editorial separado** (texto/crédito), já que não há owner. Assim o terceiro eixo tem representação concreta no modelo e a Autoria sobrevive a ações futuras na linha.

Papéis: Visitante, Usuário, Curador, Admin. O **Visitante** (anônimo) busca, cria com IA EFÊMERA (não persistida no servidor) e compartilha por EXPORTAR/COPIAR texto (não link). Salvar, publicar, votar e favoritar exigem conta. `CreationSession.user_id` é NOT NULL — sessões persistidas só existem com conta. Moderação é REATIVA (via Report + ação do Curador), nunca gate de publicação.

### (g) Stack

Next.js na última versão estável (App Router), com route handlers para o streaming token-a-token da geração em conversa. Drizzle ORM (SQL-first) como camada de acesso. Postgres como datastore único (relacional + FTS + pgvector), com **provider neutro** — não cravamos um fornecedor específico. Para testes, a integração roda pela seam mais alta (route handlers / server actions) contra um Postgres REAL descartável (local ou branch efêmera), exercitando FTS/unaccent/pgvector de verdade; o cliente do Claude fica atrás de UMA interface mockável, tornando determinísticos a validação do schema canônico e a taxonomia de resultado. REGRA geral: usar sempre a última versão estável de toda dependência, sem pinar major velha.

## Decisões de Teste

Esta seção fixa COMO o Refogando é testado. O repositório é greenfield — não há código ainda. Logo, este PRD **estabelece o padrão**; ele não descreve algo que já existe. Tudo abaixo é o contrato que o desenvolvimento deve seguir desde a primeira issue.

### O que é um bom teste

Um bom teste verifica **comportamento externo**, não detalhe de implementação. Ele descreve o que o sistema faz pelo usuário, não como o código está organizado por dentro.

- Testa pela porta de entrada e olha a saída observável: status, corpo da resposta, o que ficou no banco, o que a busca retorna.
- Não conhece nomes de funções internas, ordem de chamadas privadas, nem a forma de objetos que nunca saem do servidor.
- Sobrevive a refatoração: se a regra de negócio não muda, o teste não muda. Se o teste quebra só porque você renomeou um helper, o teste estava errado.
- Tem uma asserção clara e um motivo claro para existir. Nada de teste que repete a implementação linha a linha.

A pergunta-guia é sempre: "se eu reescrevesse o módulo por dentro mantendo o mesmo comportamento, este teste continuaria passando?". Se não, ele testa detalhe de implementação.

### A seam travada

Os testes de integração entram pela **porta mais alta**: os route handlers e server actions do Next.js. É por ali que o usuário (ou o cliente) realmente fala com o sistema, então é ali que o comportamento de verdade aparece.

**Banco de dados real e descartável.** Os testes rodam contra um Postgres **de verdade** (local ou branch efêmera), nunca contra um banco fingido. Isso não é capricho: a busca híbrida depende de FTS por idioma (config `portuguese`/`english`), de `unaccent` e de `pgvector`. Esses comportamentos só existem no Postgres real. Mock de banco esconderia exatamente os bugs que mais importam aqui. Cada execução parte de um banco limpo e o descarta no fim. O **provider de banco fica neutro** — os testes não cravam Neon nem nenhum fornecedor específico; o que vale é "Postgres real e descartável".

**O cliente do Claude fica atrás de UMA interface mockável.** Toda chamada ao Claude passa por uma única interface (um seam). Nos testes, essa interface é trocada por um dublê. Isso torna determinístico o que mais precisa ser: a **validação do schema canônico** (structured output válido/inválido) e a **taxonomia de resultado** (`success` | `degraded` | `playful` | `impossible` | `invalid`). O dublê devolve uma saída controlada; o teste afirma que o app valida o schema, classifica o resultado e persiste a Receita com o `result_kind` correto — sempre igual, sem depender de rede nem de modelo. Lembrando que só `success | degraded | playful` viram Receita com `result_kind`; `impossible` e `invalid` não produzem Receita.

Resumindo a divisão: **banco real** (porque FTS/unaccent/pgvector têm que ser exercitados pra valer) + **Claude mockado por trás de uma interface** (porque a geração precisa de asserções determinísticas).

### Módulos a testar

Cada item abaixo é um módulo com comportamento próprio que precisa de cobertura de integração pela seam alta:

- **Busca híbrida e seu seccionamento.** Que a camada precisa (FTS por idioma + `unaccent` + ingrediente canônico + facetas) e a camada semântica (pgvector) entram num só ranking; que um match exato de nome/ingrediente nunca é superado por resultado só-semântico (piso da camada precisa); que `unaccent` faz "açúcar" achar "acucar"; que a busca por ingrediente canônico funciona cross-locale e **degrada pra FTS** quando o item só tem `raw_text`; e — inegociável — que os resultados saem **seccionados por origem** (catálogo vs comunidade), cada seção rankeada por relevância híbrida, nunca num ranking cego misturando os dois (ADR-0003, ADR-0008).
- **Contrato e taxonomia de geração.** Que chat e estruturado compartilham o mesmo schema canônico de saída; que faixas numéricas são validadas no app; que cada classe da taxonomia leva ao efeito certo: `success`/`degraded` persistem Receita publicável, `playful` persiste salvável só no privado, `impossible` é hard stop honesto sem gerar Receita, `invalid` nunca exibe lixo (falhou schema mesmo após retry/repair = erro de sistema); que **refusal e max_tokens na destilação caem em `invalid`** (erro honesto, nenhuma Receita parcial); e que só `success | degraded | playful` existem como `result_kind` no banco — `impossible`/`invalid` nunca viram estado persistido (ADR-0009, ADR-0013).
- **Linhagem: derivada + diff.** Que editar Receita **não-própria** cria **Receita derivada** (`origin=user_edited`, `lineage_kind=edited`) com snapshot completo dos RecipeIngredient e diff apresentacional congelado no fork; que a base **nunca é mutada**; que editar a **própria** (privada ou pública) é update in-place; que regeneração usa `lineage_kind=regenerated` **sem** diff; que `parent_recipe_id` com `ON DELETE SET NULL` preserva o snapshot da derivada e perde só o ponteiro, e que apagar um nó de regeneração apenas corta a ancestralidade sem quebrar a versão corrente (ADR-0005, lacunas 1/4/6).
- **Briefing + CHECK.** Que o Briefing de geração mora na CreationSession; que o BriefingItem carrega FK opcional ao Ingrediente canônico, `strength` (`required`|`preferred`) e `raw_text`; que o **CHECK de banco** rejeita `mode=structured` sem briefing presente (lacuna 5).
- **i18n / tradução + stale.** Que a identidade da Receita é única e language-neutral, nunca bifurcada por locale; que quantidade e unidade do Item de receita são invariantes (não traduzíveis); que a tradução do segundo locale nasce **automática e SINALIZADA** sob demanda no primeiro acesso àquele locale; que o nome original é primário e a tradução confiável vai entre parênteses; que editar a tradução marca a Tradução de receita daquele locale e o seu Embedding como `stale` e dispara re-embedding — e que isso **não** marca a Receita como stale (a Receita só tem `result_kind`); que mudar só um campo invariante NÃO marca as traduções como desatualizadas (ADR-0001, ADR-0008, lacuna 7).
- **Publicação + invariante playful ⇒ privada.** Que a Receita nasce privada por padrão; que o próprio usuário publica sem curadoria (self-publish) e cai no pool da comunidade ordenado por votos; que o **CHECK de banco** garante `result_kind=playful ⇒ visibility=private` — tentar publicar uma zoeira é rejeitado no banco, não só na aplicação (ADR-0003, ADR-0013).
- **Voto e Favorito.** Que o voto é idempotente via **UNIQUE(user_id, recipe_id)** (repetir não infla a Popularidade); que **não dá pra votar na própria receita** (regra não-autovoto); que dá pra desfazer voto e favorito; e que despublicar **preserva os votos** já recebidos (us-publicacao).
- **Moderação reativa.** Que existe um **Report** (quem, motivo, alvo) que alimenta a fila do Curador; que o Curador remove uma receita pública do pool registrando o motivo, sem que isso seja gate de publicação; e que **remover do pool** (ação do Curador) é estado distinto de **despublicar** (ação do Owner) — o Owner continua dono da linha no privado.
- **Aviso de restrição por contradição óbvia.** Que o Aviso é **leve e honesto** ("declarado, não verificado"); que o lookup estático alérgeno→restrição (ex.: trigo/glúten contra `sem_glúten`) dispara só um Aviso amigável quando há dado de alérgeno canônico; que ele **não dispara** quando o item só tem `raw_text` (sem canônico); e — crucial — que ele **NÃO bloqueia, NÃO suprime, NÃO trava** a operação. O teste afirma que a Receita é salva/exibida mesmo com a contradição, com o Aviso anexado (ADR-0004, lacuna 8).
- **Acesso anônimo efêmero.** Que o Visitante busca e gera com IA **efêmera** (a geração **nunca toca o servidor**); que não existe estado "Sugestão" persistido pra ele; que salvar, publicar, votar e favoritar **exigem conta** e são recusados ao anônimo (ADR-0011, lacuna 2).

### O padrão a seguir (repo greenfield)

Como não há código anterior, o padrão é definido aqui e vale daqui pra frente:

1. **Toda issue de feature entrega teste de integração pela seam alta.** A unidade de confiança é o teste que entra pelo route handler / server action e checa o efeito observável (resposta + estado do banco).
2. **Postgres real e descartável em todo teste de integração.** Sem mock de banco. As extensões (`unaccent`, `pgvector`) e as configs de FTS (`portuguese`/`english`) fazem parte do setup do banco de teste.
3. **Uma só interface pro Claude, sempre mockada nos testes.** Nenhum teste fala com o modelo de verdade. As asserções sobre schema canônico e taxonomia de resultado são determinísticas.
4. **Banco neutro.** O alvo de teste é "Postgres real", não um fornecedor. Nada nos testes amarra o projeto a um provider específico.
5. **Testes de unidade só onde há lógica pura que vale isolar** — por exemplo, o lookup estático alérgeno→restrição e a validação de faixas numéricas. Para tudo que toca banco ou geração, a seam de integração é a régua.

## Fora de Escopo

Itens abaixo ficam **fora** deste PRD — cada um com o motivo curto. Não construir agora.

- **Reputação e shadow-ban.** ADR-0007 está parado. Nenhuma tabela de reputação é criada agora. Voto/Popularidade só ordena receitas públicas e alimenta descoberta; não vira autoridade nem reputação de usuário.
- **Verificação dura de restrição alimentar.** ADR-0004: o que existe é **Aviso de restrição** ("declarado, não verificado"), leve e honesto. Nada de selo verificado, nada de gating, nada de suprimir ou travar publicação. Contradição óbvia só dispara o Aviso amigável. Responsabilidade final é do usuário.
- **TTL e retenção de transcript; política LGPD.** ADR-0006: deferido de forma explícita. Os **timestamps já são gravados** desde já, pra ligar TTL no futuro sem migração dolorosa — mas a regra de retenção em si fica fora deste escopo.
- **Migração de schema canônico de Receitas existentes.** As rotinas de migração de dados quando o schema canônico muda ficam fora do MVP (não há histórico de schema ainda). O schema já carrega versão desde já, pra a migração futura não ser dolorosa — mas escrevê-la não é escopo agora.
- **Zoeira on-device / SQLite (geração lúdica no aparelho).** ADR-0009: deferida. Se um dia sair do deferido, fica **fora do schema canônico, do i18n e da busca**. Por agora, o comportamento em escopo é coberto pelo CHECK `result_kind=playful ⇒ visibility privada` (ADR-0013).
- **Curadoria obrigatória pra publicar.** A regra é **self-publish** (ADR-0003): o próprio usuário autoriza, a receita entra no pool da comunidade sem revisão prévia. Curadoria existe só pro **catálogo** editorial (origin=catalog), que é separado. Moderação é reativa, não porta de entrada.

## Notas

- **Infra (Vercel / Neon) é assunção, não decisão.** O deploy em Vercel e o Postgres na Neon são uma **assunção de trabalho não-ratificada** — não cravar em ADR ainda. O **provider de banco fica neutro**: o que o PRD exige é um Postgres com FTS por idioma (config portuguese/english + unaccent), pgvector e branches/bancos descartáveis pros testes de integração; qualquer provider que entregue isso serve.
- **Testes de integração contra Postgres real.** A seam de teste mais alta (route handlers / server actions) roda contra um **Postgres de verdade, descartável** (local ou branch efêmera), pra exercitar FTS, unaccent e pgvector como em produção. O cliente do Claude fica atrás de **uma interface mockável**, pra testar de forma determinística a validação do schema canônico e a taxonomia de resultado.
- **Modelo de embedding e dimensões ficam pra implementação.** A escolha do modelo de embedding (multilíngue, pra o cosseno ser útil cross-locale) e o número de dimensões são **detalhe de implementação**, não decisão deste PRD. A tabela lateral `recipe_embedding` já carrega a coluna `model` justamente pra versionar isso: **trocar de modelo = re-embedar** as linhas afetadas (e marcar `stale`).
- **Vocabulário culinário compartilhado.** O kernel de enums (cozinha, dificuldade, restrição, porções) é o **mesmo** na Busca (como filtro) e na criação estruturada (como constraint) — mesma taxonomia, semântica oposta. Manter uma única fonte de verdade pra esses enums.
