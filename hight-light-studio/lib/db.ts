import { createClient } from "@supabase/supabase-js";

// Les URL et Key doivent être renseignées dans .env.local
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Conversation = {
  id: string;
  panel_mode: "chat" | "code" | "design" | "video";
  created_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  model_used?: string;
  created_at: string;
};

export type GeneratedMedia = {
  id: string;
  message_id: string;
  media_url: string;
  media_type: "image" | "video";
  created_at: string;
};
