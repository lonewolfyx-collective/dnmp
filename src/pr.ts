import { run } from '@/runner.ts'

export const randomBranchSuffix = (): string => String(Math.floor(100_000 + Math.random() * 900_000))

/**
 * release 分支命名（REQUIREMENTS §6）：
 * 单包 release/v{version}；monorepo release/monorepo-{随机数值}
 */
export const releaseBranchName = (isMonorepo: boolean, version: string, suffix = randomBranchSuffix()): string =>
    isMonorepo ? `release/monorepo-${suffix}` : `release/v${version}`

export const createAndPushBranch = async (cwd: string, branch: string): Promise<void> => {
    await run('git', ['checkout', '-b', branch], { cwd })
    await run('git', ['push', '-u', 'origin', branch], { cwd })
}

export interface CreatePrInput {
    cwd: string
    repo: string
    base: string
    branch: string
    title: string
    body: string
}

export const createPr = async (input: CreatePrInput): Promise<string> => {
    const { stdout } = await run('gh', [
        'pr',
        'create',
        '--repo',
        input.repo,
        '--base',
        input.base,
        '--head',
        input.branch,
        '--title',
        input.title,
        '--body',
        input.body,
        '--draft',
        'false',
    ], { cwd: input.cwd })
    return stdout
}
