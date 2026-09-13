import type { PackageInfo, PackageManifest, ProjectContext } from '@/types.ts'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { findUp } from 'find-up'
import { glob } from 'glob'
import { parse } from 'yaml'

const readManifest = async (path: string): Promise<PackageManifest> => {
    try {
        return JSON.parse(await readFile(path, 'utf-8')) as PackageManifest
    }
    catch {
        return {}
    }
}

const workspaceGlobsOf = (manifest: PackageManifest): string[] => {
    const workspaces = manifest.workspaces
    if (Array.isArray(workspaces)) {
        return workspaces.filter((v): v is string => typeof v === 'string')
    }
    if (workspaces && Array.isArray(workspaces.packages)) {
        return workspaces.packages.filter((v): v is string => typeof v === 'string')
    }
    return []
}

const toManifestPattern = (pattern: string): string => {
    const normalized = pattern.replaceAll('\\', '/').replace(/\/+$/, '')
    return normalized.endsWith('package.json') ? normalized : `${normalized}/package.json`
}

const toPackageInfo = async (manifestPath: string): Promise<PackageInfo> => {
    const manifest = await readManifest(manifestPath)
    const dir = dirname(manifestPath)
    return {
        name: manifest.name || basename(dir),
        dir,
        manifestPath,
        version: manifest.version || '',
        isPrivate: manifest.private === true,
        manifest,
    }
}

const collectWorkspacePackages = async (root: string, globs: string[]): Promise<PackageInfo[]> => {
    const patterns = [...new Set(globs.map(toManifestPattern))]
    const files = await glob(patterns, {
        cwd: root,
        ignore: ['**/node_modules/**'],
        posix: true,
    })

    const manifestPaths = [...new Set(files)].sort().map(file => resolve(root, file))
    return Promise.all(manifestPaths.map(toPackageInfo))
}

/**
 * 项目形态识别：
 * 1. 沿目录向上查找 pnpm-workspace.yaml（packages 非空才算 workspace，兼容 dnmp 自身这种空声明）
 * 2. 否则查找最近一个声明了 workspaces 字段的 package.json（npm/yarn 风格，数组或 { packages } 对象）
 * 3. 都没有则按单包处理：取最近一层 package.json
 */
export const detectProject = async (cwd: string): Promise<ProjectContext> => {
    let root: string | undefined
    let globs: string[] = []
    let kind: 'pnpm' | 'npm' | null = null

    const pnpmWorkspacePath = await findUp('pnpm-workspace.yaml', { cwd })
    if (pnpmWorkspacePath) {
        root = dirname(pnpmWorkspacePath)
        const doc = (parse(await readFile(pnpmWorkspacePath, 'utf-8')) ?? {}) as { packages?: string[] }
        globs = (doc.packages ?? []).filter((v): v is string => typeof v === 'string')
        globs = [...new Set([...globs, ...workspaceGlobsOf(await readManifest(resolve(root, 'package.json')))])]
        kind = globs.length ? 'pnpm' : null
    }

    if (!kind) {
        // npm workspaces：手动向上遍历，找最近一个声明了 workspaces 的 package.json
        let dir = resolve(cwd)
        while (true) {
            const manifest = await readManifest(resolve(dir, 'package.json'))
            if (workspaceGlobsOf(manifest).length) {
                root = dir
                globs = workspaceGlobsOf(manifest)
                kind = 'npm'
                break
            }
            const parent = dirname(dir)
            if (parent === dir) {
                break
            }
            dir = parent
        }
    }

    if (root && kind && globs.length) {
        const packages = await collectWorkspacePackages(root, globs)
        if (packages.length) {
            return { root, isMonorepo: true, workspaceKind: kind, packages }
        }
    }

    const manifestPath = await findUp('package.json', { cwd })
    if (!manifestPath) {
        throw new Error('当前目录及其上层未找到 package.json')
    }
    const pkg = await toPackageInfo(manifestPath)
    return { root: pkg.dir, isMonorepo: false, workspaceKind: null, packages: [pkg] }
}
