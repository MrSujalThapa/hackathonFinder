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
  title: string;
  status: TerminalSessionStatus;
  active_job_id: string | null;
  selected_job_id: string | null;
  is_selected: boolean;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  last_selected_at: string | null;
  sort_order: number;
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
    title: row.title,
    status: row.status,
    activeJobId: row.active_job_id,
    selectedJobId: row.selected_job_id,
    isSelected: row.is_selected,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    lastSelectedAt: row.last_selected_at,
    sortOrder: row.sort_order,
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

function sanitizeTitle(input?: string): string {
  return (input?.trim() || "Session").slice(0, 120);
}

function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object") return {};
  const encoded = JSON.stringify(metadata);
  if (encoded.length > 4_096) return { truncated: true };
  return metadata;
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

  async function requireSession(id: string): Promise<TerminalSession> {
    const session = await getSession(id);
    if (!session) throw new Error(`Terminal session not found: ${id}`);
    return session;
  }

  async function requireOpenSession(id: string): Promise<TerminalSession> {
    const session = await requireSession(id);
    if (session.status === "closed") {
      throw new Error(`Terminal session is closed: ${id}`);
    }
    return session;
  }

  async function touchSession(id: string): Promise<TerminalSession> {
    await requireOpenSession(id);
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("terminal_sessions")
      .update({ updated_at: now })
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw new Error(tableMissingMessage(error));
    return mapSession(data as SessionRow);
  }

  const repo: TerminalSessionRepository = {
    listSessions: async (
      params: ListTerminalSessionsParams = {},
    ): Promise<TerminalSession[]> => {
      const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
      let query = supabase
        .from("terminal_sessions")
        .select("*")
        .order("status", { ascending: false })
        .order("sort_order", { ascending: true })
        .order("last_selected_at", { ascending: false, nullsFirst: false })
        .limit(limit);

      if (params.includeClosed !== true) {
        query = query.eq("status", "open");
      }

      const { data, error } = await query;
      if (error) throw new Error(tableMissingMessage(error));
      return ((data ?? []) as SessionRow[]).map(mapSession);
    },

    getSession,

    findSessionByTitleOrId: async (
      target: string,
    ): Promise<TerminalSession | null> => {
      const needle = target.trim();
      if (!needle) return null;
      const byId = await getSession(needle).catch(() => null);
      if (byId) return byId;

      const { data, error } = await supabase
        .from("terminal_sessions")
        .select("*")
        .or(`title.ilike.${needle}%,id.ilike.${needle}%`)
        .order("status", { ascending: false })
        .order("last_selected_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(tableMissingMessage(error));
      return data ? mapSession(data as SessionRow) : null;
    },

    getSelectedSession: async (): Promise<TerminalSession | null> => {
      const { data, error } = await supabase
        .from("terminal_sessions")
        .select("*")
        .eq("is_selected", true)
        .eq("status", "open")
        .maybeSingle();
      if (error) throw new Error(tableMissingMessage(error));
      return data ? mapSession(data as SessionRow) : repo.restoreLatestSelectedSession();
    },

    restoreLatestSelectedSession: async (): Promise<TerminalSession | null> => {
      const { data, error } = await supabase
        .from("terminal_sessions")
        .select("*")
        .eq("status", "open")
        .order("last_selected_at", { ascending: false, nullsFirst: false })
        .order("updated_at", { ascending: false })
        .limit(1)
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
          id: input.id,
          title: sanitizeTitle(input.title ?? input.name),
          status: "open",
          active_job_id: null,
          selected_job_id: null,
          is_selected: select,
          created_at: now,
          updated_at: now,
          last_selected_at: select ? now : null,
          sort_order: input.sortOrder ?? 0,
          metadata: sanitizeMetadata(input.metadata),
        })
        .select("*")
        .single();

      if (error) throw new Error(tableMissingMessage(error));
      return mapSession(data as SessionRow);
    },

    renameSession: async (
      id: string,
      title: string,
    ): Promise<TerminalSession> => {
      const trimmed = title.trim();
      if (!trimmed) throw new Error("Session title cannot be empty.");

      const { data, error } = await supabase
        .from("terminal_sessions")
        .update({
          title: trimmed.slice(0, 120),
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

    reopenSession: async (id: string): Promise<TerminalSession> => {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("terminal_sessions")
        .update({
          status: "open",
          updated_at: now,
          closed_at: null,
        })
        .eq("id", id)
        .select("*")
        .single();

      if (error) throw new Error(tableMissingMessage(error));
      return mapSession(data as SessionRow);
    },

    selectSession: async (id: string): Promise<TerminalSession> => {
      await requireOpenSession(id);
      await clearSelection();
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("terminal_sessions")
        .update({
          is_selected: true,
          updated_at: now,
          last_selected_at: now,
        })
        .eq("id", id)
        .select("*")
        .single();

      if (error) throw new Error(tableMissingMessage(error));
      return mapSession(data as SessionRow);
    },

    touchSession,

    attachJob: async (
      sessionId: string,
      jobId: string,
    ): Promise<TerminalSession> => {
      await requireSession(sessionId);

      const { error: jobError } = await supabase
        .from("discovery_jobs")
        .update({ terminal_session_id: sessionId })
        .eq("id", jobId);

      if (jobError) throw new Error(tableMissingMessage(jobError));

      const { data, error } = await supabase
        .from("terminal_sessions")
        .update({
          active_job_id: jobId,
          selected_job_id: jobId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sessionId)
        .select("*")
        .single();

      if (error) throw new Error(tableMissingMessage(error));
      return mapSession(data as SessionRow);
    },

    linkJob: async (sessionId: string, jobId: string): Promise<void> => {
      await repo.attachJob(sessionId, jobId);
    },

    detachCompletedActiveJob: async (
      sessionId: string,
      jobId: string,
    ): Promise<TerminalSession> => {
      const session = await requireSession(sessionId);
      const { data, error } = await supabase
        .from("terminal_sessions")
        .update({
          active_job_id: session.activeJobId === jobId ? null : session.activeJobId,
          selected_job_id: session.selectedJobId ?? jobId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sessionId)
        .select("*")
        .single();

      if (error) throw new Error(tableMissingMessage(error));
      return mapSession(data as SessionRow);
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

    listTerminalHistory: async (
      sessionId: string,
      options: { limit?: number } = {},
    ): Promise<string[]> => {
      return repo.listSessionJobIds(sessionId, options);
    },

    appendCommandHistory: async (
      sessionId: string,
      command: string,
    ): Promise<TerminalCommandHistoryEntry> => {
      const session = await requireOpenSession(sessionId);
      const trimmed = command.trim();
      if (!trimmed) throw new Error("Command history entry cannot be empty.");

      const { data: lastRows, error: lastError } = await supabase
        .from("terminal_command_history")
        .select("sequence")
        .eq("session_id", session.id)
        .order("sequence", { ascending: false })
        .limit(1);

      if (lastError) throw new Error(tableMissingMessage(lastError));
      const nextSequence =
        ((lastRows?.[0] as { sequence?: number } | undefined)?.sequence ?? 0) +
        1;

      const { data, error } = await supabase
        .from("terminal_command_history")
        .insert({
          session_id: session.id,
          command: trimmed.slice(0, 2_000),
          sequence: nextSequence,
        })
        .select("*")
        .single();

      if (error) throw new Error(tableMissingMessage(error));
      await touchSession(session.id);
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
      return ((data ?? []) as HistoryRow[]).map(mapHistory).reverse();
    },
  };

  return repo;
}
