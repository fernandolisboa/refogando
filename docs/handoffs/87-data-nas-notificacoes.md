# Handoff 87 — Data nas notificações do sininho

**Data:** 2026-10-23.
**PR:** "Notificações mostram quando aconteceram (há 3 horas, há 2 dias, data)".
**Base:** `main` depois do #622.
**Migração:** nenhuma. **ADR:** nenhum novo (ADR-0028 segue valendo; é só apresentação).

## 1. Escopo

Cada item do painel de notificações (`src/components/notification-bell.tsx`) mostra quando aconteceu, abaixo do texto:

- menos de 1 minuto: "agora" / "now";
- até 1 semana: "há 5 minutos", "há 3 horas", "há 2 dias" / "5 minutes ago"…, com a unidade **truncada** (59 min 59 s
  ainda é "há 59 minutos"; 25 h é "há 1 dia", nunca "ontem", que pode errar o dia do calendário);
- 1 semana ou mais: a data no locale ("5 de jan. de 2026" / "Jan 5, 2026");
- o instante completo (`formatDateTime`) fica no `title` do `<time dateTime=…>`.

O dado já existia: `NotificationDTO.createdAt` (ISO) vem do `GET /api/notifications`. Nada mudou no servidor.

## 2. O que ler primeiro

1. `src/domain/relative-time.ts`: `formatRelativeTime`, `formatDate`, `formatDateTime`. Saíram de
   `src/domain/admin-user-list.ts` (eram da lista de usuários do Console, #598), que agora importa daqui.
2. `src/components/notification-bell.tsx`: `now` é estado, atualizado no `onOpenChange` ao abrir.
3. `test/domain/relative-time.test.ts` e os dois casos novos no fim de `test/ui/notification-bell.test.tsx`.

## 3. Princípios inegociáveis

- **Relógio fora do render.** `Date.now()` só no inicializador do `useState` e no handler de abertura. O painel só
  monta aberto e o sininho é client-only (Modelo B), então não há divergência de SSR.
- **Sem `RangeError`.** Data inválida devolve `""` nas três funções e o sininho omite o `<time>`.
- **Futuro vira "agora".** Relógio do aparelho atrasado não pode mostrar "em 2 minutos".

## 4. Landmines

- A lista de usuários do Console usa as mesmas funções. A troca de `numeric: 'auto'` para `'always'` (exceto o
  "agora") mudou lá também: "ontem" virou "há 1 dia". Foi intencional.
- O `' '` entre o texto e o `<time>` existe só para o nome acessível do menuitem ("… seguir você há 3 horas"); num
  container flex ele não aparece. Não remova.
- O texto relativo é congelado no instante em que o painel abriu; não há tick enquanto ele fica aberto.

## 5. Critério de saída

`checks` e `e2e` verdes; abrir o sininho em produção mostra o tempo relativo em cada item, nos dois locales.
