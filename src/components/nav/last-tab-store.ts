'use client'
/**
 * Última aba visitada de cada seção pessoal (ADR-0043): o link "Minhas receitas"/"Planejar" do header
 * volta à aba onde a pessoa estava, em vez de sempre abrir a 1ª. Por dispositivo (localStorage), sem
 * id de usuário: só guarda hrefs de aba, que `parseLastTabs` valida contra `NAV_SECTIONS`.
 *
 * `useSyncExternalStore` com snapshot de servidor VAZIO: o HTML e a hidratação usam o destino padrão
 * (sem erro de hidratação) e o client troca para o lembrado logo depois. Storage bloqueado (modo
 * privado, cota) vira "nada lembrado", nunca um erro.
 */
import { useSyncExternalStore } from 'react'
import {
  LAST_TAB_STORAGE_KEY,
  parseLastTabs,
  type LastTabs,
  type NavSectionId,
} from '@/domain/nav-sections'

const EMPTY: LastTabs = {}
const listeners = new Set<() => void>()

// O snapshot precisa ser ESTÁVEL entre leituras (senão o useSyncExternalStore re-renderiza em loop):
// cacheia o objeto pelo texto cru do storage e só re-parseia quando o texto muda.
let lastRaw: string | null = null
let lastParsed: LastTabs = EMPTY

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(LAST_TAB_STORAGE_KEY)
  } catch {
    return null
  }
}

function getSnapshot(): LastTabs {
  const raw = readRaw()
  if (raw !== lastRaw) {
    lastRaw = raw
    lastParsed = parseLastTabs(raw)
  }
  return lastParsed
}

function getServerSnapshot(): LastTabs {
  return EMPTY
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  // Outra aba do mesmo navegador gravou: o snapshot relê o storage.
  window.addEventListener('storage', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function useLastTabs(): LastTabs {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** Esquece as abas lembradas (no "Sair": o próximo a entrar neste aparelho começa do padrão). */
export function forgetTabs() {
  try {
    window.localStorage.removeItem(LAST_TAB_STORAGE_KEY)
  } catch {
    return
  }
  for (const l of listeners) l()
}

/** Grava a aba da seção (no-op quando já é a lembrada). */
export function rememberTab(section: NavSectionId, href: string) {
  const current = getSnapshot()
  if (current[section] === href) return
  try {
    window.localStorage.setItem(LAST_TAB_STORAGE_KEY, JSON.stringify({ ...current, [section]: href }))
  } catch {
    return
  }
  for (const l of listeners) l()
}
