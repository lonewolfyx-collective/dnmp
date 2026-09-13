import semver from 'semver'
import { runInherit, runSafe } from '@/runner.ts'

/**
 * dist-tag 解析：用户显式传了 --npmTag 时原样使用；
 * 否则预发布版本自动映射为预发布标识（2.0.0-rc.1 -> rc），防止预发布覆盖 latest。
 */
export const resolveDistTag = (version: string, npmTag: string, explicit: boolean): string => {
    if (explicit) {
        return npmTag
    }
    const pre = semver.prerelease(version)
    if (!pre || !pre.length) {
        return npmTag
    }
    const id = pre[0]
    return typeof id === 'string' && /^[a-z]/i.test(id) ? id : 'next'
}

export const npmLoggedIn = async (cwd: string): Promise<boolean> => {
    const result = await runSafe('npm', ['whoami'], { cwd })
    return result.ok
}

export const npmPublish = async (dir: string, distTag: string, opt: string): Promise<void> => {
    const args = ['publish', '--access', 'public', '--tag', distTag]
    if (opt) {
        args.push(...opt.split(/\s+/).filter(Boolean))
    }
    await runInherit('npm', args, { cwd: dir })
}
