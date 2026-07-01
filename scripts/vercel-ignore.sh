#!/usr/bin/env bash
#
# Vercel "Ignored Build Step" — pula o build/deploy quando SÓ documentação mudou.
# Referenciado por `vercel.json` (`ignoreCommand`). Semântica da Vercel:
#   exit 1  => a Vercel CONSTRÓI (deploy acontece)
#   exit 0  => a Vercel IGNORA o build (sem deploy)
#
# Regra: só ignora quando TODOS os arquivos mudados são doc (`docs/**` ou `*.md` em
# qualquer nível). Qualquer arquivo de código/config/asset => constrói.
#
# VIÉS PRA CONSTRUIR: em qualquer incerteza (base não resolvível, sem diff, erro),
# saímos 1 (constrói). Um "skip" errado deixaria o app velho em produção (ruim); um
# "build" errado é só um deploy desperdiçado (inofensivo). Nunca pulamos no escuro.
#
# `VERCEL_GIT_PREVIOUS_SHA` = SHA do ÚLTIMO deploy BEM-SUCEDIDO deste projeto+branch;
# a Vercel só o expõe quando existe um Ignored Build Step. É a base correta (o preview
# de um PR com vários commits erraria com `HEAD^`). Fallback: `HEAD^`.
set -u

BASE="${VERCEL_GIT_PREVIOUS_SHA:-}"
[ -z "$BASE" ] && BASE="HEAD^"

# A clone da Vercel é rasa: a base pode não estar presente. Tenta buscá-la; se ainda
# assim não resolver, CONSTRÓI (seguro — nunca pula sem saber o diff).
if ! git cat-file -e "${BASE}^{commit}" 2>/dev/null; then
  git fetch --depth=1 origin "$BASE" 2>/dev/null || true
fi
if ! git cat-file -e "${BASE}^{commit}" 2>/dev/null; then
  echo "vercel-ignore: base '$BASE' não resolvível → BUILD (seguro)"
  exit 1
fi

CHANGED="$(git diff --name-only "$BASE" HEAD 2>/dev/null)"
if [ -z "$CHANGED" ]; then
  echo "vercel-ignore: sem diff vs '$BASE' → BUILD (seguro)"
  exit 1
fi

# Existe algum arquivo mudado que NÃO é `docs/…` e NÃO termina em `.md`? Então é
# mudança real → BUILD. `grep -qvE` sai 0 quando acha uma linha NÃO-doc.
if printf '%s\n' "$CHANGED" | grep -qvE '^docs/|\.md$'; then
  echo "vercel-ignore: há mudança de código/config → BUILD"
  exit 1
fi

echo "vercel-ignore: só documentação vs '$BASE' → SKIP (sem deploy)"
exit 0
