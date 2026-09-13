import type { ReleaseType } from '@/release-type.ts'

export interface PackageManifest {
    name?: string
    version?: string
    private?: boolean
    workspaces?: string[] | { packages?: string[] }
    [key: string]: unknown
}

export interface PackageInfo {
    name: string
    dir: string
    manifestPath: string
    version: string
    isPrivate: boolean
    manifest: PackageManifest
}

export interface ProjectContext {
    root: string
    isMonorepo: boolean
    workspaceKind: 'pnpm' | 'npm' | null
    packages: PackageInfo[]
}

export interface ReleaseTarget {
    name: string
    dir: string
    manifestPath: string
    currentVersion: string
    newVersion: string
    published: boolean
}

export interface CliOptions {
    release?: string
    tag?: boolean
    submit?: boolean
    git?: boolean
    pr?: boolean
    files?: string[] | string
    npmTag?: string
    opt?: string
    dryRun?: boolean
}

export interface DnmpUserConfig {
    env?: {
        opt?: string
    }
}

export interface ResolvedOptions {
    release?: ReleaseType
    tag: boolean
    submit: boolean
    git: boolean
    pr: boolean
    files: string[]
    npmTag: string
    npmTagExplicit: boolean
    opt: string
    dryRun: boolean
    ci: boolean
}

export interface FileUpdateResult {
    file: string
    updated: boolean
}
