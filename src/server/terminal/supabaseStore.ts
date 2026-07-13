/**
 * Supabase-backed terminal session repository.
 * Requires migration 007_terminal_sessions.sql to be applied.
 */

import { createServiceSupabaseClient } from "@/lib/supabase/createServiceClient";
import type {
  CreateTerminalSessionInput,
  ListTerminalSessionsParams,
  TerminalCommandHistoryEntry,
  TerminalSession,
  TerminalSessionRepository,
  TerminalSessionStatus,
} from "@/server/terminal/types";

type SessionRow = {
  id: string;
  name: string;
  status: TerminalSessionStatus;
  is_selected: boolean;
  created_at: string;
  updated_at: string;
  last_active_at: string;
  closed_at: string | null;
  metadata: Record<string, unknown> | null;
};

type HistoryRow = {
  id: string;
  session_id: string;
  command: string;
  sequence: number;
  created_at: string;
};

function mapSession(row: SessionRow): TerminalSession {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    isSelected: row.is_selected,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActiveAt: row.last_active_at,
    closedAt: row.closed_at,
    metadata: row.metadata,
  };
}

function mapHistory(row: HistoryRow): TerminalCommandHistoryEntry {
  return {
    id: row.id,
    sessionId: row.session_id,
    command: row.command,
    sequence: row.sequence,
    createdAt: row.created_at,
  };
}

function tableMissingMessage(error: { message?: string }): string {
  return `Terminal session tables unavailable (${error.message ?? "unknown"}). Apply supabase/migrations/007_terminal_sessions.sql or use the DEV-ONLY in-memory store in development.`;
}

export function createSupabaseTerminalSessionStore(): TerminalSessionRepository {
  // terminal_sessions tables are added by migration 007; regenerate database.types after apply.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceSupabaseClient() as any;

  async function clearSelection(): Promise<void> {
    const { error } = await supabase
      .from("terminal_sessions")
      .update({ is_selected: false, updated_at: new Date().toISOString() })
      .eq("is_selected", true);
    if (error) throw new Error(tableMissingMessage(error));
  }

  async function getSession(id: string): Promise<TerminalSession | null> {
    const { data, error } = await supabase
      .from("terminal_sessions")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(tableMissingMessage(error));
    return data ? mapSession(data as SessionRow) : null;
  }

  async function touchSession(id: string): Promise<TerminalSession> {
    const existing = await getSession(id);
    if (!existing) throw new Error(`Terminal session not found: ${id}`);
    if (existing.status === "closed") {
      throw new Error(`Terminal session is closed: ${id}`);
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("terminal_sessions")
      .update({ updated_at: now, last_active_at: now })
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw new Error(tableMissingMessage(error));
    return mapSession(data as SessionRow);
  }

  return {
    listSessions: async (
      params: ListTerminalSessionsParams = {},
    ): Promise<TerminalSession[]> => {
      const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
      let query = supabase
        .from("terminal_sessions")
        .select("*")
        .order("last_active_at", { ascending: false })
        .limit(limit);

      if (params.includeClosed !== true) {
        query = query.eq("status", "open");
      }

      const { data, error } = await query;
      if (error) throw new Error(tableMissingMessage(error));
      return ((data ?? []) as SessionRow[]).map(mapSession);
    },

    getSession,

    getSelectedSession: async (): Promise<TerminalSession | null> => {
      const { data, error } = await supabase
        .from("terminal_sessions")
        .select("*")
        .eq("is_selected", true)
        .eq("status", "open")
        .maybeSingle();
      if (error) throw new Error(tableMissingMessage(error));
      return data ? mapSession(data as SessionRow) : null;
    },

    createSession: async (
      input: CreateTerminalSessionInput = {},
    ): Promise<TerminalSession> => {
      const select = input.select !== false;
      if (select) await clearSelection();

      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("terminal_sessions")
        .insert({
          name: (input.name?.trim() || "Session").slice(0, 120),
          status: "open",
          is_selected: select,
          created_at: now,
          updated_at: now,
          last_active_at: now,
          metadata: input.metadata ?? {},
        })
        .select("*")
        .single();

      if (error) throw new Error(tableMissingMessage(error));
      return mapSession(data as SessionRow);
    },

    renameSession: async (
      id: string,
      name: string,
    ): Promise<TerminalSession> => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Session name cannot be empty.");

      const { data, error } = await supabase
        .from("terminal_sessions")
        .update({
          name: trimmed.slice(0, 120),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select("*")
        .single();

      if (error) throw new Error(tableMissingMessage(error));
      return mapSession(data as SessionRow);
    },

    closeSession: async (id: string): Promise<TerminalSession> => {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("terminal_sessions")
        .update({
          status: "closed",
          is_selected: false,
          updated_at: now,
          closed_at: now,
        })
        .eq("id", id)
        .select("*")
        .single();

      if (error) throw new Error(tableMissingMessage(error));
      return mapSession(data as SessionRow);
    },

    selectSession: async (id: string): Promise<TerminalSession> => {
      const existing = await getSession(id);
      if (!existing) throw new Error(`Terminal session not found: ${id}`);
      if (existing.status === "closed") {
        throw new Error(`Terminal session is closed: ${id}`);
      }

      await clearSelection();
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("terminal_sessions")
        .update({
          is_selected: true,
          updated_at: now,
          last_active_at: now,
        })
        .eq("id", id)
        .select("*")
        .single();

      if (error) throw new Error(tableMissingMessage(error));
      return mapSession(data as SessionRow);
    },

    touchSession,

    linkJob: async (sessionId: string, jobId: string): Promise<void> => {
      const session = await getSession(sessionId);
      if (!session) throw new Error(`Terminal session not found: ${sessionId}`);

      const { error } = await supabase
        .from("discovery_jobs")
        .update({ terminal_session_id: sessionId })
        .eq("id", jobId);

      if (error) throw new Error(tableMissingMessage(error));

      if (session.status === "open") {
        await touchSession(sessionId);
      }
    },

    listSessionJobIds: async (
      sessionId: string,
      options: { limit?: number } = {},
    ): Promise<string[]> => {
      const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
      const { data, error } = await supabase
        .from("discovery_jobs")
        .select("id")
        .eq("terminal_session_id", sessionId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw new Error(tableMissingMessage(error));
      return ((data ?? []) as { id: string }[]).map((row) => row.id);
    },

    appendCommandHistory: async (
      sessionId: string,
      command: string,
    ): Promise<TerminalCommandHistoryEntry> => {
      const session = await getSession(sessionId);
      if (!session) throw new Error(`Terminal session not found: ${sessionId}`);
      if (session.status === "closed") {
        throw new Error(`Terminal session is closed: ${sessionId}`);
      }

      const trimmed = command.trim();
      if (!trimmed) throw new Error("Command history entry cannot be empty.");

      const { data: lastRows, error: lastError } = await supabase
        .from("terminal_command_history")
        .select("sequence")
        .eq("session_id", sessionId)
        .order("sequence", { ascending: false })
        .limit(1);

      if (lastError) throw new Error(tableMissingMessage(lastError));
      const nextSequence =
        ((lastRows?.[0] as { sequence?: number } | undefined)?.sequence ?? 0) +
        1;

      const { data, error } = await supabase
        .from("terminal_command_history")
        .insert({
          session_id: sessionId,
          command: trimmed.slice(0, 2_000),
          sequence: nextSequence,
        })
        .select("*")
        .single();

      if (error) throw new Error(tableMissingMessage(error));
      await touchSession(sessionId);
      return mapHistory(data as HistoryRow);
    },

    listCommandHistory: async (
      sessionId: string,
      options: { limit?: number } = {},
    ): Promise<TerminalCommandHistoryEntry[]> => {
      const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
      const { data, error } = await supabase
        .from("terminal_command_history")
        .select("*")
        .eq("session_id", sessionId)
        .order("sequence", { ascending: false })
        .limit(limit);

      if (error) throw new Error(tableMissingMessage(error));
      // Return chronological (oldest → newest) for arrow-up UX.
      return ((data ?? []) as HistoryRow[]).map(mapHistory).reverse();
    },
  };
}
