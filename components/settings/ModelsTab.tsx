"use client";

import { useState } from "react";
import { CheckCircle2, Plus, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
  createModel,
  removeModel,
  testModelById,
  type ModelFormValues,
  type ModelTestResult,
} from "@/lib/client/settingsApi";
import { MODEL_CAPABILITIES, type ModelCapability, type PublicConfig } from "@/lib/types";

const CAPABILITY_LABELS: Record<ModelCapability, string> = {
  text: "Texte",
  code: "Code",
  image: "Image",
  video: "Vidéo",
};

const EMPTY_FORM: ModelFormValues = {
  providerId: "",
  model: "",
  label: "",
  capabilities: ["text"],
  supportsTools: false,
};

export default function ModelsTab({
  config,
  onChange,
  onError,
}: {
  config: PublicConfig;
  onChange: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState<ModelFormValues>(EMPTY_FORM);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ModelTestResult>>({});

  const providerLabel = (providerId: string) =>
    config.providers.find((provider) => provider.id === providerId)?.label ??
    "fournisseur supprimé";

  function toggleCapability(capability: ModelCapability) {
    setForm((prev) => ({
      ...prev,
      capabilities: prev.capabilities.includes(capability)
        ? prev.capabilities.filter((item) => item !== capability)
        : [...prev.capabilities, capability],
    }));
  }

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

  async function handleTest(modelId: string) {
    setTesting(modelId);
    try {
      const result = await testModelById(modelId);
      setResults((prev) => ({ ...prev, [modelId]: result }));
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [modelId]: {
          ok: false,
          message: err instanceof Error ? err.message : "Erreur inconnue",
          checks: [],
        },
      }));
    } finally {
      setTesting(null);
    }
  }

  if (config.providers.length === 0) {
    return (
      <p className="px-1 text-sm text-muted-foreground">
        Commence par ajouter un fournisseur dans l&apos;onglet précédent : un modèle
        est toujours rattaché à un fournisseur.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Modèles</CardTitle>
            <CardDescription>
              Saisis l&apos;identifiant exact attendu par le fournisseur (par
              exemple <code className="text-xs">gpt-4o-mini</code>) et coche ce que
              le modèle sait faire : c&apos;est ce qui détermine dans quels modes il
              apparaîtra.
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
                <Label>Fournisseur</Label>
                <Select
                  value={form.providerId}
                  onValueChange={(providerId) => setForm({ ...form, providerId })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choisir un fournisseur" />
                  </SelectTrigger>
                  <SelectContent>
                    {config.providers.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        {provider.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="model-id">Identifiant du modèle</Label>
                <Input
                  id="model-id"
                  placeholder="gpt-4o-mini"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="model-label">Nom affiché (optionnel)</Label>
                <Input
                  id="model-label"
                  placeholder="Reprend l'identifiant si laissé vide"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label>Capacités</Label>
                <div className="flex flex-wrap gap-2">
                  {MODEL_CAPABILITIES.map((capability) => {
                    const active = form.capabilities.includes(capability);
                    return (
                      <Button
                        key={capability}
                        type="button"
                        size="sm"
                        variant={active ? "default" : "outline"}
                        onClick={() => toggleCapability(capability)}
                      >
                        {CAPABILITY_LABELS[capability]}
                      </Button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3 sm:col-span-2">
                <div>
                  <Label htmlFor="model-tools">Sait appeler des outils</Label>
                  <p className="text-xs text-muted-foreground">
                    Obligatoire pour le Mode Agent. Le bouton « Tester » vérifie
                    réellement cette capacité.
                  </p>
                </div>
                <Switch
                  id="model-tools"
                  checked={form.supportsTools}
                  onCheckedChange={(supportsTools) => setForm({ ...form, supportsTools })}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Annuler
              </Button>
              <Button
                size="sm"
                disabled={
                  busy ||
                  !form.providerId ||
                  !form.model.trim() ||
                  form.capabilities.length === 0
                }
                onClick={() =>
                  run(async () => {
                    await createModel(form);
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

      {config.models.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">Aucun modèle enregistré.</p>
      ) : (
        config.models.map((model) => {
          const result = results[model.id];
          return (
            <Card key={model.id}>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div className="space-y-1.5">
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {model.label}
                    {model.capabilities.map((capability) => (
                      <Badge key={capability} variant="secondary">
                        {CAPABILITY_LABELS[capability]}
                      </Badge>
                    ))}
                    {model.supportsTools && <Badge>outils</Badge>}
                  </CardTitle>
                  <CardDescription className="font-mono text-xs">
                    {providerLabel(model.providerId)} · {model.model}
                  </CardDescription>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={testing === model.id}
                    onClick={() => handleTest(model.id)}
                  >
                    {testing === model.id ? "Test…" : "Tester"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Supprimer ce modèle"
                    disabled={busy}
                    onClick={() => run(() => removeModel(model.id))}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardHeader>

              {result && (
                <CardContent className="space-y-1.5 border-t border-border pt-4">
                  {result.checks.length > 0 ? (
                    result.checks.map((check) => (
                      <p key={check.name} className="flex items-start gap-2 text-xs">
                        {check.ok ? (
                          <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        ) : (
                          <XCircle className="mt-px h-3.5 w-3.5 shrink-0 text-destructive" />
                        )}
                        <span>
                          <span className="font-medium">{check.name} — </span>
                          <span className="text-muted-foreground">{check.detail}</span>
                        </span>
                      </p>
                    ))
                  ) : (
                    <p className="text-xs text-destructive">{result.message}</p>
                  )}
                </CardContent>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
