import type { LanguageMode, LanguageState } from './i18n';
export interface FileEntry {
  path: string; name: string; isDirectory: boolean; isSymlink: boolean;
  size: number; modified: number; created: number; extension: string; hidden: boolean;
}
export interface Place { path: string; name: string; icon: string }
export interface Volume extends Place { total: number; free: number; canEject: boolean }
export type ThemeMode = 'light' | 'dark' | 'system';
export interface TabState { location: string; history: string[]; index: number }
export interface Bootstrap { initialTab?: TabState; language: LanguageState; theme: ThemeMode; home: string; places: Place[]; volumes: Volume[]; initialPath?: string }
export interface Listing { path: string; entries: FileEntry[] }
export interface TrashListing { entries: FileEntry[]; roots: string[]; unavailable: string[] }
export interface SearchResult { entries: FileEntry[]; truncated: boolean; skipped: number }
export interface FileChange { from?: string; to: string }
export interface OperationResult { succeeded: string[]; errors: { path: string; message: string }[]; changes?: FileChange[] }
export type ClipboardInfo = { paths: string[]; cut: boolean };
// A place inside the window that accepts a drop, in window-relative CSS pixels. The main process
// turns these into screen coordinates to find where a native drag session ended.
export interface DragTargetArea { key: string; path: string; x: number; y: number; width: number; height: number }
export type Preview = { kind: 'image' | 'text' | 'none'; content: string; truncated?: boolean };
export type ExtractMode = 'choose' | 'here' | 'folder';
// File types whose default handler can be switched: macOS refuses folder elections.
export type HandlerKind = 'archive' | 'pdf' | 'image' | 'text';
export type DefaultAppKey = 'login' | 'desktop' | HandlerKind;
export interface DefaultAppState {
  login: boolean; desktop: boolean;
  handlers: Record<HandlerKind, string | null>;
  installed: boolean;
  self: string;
}
export interface ArchivePreview { path: string; name: string; entries: { path: string; directory: boolean; size: number }[] }
export interface ExplorerAPI {
  bootstrap(): Promise<Bootstrap>;
  detachTab(tab: TabState, point: { x: number; y: number }, single: boolean): Promise<void>;
  windowReady(): Promise<void>;
  setLanguage(mode: LanguageMode): Promise<LanguageState>;
  onLanguageChanged(callback: (state: LanguageState) => void): () => void;
  openPrivacySettings(): Promise<void>;
  volumes(): Promise<Volume[]>;
  ejectVolume(path: string): Promise<Volume[]>;
  listTrash(directory?: string): Promise<TrashListing>;
  restoreTrash(paths: string[], choose?: boolean): Promise<OperationResult | null>;
  emptyTrash(): Promise<OperationResult | null>;
  takeOpenPaths(): Promise<string[]>;
  onOpenPaths(callback: () => void): () => void;
  setTheme(mode: ThemeMode): Promise<ThemeMode>;
  defaultAppStatus(): Promise<DefaultAppState>;
  setDefaultApp(key: DefaultAppKey, value: boolean): Promise<DefaultAppState>;
  list(path: string, refreshIcons?: boolean): Promise<Listing>;
  search(path: string, query: string, hidden: boolean): Promise<SearchResult>;
  cancelSearch(): Promise<void>;
  open(path: string): Promise<ArchivePreview | null>;
  compressArchive(paths: string[]): Promise<string>;
  openArchiveFile(path: string, member: string): Promise<void>;
  extractArchive(path: string, selected: string[] | null, mode: ExtractMode): Promise<OperationResult | null>;
  openWith(paths: string[], editor?: 'textedit'): Promise<boolean>;
  quickLook(path: string): Promise<void>;
  reveal(path: string): Promise<void>;
  openTerminal(path: string): Promise<void>;
  share(paths: string[]): Promise<void>;
  info(path: string): Promise<FileEntry>;
  startDrag(paths: string[], icon?: string, targets?: DragTargetArea[]): void;
  onDragHover(callback: (key: string | null) => void): () => void;
  onDragDrop(callback: (destination: string) => void): () => void;
  preview(path: string): Promise<Preview>;
  icon(path: string, pixels?: number): Promise<string>;
  create(parent: string, name: string, directory: boolean): Promise<string>;
  rename(path: string, name: string): Promise<string>;
  trash(paths: string[]): Promise<OperationResult>;
  clipboardSet(paths: string[], cut: boolean): Promise<ClipboardInfo>;
  clipboardGet(): Promise<ClipboardInfo>;
  paste(parent: string, move?: boolean): Promise<OperationResult>;
  closeWindow(): Promise<void>;
  moveTo(paths: string[], parent: string): Promise<OperationResult>;
  copyTo(paths: string[], parent: string): Promise<OperationResult>;
  history(): Promise<string | null>;
  undo(): Promise<OperationResult>;
  copyText(text: string): Promise<void>;
  chooseFolder(): Promise<string | null>;
  filePath(file: File): string;
  watch(path: string | null): Promise<void>;
  onDirectoryChange(callback: () => void): () => void;
  onAction(callback: (action: string) => void): () => void;
  onScrollGestureStart(callback: (timestamp: number) => void): () => void;
}
