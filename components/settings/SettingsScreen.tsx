"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchConfig } from "@/lib/client/settingsApi";
import type { PublicConfig } from "@/lib/types";
import ProvidersTab from "./ProvidersTab";
import ModelsTab from "./ModelsTab";
import ModesTab from "./ModesTab";
import IntegrationsTab from "./IntegrationsTab";

export default function SettingsScreen() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setConfig(await fetchConfig());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loading) {
    return (
      <p className="p-8 text-sm text-muted-foreground">Chargement des réglages…</p>
    );
  }

  if (!config) {
    return (
      <div className="p-8">
        <p className="text-sm text-destructive">{error ?? "Réglages indisponibles."}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto h-full w-full max-w-3xl overflow-y-auto px-5 py-8">
      <header className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/" aria-label="Retour au studio">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Réglages</h1>
          <p className="text-sm text-muted-foreground">
            Tes clés et tes préférences restent sur cette machine.
          </p>
        </div>
      </header>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-xs underline underline-offset-2"
          >
            fermer
          </button>
        </div>
      )}

      <Tabs defaultValue="providers">
        <TabsList>
          <TabsTrigger value="providers">Fournisseurs</TabsTrigger>
          <TabsTrigger value="models">Modèles</TabsTrigger>
          <TabsTrigger value="modes">Modes</TabsTrigger>
          <TabsTrigger value="integrations">Intégrations</TabsTrigger>
        </TabsList>

        <TabsContent value="providers">
          <ProvidersTab config={config} onChange={reload} onError={setError} />
        </TabsContent>
        <TabsContent value="models">
          <ModelsTab config={config} onChange={reload} onError={setError} />
        </TabsContent>
        <TabsContent value="modes">
          <ModesTab config={config} onChange={reload} onError={setError} />
        </TabsContent>
        <TabsContent value="integrations">
          <IntegrationsTab config={config} onChange={reload} onError={setError} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
