import type { CliOptions, DnmpUserConfig, ResolvedOptions } from '@/types.ts'
import process from 'node:process'
import { DEFAULT_NPM_TAG, DEFAULT_UPDATE_FILES } from '@/constants.ts'
import { isReleaseType, RELEASE_TYPES } from '@/release-type.ts'

export const loadUserConfig = async (): Promise<DnmpUserConfig> => {
    const { loadConfig } = await import('c12')
    const { config } = await loadConfig<DnmpUserConfig>({ name: 'dnmp', defaultConfig: {} })
    return config ?? {}
}

export const isCI = (): boolean =>
    process.env.CI === 'true' || process.env.CI === '1' || !!process.env.GITHUB_ACTIONS

const normalizeFileList = (input?: string[] | string): string[] =>
    ([] as string[])
        .concat(input ?? [])
        .flatMap(value => String(value).split(','))
        .map(value => value.trim())
        .filter(Boolean)

/**
 * 配置优先级：CLI 参数 > dnmp.config（c12）> 内置默认值；
 * --opt 例外：与 env.opt 同源同值，env.opt 存在时优先。
 */
export const resolveOptions = async (cli: CliOptions, userConfig?: DnmpUserConfig): Promise<ResolvedOptions> => {
    const config = userConfig ?? await loadUserConfig()

    if (cli.release !== undefined && !isReleaseType(cli.release)) {
        throw new Error(`无效的 --release 值: ${cli.release}，可选值: ${RELEASE_TYPES.join(', ')}`)
    }

    const files = normalizeFileList(cli.files)

    return {
        release: cli.release,
        tag: cli.tag ?? true,
        submit: cli.submit ?? true,
        git: cli.git ?? true,
        pr: cli.pr ?? false,
        files: files.length ? files : [...DEFAULT_UPDATE_FILES],
        npmTag: cli.npmTag ?? DEFAULT_NPM_TAG,
        npmTagExplicit: cli.npmTag !== undefined && cli.npmTag !== '',
        opt: config.env?.opt || cli.opt || '',
        dryRun: cli.dryRun ?? false,
        ci: isCI(),
    }
}
