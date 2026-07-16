import type { Metadata } from "next";
import "./globals.css";

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
      <body className="bg-studio-bg text-studio-text antialiased">
        {children}
      </body>
    </html>
  );
}
