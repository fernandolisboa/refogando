/**
 * Catálogo de chrome em pt-BR (issue #4). `Messages = typeof ptBR` ancora o shape;
 * o en-US DEVE ter exatamente as mesmas chaves (teste de paridade T3 garante).
 */
import type { Categoria, Cozinha, Restricao, Unidade } from '@/domain/vocabulary'

export const ptBR = {
  app: { name: 'Refogando', tagline: 'Cozinhe qualquer ideia' },
  nav: { home: 'Início', recipes: 'Receitas', create: 'Criar', conversar: 'Conversar', signIn: 'Entrar', signOut: 'Sair' },
  locale: { label: 'Idioma', ptBR: 'Português (Brasil)', enUS: 'Inglês (EUA)' },
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
  // Tela de Busca (#56): título, campo, estados (inicial/vazio), seções e selos de
  // proveniência por item. Os rótulos de SELO ("Do catálogo"/"Da comunidade") são
  // distintos dos de SEÇÃO ("Catálogo"/"Comunidade") de propósito — desambigua heading
  // de etiqueta de item e lê melhor.
  busca: {
    titulo: 'Buscar receitas',
    placeholder: 'Digite um prato, ingrediente ou estilo culinário',
    buscar: 'Buscar',
    dicaInicial: 'Comece digitando um prato, ingrediente ou estilo que você curte — ou use os filtros.',
    semResultado: 'Nenhuma receita encontrada. Tente outro termo ou ajuste os filtros.',
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
  },
  // Feed /recipes (#103): lista plana e cronológica do pool, scroll infinito. Reusa `busca.*`
  // para selos/tradução automática (chrome compartilhado); só os textos próprios do feed
  // vivem aqui. Sem filtros — daí não há `semResultado` de filtro, só `vazio` (pool vazio).
  feed: {
    titulo: 'Receitas',
    subtitulo: 'O que a comunidade anda cozinhando, do mais novo ao mais antigo.',
    vazio: 'Ainda não há receitas por aqui.',
    carregarMais: 'Carregar mais',
    fim: 'Você chegou ao fim.',
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
  // Rótulo amigável por valor do enum COZINHAS (#56). `satisfies Record<Cozinha, string>`
  // trava drift do enum (chave faltante/extra/typo) no site de definição.
  cozinhaLabel: {
    italiana: 'Italiana',
    japonesa: 'Japonesa',
    brasileira: 'Brasileira',
    baiana: 'Baiana',
    mineira: 'Mineira',
    mexicana: 'Mexicana',
    chinesa: 'Chinesa',
    indiana: 'Indiana',
    tailandesa: 'Tailandesa',
    francesa: 'Francesa',
    arabe: 'Árabe',
    portuguesa: 'Portuguesa',
    mediterranea: 'Mediterrânea',
    peruana: 'Peruana',
  } satisfies Record<Cozinha, string>,
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
  // Página de detalhe da Receita (#57): headings/rótulos da leitura localizada. Os SELOS
  // de proveniência REUSAM busca.seloCatalogo/seloComunidade (mesmo conceito/componente
  // ProvenanceBadge da #56) — não duplicar aqui.
  detalhe: {
    ingredientes: 'Ingredientes',
    passos: 'Modo de preparo',
    notas: 'Notas',
    descricao: 'Descrição',
    porcoes: 'Porções',
    dificuldade: 'Dificuldade',
    cozinha: 'Cozinha',
    categoria: 'Categoria',
    restricoes: 'Restrições',
    tags: 'Tags',
    avisoTitulo: 'Aviso de restrição',
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
    ingredientePlaceholder: 'Ex.: 1 cebola grande',
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
    erroBriefingVazio:
      'Adicione ao menos um ingrediente, uma cozinha, uma restrição ou uma observação.',
    erroPorcoes: 'As porções devem ficar entre 1 e 50.',
    erroDificuldade: 'A dificuldade deve ficar entre 1 e 5.',
    erroObservacoesLongas: 'As observações estão muito longas.',
    erroIngrediente: 'Preencha o ingrediente nas linhas que você começou.',
    erroCampos: 'Verifique os campos preenchidos.',
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
    erroPlayful: 'Esta receita de zoeira não pode ser publicada.',
    erroNaoEncontrada: 'Não foi possível encontrar esta receita.',
    erroGenerico: 'Não foi possível mudar a visibilidade. Tente de novo.',
  },
  // Edição IN-PLACE + apagar a PRÓPRIA receita (#21). Confirmar editar a pública (história #277:
  // a mudança fica visível a quem favoritou), apagar com aviso de irreversibilidade (#157), e o
  // rótulo de "vínculo perdido" quando a base de uma derivada foi apagada (#289).
  edicaoPropria: {
    editarPublicaTitulo: 'Editar receita pública',
    editarPublicaAviso:
      'Esta receita é pública. Suas mudanças ficam visíveis para quem já a favoritou ou está vendo na comunidade.',
    editarPublicaConfirmar: 'Salvar mudanças',
    editarPublicaCancelar: 'Cancelar',
    apagarTitulo: 'Apagar receita',
    apagarAviso: 'Apagar é permanente: a receita some de vez e não dá para recuperar.',
    apagarConfirmar: 'Apagar para sempre',
    apagarCancelar: 'Cancelar',
    apagando: 'Apagando…',
    apagarErro: 'Não foi possível apagar a receita. Tente de novo.',
    vinculoPerdido: 'A receita original foi apagada — sua versão continua completa, só sem o vínculo com ela.',
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
  comunidade: {
    titulo: 'Comunidade',
    votar: 'Votar',
    votado: 'Votado',
    // Plural composto no componente via `.replace('{n}', …)` (folhas do tipo `Messages` são
    // string — função quebraria o tipo e a paridade). Precedente: `aviso.contradicao`.
    votos: '{n} votos',
    voto: '{n} voto',
    favoritar: 'Favoritar',
    favoritado: 'Favoritado',
    ordenarPor: 'Ordenar a Comunidade por',
    toggleRelevancia: 'Relevância',
    togglePopularidade: 'Popularidade',
    convidaEntrarVoto: 'Entrar para votar',
    convidaEntrarFavorito: 'Entrar para favoritar',
    erroVoto: 'Não foi possível votar. Tente de novo.',
    erroFavorito: 'Não foi possível favoritar. Tente de novo.',
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
    userIdLabel: 'ID do usuário',
    userIdPlaceholder: 'Cole o ID do usuário',
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
    erroPapelInvalido: 'Papel inválido.',
    erroNaoAplicado: 'Não foi possível aplicar o papel. Confira o ID.',
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
    // Rótulos de VALOR de `origin` (5 valores de ORIGENS) — NÃO vazar token cru.
    origemCatalog: 'Catálogo',
    origemAiChat: 'Conversa com IA',
    origemAiStructured: 'Briefing estruturado',
    origemAiFreeText: 'Prompt aberto',
    origemUserEdited: 'Editada por pessoa',
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
    filaVazia: 'Nenhum report pendente.',
    erroMotivo: 'Informe o motivo da remoção.',
    erroJaResolvido: 'Este report já foi resolvido.',
    erroGenerico: 'Não foi possível processar o report. Tente de novo.',
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
  },
} as const

/**
 * Shape do catálogo, derivado de `ptBR` mas com as folhas alargadas de literal para `string`.
 * Assim o en-US herda exatamente as MESMAS chaves (paridade garantida pelo compilador) sem
 * ficar preso aos literais em português. As folhas em si continuam literais em `typeof ptBR`
 * para quem lê o catálogo pt-BR.
 */
export type Messages = {
  [Section in keyof typeof ptBR]: {
    [Key in keyof (typeof ptBR)[Section]]: string
  }
}
