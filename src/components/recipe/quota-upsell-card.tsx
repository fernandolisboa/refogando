'use client'
/**
 * Cartão de upsell ESTÁTICO no limite de cota (Fase 2 de billing, flag-off — issue #466/#467, ver
 * `docs/reports/fase2-billing-decisao.md` §6 item 5). Aparece JUNTO da mensagem de limite já
 * existente (geração de receita, regenerar versão, gerar imagem) quando o dono da sessão está no
 * plano `free` — o ponto natural de upsell é justamente onde o Usuário já esbarrou no teto.
 *
 * CTA totalmente ESTÁTICO: um link pra `/{locale}/plano`, a página placeholder "em breve" — SEM
 * checkout/PSP ligado (nada de rede além da navegação). A decisão comercial (preço, modelo, PSP)
 * fica para quando o billing for ligado de verdade; este cartão nunca afirma preço nem data.
 *
 * O GATE de visibilidade (`plan === 'free'`/ausente, sessão presente) é do CALLER — cada ponto que
 * já mostra a mensagem de limite decide se renderiza este cartão (via `isFreePlanUser`, domain/
 * plan.ts). Visitante (sem sessão) já tem o próprio convite de login nesses fluxos; não duplicamos
 * aqui. Tokens NEUTROS (âmbar é exclusivo do Aviso de restrição, ADR-0004) — este NÃO é um erro.
 */
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'

export function QuotaUpsellCard() {
  const { locale, messages } = useLocale()
  const m = messages.upsell

  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-md border border-border bg-surface px-4 py-3"
    >
      <p className="font-medium text-fg">{m.titulo}</p>
      <p className="text-sm text-muted">{m.descricao}</p>
      <div>
        <Button asChild variant="secondary" size="sm">
          <Link href={`/${locale}/plano`}>{m.cta}</Link>
        </Button>
      </div>
    </div>
  )
}
