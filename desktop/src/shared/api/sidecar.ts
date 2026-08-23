/**
 * Typed client for the FastAPI sidecar.
 *
 * The sidecar is local only (127.0.0.1:8321, see docs/ARCHITECTURE.md): in
 * development it runs via `uv run uvicorn ... --port 8321`, and in production
 * the Tauri shell spawns the bundled binary on the same port.
 */

import type { TranscriptLine } from "./contracts";
import {
  ApiError,
  BASE_URL,
  readSseJson,
  request,
  requestBytes,
  requestResponse,
  requestVoid,
} from "./client";

export type Theme = "light" | "dark";
export type NoteFont = "lato" | "arial" | "serif" | "mono";

export interface User {
  id: number;
  name: string;
}

export interface Settings {
  theme: Theme;
  noteFont: NoteFont;
  noteFontSize: number;
  /** Whether Record moves the window into meeting mode. */
  enterMeetingOnRecord: boolean;
  /** Notes + AI when true; notes only when false. The server enforces it too. */
  aiEnabled: boolean;
  /** One note per day, created at `dailyNoteTime` while the app is open
   * (and on the next launch if the time already passed). */
  dailyNoteEnabled: boolean;
  /** The folder today's note lands in (null = Inbox). */
  dailyNoteFolderId: number | null;
  /** Local HH:MM when today's note is created. */
  dailyNoteTime: string;
}

/** One picture attached to a note — the id for the file endpoint plus its
 * title. Used in previews, the sidebar outline, and folder thumbnails. */
export interface OutlineImage {
  id: number;
  title: string | null;
}

/** One history row: GET /entries returns these (cheap to list). */
export interface EntrySummary {
  id: number;
  folderId: number;
  title: string | null;
  preview: string;
  /** The note's normalized tags, alphabetically ordered by the server. */
  tags: string[];
  /** The note's pictures, oldest first — folder view thumbnails. */
  images: OutlineImage[];
  createdAt: string;
  updatedAt: string;
}

/** One full note: GET /entries/{id} returns this. */
export interface Entry {
  id: number;
  folderId: number;
  title: string | null;
  noteMd: string | null;
  transcript: string | null;
  images: OutlineImage[];
  createdAt: string;
  updatedAt: string;
}

/** One folder: GET /folders returns these. Every user has exactly one Inbox. */
export interface Folder {
  id: number;
  name: string;
  isInbox: boolean;
}

/** One chat row of a note's sidebar children (messages load on open). */
export interface OutlineChat {
  id: number;
  title: string | null;
}

/** A note's compact sidebar outline: GET /entries/{id}/outline. */
export interface EntryOutline {
  hasTranscript: boolean;
  chats: OutlineChat[];
  images: OutlineImage[];
}

/** One uploaded picture's metadata (POST /entries/{id}/images). */
export interface EntryImage {
  id: number;
  entryId: number;
  title: string | null;
  mimeType: string;
  createdAt: string;
}

/** One AI-enhanced version of a note: GET /entries/{id}/enhanced-versions. */
export interface EnhancedVersion {
  id: number;
  entryId: number;
  title: string | null;
  content: string;
  templateId: string | null;
  createdAt: string;
}

/** One enhance template (built-in or custom): GET /templates returns these. */
export interface Template {
  id: string;
  name: string;
  description: string;
  instructions: string;
  isBuiltin: boolean;
}

/** One conversation on an entry. */
export interface Chat {
  id: number;
  entryId: number;
  title: string | null;
  createdAt: string;
}

/** One message in a chat. */
export interface Message {
  id: number;
  chatId: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

/** The wire shape of /settings (snake_case, as the sidecar spells it). */
interface SettingsPayload {
  theme: Theme;
  note_font: NoteFont;
  note_font_size: number;
  enter_meeting_on_record: boolean;
  ai_enabled: boolean;
  daily_note_enabled: boolean;
  daily_note_folder_id: number | null;
  daily_note_time: string;
}

/** The wire shapes of /entries — snake_case, mapped to camelCase below. */
interface EntrySummaryPayload {
  id: number;
  folder_id: number;
  title: string | null;
  preview: string;
  tags: string[];
  images: { id: number; title: string | null }[];
  created_at: string;
  updated_at: string;
}

interface EntryPayload {
  id: number;
  folder_id: number;
  title: string | null;
  note_md: string | null;
  transcript: string | null;
  images: { id: number; title: string | null }[];
  created_at: string;
  updated_at: string;
}

/** The wire shape of /folders (snake_case). */
interface FolderPayload {
  id: number;
  name: string;
  is_inbox: boolean;
}

/** The wire shape of /entries/{id}/outline (snake_case). */
interface EntryOutlinePayload {
  has_transcript: boolean;
  chats: { id: number; title: string | null }[];
  images: { id: number; title: string | null }[];
}

/** The wire shape of /entries/{id}/enhanced-versions (snake_case). */
interface EnhancedVersionPayload {
  id: number;
  entry_id: number;
  title: string | null;
  content: string;
  template_id: string | null;
  created_at: string;
}

/** The wire shape of /templates (snake_case). */
interface TemplatePayload {
  id: string;
  name: string;
  description: string;
  instructions: string;
  is_builtin: boolean;
}

/** The wire shapes of /chats and /chats/{id}/messages (snake_case). */
interface ChatPayload {
  id: number;
  entry_id: number;
  title: string | null;
  created_at: string;
}

interface MessagePayload {
  id: number;
  chat_id: number;
  role: string;
  content: string;
  created_at: string;
}

/** The wire shape of /entries/{id}/images (snake_case). */
interface EntryImagePayload {
  id: number;
  entry_id: number;
  title: string | null;
  mime_type: string;
  created_at: string;
}

const toImage = (payload: { id: number; title: string | null }): OutlineImage => ({
  id: payload.id,
  title: payload.title,
});

const toEntryImage = (payload: EntryImagePayload): EntryImage => ({
  id: payload.id,
  entryId: payload.entry_id,
  title: payload.title,
  mimeType: payload.mime_type,
  createdAt: payload.created_at,
});

const toEntry = (payload: EntryPayload): Entry => ({
  id: payload.id,
  folderId: payload.folder_id,
  title: payload.title,
  noteMd: payload.note_md,
  transcript: payload.transcript,
  images: payload.images.map(toImage),
  createdAt: payload.created_at,
  updatedAt: payload.updated_at,
});

const toEnhancedVersion = (payload: EnhancedVersionPayload): EnhancedVersion => ({
  id: payload.id,
  entryId: payload.entry_id,
  title: payload.title,
  content: payload.content,
  templateId: payload.template_id,
  createdAt: payload.created_at,
});

const toTemplate = (payload: TemplatePayload): Template => ({
  id: payload.id,
  name: payload.name,
  description: payload.description,
  instructions: payload.instructions,
  isBuiltin: payload.is_builtin,
});

const toEntrySummary = (payload: EntrySummaryPayload): EntrySummary => ({
  id: payload.id,
  folderId: payload.folder_id,
  title: payload.title,
  preview: payload.preview,
  tags: payload.tags,
  images: payload.images.map(toImage),
  createdAt: payload.created_at,
  updatedAt: payload.updated_at,
});

const toFolder = (payload: FolderPayload): Folder => ({
  id: payload.id,
  name: payload.name,
  isInbox: payload.is_inbox,
});

const toEntryOutline = (payload: EntryOutlinePayload): EntryOutline => ({
  hasTranscript: payload.has_transcript,
  chats: payload.chats.map((chat) => ({ id: chat.id, title: chat.title })),
  images: payload.images.map(toImage),
});

/** GET /me — resolves to null when onboarding hasn't happened yet. */
export async function getUser(): Promise<User | null> {
  try {
    return await request<User>("/me", undefined, 2_000);
  } catch (error) {
    if (error instanceof ApiError && error.kind === "not-found") return null;
    throw error;
  }
}

/** PUT /me — creates the user on first save (ends onboarding). */
export function saveName(name: string): Promise<User> {
  return request<User>("/me", { method: "PUT", body: JSON.stringify({ name }) });
}

/** GET /settings — creates the row with defaults on first read. */
export async function getSettings(): Promise<Settings> {
  const payload = await request<SettingsPayload>("/settings");
  return {
    theme: payload.theme,
    noteFont: payload.note_font,
    noteFontSize: payload.note_font_size,
    enterMeetingOnRecord: payload.enter_meeting_on_record,
    aiEnabled: payload.ai_enabled,
    dailyNoteEnabled: payload.daily_note_enabled,
    dailyNoteFolderId: payload.daily_note_folder_id,
    dailyNoteTime: payload.daily_note_time,
  };
}

/** PUT /settings — full replace, like the /me PUT. */
export function saveSettings(settings: Settings): Promise<void> {
  return requestVoid("/settings", {
    method: "PUT",
    body: JSON.stringify({
      theme: settings.theme,
      note_font: settings.noteFont,
      note_font_size: settings.noteFontSize,
      enter_meeting_on_record: settings.enterMeetingOnRecord,
      ai_enabled: settings.aiEnabled,
      daily_note_enabled: settings.dailyNoteEnabled,
      daily_note_folder_id: settings.dailyNoteFolderId,
      daily_note_time: settings.dailyNoteTime,
    }),
  });
}

/** GET /entries — the history list, most recently edited first. */
export async function listEntries(folderId?: number): Promise<EntrySummary[]> {
  const path = folderId === undefined ? "/entries" : `/entries?folder_id=${folderId}`;
  const payload = await request<EntrySummaryPayload[]>(path);
  return payload.map(toEntrySummary);
}

/** POST /entries — a new blank note. Without a folder it lands in Inbox. */
export async function createEntry(folderId?: number): Promise<Entry> {
  const payload = await request<EntryPayload>("/entries", {
    method: "POST",
    body: folderId === undefined ? undefined : JSON.stringify({ folder_id: folderId }),
  });
  return toEntry(payload);
}

/** GET /entries/{id} — one full note. */
export async function getEntry(id: number): Promise<Entry> {
  const payload = await request<EntryPayload>(`/entries/${id}`);
  return toEntry(payload);
}

/** PATCH /entries/{id} — save the human note content. */
export async function updateEntry(id: number, noteMd: string | null): Promise<Entry> {
  const payload = await request<EntryPayload>(`/entries/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ note_md: noteMd }),
  });
  return toEntry(payload);
}

/** PATCH /entries/{id} — rename the note (title only, content untouched). */
export async function renameEntry(id: number, title: string | null): Promise<Entry> {
  const payload = await request<EntryPayload>(`/entries/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
  return toEntry(payload);
}

/** PATCH /entries/{id} — move the note to another folder. */
export async function moveEntry(id: number, folderId: number): Promise<Entry> {
  const payload = await request<EntryPayload>(`/entries/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ folder_id: folderId }),
  });
  return toEntry(payload);
}

/** GET /entries/{id}/outline — transcript presence and chat titles. */
export async function getEntryOutline(entryId: number): Promise<EntryOutline> {
  const payload = await request<EntryOutlinePayload>(`/entries/${entryId}/outline`);
  return toEntryOutline(payload);
}

/** GET /entries/{id}/tags — the note's current normalized tags. */
export async function getEntryTags(entryId: number): Promise<string[]> {
  const payload = await request<{ tags: string[] }>(`/entries/${entryId}/tags`);
  return payload.tags;
}

/** PUT /entries/{id}/tags — replace the note's tags with this exact list. */
export async function replaceEntryTags(entryId: number, tags: string[]): Promise<string[]> {
  const payload = await request<{ tags: string[] }>(`/entries/${entryId}/tags`, {
    method: "PUT",
    body: JSON.stringify({ tags }),
  });
  return payload.tags;
}

/** DELETE /tags/{value} — remove the tag from every note. */
export function deleteTag(value: string): Promise<void> {
  return requestVoid(`/tags/${encodeURIComponent(value)}`, { method: "DELETE" });
}

/** PATCH /tags/{value} — rename the tag everywhere (merging onto an existing name). */
export async function renameTag(value: string, newValue: string): Promise<void> {
  await requestVoid(`/tags/${encodeURIComponent(value)}`, {
    method: "PATCH",
    body: JSON.stringify({ value: newValue }),
  });
}

/** POST /entries/{id}/suggest-title — one suggested title, never saved. */
export async function suggestEntryTitle(entryId: number): Promise<string> {
  const payload = await request<{ title: string }>(`/entries/${entryId}/suggest-title`, {
    method: "POST",
  });
  return payload.title;
}

/** GET /folders — Inbox first, then custom folders by name. */
export async function listFolders(): Promise<Folder[]> {
  const payload = await request<FolderPayload[]>("/folders");
  return payload.map(toFolder);
}

/** POST /folders — a new custom folder (Inbox is the only protected one). */
export async function createFolder(name: string): Promise<Folder> {
  const payload = await request<FolderPayload>("/folders", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return toFolder(payload);
}

/** PATCH /folders/{id} — rename a custom folder. */
export async function renameFolder(id: number, name: string): Promise<Folder> {
  const payload = await request<FolderPayload>(`/folders/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
  return toFolder(payload);
}

/** DELETE /folders/{id} — the folder's notes move to Inbox first. */
export function deleteFolder(id: number): Promise<void> {
  return requestVoid(`/folders/${id}`, { method: "DELETE" });
}

/** DELETE /entries/{id}. */
export function deleteEntry(id: number): Promise<void> {
  return requestVoid(`/entries/${id}`, { method: "DELETE" });
}

/** POST /entries/daily — today's note, created on the first call of the day.
 * `date` is the client's local YYYY-MM-DD, never the server's guess. */
export async function getOrCreateDailyNote(
  date: string,
  folderId: number | null,
): Promise<{ entry: Entry; created: boolean }> {
  const payload = await request<{ entry: EntryPayload; created: boolean }>(
    "/entries/daily",
    {
      method: "POST",
      body: JSON.stringify({ date, folder_id: folderId }),
    },
  );
  return { entry: toEntry(payload.entry), created: payload.created };
}

/** POST /entries/{id}/images — store one picture on the note. */
export async function uploadEntryImage(
  entryId: number,
  file: File,
  title: string | null,
): Promise<EntryImage> {
  const form = new FormData();
  form.append("file", file);
  if (title !== null && title !== "") form.append("title", title);
  const payload = await request<EntryImagePayload>(
    `/entries/${entryId}/images`,
    { method: "POST", body: form },
    120_000,
  );
  return toEntryImage(payload);
}

/** PATCH /entries/{id}/images/{image_id} — rename one picture. */
export async function renameEntryImage(
  entryId: number,
  imageId: number,
  title: string | null,
): Promise<EntryImage> {
  const payload = await request<EntryImagePayload>(
    `/entries/${entryId}/images/${imageId}`,
    { method: "PATCH", body: JSON.stringify({ title }) },
  );
  return toEntryImage(payload);
}

/** DELETE /entries/{id}/images/{image_id}. */
export function deleteEntryImage(entryId: number, imageId: number): Promise<void> {
  return requestVoid(`/entries/${entryId}/images/${imageId}`, { method: "DELETE" });
}

/** The file URL of one picture — previews, thumbnails, and the viewer. */
export function entryImageUrl(entryId: number, imageId: number): string {
  return `${BASE_URL}/entries/${entryId}/images/${imageId}`;
}

/** POST /workflows/leetcode — the starter folder and note, idempotent. */
export async function setupLeetCodeWorkflow(): Promise<{
  folderId: number;
  folderCreated: boolean;
  starterCreated: boolean;
}> {
  const payload = await request<{
    folder_id: number;
    folder_created: boolean;
    starter_created: boolean;
  }>("/workflows/leetcode", { method: "POST" });
  return {
    folderId: payload.folder_id,
    folderCreated: payload.folder_created,
    starterCreated: payload.starter_created,
  };
}

/**
 * Last-chance save when the window closes mid-keystroke: `keepalive` lets
 * the request out while the webview is tearing down.
 */
export function saveEntryKeepalive(id: number, noteMd: string | null): void {
  sendKeepalivePatch(`/entries/${id}`, { note_md: noteMd });
}

/** Last-chance enhanced-version save during webview teardown. */
export function saveEnhancedVersionKeepalive(id: number, content: string): void {
  sendKeepalivePatch(`/enhanced-versions/${id}`, { content });
}

function sendKeepalivePatch(path: string, body: object): void {
  void fetch(`${BASE_URL}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => undefined);
}

/** GET /entries/{id}/audio — the saved recording's length in seconds. */
export async function getEntryAudio(entryId: number): Promise<number> {
  const payload = await request<{ duration_s: number }>(`/entries/${entryId}/audio`);
  return payload.duration_s;
}

/** POST /entries/{id}/audio — append one recording chunk (base64 PCM16). */
export function appendEntryAudio(entryId: number, audio: string): Promise<void> {
  return requestVoid(`/entries/${entryId}/audio`, {
    method: "POST",
    body: JSON.stringify({ audio }),
  });
}

/** GET /entries/{id}/audio/file — the playable WAV. */
export function entryAudioFileUrl(entryId: number): string {
  return `${BASE_URL}/entries/${entryId}/audio/file`;
}

/** Fetch the saved WAV through the same checked HTTP boundary as JSON calls. */
export async function getEntryAudioFile(entryId: number): Promise<ArrayBuffer> {
  return requestBytes(`/entries/${entryId}/audio/file`);
}

/** GET /key/status — whether an OpenAI key is stored in the Keychain. */
export async function getKeyStatus(): Promise<boolean> {
  const payload = await request<{ set: boolean }>("/key/status");
  return payload.set;
}

/** PUT /key — store the OpenAI key in the Keychain (never returned). */
export function saveKey(key: string): Promise<void> {
  return requestVoid("/key", { method: "PUT", body: JSON.stringify({ key }) });
}

/** DELETE /key — remove the OpenAI key from the Keychain. */
export function clearKey(): Promise<void> {
  return requestVoid("/key", { method: "DELETE" });
}

const toChat = (payload: ChatPayload): Chat => ({
  id: payload.id,
  entryId: payload.entry_id,
  title: payload.title,
  createdAt: payload.created_at,
});

const toMessage = (payload: MessagePayload): Message => {
  if (!isMessagePayload(payload)) {
    throw new ApiError({
      kind: "invalid-response",
      method: "GET",
      path: "/chats/messages",
      message: "The local service returned an invalid chat message.",
    });
  }
  return {
    id: payload.id,
    chatId: payload.chat_id,
    role: payload.role,
    content: payload.content,
    createdAt: payload.created_at,
  };
};

type ValidMessagePayload = Omit<MessagePayload, "role"> & {
  role: "user" | "assistant";
};

function isMessagePayload(value: unknown): value is ValidMessagePayload {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Partial<MessagePayload>;
  return (
    Number.isFinite(message.id) &&
    Number.isFinite(message.chat_id) &&
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" &&
    typeof message.created_at === "string" &&
    !Number.isNaN(Date.parse(message.created_at))
  );
}

type ChatStreamEvent =
  | { type: "delta"; delta: string }
  | { type: "error"; message: string }
  | { type: "final"; message: MessagePayload };

function parseChatStreamEvent(value: unknown): ChatStreamEvent {
  if (typeof value !== "object" || value === null) {
    throw new ApiError({
      kind: "invalid-response",
      method: "POST",
      path: "/chats/messages",
      message: "The local service returned an invalid chat event.",
    });
  }
  const event = value as { delta?: unknown; error?: unknown; message?: unknown };
  if (
    typeof event.delta === "string" &&
    typeof event.error !== "string" &&
    !isMessagePayload(event.message)
  ) return { type: "delta", delta: event.delta };
  if (
    typeof event.error === "string" &&
    typeof event.delta !== "string" &&
    !isMessagePayload(event.message)
  ) return { type: "error", message: event.error };
  if (
    isMessagePayload(event.message) &&
    typeof event.delta !== "string" &&
    typeof event.error !== "string"
  ) return { type: "final", message: event.message };
  throw new ApiError({
    kind: "invalid-response",
    method: "POST",
    path: "/chats/messages",
    message: "The local service returned an invalid chat event.",
  });
}

/** GET /entries/{id}/chats — the chats of one entry, oldest first. */
export async function listChats(entryId: number): Promise<Chat[]> {
  const payload = await request<ChatPayload[]>(`/entries/${entryId}/chats`);
  return payload.map(toChat);
}

/** POST /entries/{id}/chats — start a new conversation on an entry. */
export async function createChat(entryId: number): Promise<Chat> {
  const payload = await request<ChatPayload>(`/entries/${entryId}/chats`, { method: "POST" });
  return toChat(payload);
}

/** PATCH /chats/{id} — rename the chat (null clears the title). */
export async function renameChat(id: number, title: string | null): Promise<Chat> {
  const payload = await request<ChatPayload>(`/chats/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
  return toChat(payload);
}

/** DELETE /chats/{id} — remove the chat and its messages. */
export function deleteChat(id: number): Promise<void> {
  return requestVoid(`/chats/${id}`, { method: "DELETE" });
}

/** GET /chats/{id}/messages — the message history of one chat. */
export async function listMessages(chatId: number): Promise<Message[]> {
  const payload = await request<MessagePayload[]>(`/chats/${chatId}/messages`);
  return payload.map(toMessage);
}

/** POST /entries/{id}/enhance — generate one version; no options = Auto. */
export async function enhanceEntry(
  entryId: number,
  options?: { templateId?: string | null; instructions?: string | null },
): Promise<EnhancedVersion> {
  const payload = await request<EnhancedVersionPayload>(
    `/entries/${entryId}/enhance`,
    {
      method: "POST",
      body: JSON.stringify({
        template_id: options?.templateId ?? null,
        instructions: options?.instructions ?? null,
      }),
    },
    120_000,
  );
  return toEnhancedVersion(payload);
}

/** GET /entries/{id}/enhanced-versions — every version, oldest first. */
export async function getEnhancedVersions(entryId: number): Promise<EnhancedVersion[]> {
  const payload = await request<EnhancedVersionPayload[]>(
    `/entries/${entryId}/enhanced-versions`,
  );
  return payload.map(toEnhancedVersion);
}

/** PATCH /enhanced-versions/{id} — edit a version's content. */
export async function updateEnhancedVersion(id: number, content: string): Promise<EnhancedVersion> {
  const payload = await request<EnhancedVersionPayload>(`/enhanced-versions/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ content }),
  });
  return toEnhancedVersion(payload);
}

/** GET /templates — every template: built-ins in canonical order, then customs. */
export async function listTemplates(): Promise<Template[]> {
  const payload = await request<TemplatePayload[]>("/templates");
  return payload.map(toTemplate);
}

/** POST /templates — add a custom template. */
export async function createTemplate(input: {
  name: string;
  description: string;
  instructions: string;
}): Promise<Template> {
  const payload = await request<TemplatePayload>("/templates", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toTemplate(payload);
}

/** PATCH /templates/{id} — edit a template (built-ins too). */
export async function updateTemplate(
  id: string,
  input: { name?: string; description?: string; instructions?: string },
): Promise<Template> {
  const payload = await request<TemplatePayload>(`/templates/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return toTemplate(payload);
}

/** POST /templates/{id}/reset — restore a built-in's factory values. */
export async function resetTemplate(id: string): Promise<Template> {
  const payload = await request<TemplatePayload>(`/templates/${id}/reset`, { method: "POST" });
  return toTemplate(payload);
}

/** DELETE /templates/{id} — remove a custom template. */
export function deleteTemplate(id: string): Promise<void> {
  return requestVoid(`/templates/${id}`, { method: "DELETE" });
}

/** One transcription dictionary term: GET /dictionary returns these. */
export interface DictionaryTerm {
  id: number;
  value: string;
  createdAt: string;
}

/** The wire shape of /dictionary (snake_case). */
interface DictionaryTermPayload {
  id: number;
  value: string;
  created_at: string;
}

const toDictionaryTerm = (payload: DictionaryTermPayload): DictionaryTerm => ({
  id: payload.id,
  value: payload.value,
  createdAt: payload.created_at,
});

/** GET /dictionary — the user's terms in saved order. */
export async function listDictionary(): Promise<DictionaryTerm[]> {
  const payload = await request<DictionaryTermPayload[]>("/dictionary");
  return payload.map(toDictionaryTerm);
}

/** POST /dictionary — add terms; the response is the full updated list. */
export async function addDictionaryTerms(values: string[]): Promise<DictionaryTerm[]> {
  const payload = await request<DictionaryTermPayload[]>("/dictionary", {
    method: "POST",
    body: JSON.stringify({ values }),
  });
  return payload.map(toDictionaryTerm);
}

/** DELETE /dictionary/{id} — remove one term. */
export function deleteDictionaryTerm(id: number): Promise<void> {
  return requestVoid(`/dictionary/${id}`, { method: "DELETE" });
}

/** The live transcript stream (SSE) for an entry. */
export function transcriptEventsUrl(entryId: number): string {
  return `${BASE_URL}/entries/${entryId}/transcript/events`;
}

/** One transcript line (a bubble) on the wire: snake_case. */
export interface TranscriptLinePayload {
  id: number;
  sequence: number;
  source: string;
  text: string;
  created_at: string;
}

/** The wire shapes of the transcript SSE frames (snake_case). */
export type TranscriptEventPayload =
  | { type: "resync"; lines: TranscriptLinePayload[] }
  | { type: "delta"; source: string; item_id: string; sequence: number; delta: string }
  | { type: "final"; item_id: string; line: TranscriptLinePayload };

/**
 * Wire line → app line. Shared by the REST read and the live SSE stream, so
 * the two paths can never drift apart — a missing mapping here crashed the
 * transcript bubbles (`formatLineTime(undefined)` → render error → the whole
 * React tree unmounted).
 */
export function toTranscriptLine(line: TranscriptLinePayload): TranscriptLine {
  if (
    !Number.isFinite(line.id) ||
    !Number.isFinite(line.sequence) ||
    (line.source !== "me" && line.source !== "them") ||
    typeof line.text !== "string" ||
    typeof line.created_at !== "string" ||
    Number.isNaN(Date.parse(line.created_at))
  ) {
    throw new ApiError({
      kind: "invalid-response",
      method: "GET",
      path: "/transcript",
      message: "The local service returned an invalid transcript line.",
    });
  }
  return {
    id: line.id,
    sequence: line.sequence,
    source: line.source,
    text: line.text,
    createdAt: line.created_at,
  };
}

/** GET /entries/{id}/transcript — the entry's utterances, oldest first. */
export async function getTranscriptLines(entryId: number): Promise<TranscriptLine[]> {
  const payload = await request<{ lines: TranscriptLinePayload[] }>(
    `/entries/${entryId}/transcript`,
  );
  return payload.lines.map(toTranscriptLine);
}

/**
 * POST /chats/{id}/messages — stream the assistant reply (SSE).
 *
 * `onDelta` receives each text chunk as it arrives; the resolved Message is
 * the persisted assistant reply. Rejects with the server's error message.
 */
export async function sendMessage(
  chatId: number,
  content: string,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<Message> {
  const response = await requestResponse(`/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
    signal,
  });
  for await (const data of readSseJson(response.body, { signal })) {
    const event = parseChatStreamEvent(data);
    if (event.type === "delta") onDelta(event.delta);
    else if (event.type === "error") {
      throw new ApiError({
        kind: "server",
        method: "POST",
        path: `/chats/${chatId}/messages`,
        message: event.message,
      });
    } else return toMessage(event.message);
  }
  throw new Error("The reply stream ended before the assistant message");
}

export { ApiError, isApiError } from "./client";
