"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createProvider,
  patchProvider,
  removeProvider,
  type ProviderFormValues,
} from "@/lib/client/settingsApi";
import type { ProviderProtocol, PublicConfig } from "@/lib/types";

/** Aide au remplissage : URL type et exemples de services par protocole. */
const PROTOCOL_HELP: Record<ProviderProtocol, { label: string; hint: string; baseUrl: string }> = {
  openai: {
    label: "OpenAI (compatible)",
    hint: "OpenAI, Kimi, GLM, OpenRouter, Groq, Together, Mistral, Ollama, LM Studio…",
    baseUrl: "https://api.openai.com/v1",
  },
  anthropic: {
    label: "Anthropic",
    hint: "Claude (api.anthropic.com)",
    baseUrl: "https://api.anthropic.com/v1",
  },
  gemini: {
    label: "Google Gemini",
    hint: "Gemini, Imagen, Veo (generativelanguage.googleapis.com)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
};

const EMPTY_FORM: ProviderFormValues = {
  label: "",
  protocol: "openai",
  baseUrl: PROTOCOL_HELP.openai.baseUrl,
  apiKey: "",
};

export default function ProvidersTab({
  config,
  onChange,
  onError,
}: {
  config: PublicConfig;
  onChange: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState<ProviderFormValues>(EMPTY_FORM);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [keyEdits, setKeyEdits] = useState<Record<string, string>>({});

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await onChange();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  function selectProtocol(protocol: ProviderProtocol) {
    // Pré-remplir l'URL évite la principale source d'erreur de saisie, tout
    // en restant modifiable pour les services auto-hébergés.
    setForm((prev) => ({ ...prev, protocol, baseUrl: PROTOCOL_HELP[protocol].baseUrl }));
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Fournisseurs d&apos;IA</CardTitle>
            <CardDescription>
              Un fournisseur = une URL d&apos;API + une clé. Les clés sont enregistrées
              dans <code className="text-xs">~/.hlstudio/config.json</code> sur ta
              machine et ne sont jamais envoyées au navigateur.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setAdding((open) => !open)}>
            <Plus className="h-4 w-4" />
            Ajouter
          </Button>
        </CardHeader>

        {adding && (
          <CardContent className="space-y-4 border-t border-border pt-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="provider-label">Nom</Label>
                <Input
                  id="provider-label"
                  placeholder="Mon compte OpenAI"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Protocole</Label>
                <Select
                  value={form.protocol}
                  onValueChange={(value) => selectProtocol(value as ProviderProtocol)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PROTOCOL_HELP).map(([value, meta]) => (
                      <SelectItem key={value} value={value}>
                        {meta.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {PROTOCOL_HELP[form.protocol].hint}
                </p>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="provider-url">URL de l&apos;API</Label>
                <Input
                  id="provider-url"
                  value={form.baseUrl}
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="provider-key">Clé d&apos;API</Label>
                <Input
                  id="provider-key"
                  type="password"
                  autoComplete="off"
                  placeholder="sk-…"
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Annuler
              </Button>
              <Button
                size="sm"
                disabled={busy || !form.label.trim()}
                onClick={() =>
                  run(async () => {
                    await createProvider(form);
                    setForm(EMPTY_FORM);
                    setAdding(false);
                  })
                }
              >
                Enregistrer
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {config.providers.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">
          Aucun fournisseur pour l&apos;instant. Ajoute-en un pour pouvoir
          déclarer des modèles.
        </p>
      ) : (
        config.providers.map((provider) => {
          const modelCount = config.models.filter(
            (model) => model.providerId === provider.id
          ).length;

          return (
            <Card key={provider.id}>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div className="space-y-1.5">
                  <CardTitle className="flex items-center gap-2">
                    {provider.label}
                    <Badge variant="secondary">{PROTOCOL_HELP[provider.protocol].label}</Badge>
                    {provider.hasApiKey ? (
                      <Badge variant="success">clé …{provider.apiKeyHint}</Badge>
                    ) : (
                      <Badge variant="warning">aucune clé</Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="font-mono text-xs">
                    {provider.baseUrl} · {modelCount} modèle{modelCount > 1 ? "s" : ""}
                  </CardDescription>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  title="Supprimer ce fournisseur et ses modèles"
                  disabled={busy}
                  onClick={() => run(() => removeProvider(provider.id))}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </CardHeader>

              <CardContent>
                <div className="flex items-end gap-2">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor={`key-${provider.id}`}>Remplacer la clé</Label>
                    <Input
                      id={`key-${provider.id}`}
                      type="password"
                      autoComplete="off"
                      placeholder="Laisser vide pour conserver la clé actuelle"
                      value={keyEdits[provider.id] ?? ""}
                      onChange={(e) =>
                        setKeyEdits({ ...keyEdits, [provider.id]: e.target.value })
                      }
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !keyEdits[provider.id]?.trim()}
                    onClick={() =>
                      run(async () => {
                        await patchProvider(provider.id, {
                          apiKey: keyEdits[provider.id],
                        });
                        setKeyEdits({ ...keyEdits, [provider.id]: "" });
                      })
                    }
                  >
                    Mettre à jour
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
