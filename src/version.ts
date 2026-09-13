import type { ReleaseType } from '@/release-type.ts'
import semver from 'semver'

// https://semver.org/

export type NextVersions = Record<ReleaseType, string>

export const validateVersion = (version: string): boolean => !!semver.valid(version)

/**
 * 预发布计数器递增：保留既有预发布标识，末段数字 +1；缺计数器时补 1。
 * 1.2.3-beta.1 -> 1.2.3-beta.2；1.2.3-beta -> 1.2.3-beta.1
 */
export const processIncrementalPre = (preParts: readonly (string | number)[], base: string, prefix: string, expectedLen: number, fallback: string): string => {
    if (preParts[0] !== prefix) {
        return `${base}-${fallback}`
    }

    const newPre = [...preParts].slice(0, expectedLen)
    while (newPre.length < expectedLen) {
        newPre.push(0)
    }

    const lastIdx = expectedLen - 1
    const lastVal = newPre[lastIdx]
    const numericVal = typeof lastVal === 'number' ? lastVal : Number.parseInt(String(lastVal), 10)

    const isExtension = preParts.length < expectedLen
    newPre[lastIdx] = isExtension ? 1 : (Number.isNaN(numericVal) ? 1 : numericVal + 1)

    return `${base}-${newPre.join('.')}`
}

const utcStamp = (): { date: string, time: string } => {
    const iso = new Date().toISOString()
    return {
        date: iso.slice(0, 10).replaceAll('-', ''),
        time: iso.slice(11, 19).replaceAll(':', ''),
    }
}

/**
 * 各升级类型的下一版本，语义见 docs/REQUIREMENTS.md §9：
 * - next：预发布中递增计数器；正式版升 patch 并加 beta 预发布
 * - rc：非 rc 预发布与正式版以 minor 为基底开 rc.0；已处于 rc 时递增计数器
 * - beta-major/minor/patch 与 alpha 系列：npm premajor/preminor/prepatch 语义，基底始终升级、计数器归零
 * - pre-beta：不升基底，beta 计数器递增
 * - date-version：UTC 日期时间戳
 */
export const getNextVersions = (version: string): NextVersions => {
    const s = semver.parse(version)
    if (!s)
        throw new Error(`[Invalid SemVer]: ${version}`)

    const { major: M, minor: m, patch: p, prerelease: pre } = s
    const base = `${M}.${m}.${p}`
    const preId = pre.length ? String(pre[0]) : ''
    const { date, time } = utcStamp()

    return {
        'major': `${M + 1}.0.0`,
        'minor': `${M}.${m + 1}.0`,
        'patch': `${M}.${m}.${p + 1}`,
        'next': pre.length
            ? semver.inc(version, 'prerelease')!
            : semver.inc(version, 'prepatch', 'beta')!,
        'rc': preId === 'rc'
            ? semver.inc(version, 'prerelease')!
            : pre.length
                ? `${base}-rc.0`
                : semver.inc(version, 'preminor', 'rc')!,
        'beta-major': semver.inc(version, 'premajor', 'beta')!,
        'beta-minor': semver.inc(version, 'preminor', 'beta')!,
        'beta-patch': semver.inc(version, 'prepatch', 'beta')!,
        'pre-beta': preId === 'beta'
            ? processIncrementalPre(pre, base, 'beta', Math.max(pre.length, 2), 'beta.1')
            : `${base}-beta.0`,
        'alpha-beta': preId === 'alpha' && String(pre[1]) === 'beta'
            ? processIncrementalPre(pre, base, 'alpha', Math.max(pre.length, 3), 'alpha.beta.1')
            : `${base}-alpha.beta.0`,
        'alpha-major': semver.inc(version, 'premajor', 'alpha')!,
        'alpha-minor': semver.inc(version, 'preminor', 'alpha')!,
        'alpha-patch': semver.inc(version, 'prepatch', 'alpha')!,
        'date-version': `${base}-${date}-${time}`,
    }
}
