import type { ReleaseType } from '@/release-type.ts'
import type { PackageInfo } from '@/types.ts'
import type { NextVersions } from '@/version.ts'
import process from 'node:process'
import { cancel, confirm, isCancel, multiselect, select, tasks, text } from '@clack/prompts'
import pc from 'picocolors'
import { CANCEL_MESSAGE, CUSTOM_RELEASE } from '@/constants.ts'
import { getNextVersions, validateVersion } from '@/version.ts'

const guard = (value: unknown): void => {
    if (isCancel(value)) {
        cancel(CANCEL_MESSAGE)
        process.exit(0)
    }
}

/** 单个版本交互：枚举选择 + custom 手动输入；CI 模式下不会被调用（main 中已拦截） */
export const selectReleaseVersion = async (
    subject: string,
    currentVersion: string,
    next: NextVersions,
): Promise<string> => {
    const options: { value: string, label: string }[] = (Object.keys(next) as ReleaseType[]).map(key => ({
        value: key,
        label: `${key.padEnd(13)} ${next[key]}`,
    }))
    options.push({ value: CUSTOM_RELEASE, label: `${'custom'.padEnd(13)} 输入自定义版本号` })

    const picked = await select({
        message: `${subject} 当前版本 ${pc.bold(currentVersion)}，选择新版本`,
        initialValue: 'next',
        options,
    })
    guard(picked)

    if (picked === CUSTOM_RELEASE) {
        const custom = await text({
            message: '输入新的版本号',
            validate: value => validateVersion(value) ? undefined : '无效的 semver 版本号',
        })
        guard(custom)
        return String(custom)
    }
    return next[picked as ReleaseType]
}

/** monorepo 包选择：默认全选非 private 包 */
export const selectPackages = async (packages: PackageInfo[]): Promise<PackageInfo[]> => {
    const selected = await multiselect({
        message: '选择要发布版本的包（空格切换，回车确认）',
        options: packages.map(p => ({
            value: p.name,
            label: p.name,
            hint: p.version ? `${pc.red(p.version)}${p.isPrivate ? ' · private' : ''}` : undefined,
        })),
        initialValues: packages.map(p => p.name),
    })
    guard(selected)

    const names = selected as string[]
    return packages.filter(p => names.includes(p.name))
}

/** monorepo 版本不一致场景：@clack/prompts tasks 逐包交互选择 */
export const selectPerPackageVersions = async (packages: PackageInfo[]): Promise<Map<string, string>> => {
    const results = new Map<string, string>()

    await tasks(packages.map((pkg, index) => ({
        title: `${pkg.name} ${pc.dim(pkg.version)}（${index + 1}/${packages.length}）`,
        task: async () => {
            const next = getNextVersions(pkg.version)
            const version = await selectReleaseVersion(pkg.name, pkg.version, next)
            results.set(pkg.name, version)
            return `${pc.dim(pkg.version)} → ${pc.bold(version)}`
        },
    })))

    return results
}

export const confirmAction = async (message: string, ci: boolean, initialValue = true): Promise<boolean> => {
    if (ci) {
        return true
    }
    const answer = await confirm({ message, initialValue })
    guard(answer)
    return Boolean(answer)
}
