import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Fusionne des classes Tailwind en laissant la dernière gagner sur un même
 * groupe de propriétés (`px-2` puis `px-4` donne `px-4`). C'est ce qui
 * permet de surcharger le style d'un composant via sa prop `className`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
