export type CandidateStatus =
  | "NEW"
  | "NEEDS_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "SAVED_FOR_LATER"
  | "EXPIRED"
  | "DUPLICATE"
  | "ERROR";

export type CandidateMode = "online" | "in-person" | "hybrid" | "unknown";

export type EvidenceType =
  | "official_page"
  | "apply_page"
  | "x_post"
  | "manual_lead"
  | "search_result"
  | "source_card"
  | "luma_page"
  | "devpost_page"
  | "mlh_page"
  | "hacklist_card"
  | "hakku_card";

export type CandidateActionType =
  | "APPROVE"
  | "REJECT"
  | "SAVE_FOR_LATER"
  | "RESTORE"
  | "ENRICH"
  | "UPDATE_FROM_DUPLICATE"
  | "SHEET_APPEND"
  | "SHEET_DELETE"
  | "UNDO";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      candidates: {
        Row: {
          id: string;
          status: CandidateStatus;
          score: number;
          name: string;
          source: string;
          official_url: string | null;
          apply_url: string | null;
          social_url: string | null;
          start_date: string | null;
          end_date: string | null;
          deadline: string | null;
          location: string | null;
          mode: CandidateMode | null;
          city: string | null;
          country: string | null;
          prize: string | null;
          themes: string[];
          eligibility: string | null;
          description: string | null;
          summary: string | null;
          why_match: string[];
          red_flags: string[];
          fingerprint: string;
          source_ids: Json;
          sheet_row_id: string | null;
          sheet_appended_at: string | null;
          found_at: string;
          last_verified: string;
          approved_at: string | null;
          rejected_at: string | null;
          saved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          status?: CandidateStatus;
          score?: number;
          name: string;
          source: string;
          official_url?: string | null;
          apply_url?: string | null;
          social_url?: string | null;
          start_date?: string | null;
          end_date?: string | null;
          deadline?: string | null;
          location?: string | null;
          mode?: CandidateMode | null;
          city?: string | null;
          country?: string | null;
          prize?: string | null;
          themes?: string[];
          eligibility?: string | null;
          description?: string | null;
          summary?: string | null;
          why_match?: string[];
          red_flags?: string[];
          fingerprint: string;
          source_ids?: Json;
          sheet_row_id?: string | null;
          sheet_appended_at?: string | null;
          found_at?: string;
          last_verified?: string;
          approved_at?: string | null;
          rejected_at?: string | null;
          saved_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["candidates"]["Insert"]>;
        Relationships: [];
      };
      candidate_evidence: {
        Row: {
          id: string;
          candidate_id: string;
          type: EvidenceType;
          url: string | null;
          title: string | null;
          snippet: string | null;
          raw: Json;
          found_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          candidate_id: string;
          type: EvidenceType;
          url?: string | null;
          title?: string | null;
          snippet?: string | null;
          raw?: Json;
          found_at?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["candidate_evidence"]["Insert"]>;
        Relationships: [];
      };
      candidate_actions: {
        Row: {
          id: string;
          candidate_id: string;
          action: CandidateActionType;
          previous_status: string | null;
          new_status: string | null;
          reason: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          candidate_id: string;
          action: CandidateActionType;
          previous_status?: string | null;
          new_status?: string | null;
          reason?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["candidate_actions"]["Insert"]>;
        Relationships: [];
      };
      candidate_answers: {
        Row: {
          id: string;
          candidate_id: string;
          question: string;
          answer: string;
          confidence: "low" | "medium" | "high" | null;
          sources: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          candidate_id: string;
          question: string;
          answer: string;
          confidence?: "low" | "medium" | "high" | null;
          sources?: Json;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["candidate_answers"]["Insert"]>;
        Relationships: [];
      };
      agent_runs: {
        Row: {
          id: string;
          command: string;
          preferences: Json;
          sources: string[];
          status: "STARTED" | "COMPLETED" | "FAILED" | "PARTIAL";
          raw_leads_count: number;
          parsed_events_count: number;
          new_candidates_count: number;
          updated_candidates_count: number;
          rejected_count: number;
          errors: Json;
          metadata: Json;
          started_at: string;
          finished_at: string | null;
        };
        Insert: {
          id?: string;
          command: string;
          preferences?: Json;
          sources?: string[];
          status?: "STARTED" | "COMPLETED" | "FAILED" | "PARTIAL";
          raw_leads_count?: number;
          parsed_events_count?: number;
          new_candidates_count?: number;
          updated_candidates_count?: number;
          rejected_count?: number;
          errors?: Json;
          metadata?: Json;
          started_at?: string;
          finished_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["agent_runs"]["Insert"]>;
        Relationships: [];
      };
      manual_leads: {
        Row: {
          id: string;
          platform: "X" | "Instagram" | "LinkedIn" | "Discord" | "Website" | "Other";
          url: string;
          notes: string | null;
          status: "UNPROCESSED" | "PROCESSED" | "REJECTED" | "NEEDS_REVIEW";
          candidate_id: string | null;
          processed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          platform: "X" | "Instagram" | "LinkedIn" | "Discord" | "Website" | "Other";
          url: string;
          notes?: string | null;
          status?: "UNPROCESSED" | "PROCESSED" | "REJECTED" | "NEEDS_REVIEW";
          candidate_id?: string | null;
          processed_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["manual_leads"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
