import { and, eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { vocabularyTerm } from '@/db/schema'
import type { ClaudeClient } from '@/server/claude/client'
import type { AppConfig } from '@/server/app-config'
import { activeSettings } from '@/domain/ai-task-config'
import { buildSceneDirectorPrompt } from '@/domain/image-scene-director'
import {
  IMAGE_SCENE_DIRECTOR_DEADLINE_MS,
  normalizeDirectorScene,
  sceneFromRules,
  type ImageScene,
  type ImageSceneRegistro,
} from '@/domain/image-scene'

/**
 * Resolve o CENÁRIO de uma imagem a gerar do zero (ADR-0043): o registro escolhido pelo usuário pula o
 * diretor (gera direto naquela cena, sem custo extra); senão o diretor de arte (tarefa de IA
 * `imageScene`) quando ligado; as regras de reserva quando desligado ou em qualquer falha. Lê também a
 * nota visual da cozinha (`vocabulary_term.visual_note`). NUNCA lança: a imagem nunca falha por causa
 * do cenário (mesmo princípio da geração tolerante, #548/#551). A edição imagem-a-imagem não passa por
 * aqui (a cena já está na foto-base).
 *
 * Custo: a chamada do diretor fica FORA do ledger de imagem (como a Extração, #463); o log abaixo traz
 * modelo e tokens para conferir no Vercel. Limite aceito no ADR-0043.
 */
export async function resolveImageScene(input: {
  db: Database
  claude: ClaudeClient
  appCfg: AppConfig
  recipeId: string
  content: {
    titulo: string
    descricao: string | null
    cozinha: string | null
    categoria: string | null
    ingredientes: string[]
  }
  /** Registro escolhido pelo usuário no modal: pula o diretor. */
  registroFixo: ImageSceneRegistro | null
}): Promise<{ scene: ImageScene; visualNote: string | null }> {
  const { db, claude, appCfg, recipeId, content, registroFixo } = input

  // A nota visual não depende do diretor: a leitura corre em paralelo com a chamada.
  const notePromise = loadVisualNote(db, content.cozinha)
  const rules = sceneFromRules({ recipeId, cozinha: content.cozinha, categoria: content.categoria, registroFixo })
  if (registroFixo || !appCfg.imageGen.sceneDirector) {
    return { scene: rules, visualNote: await notePromise }
  }

  const task = appCfg.aiTasks.imageScene
  const { systemPrompt, userPrompt } = buildSceneDirectorPrompt(content)
  const startedAt = Date.now()
  let scene = rules
  const signal = AbortSignal.timeout(IMAGE_SCENE_DIRECTOR_DEADLINE_MS)
  try {
    const out = await claude.directImageScene({
      systemPrompt,
      userPrompt,
      model: task.model,
      settings: activeSettings('imageScene', task),
      signal,
    })
    if (out.kind === 'ok') scene = normalizeDirectorScene(out.scene, rules)
    // Sem conteúdo da receita no log: só o desfecho, o registro, o modelo, os tokens e o tempo. No
    // `prazo` os tokens saem `?` (a chamada foi abortada), mas a entrada pode ter sido cobrada.
    const desfecho = out.kind === 'ok' ? 'ok' : signal.aborted ? 'prazo' : 'falhou'
    console.info(
      `[image-scene] diretor ${desfecho}: registro=${scene.registro} fonte=${scene.fonte} ` +
        `recipe=${recipeId} modelo=${task.model} in=${out.usage?.inputTokens ?? '?'} out=${out.usage?.outputTokens ?? '?'} ms=${Date.now() - startedAt}`,
    )
  } catch (err) {
    // O seam não lança; isto é só a rede de segurança (ex.: um dublê de teste que lança).
    console.warn(`[image-scene] diretor lançou, seguindo com as regras: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { scene, visualNote: await notePromise }
}

/** Nota visual da cozinha da receita, ou `null` (sem cozinha, sem nota ou leitura falhou). */
async function loadVisualNote(db: Database, cozinha: string | null): Promise<string | null> {
  if (!cozinha) return null
  try {
    const [row] = await db
      .select({ visualNote: vocabularyTerm.visualNote })
      .from(vocabularyTerm)
      .where(and(eq(vocabularyTerm.kind, 'cozinha'), eq(vocabularyTerm.slug, cozinha)))
      .limit(1)
    return row?.visualNote?.trim() || null
  } catch {
    return null
  }
}
