"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { patchSettings } from "@/lib/client/settingsApi";
import type { PublicConfig } from "@/lib/types";

export default function IntegrationsTab({
  config,
  onChange,
  onError,
}: {
  config: PublicConfig;
  onChange: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(value: string) {
    setBusy(true);
    try {
      await patchSettings({ githubToken: value });
      setToken("");
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
            GitHub
            {config.integrations.hasGithubToken ? (
              <Badge variant="success">token enregistré</Badge>
            ) : (
              <Badge variant="warning">aucun token</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Nécessaire pour importer un dépôt privé, pousser le workspace et créer
            des pull requests. Utilise un token <em>fine-grained</em> limité aux
            dépôts concernés : HL Studio n&apos;a jamais besoin d&apos;un accès à
            tous tes dépôts.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="github-token">Token d&apos;accès</Label>
            <Input
              id="github-token"
              type="password"
              autoComplete="off"
              placeholder={
                config.integrations.hasGithubToken
                  ? "Laisser vide pour conserver le token actuel"
                  : "github_pat_…"
              }
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>

          <div className="flex gap-2">
            <Button size="sm" disabled={busy || !token.trim()} onClick={() => save(token)}>
              Enregistrer
            </Button>
            {config.integrations.hasGithubToken && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => save("")}
              >
                Supprimer le token
              </Button>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Le token est stocké dans <code>~/.hlstudio/config.json</code>, n&apos;est
            jamais renvoyé au navigateur, et n&apos;est pas transmis aux commandes
            lancées par l&apos;agent.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Serveurs MCP</CardTitle>
          <CardDescription>
            Les serveurs MCP se déclarent dans{" "}
            <code className="text-xs">&lt;workspace&gt;/.hlstudio/mcp.json</code>.
            Ce fichier lance des processus : l&apos;agent ne peut pas le modifier
            lui-même, il écrit une proposition en <code>.proposed</code> que tu dois
            renommer manuellement.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Chaque appel d&apos;un outil MCP demande une confirmation explicite,
            même quand l&apos;auto-approbation des commandes est activée.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
