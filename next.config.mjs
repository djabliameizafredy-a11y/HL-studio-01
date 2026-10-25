/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  eslint: {
    // ESLint tourne séparément (`npm run lint`) plutôt que dans le build :
    // `npm run build` sert aussi au packaging npm, où une analyse de
    // plusieurs minutes à chaque publication n'apporte rien. La
    // vérification TypeScript, elle, reste active dans le build.
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Le code lit process.cwd()/workspace : sans exclusion, le traçage de
    // fichiers peut embarquer le workspace ou des .env de la machine de
    // build dans le paquet npm publié.
    outputFileTracingExcludes: {
      "*": ["workspace/**", ".env*", ".git/**", ".hlstudio/**"],
    },
  },
};

export default nextConfig;
