/**
 * Catálogo de chrome em pt-BR (issue #4). `Messages = typeof ptBR` ancora o shape;
 * o en-US DEVE ter exatamente as mesmas chaves (teste de paridade T3 garante).
 */
import type { Categoria, Restricao, Unidade } from '@/domain/vocabulary'
import type { NivelChef } from '@/domain/briefing'

export const ptBR = {
  app: { name: 'Refogando', tagline: 'Cozinhe qualquer ideia' },
  // #451: sufixo do aria-label dos links de rede social do rodapé (só o sufixo é traduzido; o nome
  // de marca da rede, não). NUNCA rotular o app como "bilíngue" em texto ao usuário (regra do dono).
  footer: { abreEmNovaAba: 'abre em nova aba' },
  nav: {
    // #277: a Descoberta/home virou "Explorar" na nav (aba ao lado de "Seguindo"). O key segue
    // `home` (linka a `/`, e not-found reusa este valor de "voltar pra home"); só o RÓTULO mudou.
    home: 'Explorar',
    // #277: aba "Seguindo" — feed das Receitas de quem o viewer segue. Só-logada (gateada por authed).
    seguindo: 'Seguindo',
    // #236: a antiga entrada "Receitas" (índice do feed) fundiu na home (a Descoberta É a home);
    // a chave foi removida por ficar órfã.
    create: 'Criar',
    // "Painel" (#125): entrada para o Console de admin, só aparece a curador+. Curto e neutro
    // — não revela "admin" a quem não acessa.
    painel: 'Painel',
    signIn: 'Entrar',
    signOut: 'Sair',
    // Menu da conta (#267): itens do dropdown do avatar. "Painel" (curador+) e "Sair" também
    // moram nesse menu, reusando `painel`/`signOut` acima (não duplicar).
    verPerfilPublico: 'Ver meu perfil público',
    editarPerfil: 'Editar perfil',
    // Menu mobile (#163): rótulos acessíveis do gatilho hambúrguer e do título do painel
    // (drawer). Só aparecem abaixo de `sm:`; no desktop a nav completa segue inline.
    abrirMenu: 'Abrir menu',
    fecharMenu: 'Fechar menu',
    menu: 'Menu',
    menuDescricao: 'Navegação do site e conta',
    // #461 (a11y): skip-link (1º tab stop, oculto até focar) que pula o header repetido e leva ao
    // conteúdo principal (`#conteudo`, o wrapper do `<main>` de cada página).
    pularParaConteudo: 'Pular para o conteúdo',
  },
  // Caixa de notificações (#371, ADR-0028): sininho na chrome (só-logado) + painel. O texto de cada
  // evento é um TEMPLATE localizado (dado estruturado na linha, frase montada na renderização) —
  // `renderNotification` escolhe a chave por tipo e interpola `{name}` por `String.replace`. Chaves
  // FLAT (a seção é folha-de-string): o tipo `Messages` deriva só 2 níveis, então nada de sub-objeto.
  notifications: {
    ariaLabel: 'Notificações',
    // #461 (a11y): quando há não-lidas, o rótulo do sino ANUNCIA a contagem (o badge é só visual —
    // `aria-hidden`). `{n}` interpolado na renderização; singular/plural como os demais contadores.
    ariaLabelUmaNaoLida: 'Notificações (1 não lida)',
    ariaLabelNaoLidas: 'Notificações ({n} não lidas)',
    tituloPainel: 'Notificações',
    vazio: 'Nenhuma notificação',
    // Evento `new_follower` — {name} = nome do ator (interpolado na renderização).
    novoSeguidor: '{name} começou a seguir você',
    // Ator soft-deletado (nome degradado a null) — variante sem nome, a notificação NÃO some.
    novoSeguidorAnon: 'Alguém começou a seguir você',
    // Eventos N2 de curadoria/moderação (#373, ADR-0028): ações impessoais (Curador/sistema),
    // SEM interpolação de ator e SEM o motivo livre embutido (surfacing do motivo é refino deferido).
    sugestaoCozinhaResolvida: 'Sua sugestão de cozinha foi analisada',
    receitaModerada: 'Uma receita sua foi removida da descoberta por um moderador',
    imagemModerada: 'Uma imagem sua foi moderada',
    contaRestringida: 'Sua conta foi restringida (geração de imagem bloqueada)',
    // Eventos N3 de avaliação (#374, ADR-0028): {name} = nome do avaliador (só no com-ator);
    // {stars} = a nota renderizada (ex.: "4★", `renderStars` no domínio, DADO VIVO via join).
    avaliacaoNaReceita: '{name} avaliou sua receita ({stars})',
    // Avaliador soft-deletado (nome degradado a null) — variante sem nome, a notificação NÃO some.
    avaliacaoNaReceitaAnon: 'Sua receita recebeu uma avaliação ({stars})',
    // Sua avaliação foi removida pelo Curador — impessoal (sem ator), mostra as estrelas da nota.
    avaliacaoModerada: 'Sua avaliação ({stars}) foi removida por um moderador',
    // Fallback dos tipos ainda não ligados nesta fatia (tracer bullet).
    generico: 'Você tem uma nova notificação',
  },
  locale: { label: 'Idioma', ptBR: 'Português (Brasil)', enUS: 'Inglês (EUA)' },
  // Toggle de tema claro/escuro (ADR-0018), no header. `light`/`dark` nomeiam o DESTINO da
  // ação (a11y): o aria-label muda conforme o tema atual ("Mudar para o tema claro/escuro").
  theme: {
    light: 'Mudar para o tema claro',
    dark: 'Mudar para o tema escuro',
  },
  system: {
    loading: 'Carregando…',
    error: 'Algo deu errado.',
    notFound: 'Não encontrado.',
    retry: 'Tentar de novo',
  },
  // Aviso de restrição (#7): template interpolado por `String.replace` ({restricao}/{alergeno}),
  // sem ICU. `mensagem` nasce na vista, renderizada no requestLocale.
  aviso: {
    contradicao: 'Marcada como {restricao}, mas contém {alergeno} — declarado, não verificado.',
  },
  // Ciclo de vida da tradução (#23, AC3): aviso leve de tradução obsoleta + rótulo
  // "ver o original". Renderizados na vista (recipe-read.ts) no requestLocale — só
  // quando a tradução pedida é stale E difere da origem (a origem nunca é sinalizada).
  traducao: {
    staleAviso: 'Esta tradução pode estar desatualizada em relação ao original.',
    verOriginal: 'Ver o original',
  },
  // Rótulo amigável por valor do enum RESTRICOES (#7). Adjetivos no feminino concordam com
  // o sujeito "Receita" do template. `satisfies Record<Restricao, string>` trava drift do enum
  // (chave faltante/extra/typo) no site de definição.
  restricaoLabel: {
    sem_gluten: 'sem glúten',
    sem_lactose: 'sem lactose',
    vegano: 'vegana',
    vegetariano: 'vegetariana',
    sem_acucar: 'sem açúcar',
    low_carb: 'low carb',
    sem_oleaginosas: 'sem oleaginosas',
    sem_frutos_do_mar: 'sem frutos do mar',
  } satisfies Record<Restricao, string>,
  // Nível de habilidade (#421, ADR-0029 dec.2): rótulo compartilhado entre o wizard de geração e o
  // Perfil (fonte única dos 3 nomes). PARA QUEM a receita é escrita — distinto da Dificuldade do prato.
  nivelChefLabel: {
    iniciante: 'Iniciante',
    intermediario: 'Intermediário',
    avancado: 'Avançado',
  } satisfies Record<NivelChef, string>,
  // Tela de Busca (#56): título, campo, estados (inicial/vazio), seções e selos de
  // proveniência por item. Os rótulos de SELO ("Do catálogo"/"Da comunidade") são
  // distintos dos de SEÇÃO ("Catálogo"/"Comunidade") de propósito — desambigua heading
  // de etiqueta de item e lê melhor.
  busca: {
    // #5 (Direção C): a Busca É a home-Descoberta (ADR-0020). O `titulo` é a IDENTIDADE da página —
    // serve de `<h1>` (sr-only, o mock não tem título visível) E de `<title>` de SEO (generateMetadata).
    // Por isso "Descobrir receitas" (não "Buscar receitas", que descrevia só a caixa). O rótulo do INPUT
    // mudou-se pra `buscarLabel` (o propósito do campo), pra o `<h1>`/SEO e o label do input divergirem.
    titulo: 'Descobrir receitas',
    // #5: rótulo sr-only do <input> de busca (o propósito do campo, separado do <h1>/título de SEO).
    buscarLabel: 'Buscar receitas',
    placeholder: 'Buscar pratos, ingredientes, estilos…',
    buscar: 'Buscar',
    // #5: rótulo sr-only do botão × que limpa o termo (a pílula esconde o × nativo do <input type=search>).
    limparBusca: 'Limpar busca',
    // #5: prefixo do eco "Resultados para «termo»" na barra de ferramentas (o termo entra num <strong>
    // com aspas curvas no componente — não interpolado na string).
    resultadosPara: 'Resultados para',
    dicaInicial: 'Comece digitando um prato, ingrediente ou estilo que você curte — ou use os filtros.',
    // #116: usuário LOGADO busca também nas PRÓPRIAS receitas (privadas inclusive).
    dicaInicialLogado: 'Comece digitando um prato, ingrediente ou estilo — buscamos nas suas receitas e nas da comunidade.',
    // #5 (Direção C): o estado VAZIO honesto. `vazioKicker` (rótulo em caixa-alta) + `vazioTitulo`
    // (manchete serifada) emolduram o `semResultado` (corpo). `semResultado` foi REPROPOSTO p/ a copy
    // do mock ("a Busca não cria") — segue sendo o texto-âncora do vazio (referenciado pelos testes).
    vazioKicker: 'Sem resultados',
    vazioTitulo: 'Nada por aqui — nem no catálogo, nem na comunidade.',
    semResultado: 'A busca não cria receitas. Mas dá pra seguir por outro caminho:',
    // #116/own-label: seção das PRÓPRIAS Receitas do viewer (logado), mostrada PRIMEIRO. Selo
    // "Sua receita" no item próprio (busca e feed), no lugar de "Da comunidade".
    secaoMinhas: 'Minhas',
    seloMinha: 'Sua receita',
    secaoCatalogo: 'Catálogo',
    secaoComunidade: 'Comunidade',
    seloCatalogo: 'Do catálogo',
    seloComunidade: 'Da comunidade',
    traducaoAutomatica: 'tradução automática',
    talvezQueira: 'Talvez você queira',
    consultaLabel: 'Você está buscando:',
    filtroCozinha: 'Cozinha',
    filtroCategoria: 'Categoria',
    filtroRestricao: 'Restrição',
    // #5 (Direção C): rótulo do gatilho "Filtros" (mobile) que recolhe a trilha de facetas. No DESKTOP
    // a trilha é permanente (à esquerda); no MOBILE vira este botão (disclosure). `filtrosContagem`
    // mostra o nº de facetas ativas (soma de cozinha+categoria+restrição); {count} é interpolado via
    // `.replace` (folhas do tipo são string).
    filtros: 'Filtros',
    filtrosContagem: 'Filtros · {count}',
    // Autoria (#129): crédito "por <nome>" no item de receita do pool, linkando /u/<handle>.
    // {name} interpolado no componente via `.replace` (folhas do tipo são string).
    porAutor: 'por {name}',
    // Selo "gerada por IA" (#132, ADR-0017) — sobre imagens ai_generated no card e no detalhe.
    // O protótipo do Claude Design usa o ✨ neste selo (RefoStage "Minhas criações"/Busca).
    imagemSeloIa: '✨ gerada por IA',
    // #5 (ADR-0019 emenda): "Gerar com IA" REBAIXADO do CTA permanente para o ESTADO VAZIO (cartão de
    // saída). NÃO auto-dispara (a Busca nunca cria): leva a /create?q=<termo> pré-preenchendo o texto
    // livre. Visitante vê o convite de entrar (reusa `minhasCriacoes.convidaEntrar*`). A entrada SEMPRE
    // disponível pra criar é o "Criar" do header global. `vazioGerarTitulo`/`vazioGerarTexto` = o cartão.
    gerarComIa: 'Gerar com IA',
    vazioGerarTitulo: 'Gerar receita com IA',
    vazioGerarTexto: 'Criamos uma receita a partir da sua busca.',
    // #5 (protótipo final): 2º cartão do estado VAZIO — "Buscar na web" (gatilho MANUAL). O mock final
    // mostra ESTE cartão no vazio (não a "Da web" automática — o auto-gate #164 só acende no raso-não-
    // vazio). O rótulo do botão reusa `buscar`="Buscar".
    vazioWebTitulo: 'Buscar na web',
    vazioWebTexto: 'Procurar essa receita em outros sites.',
    // #164: seção SEPARADA de links da web (ADR-0019) — só aparece quando o nosso acervo veio RASO.
    // São LINKS externos, marcados "da web", NÃO armazenados nem ranqueados (a Busca só encontra).
    secaoDaWeb: 'Da web',
    daWebDescricao: 'Não achamos isso no nosso acervo ainda. Estes são links externos — abrem no site de origem.',
    // #275: 2º gatilho EXPLÍCITO "buscar na web" ao FIM dos resultados — acende a web por AÇÃO do
    // usuário MESMO com acervo suficiente ("rolei até o fim e nada serviu"). Coexiste com o automático
    // (#164). Reusa a MESMA /api/discovery/web; degrada gracioso (aviso neutro, nunca erro vermelho).
    webManualCta: 'Não achou? Buscar na web',
    webManualBuscando: 'Buscando…',
    webManualNada: 'Nada encontrado na web agora.',
    // Selo de proveniência da receita IMPORTADA da web (#169, ADR-0019) — distinto de Catálogo/
    // Comunidade. Aparece no detalhe da importada (que é privada e creditada à fonte).
    seloImportada: 'Importada da web',
    // #169: modal de importação na Busca. Clicar num resultado "da web" abre uma confirmação de que
    // a receita será COPIADA pro perfil privado do usuário (atribuída à fonte, nunca republicada).
    // {fonte} interpolado no componente via `.replace`. Visitante vê o convite de entrar.
    importarTitulo: 'Importar esta receita',
    importarTexto: 'Vamos copiar esta receita para o seu perfil privado, com o crédito à fonte ({fonte}). Ela fica só sua — importar não é republicar.',
    importarConfirmar: 'Importar para o meu perfil',
    importarVerNoSite: 'Ver no site',
    importarCancelar: 'Cancelar',
    importarImportando: 'Importando…',
    // Erros do import (mapeados das respostas da rota /api/recipes/import).
    importarErroNaoImportavel: 'Não foi possível importar esta receita: o site não publica os dados estruturados de que precisamos.',
    // #272: o robots.txt do site proíbe a busca automática — a saída é "Ver no site".
    importarErroRobotsBloqueado: 'Este site não permite a importação automática das suas receitas. Você ainda pode abri-la no site de origem.',
    // #272: rate-limit por domínio — muitas importações do mesmo site em sequência.
    importarErroLimite: 'Muitas importações desse site agora há pouco. Espere um instante e tente de novo.',
    importarErroGenerico: 'Não foi possível importar agora. Tente de novo ou abra no site de origem.',
    // Visitante: gerar/importar exige conta — reusa o convite de entrar.
    importarConviteTitulo: 'Entre para importar',
    importarConviteTexto: 'Crie uma conta ou entre para importar receitas da web para o seu perfil.',
  },
  // Feed da Descoberta-home (#103/#236): lista plana e cronológica do pool, scroll infinito, em
  // REPOUSO sob `/{locale}`. Reusa `busca.*` (título da home, selos, tradução automática); só os
  // textos próprios do feed vivem aqui. O `titulo`/`subtituloLogado` saíram com a fusão (#236): o
  // `<h1>` é o da Busca e o feed de repouso é sempre o pool PÚBLICO anônimo (sem cópia "suas receitas").
  feed: {
    // #5 (Direção C): manchete serifada VISÍVEL do feed de repouso — dá à home INDEXÁVEL um heading real
    // (o `<h1>` é sr-only). Honesta com a ordenação (recência): o pool público, do mais novo ao mais antigo.
    titulo: 'Receitas da comunidade',
    subtitulo: 'O que a comunidade anda cozinhando, do mais novo ao mais antigo.',
    vazio: 'Ainda não há receitas por aqui.',
    carregarMais: 'Carregar mais',
    fim: 'Você chegou ao fim.',
  },
  // #457: slot editorial "Receita da semana" — acima do feed de repouso na home. Escolhida pelo
  // Curador ou, na ausência de escolha, pela mais popular do catálogo aprovado (fallback mecânico).
  // O item em si reusa `RecipeResultItem` (mesmo card do feed) + `busca.selo*`/`porAutor`/etc.
  receitaDaSemana: {
    titulo: 'Receita da semana',
    subtitulo: 'Um destaque do catálogo, escolhido pela curadoria.',
  },
  // Feed SEGUINDO (#277, ADR-0024) — superfície SÓ-LOGADA e NÃO-indexável (separada da home anon,
  // Modelo B). Reusa `feed.carregarMais`/`feed.fim` e `system.loading`/`system.error` na paginação.
  // O empty state é cause-NEUTRO (dispara em "não segue ninguém" E "seguidos sem receita pública"):
  // a copy é verdadeira nos dois casos e faz a ponte pra descoberta (AC4).
  seguindoFeed: {
    titulo: 'Seguindo',
    subtitulo: 'Receitas de quem você segue, do mais novo ao mais antigo.',
    precisaEntrar: 'Entre para ver as receitas de quem você segue.',
    vazioTitulo: 'Nada por aqui ainda',
    vazioCorpo: 'Siga cozinheiros para ver as receitas deles no seu feed.',
    // CTA leva à Descoberta (`/`), onde vive o trilho de Cozinheiros recomendados (#278).
    vazioCta: 'Descobrir cozinheiros',
  },
  // Trilho "Cozinheiros em alta" (#278, ADR-0024 emendado) — recomendados por popularidade global na home,
  // como coluna à direita em telas largas, cada cartão com 1–3 receitas do cozinheiro.
  cozinheirosSugeridos: {
    titulo: 'Cozinheiros em alta',
    receitaContagem: '{n} receita',
    receitasContagem: '{n} receitas',
    seguir: 'Seguir',
    seguindo: 'Seguindo',
    erroSeguir: 'Não deu pra atualizar. Tente de novo.',
    // #308: link no fim do trilho → Descoberta de Cozinheiros dedicada.
    verMais: 'Ver mais',
  },
  // Descoberta de Cozinheiros dedicada (#308, `/cooks`) — busca + filtro de cozinha + lista paginada.
  descobrirCozinheiros: {
    titulo: 'Descobrir cozinheiros',
    subtitulo: 'Encontre cozinheiros para seguir.',
    buscarLabel: 'Buscar cozinheiros',
    buscarPlaceholder: 'Nome ou @handle',
    cozinhaLabel: 'Cozinha',
    vazioBusca: 'Nenhum cozinheiro encontrado.',
    vazioLista: 'Ainda não há cozinheiros para mostrar.',
    carregando: 'Carregando…',
  },
  // Cluster de Cozinheiros na Busca mesclada (#279, ADR-0024) — flutua acima das receitas por força-de-match.
  buscaCozinheiros: {
    titulo: 'Cozinheiros',
    verTodos: 'Ver todos',
    verMenos: 'Ver menos',
  },
  // Receita DERIVADA (#17): rótulos do diff congelado (recipe-diff.ts) + o Aviso de que editar
  // uma receita que não é sua CRIA UMA CÓPIA (fork), nunca altera a base. Os rótulos são
  // chrome da UI #61 (render dos arrays/campos do `derivedDiff`); o Aviso é o sinal pós-fork.
  derivada: {
    adicionado: 'Adicionado',
    removido: 'Removido',
    quantidadeAlterada: 'Quantidade alterada',
    restricaoAlterada: 'Restrição alterada',
    copiaTitulo: 'Criando uma cópia',
    copiaAviso: 'Você está editando uma receita que não é sua — vamos criar uma cópia sua.',
  },
  // #317 (ADR-0025): `cozinhaLabel` saiu do i18n — os rótulos de cozinha agora vêm da tabela
  // `vocabulary_term` (leitor #315), resolvidos por `domain/cozinha-label.ts`. O enum estático
  // virou dado curado.
  // Rótulo amigável por valor do enum CATEGORIAS (#56).
  categoriaLabel: {
    entrada: 'Entrada',
    prato_principal: 'Prato principal',
    sobremesa: 'Sobremesa',
    bebida: 'Bebida',
    molho: 'Molho',
    acompanhamento: 'Acompanhamento',
    lanche: 'Lanche',
    cafe_da_manha: 'Café da manhã',
  } satisfies Record<Categoria, string>,
  // Rótulo amigável por valor do enum UNIDADES (#57). Os valores do enum são tokens
  // machine-readable (snake_case); este mapa os converte em texto legível na linha do
  // ingrediente. `satisfies Record<Unidade, string>` trava drift do enum.
  unidadeLabel: {
    g: 'g',
    kg: 'kg',
    ml: 'ml',
    l: 'l',
    colher_de_sopa: 'colher de sopa',
    colher_de_cha: 'colher de chá',
    xicara: 'xícara',
    unidade: 'unidade',
    dente: 'dente',
    fatia: 'fatia',
    pitada: 'pitada',
    a_gosto: 'a gosto',
    q_b: 'q.b.',
  } satisfies Record<Unidade, string>,
  // Rótulo PLURAL por unidade (ADR-0012 Adendo 2): a exibição flexiona a UNIDADE pela quantidade
  // (qty ≠ 1 → plural; fração < 1 → singular) — "3 dentes de alho", "2 colheres de sopa de azeite".
  // Conjunto FECHADO e REGULAR (colher→colheres, dente→dentes, xícara→xícaras, fatia→fatias,
  // pitada→pitadas); `g/kg/ml/l` invariáveis. O NOME do ingrediente NUNCA é flexionado (plurais
  // especiais do pt-BR moram lá). `unidade`/`a_gosto`/`q_b` nunca são lidos pelo caminho plural
  // (contável larga a palavra; a_gosto/q.b. são sufixo) — presentes só para satisfazer o Record.
  unidadeLabelPlural: {
    g: 'g',
    kg: 'kg',
    ml: 'ml',
    l: 'l',
    colher_de_sopa: 'colheres de sopa',
    colher_de_cha: 'colheres de chá',
    xicara: 'xícaras',
    unidade: 'unidades',
    dente: 'dentes',
    fatia: 'fatias',
    pitada: 'pitadas',
    a_gosto: 'a gosto',
    q_b: 'q.b.',
  } satisfies Record<Unidade, string>,
  // Conector LOCALIZADO entre medida e nome na linha do ingrediente ("200 g DE farinha"). String
  // (não objeto) — a unidade não-contável compõe "{qtd} {unidade flexionada} {conector} {nome}".
  unidadeConector: 'de',
  // Página de detalhe da Receita (#57): headings/rótulos da leitura localizada. Os SELOS
  // de proveniência REUSAM busca.seloCatalogo/seloComunidade (mesmo conceito/componente
  // ProvenanceBadge da #56) — não duplicar aqui.
  detalhe: {
    ingredientes: 'Ingredientes',
    passos: 'Modo de preparo',
    notas: 'Notas',
    descricao: 'Descrição',
    // #453: botão compartilhar (Web Share API + fallback copiar-link). Funciona pro Visitante
    // anônimo também (CONTEXT.md:168, "compartilha por texto") — não é gateado por sessão/pool.
    compartilhar: 'Compartilhar',
    linkCopiado: 'Link copiado!',
    compartilharErro: 'Não foi possível copiar o link. Tente de novo.',
    // #455: Modo cozinha — visão passo-a-passo em tela cheia. Timers são PARSING EFÊMERO do texto
    // do passo (ADR-0023: tempo-por-passo é proibido como dado); `{tempo}` interpolado via
    // `.replace` com o rótulo já formatado (`formatDuracao`, ex. "20 min").
    modoCozinha: 'Modo cozinha',
    modoCozinhaFechar: 'Sair do modo cozinha',
    modoCozinhaPassoDe: 'Passo {atual} de {total}',
    modoCozinhaAnterior: 'Passo anterior',
    modoCozinhaProximo: 'Próximo passo',
    modoCozinhaConcluir: 'Marcar passo como feito',
    modoCozinhaIniciarTimer: 'Iniciar timer de {tempo}',
    modoCozinhaPararTimer: 'Parar timer',
    modoCozinhaTempoEsgotado: 'Tempo esgotado!',
    porcoes: 'Porções',
    // #452: escalador de porções — controles "−/+" client-side sobre a LISTA de ingredientes
    // (aritmética `quantidade × ratio`, CONTEXT.md:192). Rótulos acessíveis dos botões (o número
    // corrente é lido por `aria-live`, sem texto próprio).
    porcoesDiminuir: 'Diminuir porções',
    porcoesAumentar: 'Aumentar porções',
    dificuldade: 'Dificuldade',
    tempoAtivo: 'Tempo ativo',
    tempoTotal: 'Tempo total',
    cozinha: 'Cozinha',
    categoria: 'Categoria',
    restricoes: 'Restrições',
    tags: 'Tags',
    avisoTitulo: 'Aviso de restrição',
    // #237 (aviso de catálogo AI-assistido, SEO #187): rótulo acessível do bloco de CORTESIA editorial
    // ("em colaboração entre curadoria e IA"). O TEXTO exibido vem da config admin (editável); aqui só
    // o nome acessível do bloco. NÃO é o selo obrigatório de proveniência — é um aviso adicional.
    catalogoAvisoRotulo: 'Sobre este catálogo',
    // Atribuição à FONTE (#169, ADR-0019): no detalhe da receita IMPORTADA da web, "fonte: …"
    // SUBSTITUI o crédito "por <Usuário>". {fonte} (nome do site ou host) interpolado via `.replace`;
    // o texto linka a URL de origem. `fonteVerNoSite` é o rótulo acessível do link externo.
    fonte: 'fonte: {fonte}',
    fonteVerNoSite: 'Ver no site de origem',
    // #272 (LGPD, ADR-0019): o dono de uma importada com nome de fonte humano pode REMOVÊ-LO; a
    // atribuição passa a mostrar só o site (o source_url fica). Confirmação inline (baixo-risco).
    removerNomeFonte: 'Remover o nome da fonte',
    removerNomeFonteAjuda: 'A atribuição passa a mostrar só o site de origem (o link para a página continua). O nome não volta depois.',
    removerNomeFonteConfirma: 'Remover',
    removerNomeFonteCancela: 'Cancelar',
    removerNomeFonteErro: 'Não foi possível remover agora. Tente de novo.',
    // Link de volta no topo do detalhe (#57) → "/" (a home É a busca).
    voltar: 'Voltar',
    // Gestão da Imagem da receita (#130) — bloco do dono.
    imagemTitulo: 'Foto do prato',
    imagemDescricao: 'Adicione uma foto da sua receita. Ela aparece no detalhe e na busca.',
    imagemRevisar: 'Sua receita mudou bastante. Quer trocar a foto para combinar com a nova versão?',
    imagemAdicionar: 'Adicionar foto',
    imagemTrocar: 'Trocar foto',
    imagemRemover: 'Remover foto',
    imagemEnviando: 'Enviando…',
    imagemTipoInvalido: 'Use uma imagem JPG, PNG ou WebP.',
    imagemGrande: 'Imagem muito grande. Tente uma menor.',
    imagemErro: 'Não foi possível salvar a foto. Tente de novo.',
    // Geração por IA (#132). {tempo} interpolado no componente via `.replace`.
    imagemGerar: '✨ Gerar com IA',
    imagemGerarComPrompt: 'Gerar com este prompt',
    imagemGerando: 'Gerando…',
    imagemRefinar: 'Refinar o prompt',
    imagemPromptRotulo: 'Prompt da imagem',
    imagemPromptPlaceholder: 'Descreva o prato como quer que a foto fique (opcional).',
    // #223: rótulo do prompt-base READ-ONLY (montado da receita; o refino é sempre adicionado a ele).
    imagemPromptBase: 'Prompt-base (gerado da receita)',
    imagemGerarErro: 'Não foi possível gerar a imagem. Tente de novo.',
    // #134: geração desligada pelo admin (a UI esconde o botão; cobre a corrida de desligar no meio).
    imagemGerarDesabilitada: 'A geração de imagem por IA está desativada no momento.',
    // #226 (ADR-0022 dec.3): o Curador bloqueou a geração-de-imagem-por-IA DESTE usuário (abuso
    // confirmado). Nota proativa (esconde "Gerar com IA"; o upload de foto segue) + aviso no modal
    // (defesa-em-profundidade na corrida de bloquear no meio). DISTINTO de `imagemGerarDesabilitada`
    // (config-global do admin) — aqui é a restrição por-CONTA.
    imagemGerarBloqueadaNota:
      'A geração de imagem por IA foi desativada para esta conta. Você ainda pode enviar suas próprias fotos.',
    imagemGerarBloqueada:
      'A geração de imagem por IA foi desativada para a sua conta. Você ainda pode enviar suas próprias fotos.',
    // Janela DESLIZANTE de 24h (não "hoje"/dia-calendário): copy neutra à janela.
    imagemLimite: 'Você atingiu o limite de gerações por enquanto. Libera em ~{tempo}.',
    // Estúdio de imagem (#222, ADR-0022): preview-modal + galeria re-selecionável.
    imagemSeloIa: '✨ gerada por IA',
    // #285 (image-to-image): editar a partir de outra imagem da galeria (selo distinto + modo edição).
    imagemSeloIaEditada: '✨ editada com IA',
    imagemEditarDesta: 'Editar a partir desta',
    imagemEditandoDesta: 'Editando a partir desta imagem',
    imagemCancelarEdicao: 'Cancelar edição',
    imagemEdicaoPlaceholder: 'Descreva a mudança que você quer nesta imagem.',
    imagemPreviewTitulo: 'Gerar imagem com IA',
    imagemPreviewDescricao: 'Veja a imagem gerada antes de usá-la. Gerar outra mantém as anteriores na galeria.',
    imagemUsarEsta: 'Usar esta',
    imagemGerarOutra: 'Gerar outra',
    // #265: CTA primário do modal no estado de REPOUSO (sem preview ainda). Distinto de
    // `imagemGerar` ("✨ Gerar com IA", botão externo) — não gera ao abrir, só no clique.
    imagemGerarAgora: 'Gerar',
    imagemFechar: 'Fechar',
    imagemGaleria: 'Galeria de imagens',
    imagemGaleriaVazia: 'Nenhuma imagem ainda. Gere uma com IA ou envie a sua foto.',
    imagemSelecionar: 'Usar esta',
    imagemSelecionada: 'Em uso',
    imagemApagar: 'Apagar',
    // 409 in_use: a imagem ainda é a face de alguma versão — desselecione antes de apagar.
    imagemApagarEmUso: 'Esta imagem está em uso por uma versão. Escolha outra antes de apagá-la.',
    // #225: moderação × galeria (ADR-0022). A imagem moderada (#133) fica na galeria do dono marcada
    // "removida"; não pode virar a face pública.
    imagemRemovida: 'Removida pela moderação',
    // 409 imagem_moderada: tentar selecionar uma imagem moderada como face.
    imagemModeradaNaoSelecionavel: 'Esta imagem foi removida pela moderação e não pode ser usada como capa. Escolha outra.',
    // US21: a face SELECIONADA foi moderada — o público vê um placeholder; sugira escolher outra.
    imagemSelecionadaModerada: 'A imagem selecionada foi removida pela moderação; o público vê um placeholder. Escolha outra imagem como capa.',
  },
  // Telas de autenticação (#55): entrar / criar conta. Objeto PLANO (folhas string) —
  // o TIPO `Messages` exige um nível de namespace. Guarda só o CONTEXTUAL das telas; o
  // que é idêntico ao header REUSA `nav.signIn`/`nav.signOut` (não duplicar — ADR-0001).
  // Erros traduzidos por CHAVE (mapErrorToKey casa `error.code` do Better Auth, nunca o
  // status); NUNCA exibir a mensagem crua do servidor.
  auth: {
    criarConta: 'Criar conta',
    nome: 'Nome',
    email: 'Email',
    senha: 'Senha',
    senhaDica: 'Mínimo de 8 caracteres',
    enviando: 'Enviando…',
    continuarComGoogle: 'Continuar com o Google',
    ou: 'ou',
    jaTemConta: 'Já tem uma conta?',
    semConta: 'Ainda não tem conta?',
    erroCredencialInvalida: 'Email ou senha incorretos.',
    erroEmailEmUso: 'Este email já está cadastrado.',
    erroSenhaCurta: 'A senha precisa ter pelo menos 8 caracteres.',
    erroRede: 'Não foi possível conectar. Tente de novo.',
    erroGenerico: 'Não foi possível concluir. Tente de novo.',
  },
  // Tela CRIAR estruturada (#58): o Briefing por campos → resultado de geração. ESTENDE
  // `system` com a taxonomia de desfecho da geração (success/degraded/playful/impossible)
  // — `system` só cobre loading/error/notFound/retry, insuficiente aqui. Termos seguem
  // CONTEXT.md: Briefing/pedido, força (required/preferred), Aviso (toque leve, âmbar só
  // via RestrictionWarning), comentário consultivo (advisory) fora do objeto Receita,
  // playful distinto e não publicável. Erros traduzidos por CHAVE (mapErroMensagem casa o
  // código de validação do handler), nunca a mensagem crua do servidor.
  criar: {
    titulo: 'Criar receita',
    descricao: 'Monte um pedido por campos e a IA gera a receita.',
    descricaoPromptAberto: 'Descreva a receita que você quer e a IA gera para você.',
    modoLegenda: 'Modo de criação',
    modoEstruturado: 'Estruturado',
    modoPromptAberto: 'Prompt aberto',
    textareaLabel: 'Sua ideia de receita',
    textareaPlaceholder:
      'Ex.: um curry vegano de grão-de-bico, rápido e sem pimenta, para 4 pessoas.',
    erroTextoVazio:
      'Escreva um pouco mais sobre a receita que você quer (mínimo de 10 caracteres).',
    erroTextoMuitoLongo: 'Sua descrição está muito longa. Use no máximo 2000 caracteres.',
    precisaEntrar: 'Entre na sua conta para criar receitas.',
    legendaIngredientes: 'Ingredientes',
    ingrediente: 'Ingrediente',
    adicionarIngrediente: 'Adicionar ingrediente',
    removerIngrediente: 'Remover ingrediente',
    ingredientePlaceholder: 'Ex.: cebola',
    quantidade: 'Quantidade',
    quantidadePlaceholder: 'Ex.: 2',
    unidade: 'Unidade',
    unidadeNenhuma: 'Sem unidade',
    forca: 'Força',
    forcaObrigatorio: 'Obrigatório',
    forcaPreferido: 'Preferido',
    cozinha: 'Cozinha',
    cozinhaNenhuma: 'Qualquer cozinha',
    legendaRestricoes: 'Restrições alimentares',
    porcoes: 'Porções',
    dificuldade: 'Dificuldade (1 a 5)',
    tempoAtivoMin: 'Tempo ativo (min)',
    tempoTotalMin: 'Tempo total (min)',
    tempoAtivoExcedeTotal: 'O tempo ativo não passa do total — ao salvar, ele será ajustado.',
    observacoes: 'Observações',
    observacoesPlaceholder: 'Ex.: sem pimenta, bem dourado',
    gerar: 'Gerar receita',
    gerando: 'Gerando receita…',
    resultadoSucesso: 'Receita pronta.',
    resultadoDegradado: 'Geramos a receita, mas não foi possível atender tudo o que você pediu.',
    playfulTitulo: 'Essa foi uma brincadeira.',
    playfulNota:
      'A IA respondeu no humor. Fica salva só no seu espaço privado e não pode ser publicada.',
    consultoria: 'A IA comentou',
    resultadoImpossivel: 'Não deu para criar uma receita com esse pedido.',
    erroCarregarReceita:
      'A receita foi criada e está no seu espaço, mas não conseguimos carregá-la agora. Tente de novo.',
    tentarCarregarNovamente: 'Tentar carregar de novo',
    tentarNovamente: 'Ajustar e tentar de novo',
    criarOutra: 'Criar outra receita',
    verReceita: 'Ver receita',
    erroGeracao: 'Não foi possível gerar a receita. Tente de novo.',
    erroConexao: 'Não foi possível conectar. Tente de novo.',
    // #167: teto diário de geração de receita por papel atingido (janela 24h deslizante). Copy
    // neutra à janela ("por enquanto", não "hoje"/dia-calendário) — espelha imagemLimite.
    erroLimiteGeracao: 'Você atingiu o limite de receitas geradas por enquanto. Tente de novo mais tarde.',
    erroBriefingVazio:
      'Adicione ao menos um ingrediente, uma cozinha, uma restrição ou uma observação.',
    erroPorcoes: 'As porções devem ficar entre 1 e 50.',
    erroObservacoesLongas: 'As observações estão muito longas.',
    erroIngrediente: 'Preencha o ingrediente nas linhas que você começou.',
    erroCampos: 'Verifique os campos preenchidos.',
    // Entrada inteligente (#112): a IA ORGANIZA os ingredientes que você escreveu em texto
    // natural nas linhas estruturadas. NÃO inventa nem gera a receita (Extração ≠ Geração).
    entradaInteligente: 'Escreva os ingredientes do seu jeito',
    entradaPlaceholder: 'Ex.: 2 cebolas, sal a gosto, um pouco de salsinha, 200g de queijo',
    estruturar: 'Estruturar',
    estruturando: 'Estruturando…',
    entradaDistincao:
      'A IA organiza os ingredientes que você escreveu — não inventa nem gera a receita.',
    erroEntradaVazia:
      'Escreva um pouco mais sobre os ingredientes (mínimo de 10 caracteres).',
    erroEntradaLonga: 'Sua lista está muito longa. Use no máximo 500 caracteres.',
    erroEstruturacao: 'Não foi possível organizar os ingredientes agora. Tente de novo.',
    itemUnidadeDesconhecida: 'Não reconhecemos a unidade — escolha uma na lista.',
    // Alternância de modo EXTERNA da tela CRIAR unificada (#104): Formulário (estruturado +
    // prompt aberto) ↔ Conversa (chat focado). `seletorModo` é o rótulo do segmented control.
    modoFormulario: 'Formulário',
    modoConversa: 'Conversa',
    seletorModo: 'Como criar',
    // #423 (ADR-0029 dec.6): "gerar 2, o usuário escolhe". Opt-in no modo estruturado (só quando o admin
    // liga a feature) + a tela de escolha entre as 2 versões.
    variar2Label: 'Gerar 2 versões para eu escolher',
    variar2Ajuda: 'A IA cria duas versões diferentes; você escolhe a preferida.',
    variacaoTitulo: 'Escolha uma versão',
    variacaoIntro:
      'Geramos duas versões. Escolha a que você prefere — a outra fica salva no seu espaço.',
    variacaoColuna: 'Versão {n}',
    variacaoEscolher: 'Escolher esta',
    variacaoCorpoIndisponivel:
      'Não foi possível carregar esta versão agora, mas ela está salva no seu espaço.',
    erroLimiteVariacao:
      'Você não tem espaço para gerar 2 versões agora. Tente uma versão só ou volte mais tarde.',
  },
  // Drawer "Nova receita" (#191, ADR-0021) — reorganiza a criação por IA num drawer da direita
  // (sobre o Sheet). O kicker em versalete + o título do passo dão o nome acessível do diálogo; o
  // `<h1>` do nome da Receita continua sendo dos componentes internos (seam de heading, F1
  // cancelado). Esta fatia entrega o método-picker + o caminho Prompt aberto ponta-a-ponta.
  criarDrawer: {
    kicker: 'Nova receita',
    fechar: 'Fechar',
    voltar: 'Voltar',
    descricaoAcessivel: 'Crie uma receita com a ajuda da IA.',
    // Título do diálogo por passo (vira o SheetTitle / nome acessível do drawer).
    tituloPicker: 'Como você quer criar?',
    tituloPrompt: 'Prompt aberto',
    tituloEstruturado: 'Formulário estruturado',
    tituloConversa: 'Conversa',
    // Método-picker (3 cards).
    pickerIntro:
      'Como você quer chegar na sua receita? Dá pra montar por campos, descrever de uma vez ou conversar.',
    metodoEstruturadoTitulo: 'Formulário estruturado',
    metodoEstruturadoDesc:
      'Monte por campos — ingredientes, cozinha, restrições. A IA preenche o resto.',
    metodoPromptTitulo: 'Prompt aberto',
    metodoPromptDesc: 'Descreva o prato de uma vez e gere na hora. Sem idas e vindas.',
    metodoConversaTitulo: 'Conversa',
    metodoConversaDesc: 'Converse com a IA até a receita ficar do seu jeito.',
    // Caminho Conversa (#194) — chat multi-turno + "Destilar receita" dentro do drawer. O resto
    // dos rótulos (bolhas, enviar, resultado/erro/queda, Ver receita) REUSA `conversa.*`.
    conversaIntro:
      'Converse para chegar na receita. Quando quiser, peça para destilar tudo numa receita pronta.',
    destilarReceita: 'Destilar receita',
    // Placeholder do antigo caminho ainda-não-entregue (mantido por compat). O Formulário
    // estruturado já é o wizard real (#193) e a Conversa agora é funcional (#194).
    emBreve: 'Em breve',
    emBreveConversa: 'O modo Conversa chega em breve por aqui.',
  },
  // Wizard do Formulário estruturado dentro do drawer (#193, ADR-0021) — 3 passos que montam o
  // Briefing. A submissão REUSA o caminho `structured` de POST /api/generations (mesmo payload/
  // Briefing) e os estados de cap/erro/foco do spine (#191). O stepper no header mostra o
  // progresso; Voltar preserva o estado. Os RÓTULOS de resultado/erro/Ver receita REUSAM
  // `criar.*` (mesmo pipeline de resultado). Seção própria (folhas string/array, sem aninhar —
  // o tipo Messages é raso por seção).
  criarWizard: {
    // Passos do stepper (índice 0..2). Nomes curtos pra caberem no header.
    passoIngredientes: 'Ingredientes',
    passoCozinha: 'Cozinha',
    passoDetalhes: 'Detalhes',
    passoLabel: 'Passo {n} de 3',
    // Rodapé.
    continuar: 'Continuar',
    gerar: 'Gerar receita',
    // Passo 1 — Ingredientes.
    ingredientesTitulo: 'Ingredientes',
    ingredientesIntro:
      'Liste tudo de uma vez ou adicione um a um — você pode voltar e ajustar qualquer item.',
    modoUmAUm: 'Um a um',
    modoDeUmaVez: 'De uma vez',
    modoIngredientesLabel: 'Como informar os ingredientes',
    itemPosicao: 'Ingrediente {atual} de {total}',
    itemAnterior: 'Ingrediente anterior',
    itemProximo: 'Próximo ingrediente',
    irParaItem: 'Ir para o ingrediente {n}',
    adicionarOutro: 'Adicionar outro',
    bulkLabel: 'Liste os ingredientes',
    bulkPlaceholder:
      'Um ingrediente por linha ou separados por vírgula\nEx.: 2 xícaras de fubá, 1 cebola, 200 g de goiabada',
    bulkDistincao:
      'Um ingrediente por linha ou separados por vírgula — a IA separa quantidade, unidade e item.',
    // Passo 2 — Cozinha + Restrições.
    cozinhaTitulo: 'Cozinha',
    cozinhaIntro: 'De onde vem o tempero? Opcional.',
    // "Outra" (#319): cozinha fora do vocabulário — vira sugestão pro Curador.
    cozinhaOutra: 'Outra',
    cozinhaOutraLabel: 'Qual cozinha?',
    cozinhaOutraPlaceholder: 'Ex.: Cozinha georgiana',
    restricoesTitulo: 'Restrições alimentares',
    restricoesIntro: 'Marque o que a receita precisa respeitar. Declarado, não verificado.',
    // Passo 3 — Detalhes.
    porcoesTitulo: 'Porções',
    porcoesMenos: 'Menos porções',
    porcoesMais: 'Mais porções',
    // Nível de habilidade (#421, ADR-0029 dec.2): PARA QUEM a receita é escrita (minúcia/tom do texto).
    // Substitui a antiga Dificuldade-como-entrada; a dificuldade do prato agora é ESTIMADA pela IA.
    nivelTitulo: 'Nível de habilidade',
    nivelIntro: 'Para quem a receita é escrita — quanto detalhe e que tom. A dificuldade do prato quem estima é a IA.',
    // Chip que reverte ao default do Perfil (nenhum override nesta geração).
    nivelPadrao: 'Usar meu padrão',
    observacoesTitulo: 'Observações',
    observacoesPlaceholder:
      'Algo a mais? Ex.: sem pimenta, rende bem congelado, ponto bem cremoso…',
  },
  conversa: {
    titulo: 'Conversar com a IA',
    descricao:
      'Converse para chegar na receita. Quando quiser, peça para destilar tudo numa receita pronta.',
    precisaEntrar: 'Entre na sua conta para conversar e criar receitas.',
    voce: 'Você',
    assistente: 'IA',
    inputLabel: 'Sua mensagem',
    inputPlaceholder: 'Ex.: quero um jantar rápido com o que tenho na geladeira…',
    enviar: 'Enviar',
    enviando: 'Enviando…',
    pensando: 'A IA está respondendo…',
    destilando: 'Destilando a receita…',
    conversaVazia: 'Comece a conversa: descreva o que você quer cozinhar.',
    resultadoSucesso: 'Receita pronta a partir da conversa.',
    resultadoDegradado:
      'Destilamos a receita, mas não foi possível atender tudo o que a conversa pediu.',
    playfulTitulo: 'Essa foi uma brincadeira.',
    playfulNota:
      'A IA respondeu no humor. Fica salva só no seu espaço privado e não pode ser publicada.',
    consultoria: 'A IA comentou',
    resultadoImpossivel: 'Não deu para destilar uma receita a partir desta conversa.',
    erroCarregarReceita:
      'A receita foi criada e está no seu espaço, mas não conseguimos carregá-la agora. Tente de novo.',
    tentarCarregarNovamente: 'Tentar carregar de novo',
    erroGeracao: 'Não foi possível destilar a receita agora.',
    redestilar: 'Destilar de novo',
    erroConflito: 'Outra ação concorreu com esta conversa. Tente enviar de novo.',
    erroConexao: 'Não foi possível conectar. Tente de novo.',
    quedaTitulo: 'A conexão caiu antes de terminar.',
    quedaNota: 'Sua conversa está salva. Você pode retomar e tentar de novo.',
    retomar: 'Retomar conversa',
    retomarFalhou: 'Esta conversa não foi encontrada ou expirou.',
    verReceita: 'Ver e publicar receita',
    novaConversa: 'Nova conversa',
    apagarTranscricao: 'Apagar conversa',
    apagarTituloConfirma: 'Apagar esta conversa?',
    apagarAviso:
      'A conversa será apagada para sempre e não dá para desfazer. A receita já criada continua salva.',
    apagarConfirmar: 'Apagar para sempre',
    apagarCancelar: 'Cancelar',
    apagarErro: 'Não foi possível apagar a conversa. Tente de novo.',
    // Vista FOCADA (#104): o histórico fica atrás de "Ver transcrição" (modal read-only).
    verTranscricao: 'Ver transcrição',
    transcricaoTitulo: 'Transcrição da conversa',
    // Rótulo da bolha do Assistente na vista focada (resposta concisa do último par de falas).
    respostaIA: 'Resposta da IA',
    // Placeholders ROTATIVOS do input (só ciclam com o campo vazio e ocioso) — exemplos com o
    // jeitão caseiro do Refogando. EXATAMENTE 8, mesmo comprimento que o array en-US (a paridade
    // recursiva trata o array como objeto de chaves numéricas).
    placeholders: [
      'um bobó de camarão pra 4',
      'sobremesa sem açúcar com banana',
      'jantar rápido com o que tem na geladeira',
      'feijoada vegetariana pro fim de semana',
      'almoço leve sem glúten pra hoje',
      'um bolo de fubá com goiabada',
      'marmita fitness com frango e batata-doce',
      'café da manhã reforçado pra quem treina',
    ],
  },
  visibilidade: {
    titulo: 'Visibilidade',
    privadaBadge: 'Privada',
    publicaBadge: 'Pública',
    privadaDescricao: 'Só você vê esta receita.',
    publicaDescricao: 'Esta receita está no acervo da comunidade.',
    publicar: 'Publicar',
    despublicar: 'Despublicar',
    atualizando: 'Atualizando…',
    playfulBloqueio: 'Receitas de zoeira ficam privadas e não podem ser publicadas.',
    // ADR-0019/#168: importada da web é sempre privada (atribuída à fonte, nunca republicada).
    webImportedBloqueio: 'Receitas importadas da web ficam privadas e não podem ser publicadas.',
    erroPlayful: 'Esta receita de zoeira não pode ser publicada.',
    erroWebImported: 'Receitas importadas da web não podem ser publicadas.',
    erroNaoEncontrada: 'Não foi possível encontrar esta receita.',
    erroGenerico: 'Não foi possível mudar a visibilidade. Tente de novo.',
    // #195/ADR-0021 (decisão 4): toggle de Visibilidade DENTRO do modal de edição — rascunho local
    // (não chama o servidor até o Salvar). O conteúdo grava primeiro; só depois, se a visibilidade
    // mudou, a publicação comita por request separado.
    rascunhoLegenda: 'Visibilidade',
    rascunhoTornarPublica: 'Tornar pública',
    rascunhoTornarPublicaAjuda: 'Aparece no acervo da comunidade quando você salvar.',
    rascunhoManterPrivada: 'Só você vê esta receita.',
    // Falha PARCIAL no Salvar: o conteúdo gravou, mas publicar/despublicar falhou. A edição NÃO se
    // perde; só a visibilidade não mudou.
    erroVisibilidadeParcial:
      'Salvamos suas mudanças, mas não foi possível alterar a visibilidade. Tente de novo.',
    // Chip de status (não-clicável) no detalhe — o dono vê o estado de relance.
    chipRotulo: 'Visibilidade',
  },
  // Edição IN-PLACE + apagar a PRÓPRIA receita (#21). Confirmar editar a pública (história #277:
  // a mudança fica visível a quem salvou), apagar com aviso de irreversibilidade (#157), e o
  // rótulo de "vínculo perdido" quando a base de uma derivada foi apagada (#289).
  edicaoPropria: {
    editarPublicaTitulo: 'Editar receita pública',
    editarPublicaAviso:
      'Esta receita é pública. Suas mudanças ficam visíveis para quem já a salvou ou está vendo na comunidade.',
    editarPublicaConfirmar: 'Salvar mudanças',
    editarPublicaCancelar: 'Cancelar',
    apagarTitulo: 'Apagar receita',
    apagarAviso: 'Apagar é permanente: a receita some de vez e não dá para recuperar.',
    apagarConfirmar: 'Apagar para sempre',
    apagarCancelar: 'Cancelar',
    apagando: 'Apagando…',
    apagarErro: 'Não foi possível apagar a receita. Tente de novo.',
    vinculoPerdido: 'A receita original foi apagada — sua versão continua completa, só sem o vínculo com ela.',
    // #192/ADR-0021: modal centrado de edição IN-PLACE (a tela de detalhe vira só-leitura). O
    // botão "Editar" abre o modal; o título/descrição/fechar são do `SheetContent`.
    modalTitulo: 'Editar receita',
    modalDescricao: 'Altere o conteúdo da sua receita. As mudanças valem para esta mesma receita.',
    modalFechar: 'Fechar',
    // #196/ADR-0021: o MESMO modal abre para DERIVAR uma receita NÃO-própria. Salvar não muta a
    // base — cria uma cópia sua (privada) e leva você até ela. Sem toggle de Visibilidade nem
    // Apagar (a base não é sua); o aviso de cópia reusa `derivada.copiaAviso`.
    modalDerivarTitulo: 'Criar minha versão',
    modalDerivarDescricao: 'Edite o conteúdo. Vamos salvar como uma cópia sua, privada — a receita original não muda.',
  },
  // Regeneração: nova versão imutável por linhagem (#20). Regenerar a PRÓPRIA receita cria uma
  // NOVA versão a partir do mesmo pedido — nunca sobrescreve; as versões anteriores ficam salvas.
  // Os rótulos são chrome da UI #61 (linhagem/versões); `semFonte` é o erro 409 quando a receita
  // não tem fonte recuperável para regenerar (catálogo, editada por pessoa, ou conversa apagada).
  versao: {
    novaVersao: 'Nova versão',
    versaoAnterior: 'Versão anterior',
    versaoAtual: 'Versão atual',
    regenerar: 'Gerar nova versão',
    regenerando: 'Gerando nova versão…',
    semFonte: 'Não dá para gerar uma nova versão desta receita: o pedido original não está disponível.',
  },
  // Minhas criações (#61) — a tela integradora do épico. Lista as Receitas do dono (cards com
  // selos NEUTROS de visibilidade/linhagem/origem), os rótulos das AFORDÂNCIAS do dono no
  // detalhe (editar/apagar/regenerar/ver versões/criar minha versão) e os CONVITES de entrar
  // para o Visitante (descope #22: anônimo é read-only; toda ação de conta convida a entrar).
  // Os selos REUSAM conceitos já localizados onde possível; aqui só o que é próprio da tela.
  minhasCriacoes: {
    titulo: 'Minhas criações',
    subtitulo: 'Tudo o que você criou, do mais recente ao mais antigo.',
    vazio: 'Você ainda não criou nenhuma receita.',
    criarPrimeira: 'Criar minha primeira receita',
    // Card tracejado "começar outra" no grid (protótipo RefoStage "Minhas criações").
    comecarOutra: 'Quer começar outra?',
    criarReceita: 'Criar receita',
    precisaEntrar: 'Entre na sua conta para ver suas criações.',
    erro: 'Não foi possível carregar suas criações. Tente de novo.',
    semTitulo: 'Receita sem título',
    // Selos de estado por card (NEUTROS — âmbar é exclusivo do Aviso de restrição).
    seloPrivada: 'Privada',
    seloPublica: 'Pública',
    seloRemovida: 'Fora do acervo',
    seloPlayful: 'Zoeira',
    seloDerivada: 'Derivada',
    seloRegenerada: 'Regenerada',
    // #169/ADR-0019: receita IMPORTADA da web (origin=web_imported) — marcador na lista de criações.
    seloImportada: 'Importada da web',
    // Afordâncias do dono no detalhe (aparecem só sob canManage, vindo do servidor).
    gerenciarTitulo: 'Gerenciar receita',
    editar: 'Editar',
    apagar: 'Apagar',
    regenerar: 'Gerar nova versão',
    // CTA de derivar uma receita NÃO-própria (catálogo/pública de outra pessoa).
    criarMinhaVersao: 'Criar minha versão',
    // Bloco do diff da derivada (título da seção; os rótulos das linhas vêm de `derivada`).
    diffTitulo: 'O que mudou em relação à original',
    // Convites de entrar (gating consistente em /create, /conversation e nos botões do detalhe).
    convidaEntrarTitulo: 'Entre para fazer isso',
    convidaEntrarTexto: 'Crie uma conta ou entre para criar, salvar e gerenciar receitas.',
  },
  // Perfil do Usuário (#124, frente Perfil — primeira fatia: nome + bio). Tela de edição
  // em /me/profile que consome o contrato `/api/me`. `email` é read-only (identidade). A
  // `bioContador` interpola {n} via `.replace` no componente (folhas do tipo são string).
  perfil: {
    titulo: 'Seu perfil',
    subtitulo: 'Edite como você aparece para a comunidade.',
    nome: 'Nome de exibição',
    email: 'Email',
    emailDica: 'Seu email é usado para entrar e não pode ser alterado aqui.',
    handle: 'Handle',
    // {handle} interpolado no componente via `.replace` (folhas do tipo são string).
    handleDica: 'O endereço do seu perfil público: /u/{handle}. Trocar quebra os links antigos.',
    handlePlaceholder: 'seu-handle',
    handleInvalido: 'Use 3 a 30 letras minúsculas, números e hífens (sem acento, espaço ou hífen nas bordas).',
    handleReservado: 'Esse handle é reservado. Escolha outro.',
    handleEmUso: 'Esse handle já está em uso. Escolha outro.',
    bio: 'Bio',
    bioPlaceholder: 'Conte um pouco sobre você e o que você gosta de cozinhar.',
    bioContador: '{n}/280',
    // Nível de habilidade padrão (#421, ADR-0029 dec.2): default do eixo de geração, sobrescrevível
    // em cada geração. A opção vazia limpa o default (sem preferência = eixo neutro).
    nivelPadrao: 'Nível de habilidade padrão',
    nivelPadraoDica: 'Usado como padrão ao gerar receitas — você pode mudar em cada geração.',
    nivelPadraoNenhum: 'Sem preferência',
    // Links sociais (#127). Editor de até 5 linhas (tipo + url) no perfil.
    links: 'Links',
    linksDica: 'Adicione até 5 links (redes sociais, site). Só endereços http(s) são aceitos.',
    linkTipoRotulo: 'Tipo do link',
    linkUrlRotulo: 'URL do link',
    linkUrlPlaceholder: 'https://…',
    linkAdicionar: 'Adicionar link',
    linkRemover: 'Remover link',
    linkInvalido: 'Use um endereço http(s) válido (sem javascript:, espaços ou esquemas inseguros).',
    linkTipoInstagram: 'Instagram',
    linkTipoX: 'X',
    linkTipoGithub: 'GitHub',
    linkTipoYoutube: 'YouTube',
    linkTipoSite: 'Site',
    // Avatar (#126). {name} interpolado no componente via `.replace` (folhas do tipo são string).
    avatarAlt: 'Foto de {name}',
    avatarEnviar: 'Enviar foto',
    avatarTrocar: 'Trocar foto',
    avatarRemover: 'Remover foto',
    avatarEnviando: 'Enviando…',
    avatarTipoInvalido: 'Use uma imagem JPG, PNG ou WebP.',
    avatarGrande: 'Imagem muito grande. Tente uma menor.',
    avatarErro: 'Não foi possível salvar sua foto. Tente de novo.',
    salvar: 'Salvar',
    salvando: 'Salvando…',
    salvo: 'Perfil salvo.',
    precisaEntrar: 'Entre na sua conta para editar seu perfil.',
    erro: 'Não foi possível salvar seu perfil. Tente de novo.',
  },
  // Perfil PÚBLICO (#129) — a página `/u/<handle>` que um Visitante anônimo vê: nome, avatar,
  // bio, links e as receitas PÚBLICAS daquela pessoa. Distinto de `perfil` (a tela de EDIÇÃO do
  // próprio dono em /me/profile). `receitasTitulo`/`semReceitas` rotulam a seção de receitas.
  perfilPublico: {
    receitasTitulo: 'Receitas',
    // Link de volta no topo do perfil público (#129) → "/".
    voltar: 'Voltar',
    semReceitas: 'Esta pessoa ainda não publicou nenhuma receita.',
    // Rótulo acessível do avatar (alt). {name} interpolado via `.replace` no componente.
    avatarAlt: 'Foto de {name}',
    // Rótulo acessível do bloco de links sociais.
    linksLabel: 'Links',
    // Social (#274, ADR-0024) — voz Cozinheiro. Contadores com placeholder '{n}' (.replace no
    // componente); nudge espelha `comunidade.convidaEntrarSalvar`.
    seguir: 'Seguir',
    seguindo: 'Seguindo',
    // Contador de seguidores tem singular ("1 seguidor") — como o de receitas abaixo. O de
    // "seguindo" é gerúndio invariante ("1 seguindo" / "2 seguindo"), uma chave só basta.
    seguidorContagem: '{n} seguidor',
    seguidoresContagem: '{n} seguidores',
    seguindoContagem: '{n} seguindo',
    // Contador de RECEITAS na linha de stats (perfil estilo Instagram) — vem de `recipes.length` (sem
    // nova query). Tem singular ("1 receita"), espelhando o de seguidores.
    receitaContagem: '{n} receita',
    receitasContagem: '{n} receitas',
    entrarParaSeguir: 'Entrar para seguir',
    erroSeguir: 'Não foi possível concluir. Tente de novo.',
    seguidoresTitulo: 'Seguidores',
    seguindoTitulo: 'Seguindo',
    // Lista COMPLETA (#307) — modal "ver todos" aberto pelos contadores. Título reusa seguidores/seguindo;
    // a descrição é o aria-describedby (#181). "Carregar mais" pagina; vazio/erro localizados.
    listaDescricao: 'Lista completa de cozinheiros.',
    carregarMais: 'Carregar mais',
    // Estado de carregamento da página 1; rótulo do X (≠ 'Voltar', que é navegação); erro de "carregar
    // mais" é INLINE (não apaga a lista já carregada) e separado do erro da página 1.
    listaCarregando: 'Carregando…',
    listaFechar: 'Fechar',
    listaVazia: 'Ninguém por aqui ainda.',
    listaErro: 'Não foi possível carregar a lista. Tente de novo.',
    listaErroMais: 'Não foi possível carregar mais. Tente de novo.',
  },
  comunidade: {
    titulo: 'Comunidade',
    salvar: 'Salvar',
    salvo: 'Salvo',
    ordenarPor: 'Ordenar a Comunidade por',
    toggleRelevancia: 'Relevância',
    togglePopularidade: 'Popularidade',
    convidaEntrarSalvar: 'Entrar para salvar',
    erroSalvar: 'Não foi possível salvar. Tente de novo.',
  },
  // Coleções (#364, ADR-0027) — pastas PRIVADAS sobre o Salvar. Namespace próprio. A página
  // /me/saved lista "Todos" (todos os saves) + as coleções; o picker do detalhe adiciona/remove.
  // Contadores compostos via `.replace('{n}', …)` no componente (folhas do tipo são string).
  colecoes: {
    titulo: 'Salvos',
    subtitulo: 'Suas receitas salvas, organizadas em coleções.',
    todos: 'Todos',
    colecoes: 'Coleções',
    novaColecao: 'Nova coleção',
    nomeColecao: 'Nome da coleção',
    criar: 'Criar',
    renomear: 'Renomear',
    apagar: 'Apagar',
    salvarNome: 'Salvar',
    cancelar: 'Cancelar',
    // Confirmação de apagar (deixa claro que os saves permanecem).
    confirmarApagar: 'Apagar esta coleção? As receitas continuam salvas.',
    // Picker no detalhe.
    adicionarAColecao: 'Adicionar a coleção',
    // Contador de itens por coleção (singular + plural, {n}) — rótulo acessível do chip.
    itemContagem: '{n} receita',
    itensContagem: '{n} receitas',
    // Estados vazios.
    vazio: 'Você ainda não salvou nenhuma receita.',
    vazioColecao: 'Nenhuma receita nesta coleção ainda.',
    semColecoes: 'Você ainda não criou nenhuma coleção.',
    // Erros (nome inválido/duplicado/limite) + genéricos.
    erroNomeInvalido: 'Escolha um nome (até 60 caracteres).',
    erroNomeDuplicado: 'Você já tem uma coleção com esse nome.',
    erroLimite: 'Você atingiu o limite de coleções.',
    erro: 'Algo deu errado. Tente de novo.',
    erroCarregar: 'Não foi possível carregar. Tente de novo.',
    precisaEntrar: 'Entre na sua conta para ver seus salvos.',
  },
  // Avaliação (#363, ADR-0027) — nota 1–5★ + comentário. Namespace SEPARADO de `comunidade`.
  // Plurais compostos via `.replace('{n}'/'{media}', …)` no componente (folhas do tipo
  // `Messages` são string).
  avaliacoes: {
    titulo: 'Avaliações',
    editar: 'Editar',
    apagar: 'Apagar',
    enviar: 'Enviar',
    salvando: 'Salvando…',
    comentarioLabel: 'Comentário (opcional)',
    comentarioPlaceholder: 'Conte como ficou…',
    notaLabel: 'Sua nota',
    estrela: '{n} estrela',
    estrelas: '{n} estrelas',
    media: '★ {media} · {n} avaliações',
    mediaUma: '★ {media} · 1 avaliação',
    semAvaliacoes: 'Ainda sem avaliações. Seja a primeira pessoa a avaliar.',
    convidaEntrar: 'Entrar para avaliar',
    erroEnviar: 'Não foi possível enviar sua avaliação. Tente de novo.',
    erroApagar: 'Não foi possível apagar sua avaliação. Tente de novo.',
    // #366: a própria avaliação do viewer foi MODERADA (removida pelo Curador). Estado só-leitura —
    // sem estrelas/Editar/Apagar (o delete é no-op no servidor; não oferecemos a ação que mente).
    suaAvaliacaoRemovida: 'Sua avaliação foi removida por um moderador.',
    // #366: reportar a avaliação de outra pessoa (report→Curador). O autor NÃO reporta a própria;
    // ninguém REMOVE (só o Curador, na fila). Sucesso ⇒ estado "Reportado" desabilitado.
    reportar: 'Reportar',
    reportado: 'Reportado',
    motivoReport: 'Motivo do report',
    cancelarReport: 'Cancelar',
    erroReport: 'Não foi possível reportar. Tente de novo.',
    // #365: FOTO do prato na avaliação (upload/câmera, SEM IA). Adicionar/trocar/remover + erros de
    // tipo/tamanho/envio; `fotoAlt` é o texto alternativo (conteúdo/prova, não decorativo).
    adicionarFoto: 'Adicionar foto',
    trocarFoto: 'Trocar foto',
    removerFoto: 'Remover foto',
    fotoTipoInvalido: 'Use uma imagem JPG, PNG ou WebP.',
    fotoGrande: 'Imagem muito grande. Tente uma menor.',
    erroFoto: 'Não foi possível enviar a foto. Tente de novo.',
    fotoAlt: 'Foto do prato',
  },
  // Console de administração (#63). Namespaces FLAT (o tipo `Messages` só aceita 1 nível):
  // os rótulos de VALOR de enum (origin/resultKind/provenance) viram chaves planas, e o
  // COMPONENTE monta lookups `satisfies Record<Enum,string>` a partir delas para travar drift.
  admin: {
    titulo: 'Console de administração',
    subtitulo: 'Configuração, papéis e curadoria.',
    acessoNegadoTitulo: 'Acesso restrito',
    acessoNegado: 'Você não tem permissão para acessar esta área.',
    voltarInicio: 'Voltar ao início',
    configTitulo: 'Modelo de geração padrão',
    modeloLabel: 'Modelo',
    modeloOpus: 'Claude Opus 4.8 (qualidade)',
    modeloSonnet: 'Claude Sonnet 4.6 (custo)',
    salvar: 'Salvar',
    salvando: 'Salvando…',
    salvo: 'Configuração salva.',
    erroModelo: 'Modelo inválido.',
    papeisTitulo: 'Papéis de usuário',
    // Busca de usuário (#269): troca o "cole o UUID" por busca por nome/@handle/email/ID.
    buscaUsuarioLabel: 'Buscar usuário',
    buscaUsuarioPlaceholder: 'Nome, @handle, email ou ID',
    buscaUsuarioCarregando: 'Buscando…',
    buscaUsuarioVazio: 'Nenhum usuário encontrado.',
    buscaUsuarioContagem: '{n} resultado(s)',
    buscaUsuarioResultados: 'Resultados da busca',
    usuarioSelecionado: 'Selecionado',
    trocarUsuario: 'Trocar',
    papelLabel: 'Novo papel',
    papelUsuario: 'Usuário',
    papelCurador: 'Curador',
    papelAdmin: 'Administrador',
    // Rótulo NEUTRO: a ação define QUALQUER papel (inclui rebaixar admin→usuário), não só
    // promover — `aplicarPapel`/`aplicandoPapel` casam a semântica genérica de set-role.
    aplicarPapel: 'Aplicar papel',
    aplicandoPapel: 'Aplicando…',
    promovido: 'Papel atualizado.',
    // Rótulos de AGRUPAMENTO (governança da Plataforma vs Curadoria de conteúdo).
    grupoPlataforma: 'Plataforma',
    grupoCuradoria: 'Curadoria',
    // Rótulos CURTOS da navegação por seção (#125, rotas aninhadas). `navAria` nomeia a
    // <nav> de seções para AT (distinta da nav principal do header).
    navAria: 'Seções do Console',
    navIa: 'IA',
    navPapeis: 'Papéis',
    navModeracao: 'Moderação',
    navTraducoes: 'Traduções',
    navCatalogo: 'Catálogo',
    // ── #321: CRUD da taxonomia de cozinhas (Governança, admin-only). Bloco CONTÍGUO p/ facilitar
    //    o merge com #319 (que também edita estes arquivos i18n). ──
    navVocabulario: 'Cozinhas',
    vocabTitulo: 'Taxonomia de cozinhas',
    vocabDescricao:
      'Adicione, renomeie e deprecie cozinhas. Depreciar tira a cozinha das opções novas, mas mantém o que já foi gravado.',
    vocabSlugLabel: 'Slug (identificador, ex.: coreana)',
    vocabRotuloPt: 'Rótulo (pt-BR)',
    vocabRotuloEn: 'Rótulo (en-US)',
    vocabAdicionar: 'Adicionar cozinha',
    vocabAdicionando: 'Adicionando…',
    vocabSalvar: 'Salvar',
    vocabSalvando: 'Salvando…',
    vocabEditar: 'Editar rótulos',
    // #422: nota de voz curada por cozinha (instrui a IA a cozinhar autenticamente; sem deploy).
    vocabNotaVoz: 'Nota de voz (opcional)',
    vocabNotaVozPlaceholder:
      'Como a IA deve cozinhar nesta tradição: técnicas, ingredientes e temperos típicos. Deixe em branco para usar só a instrução genérica.',
    vocabCancelar: 'Cancelar',
    vocabDepreciar: 'Depreciar',
    vocabReativar: 'Reativar',
    vocabStatusAtiva: 'Ativa',
    vocabStatusDepreciada: 'Depreciada',
    vocabSalvo: 'Alterações salvas.',
    vocabCarregando: 'Carregando…',
    vocabErroCarregar: 'Não foi possível carregar as cozinhas.',
    vocabTentarNovamente: 'Tentar de novo',
    vocabErroSlug: 'Slug inválido: use só minúsculas, números e hífens (ex.: coreana).',
    vocabErroRotulos: 'Preencha os dois rótulos (pt-BR e en-US).',
    vocabErroSlugEmUso: 'Já existe uma cozinha com esse slug.',
    vocabErroNaoEncontrado: 'Cozinha não encontrada.',
    vocabErroInterno: 'Algo deu errado. Tente de novo.',
    // #268: a aba /admin/descoberta abriga a infra de BUSCA — descoberta na web + embeddings; a IA
    // generativa (modelo de receita + geração de imagem + tetos) foi p/ a aba "IA" (/admin/ia).
    navDescoberta: 'Descoberta',
    // ── #425 (ADR-0029 dec.7): Comparador de prompt antes/depois (Governança, admin-only). ──
    navComparador: 'Comparador',
    comparadorTitulo: 'Comparador de prompt (antes/depois)',
    comparadorDescricao:
      'Portão de qualidade: roda briefings fixos pelo prompt velho (congelado) vs. o novo (vivo) e mostra a receita lado a lado. Não salva nada.',
    comparadorRodar: 'Rodar comparação',
    comparadorRodando: 'Rodando…',
    comparadorGerarImagem: 'Gerar imagem (mais lento)',
    comparadorVelho: 'Velho',
    comparadorNovo: 'Novo',
    comparadorSystemPrompt: 'Prompt de sistema',
    comparadorIngredientes: 'Ingredientes',
    comparadorPassos: 'Passos',
    comparadorSemReceita: 'Sem receita entregue.',
    comparadorErro: 'Falha ao rodar esta comparação.',
    comparadorImagemAlt: 'Imagem gerada do prato',
    comparadorOutcomeSuccess: 'sucesso',
    comparadorOutcomeDegraded: 'degradado',
    comparadorOutcomePlayful: 'lúdico',
    comparadorOutcomeImpossible: 'impossível',
    comparadorOutcomeInvalid: 'inválido',
    // ── #451: aba "Site" (Governança, admin-only) — links de redes sociais do rodapé, editáveis sem deploy. ──
    navSite: 'Site',
    redesTitulo: 'Redes sociais (rodapé)',
    redesDescricao:
      'Links que aparecem no rodapé do site. Cadastre a conta e ligue quando ela existir. Vazio = rodapé sem links.',
    redesPlataformaLabel: 'Rede',
    redesUrlLabel: 'URL (https://…)',
    redesRotuloLabel: 'Rótulo (opcional)',
    redesLigadoLabel: 'Mostrar no rodapé',
    redesAdicionar: 'Adicionar rede',
    redesRemover: 'Remover',
    redesSalvar: 'Salvar',
    redesSalvando: 'Salvando…',
    redesSalvo: 'Alterações salvas.',
    redesErro: 'Não foi possível salvar. Confira as URLs (só http/https) e evite plataformas repetidas.',
    redesCarregando: 'Carregando…',
    redesVazio: 'Nenhuma rede cadastrada ainda.',
    // Seção "Geração de imagem" (#134) — vive na aba "IA" (/admin/ia); liga/desliga, modelo e tetos.
    aiTitulo: 'Geração de imagem por IA',
    aiDescricao: 'Controle a geração de imagem das receitas: ligar/desligar, modelo e tetos diários por papel.',
    aiHabilitadaLabel: 'Geração de imagem ligada',
    aiModeloLabel: 'Modelo',
    aiModeloNanoBanana: 'Nano Banana 2 (Gemini)',
    aiTetosLabel: 'Tetos de imagem por papel (janela de 24h)',
    // #167: teto de geração de RECEITA por papel (eixo separado do teto de imagem).
    aiTetoReceitaLabel: 'Tetos de geração de receita por papel (janela de 24h)',
    aiTetoIlimitado: 'ilimitado',
    aiTetoAjuda: 'Deixe em branco para ilimitado. 0 bloqueia o papel.',
    aiErroConfig: 'Configuração inválida. Revise os tetos e o modelo.',
    // #423 (ADR-0029 dec.6): variação de geração ("gerar 2, o usuário escolhe") — liga/desliga + o eixo
    // de divergência (pólos + como divergir), editável sem deploy.
    aiVariacaoLabel: 'Variação de geração (gerar 2, o usuário escolhe)',
    aiVariacaoAjuda:
      'Uma única chamada gera duas versões divergentes; o usuário escolhe. Custa cerca de 2× tokens — mantenha como opt-in.',
    aiVariacaoHabilitadaLabel: 'Oferecer "Gerar 2 versões" na criação',
    aiVariacaoPoloA: 'Pólo A',
    aiVariacaoPoloB: 'Pólo B',
    aiVariacaoInstrucao: 'Como divergir',
    // #164: descoberta na web (ADR-0019) — liga/desliga + allowlist de domínios. A allowlist é fonte
    // ÚNICA tanto da busca na web quanto do guard de SSRF do import. Um domínio por linha.
    webTitulo: 'Descoberta na web',
    webDescricao: 'Quando o nosso acervo está raso, mostre links externos da web. Defina os domínios permitidos (um por linha).',
    webHabilitadaLabel: 'Descoberta na web ligada',
    webAllowlistLabel: 'Domínios permitidos',
    webAllowlistAjuda: 'Um domínio por linha (ex.: tudogostoso.com.br). Vazio bloqueia tudo.',
    webErroConfig: 'Configuração inválida. Revise os domínios (um hostname por linha, sem http:// nem caminho).',
    // #273: domínios sugeridos (click-to-add) — atalho de curadoria. Clicar SÓ acrescenta ao campo acima;
    // adicionar = vetar (não salva nem liga sozinho). Os DOIS grupos aparecem (a allowlist é global).
    webSugeridosTitulo: 'Domínios sugeridos',
    webSugeridosDescricao:
      'Atalhos para preencher a lista. Clicar só acrescenta o domínio ao campo acima — não salva nem liga a descoberta.',
    webSugeridosGrupoBrasil: 'Brasil',
    webSugeridosGrupoInternacional: 'Internacional',
    webSugeridoAdicionarAria: 'Adicionar {dominio} à lista',
    webSugeridoJaAdicionado: 'já na lista',
    webVetarLembrete:
      'Adicionar um domínio = vetá-lo. Confira o robots.txt e os termos de uso do site antes.',
    // #273: probe de saúde — cola uma URL de receita e checa (a) JSON-LD schema.org/Recipe e (b) o
    // robots.txt da origem, ANTES de vetar. Veredito por cópia + estado (sem cor isolada — a11y AA).
    webProbeUrlLabel: 'Checar uma receita de exemplo',
    webProbePlaceholder: 'https://site.com/receita-de-bolo',
    webProbeChecar: 'Checar',
    webProbeChecando: 'Checando…',
    webProbeJsonLdSim: 'Tem receita em JSON-LD (schema.org/Recipe).',
    webProbeJsonLdIdiomaNaoSuportado: 'Tem receita em JSON-LD, mas em idioma fora de PT/EN.',
    webProbeJsonLdNao: 'Sem receita em JSON-LD utilizável.',
    webProbeRobotsPermite: 'O robots.txt permite o RefogandoBot nesse caminho.',
    webProbeRobotsBloqueia: 'O robots.txt bloqueia o RefogandoBot nesse caminho.',
    webProbeImportavel: 'Pronto para importar depois de vetar o domínio.',
    webProbeNaoImportavel: 'Ainda não dá para importar dessa página.',
    webProbeNaoCarregou: 'Não foi possível carregar a página. Confira a URL.',
    webProbeErro: 'Não foi possível checar agora. Tente de novo.',
    webProbeUrlInvalida: 'URL inválida. Use http(s) de um site público.',
    // #237: aviso de catálogo AI-assistido (SEO #187) — liga/desliga + texto editável. CORTESIA
    // editorial: aparece só em receitas de catálogo quando ligado; NUNCA substitui os selos obrigatórios.
    catalogoAvisoTitulo: 'Aviso do catálogo (IA-assistido)',
    catalogoAvisoDescricao:
      'Mostre um aviso opcional nas receitas do catálogo informando que elas podem ser produzidas em colaboração entre a curadoria e a IA. Não substitui os selos obrigatórios de geração por IA.',
    catalogoAvisoHabilitadoLabel: 'Aviso do catálogo ligado',
    catalogoAvisoTextoLabel: 'Texto do aviso',
    catalogoAvisoTextoAjuda: 'Frase exibida nas receitas do catálogo quando o aviso está ligado.',
    catalogoAvisoErroConfig: 'Configuração inválida. O texto do aviso não pode ficar vazio.',
    // #457: "Receita da semana" — slot editorial da home. O Curador busca por título (restrito ao
    // catálogo aprovado) e escolhe; sem escolha, a home cai no destaque automático por Popularidade.
    receitaSemanaTitulo: 'Receita da semana',
    receitaSemanaDescricao:
      'Escolha uma receita do catálogo para destacar na home nesta semana. Sem escolha, a home mostra automaticamente a receita mais popular do catálogo.',
    receitaSemanaAtualLabel: 'Escolha atual',
    receitaSemanaAtualVazio: 'Nenhuma — a home está usando o destaque automático por popularidade.',
    receitaSemanaLimpar: 'Remover escolha',
    receitaSemanaLimpando: 'Removendo…',
    receitaSemanaBuscaLabel: 'Buscar receita do catálogo',
    receitaSemanaBuscaPlaceholder: 'Título da receita',
    receitaSemanaBuscaCarregando: 'Buscando…',
    receitaSemanaBuscaVazio: 'Nenhuma receita do catálogo encontrada com esse título.',
    receitaSemanaBuscaContagem: '{n} resultado(s)',
    receitaSemanaBuscaResultados: 'Resultados da busca',
    receitaSemanaSelecionada: 'Selecionada',
    receitaSemanaTrocar: 'Trocar',
    receitaSemanaSalvo: 'Receita da semana atualizada.',
    receitaSemanaErroReceita: 'Essa receita não é (ou deixou de ser) do catálogo aprovado.',
    // Backfill dos embeddings da busca semântica (#119) — recompute em lote, retomável.
    backfillTitulo: 'Embeddings da busca semântica',
    backfillDescricao:
      'Recomputa os vetores de busca das receitas que ainda não têm (criadas antes do recurso). Rode até "faltam: 0".',
    backfillBtn: 'Recomputar embeddings',
    backfillRodando: 'Recomputando…',
    backfillResultado: 'Recomputados: {recomputados} · faltam: {restantes}.',
    backfillResultadoParcial:
      'Recomputados: {recomputados} · faltam: {restantes}. O serviço de embedding parou (sem chave ou limite). Rode de novo mais tarde.',
    backfillErro: 'Não foi possível recomputar. Tente de novo.',
    // Re-tradução de defasadas (#499, ADR-0031) — lote retomável, mesma UX do backfill de embedding.
    retranslateTitulo: 'Re-tradução de defasadas',
    retranslateDescricao:
      'Re-traduz traduções derivadas cujo original mudou ou cujo tradutor melhorou — só as que ninguém editou à mão desde a última tradução automática. Rode até "faltam: 0".',
    retranslateBtn: 'Re-traduzir defasadas',
    retranslateRodando: 'Re-traduzindo…',
    retranslateResultado: 'Re-traduzidas: {retraduzidas} · puladas: {puladas} · faltam: {restantes}.',
    retranslateErro: 'Não foi possível re-traduzir. Tente de novo.',
    // Atendimento ao autor externo (titular B, sem conta) — #396/GAP-4. Remove o NOME da fonte em lote
    // por nome/URL, sem exigir que a receita seja do operador. Mantém a URL; irreversível pro nome.
    takedownTitulo: 'Remover atribuição (pedido do autor)',
    takedownDescricao:
      'Atende o autor de um site externo que pediu para tirar o nome dele. Remove o nome da fonte de TODAS as receitas importadas (inclusive privadas de usuários) que casem o nome ou a URL. A URL de origem é mantida (a atribuição passa a mostrar só o site). Rode a prévia antes de remover.',
    takedownNomeLabel: 'Nome exibido da fonte',
    takedownNomePlaceholder: 'Ex.: Cozinha da Vovó',
    takedownUrlLabel: 'URL de origem',
    takedownUrlPlaceholder: 'https://site.com/receita',
    takedownCaseIdLabel: 'ID do ticket DSAR (opcional)',
    takedownCaseIdPlaceholder: 'uuid do ticket, se houver',
    takedownPrevia: 'Prévia',
    takedownPreviaRodando: 'Buscando…',
    takedownRemover: 'Remover nome',
    takedownRemovendo: 'Removendo…',
    takedownPreviaResultado: 'Casaram: {casaram} · com nome a remover: {removiveis}.',
    takedownNomesRemovidos: 'Nomes que serão removidos',
    takedownRemovido: 'Nome removido de {removiveis} receita(s). URL preservada.',
    takedownNada: 'Nenhuma receita com nome humano a remover casou o critério.',
    takedownCriterioObrigatorio: 'Informe ao menos o nome OU a URL da fonte.',
    takedownCaseIdInvalido: 'ID de ticket inválido (precisa ser um uuid).',
    takedownErro: 'Não foi possível concluir. Tente de novo.',
    // Escalada além do nome (titular B) — #397/GAP-3. Desvincular a URL inteira ou apagar a importada.
    // A POLÍTICA de quando usar aguarda o sign-off jurídico (#276); o mecanismo não decide sozinho.
    escalonarTitulo: 'Escalar além do nome (desvincular URL / apagar importada)',
    escalonarAviso:
      'A POLÍTICA de QUANDO escalar (desvincular a URL ou apagar a receita) aguarda o sign-off jurídico (#276). Este mecanismo não decide sozinho — use só sob orientação. Reaproveita o nome/URL preenchidos acima.',
    escalonarAcaoLabel: 'Ação',
    escalonarAcaoUnlink: 'Desvincular URL (zera URL e nome)',
    escalonarAcaoDelete: 'Apagar receita importada (irreversível)',
    escalonarPrevia: 'Prévia do escalonamento',
    escalonarPreviaRodando: 'Buscando…',
    escalonarPreviaResultado: '{casaram} receita(s) importada(s) casaram o critério.',
    escalonarUrlsAfetadas: 'URLs que serão removidas',
    escalonarNomesAfetados: 'Nomes que serão removidos',
    // Aviso lido ANTES de confirmar a ação destrutiva: a seleção é OR (união), não AND (interseção),
    // e o efeito é irreversível. Preencher nome E url arrasta a UNIÃO das duas buscas.
    escalonarUniaoAviso:
      'Atenção: a seleção é por nome OU URL (união) — preencher os dois casa TODAS as receitas com aquele nome MAIS todas com aquela URL, não a interseção. Confira o escopo acima; a ação é IRREVERSÍVEL.',
    escalonarConfirmUnlink: 'Confirmar: desvincular URL',
    escalonarConfirmDelete: 'Confirmar: apagar importada',
    escalonarAplicando: 'Aplicando…',
    escalonarUnlinkOk: 'URL e nome desvinculados de {n} receita(s).',
    escalonarDeleteOk: '{n} receita(s) importada(s) apagada(s).',
    escalonarNada: 'Nenhuma receita importada casou o critério.',
    escalonarErro: 'Não foi possível concluir a escalada. Tente de novo.',
    // Painel de SLA dos tickets de takedown/DSAR ABERTOS (#412/GAP-7). Só leitura; a rota filtra os
    // resolvidos (fulfilled/rejected). Ordenado por urgência: nível de alerta mais alto no topo.
    slaTitulo: 'SLA dos pedidos de takedown (abertos)',
    slaDescricao:
      'Tickets de takedown/DSAR com o prazo de 15 dias AINDA correndo (os resolvidos saem da lista). Os mais urgentes — nível de alerta mais alto — aparecem no topo. Só acompanhamento; o atendimento e o escalonamento ficam nas seções acima.',
    slaVazio: 'Nenhum pedido de takedown em aberto.',
    slaTipoLabel: 'Tipo do pedido',
    slaFonteLabel: 'Fonte',
    slaUrlLabel: 'URL de origem',
    slaMensagemLabel: 'Pedido',
    slaRecebidoLabel: 'Recebido em',
    slaSemFonte: '(sem nome nem URL)',
    slaIdadeDias: 'Há {dias} dia(s)',
    slaTipoNameRemoval: 'Remoção de nome',
    slaTipoFullRemoval: 'Remoção total',
    slaTipoOther: 'Outro',
    slaNivelNone: 'No prazo',
    slaNivelYellow: 'Prazo se aproximando',
    slaNivelRed: 'Escalonar ao Encarregado',
    slaNivelOverdue: 'Prazo vencido',
    // Painel de custo de IA (#465) — agrega os ledgers de texto (#463) e imagem (#224).
    custoTitulo: 'Custo de IA',
    custoDescricao:
      'Quanto a geração por IA custou nos últimos {dias} dias — texto (receitas) e imagem. Só o que foi realmente medido entra nas somas; gerações sem telemetria de custo ficam de fora. Só visibilidade de margem e uso; nada aqui muda o app.',
    custoJanela: 'Últimos {dias} dias',
    custoTotalTexto: 'Texto',
    custoTotalImagem: 'Imagem',
    custoTotalGeral: 'Total',
    custoDiaTitulo: 'Custo por dia',
    custoDiaData: 'Dia',
    custoDiaVazio: 'Sem custo medido na janela.',
    custoUsuariosTitulo: 'Maiores gastos por usuário',
    custoUsuarioCol: 'Usuário',
    custoUsuariosVazio: 'Nenhum usuário com custo medido na janela.',
    custoDesfechoTitulo: 'Custo do texto por desfecho',
    custoDesfechoDescricao:
      'Do gasto com geração de texto que produziu Receita, quanto virou Receita que alguém salvou ou avaliou. Salvos e avaliados se sobrepõem (uma Receita pode ter os dois).',
    custoDesfechoTotal: 'Gerado (com Receita)',
    custoDesfechoSalvos: 'Salvos',
    custoDesfechoAvaliados: 'Avaliados',
    custoContagem: '{n} geração(ões)',
    erroPapelInvalido: 'Papel inválido.',
    erroNaoAplicado: 'Não foi possível aplicar o papel.',
    erroGenerico: 'Algo deu errado. Tente de novo.',
  },
  moderacao: {
    titulo: 'Fila de moderação',
    receita: 'Receita',
    origem: 'Origem',
    tipoResultado: 'Tipo de resultado',
    motivoReport: 'Motivo do report',
    status: 'Status',
    statusPendente: 'Pendente',
    // Rótulos de VALOR de `origin` (6 valores de ORIGENS) — NÃO vazar token cru.
    origemCatalog: 'Catálogo',
    origemAiChat: 'Conversa com IA',
    origemAiStructured: 'Briefing estruturado',
    origemAiFreeText: 'Prompt aberto',
    origemUserEdited: 'Editada por pessoa',
    origemWebImported: 'Importada da web',
    // Rótulos de VALOR de `resultKind` (3 valores de RESULT_KINDS).
    tipoSucesso: 'Sucesso',
    tipoDegradado: 'Degradado',
    tipoPlayful: 'Bem-humorado',
    manter: 'Manter no pool',
    remover: 'Remover do pool',
    motivoRemocao: 'Motivo da remoção',
    motivoPlaceholder: 'Explique por que esta receita sai do pool',
    confirmarRemocao: 'Confirmar remoção',
    cancelar: 'Cancelar',
    removendo: 'Removendo…',
    // "Remover só a imagem" (#133): esconde a foto do público SEM tirar a Receita do pool.
    removerImagem: 'Remover só a imagem',
    removendoImagem: 'Removendo imagem…',
    filaVazia: 'Nenhum report pendente.',
    erroMotivo: 'Informe o motivo da remoção.',
    erroSemImagem: 'Esta receita não tem imagem para remover.',
    erroJaResolvido: 'Este report já foi resolvido.',
    erroGenerico: 'Não foi possível processar o report. Tente de novo.',
    // #226 (ADR-0022 dec.3 / 1º gancho do ADR-0007): o Curador bloqueia/desbloqueia a geração-de-
    // imagem-por-IA do AUTOR da receita reportada (abuso confirmado). Só aparece quando há dono
    // (Catálogo → sem ação). O motivo é OBRIGATÓRIO ao bloquear (espelha o remove-do-pool).
    bloquearGeracao: 'Bloquear geração de imagem do autor',
    confirmarBloqueio: 'Confirmar bloqueio',
    desbloquearGeracao: 'Desbloquear geração de imagem do autor',
    bloqueandoGeracao: 'Bloqueando…',
    desbloqueandoGeracao: 'Desbloqueando…',
    motivoBloqueioGeracao: 'Motivo do bloqueio',
    motivoBloqueioPlaceholder: 'Explique por que o autor perde a geração de imagem por IA',
    erroUsuarioNaoEncontrado: 'Não foi possível encontrar o autor desta receita.',
    // #366: card de report de uma AVALIAÇÃO. O Curador remove a avaliação INTEIRA (nota+comentário+
    // foto) — remoção LÓGICA — ou MANTÉM (keep, único descarte). O dono NÃO tem ação aqui.
    avaliacaoDe: 'Autor da avaliação',
    avaliacaoNota: 'Nota',
    avaliacaoComentario: 'Comentário',
    avaliacaoSemComentario: 'Sem comentário',
    // #365: a FOTO reportada, mostrada ao Curador (rota gated) pra julgar com visibilidade.
    avaliacaoFoto: 'Foto',
    avaliacaoFotoAlt: 'Foto da avaliação',
    removerAvaliacao: 'Remover avaliação',
    removendoAvaliacao: 'Removendo avaliação…',
    erroSemAvaliacao: 'Este report não é de uma avaliação.',
  },
  // #227 (ADR-0022 dec.3): fila PROATIVA e NÃO-BLOQUEANTE do Curador — gerações por IA COM refino.
  // A imagem segue pública (default-open, ADR-0020); o Curador só monitora e pode REMOVER (moderar,
  // esconde do público) OU DISPENSAR (julgou ok, mantém pública). Espelha a fila de moderação.
  revisaoImagens: {
    titulo: 'Imagens para revisar',
    descricao:
      'Gerações por IA com refino do autor. A imagem continua visível ao público — esta fila é só para monitorar. Remova (esconde do público) ou dispense (mantém visível).',
    receita: 'Receita',
    autor: 'Autor',
    semReceita: 'Sem receita vinculada',
    refinada: 'Gerada com refino',
    abrirReceita: 'Abrir receita',
    remover: 'Remover',
    removendo: 'Removendo…',
    confirmarRemocao: 'Confirmar remoção',
    motivoRemocao: 'Motivo da remoção',
    motivoPlaceholder: 'Explique por que esta imagem sai do público',
    dispensar: 'Dispensar',
    dispensando: 'Dispensando…',
    cancelar: 'Cancelar',
    filaVazia: 'Nenhuma imagem para revisar.',
    erroMotivo: 'Informe o motivo da remoção.',
    erroNaoEncontrada: 'Esta imagem não está mais na fila.',
    erroGenerico: 'Não foi possível processar a imagem. Tente de novo.',
  },
  // #320 (ADR-0025 Decisão 5): fila REATIVA do Curador para as cozinhas SUGERIDAS pelo fluxo "Outra"
  // (#319). É o único lugar do Curador que mostra o slug CRU sugerido. O Curador aprova (vira faceta,
  // batizando os rótulos e podendo corrigir o slug canônico), mescla numa cozinha ativa, ou rejeita.
  filaCozinhas: {
    titulo: 'Cozinhas sugeridas',
    descricao:
      'Cozinhas propostas por usuários (opção "Outra"). Aprove para virar uma faceta, mescle numa existente, ou rejeite.',
    cozinha: 'Cozinha sugerida',
    receitas: 'Receitas',
    rotuloPtBr: 'Rótulo (português)',
    rotuloEnUs: 'Rótulo (inglês)',
    slugCanonico: 'Corrigir o slug (opcional)',
    slugCanonicoPlaceholder: 'ex.: georgiana',
    alvoMesclar: 'Mesclar na cozinha (slug)',
    alvoPlaceholder: 'ex.: italiana',
    aprovar: 'Aprovar',
    confirmarAprovacao: 'Confirmar aprovação',
    aprovando: 'Aprovando…',
    mesclar: 'Mesclar',
    confirmarMesclagem: 'Confirmar mesclagem',
    mesclando: 'Mesclando…',
    rejeitar: 'Rejeitar',
    rejeitando: 'Rejeitando…',
    cancelar: 'Cancelar',
    filaVazia: 'Nenhuma cozinha sugerida.',
    erroRotulos: 'Informe os dois rótulos (português e inglês).',
    erroSlugInvalido: 'Slug inválido. Use apenas letras minúsculas, números e hífens.',
    erroSlugEmUso: 'Já existe uma cozinha com esse slug.',
    erroAlvoInvalido: 'Escolha uma cozinha ativa existente para mesclar.',
    erroJaResolvido: 'Esta sugestão já foi resolvida.',
    erroNaoEncontrado: 'Esta sugestão não existe mais.',
    erroGenerico: 'Não foi possível processar a sugestão. Tente de novo.',
  },
  traducoesStale: {
    titulo: 'Traduções desatualizadas',
    receita: 'Receita',
    idioma: 'Idioma',
    origem: 'Origem',
    provAutomaticaNaoRevisada: 'Automática (não revisada)',
    provAutomaticaRevisada: 'Automática (revisada)',
    provEscritaPorPessoa: 'Escrita por pessoa',
    marcarRevisada: 'Marcar como revisada',
    marcando: 'Marcando…',
    listaVazia: 'Nenhuma tradução desatualizada.',
    erroGenerico: 'Não foi possível marcar como revisada. Tente de novo.',
    // #498 (ADR-0031 companheiro iii): edição do nome de ingrediente traduzido.
    editarNomes: 'Editar nomes de ingrediente',
    fecharNomes: 'Fechar',
    carregandoIngredientes: 'Carregando ingredientes…',
    erroCarregarIngredientes: 'Não foi possível carregar os ingredientes.',
    semIngredientesNomeados: 'Nenhum ingrediente com nome nesta receita.',
    nomeIngredienteLabel: 'Nome do ingrediente',
    salvarNomes: 'Salvar',
    salvando: 'Salvando…',
    nomesSalvos: 'Nomes salvos.',
    erroSalvarNomes: 'Não foi possível salvar os nomes. Tente de novo.',
  },
  // Lista do Curador — defasadas-E-divergentes (#500, ADR-0031 dec.6): a fonte mudou e o
  // conteúdo já diverge da última MT (editado à mão) ou é legado sem prova de intocabilidade.
  // Reusa os rótulos de proveniência/editor de nomes de `traducoesStale` (mesma ação de correção).
  traducoesDivergentes: {
    titulo: 'Traduções para re-revisão',
    descricao:
      'A fonte mudou e o conteúdo já diverge da última tradução automática — corrija à mão.',
    receita: 'Receita',
    idioma: 'Idioma',
    origem: 'Origem',
    listaVazia: 'Nenhuma tradução para re-revisão.',
  },
  curadoria: {
    titulo: 'Curadoria de catálogo',
    ingredientesTitulo: 'Ingredientes recorrentes',
    aparicoes: 'Aparições',
    promover: 'Promover a canônico',
    promovendo: 'Promovendo…',
    promocaoVazia: 'Nenhum ingrediente recorrente para promover.',
    erroSlugEmUso: 'Este ingrediente já existe.',
    erroGenerico: 'Não foi possível promover. Tente de novo.',
    // #266: gatilho do drawer lateral + label do X (ADR-0021).
    criarReceitaBotao: 'Nova receita de catálogo',
    criarReceitaFechar: 'Fechar',
    criarReceitaTitulo: 'Criar receita do catálogo',
    criarReceitaDescricao: 'Cadastre uma receita completa para a coleção editorial.',
    criarReceitaTituloCampo: 'Título',
    criarReceitaObrigatorio: '(obrigatório)',
    criarReceitaTituloPlaceholder: 'Ex.: Feijoada',
    criarReceitaIdiomaOriginal: 'Idioma original',
    criarReceitaDescricaoCampo: 'Descrição',
    criarReceitaIngredientes: 'Ingredientes',
    criarReceitaIngrediente: 'Ingrediente',
    criarReceitaIngredientePlaceholder: 'Ex.: feijão preto',
    criarReceitaQuantidade: 'Quantidade',
    criarReceitaQuantidadePlaceholder: 'Ex.: 500',
    criarReceitaUnidade: 'Unidade',
    criarReceitaUnidadeNenhuma: 'Sem unidade',
    criarReceitaAdicionarIngrediente: 'Adicionar ingrediente',
    criarReceitaRemoverIngrediente: 'Remover',
    criarReceitaCozinha: 'Cozinha',
    criarReceitaCozinhaNenhuma: 'Nenhuma',
    criarReceitaCategoria: 'Categoria',
    criarReceitaCategoriaNenhuma: 'Nenhuma',
    criarReceitaRestricoes: 'Restrições',
    criarReceitaPorcoes: 'Porções',
    criarReceitaDificuldade: 'Dificuldade (1 a 5)',
    criarReceitaPassos: 'Modo de preparo',
    criarReceitaPasso: 'Passo',
    criarReceitaAdicionarPasso: 'Adicionar passo',
    criarReceitaRemoverPasso: 'Remover',
    criarReceitaNotas: 'Notas',
    criarReceitaEnviar: 'Criar receita',
    criarReceitaEnviando: 'Criando…',
    criarReceitaSucesso: 'Receita criada no catálogo.',
    criarReceitaErroTitulo: 'Informe o título da receita.',
    criarReceitaErroDados: 'Verifique os campos: algum valor está inválido.',
    criarReceitaErroConexao: 'Não foi possível conectar. Tente de novo.',
    criarReceitaErroGenerico: 'Não foi possível criar a receita. Tente de novo.',
    // #238/ADR-0026: fila de curadoria de RECEITAS de catálogo (rascunhos pendentes da IA).
    filaTitulo: 'Receitas pendentes de curadoria',
    filaVazia: 'Nenhuma receita pendente.',
    filaAprovar: 'Aprovar',
    filaAprovando: 'Aprovando…',
    filaRejeitar: 'Rejeitar',
    filaRejeitando: 'Rejeitando…',
    filaRejeitarNota: 'Motivo da rejeição (opcional)',
    filaRejeitarConfirmar: 'Confirmar rejeição',
    filaRejeitarCancelar: 'Cancelar',
    filaErro: 'Não foi possível concluir. Tente de novo.',
    filaCozinha: 'Cozinha',
    filaCategoria: 'Categoria',
    filaPorcoes: 'Porções',
    filaDificuldade: 'Dificuldade',
    filaRejeitadasTitulo: 'Rejeitadas',
    filaRejeitadasVazia: 'Nenhuma rejeitada.',
    filaRestaurar: 'Restaurar à fila',
    filaRestaurando: 'Restaurando…',
    filaVer: 'Ver receita',
    filaOcultar: 'Ocultar',
    filaIngredientes: 'Ingredientes',
    filaPreparo: 'Modo de preparo',
    filtroTodasCozinhas: 'Todas as cozinhas',
    filtroTodasCategorias: 'Todas as categorias',
    filtroBusca: 'Buscar por título…',
    filaVerMais: 'Ver mais',
    filaSemFiltro: 'Nenhuma receita pendente com esse filtro.',
    filaContagem: 'pendentes',
    // #238 (emenda): editar antes de aprovar + imagem do catálogo.
    filaEditar: 'Editar',
    filaEditarSalvar: 'Salvar',
    filaEditarTitulo: 'Editar rascunho',
    filaEditarDescricao: 'Ajuste o conteúdo antes de aprovar. As mudanças não vão ao ar até você aprovar.',
    filaImagem: 'Imagem',
    filaImagemOcultar: 'Ocultar imagem',
    filaImagemGerar: 'Gerar imagem',
    filaImagemGerarOutra: 'Gerar outra',
    filaImagemSubir: 'Subir foto',
    filaImagemRemover: 'Remover foto',
    filaImagemSemFoto: 'Sem foto',
    filaImagemUsarEsta: 'Usar esta',
    filaImagemFaceAtual: 'Foto atual',
    filaImagemApagar: 'Apagar imagem',
    filaImagemErro: 'Não foi possível atualizar a imagem. Tente de novo.',
    filaImagemTipoInvalido: 'Formato inválido (use JPG, PNG ou WebP).',
    filaImagemGrande: 'Imagem muito grande (máx. 2 MB).',
  },
  // Política de Privacidade (#398 / parte de #276) — PUBLICADA (indexável, linkada no rodapé + sitemap).
  // Chaves FLAT dentro da seção (o tipo `Messages` deriva só 2 níveis): folhas string ou
  // `readonly string[]` (listas/tabelas por índice). Os placeholders foram resolvidos com os contatos
  // reais escritos DIRETO nestas strings (esta seção é o único lugar pra editar nome/e-mail do encarregado).
  // Publicada por decisão do dono; o sign-off jurídico segue pendente em #276.
  privacidade: {
    metaTitulo: 'Política de Privacidade — Refogando',
    titulo: 'Política de Privacidade',

    parteATitulo: 'Parte (a) — Política de Privacidade',
    resumoTitulo: 'Resumo em 30 segundos',
    resumoItens: [
      'O Refogando é um app de receitas com IA.',
      'Coletamos o mínimo: o necessário para você ter uma conta e usar o app e, quando você importa uma receita de um site externo, o nome do autor/site e o link de origem, só para dar o crédito.',
      'Não vendemos seus dados. Compartilhamos apenas com prestadores de serviço que fazem o app funcionar (hospedagem, banco, IA).',
      'Você tem direitos (acesso, correção, exclusão etc. — Art. 18 da LGPD). Fale com nosso encarregado: privacidade@refogando.com. Respondemos em até 15 dias.',
      'Este texto pode mudar; avisamos quando mudar.',
    ],

    s1Titulo: '1. Quem somos (identificação do controlador) — Art. 9º, III',
    s1Corpo: [
      'O controlador dos dados é Fernando Lisboa, pessoa física responsável pelo aplicativo Refogando (https://refogando.com).',
      'Como o Refogando é operado por pessoa física, não há razão social nem CNPJ associados; o contato oficial é o e-mail de privacidade indicado abaixo.',
    ],

    s2Titulo: '2. Contato do controlador e do encarregado (DPO) — Art. 9º, IV; Art. 41',
    s2Itens: [
      'Encarregado pelo tratamento de dados (DPO): Fernando Lisboa.',
      'E-mail de contato para assuntos de privacidade e exercício de direitos: privacidade@refogando.com.',
      'Prazo de resposta: respondemos a pedidos dos titulares em até 15 dias (LGPD, Art. 19, II).',
    ],

    s3Titulo: '3. Para que usamos seus dados (finalidade específica) — Art. 9º, I; Art. 6º, I',
    s3Intro:
      'Tratamos dados pessoais apenas para finalidades específicas e informadas. Cada atividade segue o padrão Dados / Finalidade / Base legal / Retenção.',
    s3Nota:
      'O inventário completo de dados de conta/uso ainda será fechado com a equipe e validado; o quadro abaixo é o esqueleto dos tratamentos confirmados. A feature de Descoberta na web está detalhada na Parte (b).',

    rotuloDados: 'Dados',
    rotuloFinalidade: 'Finalidade',
    rotuloBaseLegal: 'Base legal',
    rotuloRetencao: 'Retenção',

    s31Titulo: '3.1. Conta de usuário e autenticação',
    s31Valores: [
      'e-mail, nome/identificador de exibição (handle), credenciais de login e foto de perfil, biografia, links e idioma preferido.',
      'criar e manter sua conta, autenticar o acesso e permitir o uso do app.',
      'execução de contrato com o titular — Art. 7º, V da LGPD.',
      'enquanto a conta existir; após a exclusão, anonimizamos imediatamente os dados de identificação e eliminamos os resquícios físicos (como imagens) após um prazo de retenção.',
    ],
    s32Titulo: '3.2. Conteúdo criado no app (receitas, coleções, avaliações)',
    s32Valores: [
      'receitas que você cria, salva, avalia e organiza; preferências de idioma; conteúdo textual que você escreve.',
      'entregar a funcionalidade do app (guardar e exibir seu conteúdo, montar coleções, feed e busca).',
      'execução de contrato — Art. 7º, V.',
      'enquanto a conta existir ou até você apagar o conteúdo.',
    ],
    s33Titulo: '3.3. Imagens geradas por IA e conteúdo assistido por IA',
    s33Valores: [
      'prompts e imagens que você gera; metadados de uso (para controle de custo/cota).',
      'gerar imagens de pratos e apoiar a criação de receitas; controlar limites de uso.',
      'execução de contrato — Art. 7º, V; e legítimo interesse para prevenção de abuso/controle de custo — Art. 7º, IX.',
      'enquanto a conta existir ou até você apagar o conteúdo.',
    ],
    s34Titulo: '3.4. Atribuição de receitas importadas da web ("Descoberta na web")',
    s34Corpo:
      'Detalhada na Parte (b). Em resumo: guardamos nome do autor/site e URL de origem, só para dar crédito. Base legal: legítimo interesse — Art. 7º, IX (com dado manifestamente público — Art. 7º, §4º como fundamento alternativo).',

    s4Titulo: '4. Como e por quanto tempo tratamos (forma e duração) — Art. 9º, II',
    s4Itens: [
      'Como: os dados são tratados por meios eletrônicos, em servidores de prestadores de serviço contratados (ver item 5). Aplicamos medidas de segurança compatíveis (Art. 46), incluindo controle de acesso por autenticação e autorização por titularidade.',
      'Por quanto tempo: mantemos cada dado apenas pelo tempo necessário à finalidade que o justifica (item 3) ou por obrigação legal. Ao encerrar a finalidade, eliminamos ou anonimizamos os dados (Art. 15/16). Os prazos específicos seguem a finalidade de cada tratamento descrita no item 3.',
    ],

    s5Titulo: '5. Com quem compartilhamos (uso compartilhado) — Art. 9º, V',
    s5Intro:
      'Não vendemos dados pessoais. Compartilhamos com operadores (prestadores de serviço que tratam dados em nosso nome, sob contrato) estritamente para operar o app:',
    s5Cabecalho: ['Prestador', 'Para quê', 'Categoria'],
    s5Prestadores: ['Vercel', 'Neon', 'Google (Gemini)', 'Anthropic (Claude)', 'Brave Search'],
    s5ParaQue: [
      'Hospedagem do aplicativo',
      'Banco de dados',
      'Geração de imagens e embeddings de busca',
      'Geração/assistência de texto',
      'Busca de links externos na "Descoberta na web"',
    ],
    s5Categorias: [
      'Operador de infraestrutura',
      'Operador de infraestrutura',
      'Operador de IA',
      'Operador de IA',
      'Operador de busca',
    ],
    s5Nota: 'Finalidade do compartilhamento: exclusivamente a operação técnica das funções acima; nenhum parceiro recebe dados para finalidade própria de marketing.',
    s5Transferencia:
      'Transferência internacional: alguns prestadores processam dados fora do Brasil, com as salvaguardas de transferência internacional previstas na LGPD (Arts. 33 a 36).',

    s6Titulo: '6. Responsabilidades dos agentes de tratamento — Art. 9º, VI; Arts. 37–39',
    s6Itens: [
      'Fernando Lisboa atua como controlador e é responsável pelas decisões sobre o tratamento.',
      'Os prestadores do item 5 atuam como operadores, tratando dados conforme nossas instruções e sob contrato.',
      'Mantemos registro das operações de tratamento (Art. 37) e adotamos medidas de segurança (Art. 46). Em caso de incidente de segurança com risco relevante, comunicamos a ANPD e os titulares (Art. 48).',
    ],

    s7Titulo: '7. Seus direitos (direitos do titular) — Art. 9º, VII; Art. 18',
    s7Intro:
      'Você, titular dos dados, tem os direitos garantidos pelo Art. 18 da LGPD, mediante requisição, entre eles:',
    s7Direitos: [
      'Confirmação da existência de tratamento;',
      'Acesso aos dados;',
      'Correção de dados incompletos, inexatos ou desatualizados;',
      'Anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade;',
      'Portabilidade a outro fornecedor, mediante requisição;',
      'Eliminação dos dados tratados com consentimento (ressalvadas as hipóteses do Art. 16);',
      'Informação sobre entidades com as quais compartilhamos dados;',
      'Informação sobre a possibilidade de não fornecer consentimento e as consequências;',
      'Revogação do consentimento;',
      'Quando o tratamento se basear em legítimo interesse, o direito de opor-se e de solicitar informações (Art. 18, §2º, e Art. 37).',
    ],
    s7ComoExercer:
      'Como exercer: use a página Seus Direitos (/seus-direitos) ou escreva para privacidade@refogando.com. Respondemos em até 15 dias (Art. 19, II). Você também pode peticionar à Autoridade Nacional de Proteção de Dados (ANPD).',

    s8Titulo: '8. Alterações desta política',
    s8Corpo:
      'Podemos atualizar esta política. Quando houver mudança relevante, avisaremos pela página Seus Direitos (/seus-direitos) e pelo e-mail privacidade@refogando.com, e registraremos a versão e a data de cada alteração.',

    parteBTitulo: 'Parte (b) — "Descoberta na web"',
    resumoBTitulo: 'Resumo desta seção',
    resumoBItens: [
      'Quando você importa uma receita de um site externo, guardamos duas coisas sobre a origem: o nome do autor/site e o link (URL) — só para creditar a fonte.',
      'Não copiamos a foto nem o texto autoral (a receita importada nasce sem imagem e sem descrição).',
      'A receita importada é sempre privada — você não pode publicá-la nem republicá-la.',
      'O dado pessoal aqui é o nome do autor da receita de terceiro — e você, autor, pode pedir a remoção do seu nome (o crédito passa a exibir só o site).',
    ],

    b1Titulo: 'b.1. O que é a Descoberta na web',
    b1Corpo: [
      'O Refogando pode mostrar, na busca, alguns links de receitas de sites externos (marcados "da web"), a partir de uma lista fechada de domínios que aprovamos um a um (allowlist; provedor de busca: Brave). Se você clica e confirma, o app importa aquela receita para a sua coleção privada.',
    ],
    b1Itens: [
      'A busca nunca cria nem republica conteúdo de terceiros. Linkar ≠ importar; importar ≠ republicar.',
      'A allowlist é a fonte única de domínios (gerida por admin; com limites de domínios consultados e de resultados por busca).',
      'Guard-rails técnicos já implementados: respeito ao robots.txt (RFC 9309), User-Agent identificado (RefogandoBot/1.0), rate-limit de cortesia e busca/import só por ação explícita do usuário — nunca crawl automático de fundo.',
    ],

    b2Titulo: 'b.2. Quem é o titular do dado aqui',
    b2Corpo:
      'O dado pessoal tratado nesta feature é o nome do autor/publisher da receita de terceiro — ou seja, o titular é o autor da receita externa, e não o usuário do app. Essa distinção importa para o exercício de direitos (item b.5).',

    b3Titulo: 'b.3. Que dados coletamos, para quê, com que base e por quanto tempo',
    b3Rotulos: ['Dados', 'O que NÃO coletamos', 'Finalidade', 'Base legal', 'Retenção'],
    b3Valores: [
      'Apenas dois campos de atribuição, gravados só em receitas importadas: o nome legível do autor/site e a URL pública de origem. Toda receita que não é importada deixa esses dois campos vazios.',
      'Não copiamos a foto (a receita importada nasce sem imagem) nem o texto autoral / headnote. Isso reduz ao mínimo a superfície de dado de terceiros e evita copiar a camada expressiva protegida por direito autoral.',
      'Dar o crédito à fonte ("fonte: … (link)") — cumprindo o direito moral de atribuição (Lei 9.610/98) — e mandar tráfego de volta ao site de origem. A atribuição é obrigatória, não opcional.',
      'Legítimo interesse — LGPD Art. 7º, IX. Fundamento alternativo/complementar: dado tornado manifestamente público pelo titular (Art. 7º, §4º).',
      'Enquanto a receita importada existir na coleção privada do usuário, ou até o autor pedir a remoção do nome (item b.5), ou até o usuário apagar a receita. Ao remover o nome, o crédito passa a exibir apenas o site (host) derivado da URL.',
    ],

    b4Titulo: 'b.4. Compartilhamento nesta feature',
    b4Corpo:
      'Para encontrar os links externos, consultamos o provedor de busca Brave (operador), enviando o termo de busca restrito aos domínios da allowlist. A importação é uma cópia feita a pedido do usuário, guardada de forma privada na conta dele — não é republicada nem compartilhada com terceiros.',

    b5Titulo: 'b.5. Direitos do titular (autor da receita externa) e como exercer — Art. 18',
    b5Intro:
      'Se você é autor de uma receita que foi importada para o Refogando e quer remover o seu nome da atribuição, você tem esse direito (Art. 18, IV; e o direito de oposição ao tratamento fundado em legítimo interesse, Art. 18, §2º).',
    b5ComoFunciona: [
      'A remoção zera apenas o nome do autor; a URL de origem permanece, porque a atribuição é obrigatória. Após a remoção, o crédito é rebaixado ao nome do site (host) derivado da URL, e o link "ver no site" continua.',
      'A remoção só tem efeito quando há de fato um nome humano distinto do host; caso contrário é uma operação sem efeito.',
      'A remoção não é reversível para o nome original — o que é adequado ao direito de remoção.',
    ],
    b5Contato:
      'Contato do encarregado para esta finalidade: Fernando Lisboa — privacidade@refogando.com — resposta em até 15 dias. Você também pode usar o formulário público na página Seus Direitos (/seus-direitos).',

    todoRotulo: 'campo a preencher',
    rodapeVersaoRotulo: 'Versão',
    rodapeVersao: 'v1',
    rodapeDataRotulo: 'Data',
    rodapeData: '2026-07-03',
    rodapeStatusRotulo: 'Status',
    rodapeStatus: 'Publicada — revisão jurídica em andamento',
  },

  // Página "Seus direitos" + formulário público de intake (#399, GAP-2; parte de #276). PUBLICADA:
  // indexável, linkada no rodapé e no sitemap; o canal (e-mail + formulário) já existe e é funcional.
  seusDireitos: {
    metaTitulo: 'Seus direitos / Privacidade — Refogando',
    titulo: 'Seus direitos',
    intro:
      'Você tem direitos sobre os seus dados pessoais (LGPD, Art. 18): confirmação, acesso, correção, eliminação, oposição e outros. Nesta página explicamos como exercê-los e você pode abrir um pedido pelo formulário abaixo. Respondemos em até 15 dias (Art. 19, II).',

    titularATitulo: 'Você tem conta no Refogando',
    titularACorpo:
      'Se você é usuário do app, boa parte dos seus direitos é atendida direto na sua conta (perfil, receitas, coleções). Para o que ainda não é self-service, use o formulário abaixo ou o e-mail de privacidade — sempre dentro do prazo de 15 dias.',
    titularBTitulo: 'Você é autor de uma receita importada da web',
    titularBCorpo:
      'Se uma receita sua foi importada de um site externo para o Refogando, guardamos apenas o seu nome (crédito) e o link de origem — nunca a foto nem o texto autoral. Você pode pedir a remoção do seu nome (o crédito passa a exibir só o site) ou a remoção integral. Você NÃO precisa ter conta: use o formulário abaixo.',

    fluxoTitulo: 'Como funciona o pedido',
    fluxoPassos: [
      'Você envia o pedido pelo formulário (ou pelo e-mail de privacidade), identificando o conteúdo (link de origem e/ou nome exibido) e o que deseja.',
      'Abrimos um protocolo e registramos a data de recebimento — é quando começa a contar o prazo de 15 dias (Art. 19, II).',
      'Confirmamos a sua identidade do modo mais simples possível (em regra, a correspondência com o contato já ligado à origem). Não exigimos documentos como condição (Art. 6º, III).',
      'Executamos o pedido e respondemos dentro do prazo, informando o que foi feito — ou, em caso de recusa justificada, o motivo.',
    ],
    prazoNota: 'Prazo de resposta: até 15 dias corridos, contados do recebimento (LGPD, Art. 19, II).',
    naoExigimosDocumentos:
      'Coletamos apenas o mínimo necessário para localizar o conteúdo e atender o pedido. Não exigimos documentos nem dados pessoais adicionais como condição (Art. 6º, III — necessidade).',

    canalTitulo: 'Canal de contato',
    canalCorpo:
      'Encarregado pelo tratamento de dados (DPO): Fernando Lisboa. E-mail para privacidade e exercício de direitos: privacidade@refogando.com.',

    formTitulo: 'Abrir um pedido',
    formIntro:
      'Preencha o pedido abaixo. Informe o link de origem e/ou o nome exibido para localizarmos o conteúdo, e descreva o que você deseja.',
    formTipoRotulo: 'Tipo de pedido',
    formTipoNameRemoval: 'Remover o meu nome do crédito (mantendo o link)',
    formTipoFullRemoval: 'Remover integralmente a receita importada',
    formTipoOther: 'Outro pedido sobre meus dados',
    formUrlRotulo: 'Link de origem (URL)',
    formUrlPlaceholder: 'https://site-de-origem.com/receita',
    formNomeRotulo: 'Nome exibido no crédito',
    formNomePlaceholder: 'Ex.: Cozinha da Vovó',
    formIdentificacaoDica: 'Informe ao menos um: o link de origem OU o nome exibido.',
    formPedidoRotulo: 'Seu pedido',
    formPedidoPlaceholder: 'Descreva o que você deseja (ex.: remover meu nome do crédito desta receita).',
    formContatoRotulo: 'E-mail para resposta (opcional)',
    formContatoPlaceholder: 'seu@email.com',
    formContatoDica: 'Opcional. Se informar, usamos apenas para responder a este pedido.',
    formEnviar: 'Enviar pedido',
    formEnviando: 'Enviando…',
    formSucessoTitulo: 'Pedido recebido',
    formSucessoCorpo:
      'Recebemos o seu pedido e registramos a data de recebimento. Responderemos em até 15 dias. Guarde o número de protocolo abaixo.',
    formProtocoloRotulo: 'Protocolo',
    erroPedido: 'Descreva o seu pedido para continuar.',
    erroIdentificacao: 'Informe ao menos um: o link de origem ou o nome exibido.',
    erroEnvio: 'Não foi possível enviar o pedido agora. Tente novamente em instantes.',

    todoRotulo: 'campo a preencher',
    rodapeVersaoRotulo: 'Versão',
    rodapeVersao: 'v1',
    rodapeDataRotulo: 'Data',
    rodapeData: '2026-07-03',
    rodapeStatusRotulo: 'Status',
    rodapeStatus: 'Publicada — revisão jurídica em andamento',
  },
} as const

/**
 * Shape do catálogo, derivado de `ptBR` mas com as folhas alargadas de literal para `string`.
 * Assim o en-US herda exatamente as MESMAS chaves (paridade garantida pelo compilador) sem
 * ficar preso aos literais em português. As folhas em si continuam literais em `typeof ptBR`
 * para quem lê o catálogo pt-BR.
 *
 * Folhas-ARRAY (ex.: `conversa.placeholders`, exemplos rotativos do input, #104) viram
 * `readonly string[]` em vez de `string` — alargadas no elemento mas mantendo a forma de lista.
 * A paridade de COMPRIMENTO entre locales é exigida pelo teste recursivo (que trata o array
 * como objeto de chaves numéricas), não pelo tipo.
 */
export type Messages = {
  // Uma SEÇÃO de topo costuma ser um objeto de folhas (`{ chave: 'texto' }`); o ramo escalar abaixo
  // libera uma seção que é uma STRING direta (ex.: `unidadeConector: 'de'`), traduzível como folha
  // de topo sem virar `{ k: v }` artificial. Nenhuma seção-objeto existente casa `extends string`,
  // então o ramo é puramente ADITIVO (não muda o tipo das seções atuais).
  [Section in keyof typeof ptBR]: (typeof ptBR)[Section] extends string
    ? string
    : {
        [Key in keyof (typeof ptBR)[Section]]: (typeof ptBR)[Section][Key] extends readonly string[]
          ? readonly string[]
          : string
      }
}
