import type { Metadata } from "next";
import "./globals.css";

// Polices chargées côté client via CSS (globals.css @import) plutôt que
// next/font/google qui nécessite un fetch réseau au moment du build.
// Compatible local-first : pas de dépendance réseau au build.

export const metadata: Metadata = {
  title: "Hight Light Studio",
  description: "Le workspace IA multi-modèles de Hight Light.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body className="bg-studio-bgAlt text-studio-text antialiased font-sans relative overflow-hidden">
        {/* Blobs d'arrière-plan */}
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-studio-bgAccent rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob"></div>
        <div className="absolute top-[20%] right-[-5%] w-72 h-72 bg-studio-accentSecondary/20 rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob" style={{ animationDelay: '2s' }}></div>
        <div className="absolute bottom-[-10%] left-[20%] w-80 h-80 bg-studio-accentTertiary/20 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob" style={{ animationDelay: '4s' }}></div>
        
        <div className="relative z-10 h-full">
          {children}
        </div>
      </body>
    </html>
  );
}
