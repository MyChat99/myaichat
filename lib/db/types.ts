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
        Relationships: [];
      };
      messages: {
        Row: {
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
          conversation_id: string;
          role: MessageRole;
          content?: string;
          attachments?: Json;
          input_tokens?: number;
          output_tokens?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['messages']['Row']>;
        Relationships: [];
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
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          model_id?: string | null;
          input_tokens?: number;
          output_tokens?: number;
          estimated_cost?: number;
          created_at?: string;
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
      prune_auth_attempts: {
        Args: Record<never, never>;
        Returns: undefined;
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
