/**
 * Versão publicada dos textos legais (ADR-0051). PURO: sem React, sem DB.
 *
 * `DATA_PUBLICACAO_TERMOS_V1` é a FONTE ÚNICA da data em que os Termos de Uso v1 e a Política v3.1 foram
 * publicados (o dia do merge do PR). As strings i18n a importam (`termos.rodapeData`, `termos.s10Historico`,
 * `privacidade.rodapeData` e a linha v3.1 de `privacidade.s10Historico`, `seusDireitos.rodapeData`). Se o merge
 * escorregar de dia, troque SÓ aqui.
 */

/** Dia da publicação dos Termos v1 e da Política v3.1 (AAAA-MM-DD, horário de Brasília). */
export const DATA_PUBLICACAO_TERMOS_V1 = '2026-10-23'
