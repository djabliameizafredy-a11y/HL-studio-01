import { NextRequest } from "next/server";
import { DEFAULT_MODEL_BY_MODE, SYSTEM_PROMPTS, routeRequest } from "@/lib/modelRouter";
import Anthropic from "@anthropic-ai/sdk";
import type { RouteRequestBody } from "@/lib/types";
import { supabase } from "@/lib/db";

// Helper pour uploader un data URI vers Supabase Storage
async function uploadMedia(dataUri: string, conversationId: string): Promise<string | null> {
  try {
    const matches = dataUri.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return null;
    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, "base64");
    
    const ext = mimeType.split("/")[1] || "bin";
    const fileName = `${conversationId}/${Date.now()}.${ext}`;

    const { data, error } = await supabase.storage
      .from("media")
      .upload(fileName, buffer, {
        contentType: mimeType,
      });

    if (error) {
      console.error("Erreur upload Supabase:", error);
      return null;
    }

    const { data: publicUrlData } = supabase.storage.from("media").getPublicUrl(fileName);
    return publicUrlData.publicUrl;
  } catch (err) {
    console.error("Erreur upload:", err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RouteRequestBody & { conversationId?: string };

    if (!body.messages || body.messages.length === 0) {
      return new Response(JSON.stringify({ error: "Le champ 'messages' est requis." }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const mode = body.mode ?? "chat";
    const model = body.model ?? DEFAULT_MODEL_BY_MODE[mode];
    const systemPrompt = SYSTEM_PROMPTS[mode];
    let conversationId = body.conversationId;

    // Créer la conversation si elle n'existe pas
    if (!conversationId) {
      const { data: convData } = await supabase
        .from("conversations")
        .insert({ panel_mode: mode })
        .select("id")
        .single();
      if (convData) conversationId = convData.id;
    }

    // Sauvegarder le message utilisateur
    const userMessage = body.messages[body.messages.length - 1];
    if (conversationId) {
      await supabase.from("messages").insert({
        conversation_id: conversationId,
        role: "user",
        content: userMessage.content,
      });
    }

    if (model === "claude") {
      if (!process.env.ANTHROPIC_API_KEY) {
        return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY manquante" }), { status: 500, headers: { "Content-Type": "application/json" } });
      }

      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const stream = await anthropic.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 2048,
        system: systemPrompt,
        messages: body.messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      });

      const readable = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          let fullText = "";
          try {
            for await (const chunk of stream) {
              if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
                const text = chunk.delta.text;
                fullText += text;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
              }
            }
            // Save to DB
            if (conversationId) {
              await supabase.from("messages").insert({
                conversation_id: conversationId,
                role: "assistant",
                content: fullText,
                model_used: model,
              });
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : "Erreur inconnue";
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`));
          } finally {
            controller.close();
          }
        }
      });

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        }
      });
    }

    // Autres modèles
    const result = await routeRequest(body);
    
    // Upload media if present and it's a data URI
    let finalImageUrl = result.imageUrl;
    let finalVideoUrl = result.videoUrl;
    
    if (conversationId && result.imageUrl?.startsWith("data:")) {
       const uploadedUrl = await uploadMedia(result.imageUrl, conversationId);
       if (uploadedUrl) finalImageUrl = uploadedUrl;
    }
    
    // Save assistant message to DB
    if (conversationId) {
      const { data: msgData } = await supabase.from("messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: result.text,
        model_used: model,
      }).select("id").single();
      
      if (msgData && (finalImageUrl || finalVideoUrl)) {
         await supabase.from("generated_media").insert({
           message_id: msgData.id,
           media_url: finalImageUrl || finalVideoUrl,
           media_type: finalImageUrl ? "image" : "video"
         });
      }
    }

    const readable = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        if (result.text) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: result.text })}\n\n`));
        }
        if (finalImageUrl) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ imageUrl: finalImageUrl })}\n\n`));
        }
        if (finalVideoUrl) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ videoUrl: finalVideoUrl })}\n\n`));
        }
        controller.close();
      }
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      }
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
