"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { patchSettings } from "@/lib/client/settingsApi";
import {
  CAPABILITY_BY_MODE,
  WORKSPACE_MODES,
  type PublicConfig,
  type WorkspaceMode,
} from "@/lib/types";

const MODE_INFO: Record<WorkspaceMode, { label: string; description: string }> = {
  chat: { label: "Chat", description: "Conversation libre. Un modèle de texte suffit." },
  code: {
    label: "Code (Mode Agent)",
    description:
      "Lit et écrit des fichiers, exécute des commandes. Nécessite un modèle capable d'appeler des outils.",
  },
  design: { label: "Design", description: "Génération d'images à partir d'une description." },
  video: { label: "Vidéo", description: "Génération de vidéos. Souvent asynchrone." },
};

/** Valeur interne du Select pour « aucun modèle » (Radix refuse la chaîne vide). */
const NONE = "__none__";

export default function ModesTab({
  config,
  onChange,
  onError,
}: {
  config: PublicConfig;
  onChange: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  /**
   * Modèles éligibles à un mode : la capacité attendue doit être déclarée,
   * et le mode Code exige en plus le support des outils. Le serveur
   * revalide ces mêmes règles.
   */
  function eligibleModels(mode: WorkspaceMode) {
    const needed = CAPABILITY_BY_MODE[mode];
    return config.models.filter(
      (model) =>
        model.capabilities.includes(needed) && (mode !== "code" || model.supportsTools)
    );
  }

  async function assign(patch: Parameters<typeof patchSettings>[0]) {
    setBusy(true);
    try {
      await patchSettings(patch);
      await onChange();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Modèle par mode</CardTitle>
          <CardDescription>
            Chaque mode n&apos;affiche que les modèles compatibles avec sa fonction.
            Si une liste est vide, ajoute un modèle avec la capacité correspondante.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {WORKSPACE_MODES.map((mode) => {
            const models = eligibleModels(mode);
            const current = config.assignments[mode];

            return (
              <div key={mode} className="space-y-1.5">
                <Label>{MODE_INFO[mode].label}</Label>
                <Select
                  value={current ?? NONE}
                  disabled={busy || models.length === 0}
                  onValueChange={(value) =>
                    assign({ assignments: { [mode]: value === NONE ? null : value } })
                  }
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        models.length === 0
                          ? `Aucun modèle « ${CAPABILITY_BY_MODE[mode]} » disponible`
                          : "Choisir un modèle"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Aucun</SelectItem>
                    {models.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{MODE_INFO[mode].description}</p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bot assistant d&apos;interface</CardTitle>
          <CardDescription>
            Le modèle qu&apos;utilise la bulle d&apos;aide lorsque tu lui poses une
            question. Choisis-en un économique : il ne sert qu&apos;à expliquer
            l&apos;interface.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <Select
            value={config.assistantModelId ?? NONE}
            disabled={busy}
            onValueChange={(value) =>
              assign({ assistantModelId: value === NONE ? null : value })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Choisir un modèle" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Aucun (aides au survol uniquement)</SelectItem>
              {config.models
                .filter((model) => model.capabilities.includes("text"))
                .map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
    </div>
  );
}
