export type MemoryFile = { name: string; size: number; mtimeMs: number }
export type MemoryFolder = { name: string; files: MemoryFile[] }
export type Snapshot = { root: string; folders: MemoryFolder[]; scannedAt: number }
export type Activity = { tools: number; bash: number; edited: string[] }
export type SyncInfo = { at: number; sessionFile: string; summary: string }

declare module 'claude-code' {
  interface PluginState {
    'memory-keeper': {
      snapshot: Snapshot | null
      activity: Activity
      lastSync: SyncInfo | null
      isSyncing: boolean
    }
  }
}
