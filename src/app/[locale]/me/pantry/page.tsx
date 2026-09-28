/**
 * Página "Despensa" (ADR-0038): o que a pessoa tem em casa e o que dá pra fazer com isso. Server Component
 * fino, espelha `/me/meal-plan`: provê o único `<main>` + o `<h1>` localizado e monta `<PantryView />`, que
 * resolve a sessão e busca a Despensa e os resultados no cliente. URL em inglês: /me/pantry.
 */
import { cookies, headers } from "next/headers";
import { Container } from "@/components/container";
import { PantryView } from "@/components/pantry/pantry-view";
import { LOCALE_COOKIE } from "@/i18n/cookie";
import { MESSAGES } from "@/i18n/messages";
import { resolvePageLocale } from "@/server/http/page-locale";
import { loggedInPageMetadata } from "@/server/http/page-metadata";

// Título fino ("Despensa") + noindex (só-logado), espelha #462.
export function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  return loggedInPageMetadata(params, (m) => m.despensa.titulo);
}

export default async function PantryPage() {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const locale = resolvePageLocale({
    urlLocale: null,
    cookieLocale: cookieStore.get(LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: headerStore.get("accept-language"),
  });
  const m = MESSAGES[locale].despensa;

  return (
    <Container
      as="main"
      size="page"
      className="flex flex-col gap-8 py-8 sm:py-12"
    >
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          {m.titulo}
        </h1>
        <p className="text-muted">{m.descricao}</p>
      </div>
      <PantryView />
    </Container>
  );
}
