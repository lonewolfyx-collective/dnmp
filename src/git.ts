import type { ReleaseTarget } from '@/types.ts'
import { run, runSafe } from '@/runner.ts'

export interface GitPreflight {
    branch: string
    defaultBranch: string
    dirtyFiles: string[]
    remoteUrl: string
}

const detectDefaultBranch = async (cwd: string): Promise<string> => {
    const symbolic = await runSafe('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd })
    if (symbolic.ok && symbolic.stdout) {
        return symbolic.stdout.replace(/^origin\//, '')
    }

    for (const candidate of ['main', 'master']) {
        const exists = await runSafe('git', ['show-ref', '--verify', `refs/heads/${candidate}`], { cwd })
        if (exists.ok) {
            return candidate
        }
    }
    throw new Error('无法识别默认分支：origin/HEAD 未设置且不存在 main / master 分支')
}

export const gitPreflight = async (cwd: string): Promise<GitPreflight> => {
    const repo = await runSafe('git', ['rev-parse', '--is-inside-work-tree'], { cwd })
    if (!repo.ok || repo.stdout !== 'true') {
        throw new Error('当前目录不是 git 仓库')
    }

    await run('git', ['rev-parse', '--verify', 'HEAD'], { cwd })

    const branch = (await run('git', ['branch', '--show-current'], { cwd })).stdout
    const status = await run('git', ['status', '--porcelain'], { cwd })
    const remote = await runSafe('git', ['remote', 'get-url', 'origin'], { cwd })

    return {
        branch,
        defaultBranch: await detectDefaultBranch(cwd),
        dirtyFiles: status.stdout ? status.stdout.split('\n').filter(Boolean) : [],
        remoteUrl: remote.stdout,
    }
}

export const tagExists = async (cwd: string, name: string): Promise<boolean> => {
    const result = await runSafe('git', ['rev-parse', '-q', '--verify', `refs/tags/${name}`], { cwd })
    return result.ok
}

/** https://host/owner/repo(.git) 或 git@host:owner/repo(.git) -> owner/repo */
export const parseRepoSlug = (remoteUrl: string): string => {
    const ssh = remoteUrl.match(/^git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/)
    if (ssh) {
        return `${ssh[1]}/${ssh[2]}`
    }
    const https = remoteUrl.match(/^https?:\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/)
    if (https) {
        return `${https[1]}/${https[2]}`
    }
    throw new Error(`无法从 remote origin 解析仓库标识: ${remoteUrl}`)
}

export const commitRelease = async (cwd: string, files: string[], message: string): Promise<void> => {
    await run('git', ['add', '--', ...files], { cwd })
    await run('git', ['commit', '-m', message], { cwd })
}

export const createTag = async (cwd: string, name: string): Promise<void> => {
    await run('git', ['tag', '--annotate', '--message', `chore(release): ${name}`, name], { cwd })
}

/**
 * tag 命名（REQUIREMENTS §5）：
 * 单包 / monorepo 发布后版本一致 -> v{version} 一个；
 * monorepo 各包版本不一致 -> {scope}@v{version} 每包一个。
 */
export const computeTagNames = (targets: Pick<ReleaseTarget, 'name' | 'newVersion'>[], isMonorepo: boolean): string[] => {
    if (!isMonorepo || targets.length === 1) {
        return [`v${targets[0]!.newVersion}`]
    }
    const versions = new Set(targets.map(t => t.newVersion))
    if (versions.size === 1) {
        return [`v${targets[0]!.newVersion}`]
    }
    return targets.map(t => `${t.name}@v${t.newVersion}`)
}

export const pushBranchAndTags = async (cwd: string, branch: string, tags: string[]): Promise<void> => {
    await run('git', ['push', 'origin', branch], { cwd })
    if (tags.length) {
        await run('git', ['push', 'origin', ...tags], { cwd })
    }
}

export const checkoutBranch = async (cwd: string, branch: string): Promise<void> => {
    await run('git', ['checkout', branch], { cwd })
}
