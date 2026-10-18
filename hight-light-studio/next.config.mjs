/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
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
