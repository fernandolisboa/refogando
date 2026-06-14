import 'vitest'

declare module 'vitest' {
  interface ProvidedContext {
    /** Connection string do Postgres descartável desta execução (passada de
     * globalSetup para os workers via provide/inject). */
    databaseUrl: string
  }
}
