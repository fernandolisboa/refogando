import type { NextConfig } from 'next'

/**
 * `images.remotePatterns` libera o host do Vercel Blob (#126) — onde moram os avatares e, depois,
 * as Imagens da receita (entidade `recipe_image`, #130). O store é PUBLIC, então a URL serve a
 * imagem direto; o repo renderiza com `<img>` simples (convenção), mas `remotePatterns` mantém a
 * porta aberta pra `next/image` sem retrabalho. O subdomínio do store varia (`<id>.public...`),
 * por isso o wildcard de host.
 */
const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.public.blob.vercel-storage.com',
      },
    ],
  },
}

export default nextConfig
