import type { FileUpdateResult, PackageInfo, ReleaseTarget } from '@/types.ts'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DEP_FIELDS } from '@/constants.ts'

// 保留文件原有格式：缩进取文件里第一处缩进，尾换行按原样还原
const detectIndent = (raw: string): string => {
    const match = raw.match(/^[ \t]+/m)
    return match ? match[0] : '  '
}

const serializeJson = (data: unknown, raw: string): string =>
    JSON.stringify(data, null, detectIndent(raw)) + (raw.endsWith('\n') ? '\n' : '')

const updateJsonVersion = async (path: string, version: string): Promise<boolean> => {
    const raw = await readFile(path, 'utf-8')
    const data = JSON.parse(raw) as { version?: string }
    if (data.version === undefined) {
        return false
    }
    if (data.version === version) {
        return false
    }
    data.version = version
    await writeFile(path, serializeJson(data, raw))
    return true
}

const updatePackageLock = async (path: string, version: string): Promise<boolean> => {
    const raw = await readFile(path, 'utf-8')
    const data = JSON.parse(raw) as {
        version?: string
        packages?: Record<string, { version?: string } | undefined>
    }
    let changed = false
    if (data.version !== undefined && data.version !== version) {
        data.version = version
        changed = true
    }
    const rootEntry = data.packages?.['']
    if (rootEntry?.version !== undefined && rootEntry.version !== version) {
        rootEntry.version = version
        changed = true
    }
    if (changed) {
        await writeFile(path, serializeJson(data, raw))
    }
    return changed
}

// jsr/deno 配置可能是 JSONC（带注释）：能严格解析就整体序列化，否则正则只替换顶层 version 字段，注释原样保留
const updateJsoncVersion = async (path: string, version: string): Promise<boolean> => {
    const raw = await readFile(path, 'utf-8')
    try {
        return await updateJsonVersion(path, version)
    }
    catch {
        const updated = raw.replace(/^([ \t]*)"version"\s*:\s*"[^"]*"/m, `$1"version": "${version}"`)
        if (updated === raw) {
            return false
        }
        await writeFile(path, updated)
        return true
    }
}

const updateOne = async (path: string, file: string, version: string): Promise<boolean> => {
    if (file === 'package-lock.json') {
        return updatePackageLock(path, version)
    }
    if (file.endsWith('.jsonc')) {
        return updateJsoncVersion(path, version)
    }
    return updateJsonVersion(path, version)
}

/**
 * 把目标包的新版本写入 --files 列表文件。
 * workspaceRoot 仅在「单包或全仓库版本一致」时传入，用于把根目录的 package-lock.json 一并更新；
 * 多版本不一致时根 lock 无唯一版本，跳过。
 */
export const applyVersionFiles = async (
    target: ReleaseTarget,
    files: string[],
    workspaceRoot?: string,
): Promise<FileUpdateResult[]> => {
    const results: FileUpdateResult[] = []
    const seen = new Set<string>()

    const dirs = workspaceRoot && workspaceRoot !== target.dir
        ? [target.dir, workspaceRoot]
        : [target.dir]

    for (const file of files) {
        for (const dir of dirs) {
            const path = resolve(dir, file)
            if (seen.has(path) || !existsSync(path)) {
                continue
            }
            seen.add(path)
            results.push({ file: path, updated: await updateOne(path, file, target.newVersion) })
        }
    }
    return results
}

const bumpDepRange = (range: string, from: string, to: string): string => {
    if (!range.endsWith(from)) {
        return range
    }
    return range.slice(0, range.length - from.length) + to
}

/**
 * 同步 workspace 内部依赖区间：包 A 升级后，其他包（含 private）对 A 的依赖值
 * 以旧版本号结尾的（^1.2.3 / ~1.2.3 / workspace:^1.2.3 / 1.2.3）替换为新版本，保留前缀。
 * 仅在「改动前各包版本一致」的场景调用（REQUIREMENTS §3）。
 */
export const syncWorkspaceDependencies = async (
    packages: PackageInfo[],
    updates: Map<string, string>,
): Promise<string[]> => {
    const versionByName = new Map(packages.map(p => [p.name, p.version]))
    const changed: string[] = []

    for (const pkg of packages) {
        const raw = await readFile(pkg.manifestPath, 'utf-8')
        const data = JSON.parse(raw) as Record<string, unknown>
        let touched = false

        for (const field of DEP_FIELDS) {
            const deps = data[field]
            if (!deps || typeof deps !== 'object') {
                continue
            }
            for (const [depName, range] of Object.entries(deps as Record<string, unknown>)) {
                const newVersion = updates.get(depName)
                const oldVersion = versionByName.get(depName)
                if (!newVersion || !oldVersion || typeof range !== 'string' || range === newVersion) {
                    continue
                }
                const bumped = bumpDepRange(range, oldVersion, newVersion)
                if (bumped !== range) {
                    ;(deps as Record<string, string>)[depName] = bumped
                    touched = true
                }
            }
        }

        if (touched) {
            await writeFile(pkg.manifestPath, serializeJson(data, raw))
            changed.push(pkg.manifestPath)
        }
    }
    return changed
}
