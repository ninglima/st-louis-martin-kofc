export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          created_at: string | null
          created_by: string | null
          email: string | null
          id: string
          name: string
          picture_url: string | null
          public_data: Json
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          id?: string
          name: string
          picture_url?: string | null
          public_data?: Json
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          id?: string
          name?: string
          picture_url?: string | null
          public_data?: Json
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      dues_levels: {
        Row: {
          active: boolean
          amount_cents: number
          name: string
          self_service: boolean
          slug: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          amount_cents: number
          name: string
          self_service?: boolean
          slug: string
          sort_order: number
        }
        Update: {
          active?: boolean
          amount_cents?: number
          name?: string
          self_service?: boolean
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      dues_periods: {
        Row: {
          amount_cents: number
          check_number: string | null
          created_at: string
          id: string
          level: string
          member_id: string
          method: Database["public"]["Enums"]["dues_method"]
          payment_id: string | null
          period_end: string
          period_start: string
          received_on: string
          recorded_by: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount_cents: number
          check_number?: string | null
          created_at?: string
          id?: string
          level: string
          member_id: string
          method: Database["public"]["Enums"]["dues_method"]
          payment_id?: string | null
          period_end: string
          period_start: string
          received_on: string
          recorded_by?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount_cents?: number
          check_number?: string | null
          created_at?: string
          id?: string
          level?: string
          member_id?: string
          method?: Database["public"]["Enums"]["dues_method"]
          payment_id?: string | null
          period_end?: string
          period_start?: string
          received_on?: string
          recorded_by?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dues_periods_level_fkey"
            columns: ["level"]
            isOneToOne: false
            referencedRelation: "dues_levels"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "dues_periods_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dues_periods_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          accepted_on: string | null
          address_line1_enc: string | null
          address_line2_enc: string | null
          bad_address: boolean
          city: string | null
          country: string | null
          created_at: string
          dues_level: string
          email_secondary_enc: string | null
          first_name: string
          id: string
          is_student: boolean
          last_name: string
          membership_number: string
          middle_name: string | null
          phone_business_enc: string | null
          phone_cell_enc: string | null
          phone_residence_enc: string | null
          postal_code_enc: string | null
          prefix: string | null
          primary_email: string | null
          primary_type: string | null
          roster_last_seen_at: string | null
          roster_source_file: string | null
          secondary_address_enc: string | null
          state: string | null
          suffix: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          accepted_on?: string | null
          address_line1_enc?: string | null
          address_line2_enc?: string | null
          bad_address?: boolean
          city?: string | null
          country?: string | null
          created_at?: string
          dues_level?: string
          email_secondary_enc?: string | null
          first_name: string
          id?: string
          is_student?: boolean
          last_name: string
          membership_number: string
          middle_name?: string | null
          phone_business_enc?: string | null
          phone_cell_enc?: string | null
          phone_residence_enc?: string | null
          postal_code_enc?: string | null
          prefix?: string | null
          primary_email?: string | null
          primary_type?: string | null
          roster_last_seen_at?: string | null
          roster_source_file?: string | null
          secondary_address_enc?: string | null
          state?: string | null
          suffix?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          accepted_on?: string | null
          address_line1_enc?: string | null
          address_line2_enc?: string | null
          bad_address?: boolean
          city?: string | null
          country?: string | null
          created_at?: string
          dues_level?: string
          email_secondary_enc?: string | null
          first_name?: string
          id?: string
          is_student?: boolean
          last_name?: string
          membership_number?: string
          middle_name?: string | null
          phone_business_enc?: string | null
          phone_cell_enc?: string | null
          phone_residence_enc?: string | null
          postal_code_enc?: string | null
          prefix?: string | null
          primary_email?: string | null
          primary_type?: string | null
          roster_last_seen_at?: string | null
          roster_source_file?: string | null
          secondary_address_enc?: string | null
          state?: string | null
          suffix?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "members_dues_level_fkey"
            columns: ["dues_level"]
            isOneToOne: false
            referencedRelation: "dues_levels"
            referencedColumns: ["slug"]
          },
        ]
      }
      payment_config: {
        Row: {
          active_provider: string
          environment: string
          id: number
          square_access_token: string | null
          square_application_id: string | null
          square_location_id: string | null
          square_webhook_signature_key: string | null
          stripe_publishable_key: string | null
          stripe_secret_key: string | null
          stripe_webhook_secret: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          active_provider?: string
          environment?: string
          id?: never
          square_access_token?: string | null
          square_application_id?: string | null
          square_location_id?: string | null
          square_webhook_signature_key?: string | null
          stripe_publishable_key?: string | null
          stripe_secret_key?: string | null
          stripe_webhook_secret?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          active_provider?: string
          environment?: string
          id?: never
          square_access_token?: string | null
          square_application_id?: string | null
          square_location_id?: string | null
          square_webhook_signature_key?: string | null
          stripe_publishable_key?: string | null
          stripe_secret_key?: string | null
          stripe_webhook_secret?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      payment_items: {
        Row: {
          amount: number
          created_at: string | null
          description: string
          id: string
          item_type: string
          payment_id: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          description: string
          id?: string
          item_type: string
          payment_id: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          description?: string
          id?: string
          item_type?: string
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_items_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string | null
          currency: string
          description: string | null
          id: string
          metadata: Json | null
          payment_type: Database["public"]["Enums"]["payment_type"]
          provider: string
          provider_payment_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          currency?: string
          description?: string | null
          id?: string
          metadata?: Json | null
          payment_type: Database["public"]["Enums"]["payment_type"]
          provider: string
          provider_payment_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          currency?: string
          description?: string | null
          id?: string
          metadata?: Json | null
          payment_type?: Database["public"]["Enums"]["payment_type"]
          provider?: string
          provider_payment_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          can_manage: boolean
          can_view: boolean
          role_id: string
          section: string
        }
        Insert: {
          can_manage?: boolean
          can_view?: boolean
          role_id: string
          section: string
        }
        Update: {
          can_manage?: boolean
          can_view?: boolean
          role_id?: string
          section?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_default: boolean
          is_system: boolean
          name: string
          slug: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          is_system?: boolean
          name: string
          slug: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          is_system?: boolean
          name?: string
          slug?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      roster_imports: {
        Row: {
          completed_at: string | null
          created_at: string
          filename: string
          id: string
          plan_enc: string | null
          results_enc: string | null
          status: string
          uploaded_by: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          filename: string
          id?: string
          plan_enc?: string | null
          results_enc?: string | null
          status?: string
          uploaded_by?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          filename?: string
          id?: string
          plan_enc?: string | null
          results_enc?: string | null
          status?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          role_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          role_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      // HAND-CORRECTED, do not regenerate away: same generator limitation as
      // members_list above. check_number is null except for method = 'check';
      // recorded_by_email is null when recorded_by is null (set null on user
      // delete) or the period predates recorded_by; voided_at/void_reason are
      // null until the period is voided.
      member_dues_ledger: {
        Args: { p_member_id: string }
        Returns: {
          amount_cents: number
          check_number: string | null
          created_at: string
          id: string
          level: string
          level_name: string
          method: Database["public"]["Enums"]["dues_method"]
          period_end: string
          period_start: string
          received_on: string
          recorded_by_email: string | null
          void_reason: string | null
          voided_at: string | null
        }[]
      }
      // HAND-CORRECTED, do not regenerate away: accepted_on is null until a
      // member is accepted; paid_through is null until the first dues period
      // is recorded.
      member_dues_summary: {
        Args: { p_member_ids: string[] }
        Returns: {
          accepted_on: string | null
          amount_cents: number
          dues_level: string
          dues_status: string
          is_student: boolean
          level_name: string
          member_id: string
          paid_through: string | null
        }[]
      }
      member_upsert_from_roster: { Args: { p: Json }; Returns: string }
      members_can_manage: { Args: never; Returns: boolean }
      members_cities: {
        Args: never
        Returns: {
          city: string
        }[]
      }
      members_list: {
        Args: {
          p_city?: string
          p_has_account?: boolean
          p_limit?: number
          p_offset?: number
          p_search?: string
        }
        // HAND-CORRECTED, do not regenerate away: Supabase's generator types
        // every column of a `setof`-returning function as non-nullable. Eight
        // of these are nullable in SQL and are null on real roster data (two
        // members have no email; a member with no phone at all yields null).
        Returns: {
          address_line1: string | null
          bad_address: boolean
          city: string | null
          full_name: string
          id: string
          membership_number: string
          phone: string | null
          postal_code: string | null
          primary_email: string | null
          roster_last_seen_at: string | null
          state: string | null
          user_id: string | null
        }[]
      }
      // HAND-CORRECTED, do not regenerate away: voided_at is null until the
      // period is voided.
      my_dues_ledger: {
        Args: never
        Returns: {
          amount_cents: number
          id: string
          level_name: string
          method: Database["public"]["Enums"]["dues_method"]
          period_end: string
          period_start: string
          received_on: string
          voided_at: string | null
        }[]
      }
      // HAND-CORRECTED, do not regenerate away: accepted_on is null until a
      // member is accepted; paid_through is null until the first dues period
      // is recorded.
      my_dues_summary: {
        Args: never
        Returns: {
          accepted_on: string | null
          amount_cents: number
          dues_level: string
          dues_status: string
          is_student: boolean
          level_name: string
          member_id: string
          paid_through: string | null
        }[]
      }
      roster_import_load_plan: { Args: { p_import: string }; Returns: Json }
      roster_import_load_results: { Args: { p_import: string }; Returns: Json }
      roster_import_save_plan: {
        Args: { p_import: string; p_plan: Json }
        Returns: undefined
      }
      roster_import_save_results: {
        Args: { p_import: string; p_results: Json }
        Returns: undefined
      }
    }
    Enums: {
      dues_method: "online" | "check" | "cash" | "waived" | "opening_balance"
      payment_status:
        | "pending"
        | "processing"
        | "succeeded"
        | "failed"
        | "refunded"
        | "cancelled"
      payment_type: "dues" | "donation" | "event_fee"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      dues_method: ["online", "check", "cash", "waived", "opening_balance"],
      payment_status: [
        "pending",
        "processing",
        "succeeded",
        "failed",
        "refunded",
        "cancelled",
      ],
      payment_type: ["dues", "donation", "event_fee"],
    },
  },
} as const

