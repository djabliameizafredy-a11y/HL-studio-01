import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";
import type { WorkspaceMode } from "@/lib/types";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get("mode") as WorkspaceMode | null;

    if (!mode) {
      return NextResponse.json({ error: "Mode requis" }, { status: 400 });
    }

    // Récupérer la dernière conversation pour ce mode
    // (Dans une vraie app, on filtrerait par utilisateur et on gèrerait plusieurs convs)
    const { data: convData, error: convError } = await supabase
      .from("conversations")
      .select("id")
      .eq("panel_mode", mode)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (convError && convError.code !== "PGRST116") {
      throw new Error(`Erreur Supabase (conv): ${convError.message}`);
    }

    if (!convData) {
      return NextResponse.json({ messages: [], conversationId: null });
    }

    const { data: messages, error: msgError } = await supabase
      .from("messages")
      .select(`
        id, role, content, model_used, created_at,
        generated_media ( id, media_url, media_type )
      `)
      .eq("conversation_id", convData.id)
      .order("created_at", { ascending: true });

    if (msgError) {
      throw new Error(`Erreur Supabase (msg): ${msgError.message}`);
    }

    return NextResponse.json({ messages: messages || [], conversationId: convData.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
