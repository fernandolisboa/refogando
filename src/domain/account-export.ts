/**
 * Kernel PURO do export LGPD da conta (#595; Art. 18 II/V): o nome do arquivo que o titular baixa.
 * Sem DB, sem IO. A montagem do dump mora em `src/server/legal/account-export.ts`.
 *
 * O nome leva a data para o titular distinguir dois exports na pasta de downloads. O servidor usa o
 * MESMO `now` do `exportedAt` do dump (as duas datas sempre batem); o cliente, que baixa por fetch +
 * blob, gera o nome pela mesma função.
 */

export const ACCOUNT_EXPORT_FILENAME_PREFIX = 'refogando-meus-dados'

/** `refogando-meus-dados-YYYY-MM-DD.json`, data em UTC (a mesma de `exportedAt`). */
export function accountExportFilename(now: Date): string {
  return `${ACCOUNT_EXPORT_FILENAME_PREFIX}-${now.toISOString().slice(0, 10)}.json`
}
