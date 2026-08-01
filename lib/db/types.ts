/**
 * Database types for the Phase 1 schema.
 *
 * HAND-MAINTAINED. `supabase gen types` runs its introspection inside a
 * container, so it needs Docker, which this setup deliberately avoids
 * (docs/wiki/DECISIONS.md DEC-004, ISSUES.md ISSUE-005).
 *
 * If you change supabase/migrations/, update this file in the same commit.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type UserRole = 'user' | 'admin';
export type MessageRole = 'user' | 'assistant' | 'system';
export type ThemeMode = 'light' | 'dark' | 'system';
export type FontSize = 'sm' | 'md' | 'lg';
export type BubbleStyle = 'bubbles' | 'flat';

type Timestamps = { created_at: string; updated_at: string };

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Timestamps & {
          id: string;
          display_name: string | null;
          avatar_url: string | null;
          role: UserRole;
          /** Added in migration 20260730120005. */
          suspended: boolean;
        };
        Insert: Partial<Timestamps> & {
          id: string;
          display_name?: string | null;
          avatar_url?: string | null;
          role?: UserRole;
          suspended?: boolean;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Row']>;
        Relationships: [];
      };
      providers: {
        Row: Timestamps & {
          id: string;
          name: string;
          encrypted_api_key: string | null;
          key_last4: string | null;
          enabled: boolean;
          created_by: string | null;
        };
        Insert: Partial<Timestamps> & {
          id?: string;
          name: string;
          encrypted_api_key?: string | null;
          key_last4?: string | null;
          enabled?: boolean;
          created_by?: string | null;
        };
        Update: Partial<Database['public']['Tables']['providers']['Row']>;
        Relationships: [];
      };
      models: {
        Row: Timestamps & {
          id: string;
          provider_id: string;
          model_id: string;
          display_name: string;
          max_tokens: number;
          default_temperature: number;
          input_cost_per_1k: number;
          output_cost_per_1k: number;
          enabled: boolean;
          /** Added in migration 20260730120007. */
          supports_vision: boolean;
          supports_documents: boolean;
        };
        Insert: Partial<Timestamps> & {
          id?: string;
          provider_id: string;
          model_id: string;
          display_name: string;
          max_tokens?: number;
          default_temperature?: number;
          input_cost_per_1k?: number;
          output_cost_per_1k?: number;
          enabled?: boolean;
          supports_vision?: boolean;
          supports_documents?: boolean;
        };
        Update: Partial<Database['public']['Tables']['models']['Row']>;
        Relationships: [];
      };
      conversations: {
        Row: Timestamps & {
          id: string;
          user_id: string;
          title: string;
          model_id: string | null;
          pinned: boolean;
        };
        Insert: Partial<Timestamps> & {
          id?: string;
          user_id: string;
          title?: string;
          model_id?: string | null;
          pinned?: boolean;
        };
        Update: Partial<Database['public']['Tables']['conversations']['Row']>;
        /**
         * Declared so `select('…, models(display_name)')` type-checks.
         *
         * Every other table here still has `Relationships: []`, which is what
         * a hand-written types file drifts into — an empty list is accepted by
         * the compiler and silently makes every embed an error at the call
         * site. Filled in as embeds are actually used, rather than inventing
         * shapes nothing exercises. See ISSUE-005.
         */
        Relationships: [
          {
            foreignKeyName: 'conversations_model_id_fkey';
            columns: ['model_id'];
            isOneToOne: false;
            referencedRelation: 'models';
            referencedColumns: ['id'];
          },
        ];
      };
      messages: {
        Row: {
          /** Monotonic per-row order. See migration 20260731140001. */
          seq: number;
          id: string;
          conversation_id: string;
          role: MessageRole;
          content: string;
          attachments: Json;
          input_tokens: number;
          output_tokens: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          /** Assigned by a sequence — never set this from application code. */
          seq?: number;
          conversation_id: string;
          role: MessageRole;
          content?: string;
          attachments?: Json;
          input_tokens?: number;
          output_tokens?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['messages']['Row']>;
        Relationships: [
          {
            foreignKeyName: 'messages_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
        ];
      };
      user_preferences: {
        Row: Timestamps & {
          user_id: string;
          theme: ThemeMode;
          accent_color: string;
          font_size: FontSize;
          bubble_style: BubbleStyle;
          default_model_id: string | null;
          /** Added in migration 20260730120006. */
          preset_theme: string;
        };
        Insert: Partial<Timestamps> & {
          user_id: string;
          theme?: ThemeMode;
          accent_color?: string;
          font_size?: FontSize;
          bubble_style?: BubbleStyle;
          default_model_id?: string | null;
          preset_theme?: string;
        };
        Update: Partial<Database['public']['Tables']['user_preferences']['Row']>;
        Relationships: [];
      };
      usage_logs: {
        Row: {
          id: string;
          user_id: string | null;
          model_id: string | null;
          input_tokens: number;
          output_tokens: number;
          estimated_cost: number;
          created_at: string;
          /**
           * NULL for real usage. Only a seeder sets this — see migration
           * 20260801120000, which exists so `--clean-demo` can remove exactly
           * the rows `--demo` wrote.
           */
          source: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          model_id?: string | null;
          input_tokens?: number;
          output_tokens?: number;
          estimated_cost?: number;
          created_at?: string;
          source?: string | null;
        };
        Update: Partial<Database['public']['Tables']['usage_logs']['Row']>;
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          actor_id: string | null;
          action: string;
          target_type: string | null;
          target_id: string | null;
          metadata: Json;
          ip: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_id?: string | null;
          action: string;
          target_type?: string | null;
          target_id?: string | null;
          metadata?: Json;
          ip?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['audit_logs']['Row']>;
        Relationships: [];
      };
      api_usage: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          endpoint: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['api_usage']['Row']>;
        Relationships: [];
      };
      known_logins: {
        Row: {
          id: string;
          user_id: string;
          /** HMAC of (ip + coarse user-agent) — never the raw values. */
          fingerprint: string;
          first_seen: string;
          last_seen: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          fingerprint: string;
          first_seen?: string;
          last_seen?: string;
        };
        Update: Partial<Database['public']['Tables']['known_logins']['Row']>;
        Relationships: [];
      };
      auth_attempts: {
        Row: {
          id: string;
          /** HMAC of an email or IP — never the raw value. See the migration. */
          identifier: string;
          kind: 'login' | 'reauth';
          succeeded: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          identifier: string;
          kind: 'login' | 'reauth';
          succeeded?: boolean;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['auth_attempts']['Row']>;
        Relationships: [];
      };
      system_settings: {
        Row: {
          key: string;
          value: Json;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          key: string;
          value: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: Partial<Database['public']['Tables']['system_settings']['Row']>;
        Relationships: [];
      };
    };
    Views: {
      /** Safe projection of `providers` — the encrypted key column is not present. */
      providers_public: {
        Row: {
          id: string;
          name: string;
          enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      is_admin: {
        Args: { uid?: string };
        Returns: boolean;
      };
      prune_api_usage: {
        Args: Record<never, never>;
        Returns: undefined;
      };
      prune_auth_attempts: {
        Args: Record<never, never>;
        Returns: undefined;
      };
      explain_analytics: {
        Args: Record<never, never>;
        Returns: { label: string; plan: string }[];
      };
      benchmark_message_index: {
        Args: { row_count?: number };
        Returns: { stage: string; plan: string }[];
      };
      rls_status: {
        Args: Record<never, never>;
        Returns: { table_name: string; rls_enabled: boolean; policy_count: number }[];
      };
    };
    Enums: {
      user_role: UserRole;
      message_role: MessageRole;
    };
    CompositeTypes: Record<never, never>;
  };
}
