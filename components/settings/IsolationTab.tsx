"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { patchSettings } from "@/lib/client/settingsApi";
import { ISOLATION_MODES, type IsolationMode, type PublicConfig } from "@/lib/types";

const MODE_HELP: Record<IsolationMode, string> = {
  local:
    "Filet local (toujours actif) : HOME isolé dans ~/.hlstudio/agent-home, motifs dangereux bloqués, audit des liens symboliques. Suffisant pour un usage personnel sur ta machine.",
  docker:
    "En plus du filet local, chaque commande tourne dans `docker run --rm --network none` avec le workspace monté en /workspace. Si Docker n'est pas installé, HL Studio retombe automatiquement sur le filet local.",
  opensandbox:
    "En plus du filet local, chaque commande est lancée via le binaire `opensandbox` s'il est dans le PATH. S'il est absent, HL Studio retombe sur le filet local.",
};

export default function IsolationTab({
  config,
  onChange,
  onError,
}: {
  config: PublicConfig;
  onChange: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const isolation = config.isolation ?? { mode: "local" as IsolationMode, browserEnabled: false };

  async function save(next: { mode?: IsolationMode; browserEnabled?: boolean }) {
    setBusy(true);
    try {
      await patchSettings({ isolation: next });
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
          <CardTitle className="flex items-center gap-2">
            Isolation des commandes
            <Badge variant="outline">{isolation.mode}</Badge>
          </CardTitle>
          <CardDescription>
            Chaque commande de l&apos;agent (et chaque hook) passe par ce filet
            avant d&apos;être exécutée. Une confirmation humaine reste obligatoire,
            sauf si tu as coché l&apos;auto-approbation pour la tâche en cours.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="isolation-mode">Mode</Label>
            <Select
              value={isolation.mode}
              onValueChange={(value) => save({ mode: value as IsolationMode })}
              disabled={busy}
            >
              <SelectTrigger id="isolation-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ISOLATION_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {mode}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">{MODE_HELP[isolation.mode]}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Automatisation du navigateur
            {isolation.browserEnabled ? (
              <Badge variant="warning">activée</Badge>
            ) : (
              <Badge variant="outline">désactivée</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Permet à l&apos;agent d&apos;ouvrir des pages, cliquer, remplir des
            formulaires et capturer le panneau Preview via Playwright. Désactivé
            par défaut : l&apos;agent peut alors parler à des sites externes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="browser-enabled" className="text-sm">
              Autoriser Playwright
            </Label>
            <Switch
              id="browser-enabled"
              checked={isolation.browserEnabled}
              disabled={busy}
              onCheckedChange={(checked) => save({ browserEnabled: checked })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Après activation, installe le navigateur une fois :{" "}
            <code>npm i -D playwright</code> puis{" "}
            <code>npx playwright install chromium</code>. Chaque action
            navigateur demande encore une confirmation, même avec
            l&apos;auto-approbation des commandes.
          </p>
          {isolation.browserEnabled && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => save({ browserEnabled: false })}
            >
              Désactiver maintenant
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
