import semver from 'semver'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getNextVersions, processIncrementalPre, validateVersion } from '@/version.ts'

describe('getNextVersions（REQUIREMENTS §9 语义）', () => {
    it('正式版 1.2.3 的各升级类型', () => {
        expect(getNextVersions('1.2.3')).toMatchObject({
            'major': '2.0.0',
            'minor': '1.3.0',
            'patch': '1.2.4',
            'next': '1.2.4-beta.0',
            'rc': '1.3.0-rc.0',
            'beta-major': '2.0.0-beta.0',
            'beta-minor': '1.3.0-beta.0',
            'beta-patch': '1.2.4-beta.0',
            'pre-beta': '1.2.3-beta.0',
            'alpha-beta': '1.2.3-alpha.beta.0',
            'alpha-major': '2.0.0-alpha.0',
            'alpha-minor': '1.3.0-alpha.0',
            'alpha-patch': '1.2.4-alpha.0',
        })
    })

    it('预发布 1.2.3-beta.1：next / pre-beta 递增计数器，rc 以同基底开新通道', () => {
        expect(getNextVersions('1.2.3-beta.1')).toMatchObject({
            'next': '1.2.3-beta.2',
            'pre-beta': '1.2.3-beta.2',
            'rc': '1.2.3-rc.0',
        })
    })

    it('rc 预发布递增计数器', () => {
        expect(getNextVersions('1.3.0-rc.0')).toMatchObject({
            next: '1.3.0-rc.1',
            rc: '1.3.0-rc.1',
        })
    })

    it('无计数器的旧式预发布（1.2.3-beta）补齐计数器而非抹掉', () => {
        expect(getNextVersions('1.2.3-beta')).toMatchObject({
            'next': '1.2.3-beta.0',
            'pre-beta': '1.2.3-beta.1',
            'alpha-beta': '1.2.3-alpha.beta.0',
        })
    })

    it('alpha.beta 通道递增', () => {
        expect(getNextVersions('1.2.3-alpha.beta.0')['alpha-beta']).toBe('1.2.3-alpha.beta.1')
    })

    it('多段预发布保持形态递增（1.2.3-beta.0.5）', () => {
        expect(getNextVersions('1.2.3-beta.0.5')['pre-beta']).toBe('1.2.3-beta.0.6')
    })

    it('全部输出均为合法 semver', () => {
        for (const version of ['0.0.0', '1.2.3', '2.0.0-rc.1', '10.20.30-beta.0.1', '1.0.0-alpha.beta']) {
            const next = getNextVersions(version)
            for (const [type, value] of Object.entries(next)) {
                expect(semver.valid(value), `${version} --${type} -> ${value}`).toBeTypeOf('string')
            }
        }
    })

    it('date-version 使用 UTC，与本地时区无关', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-08-30T06:12:33.000Z'))
        try {
            expect(getNextVersions('1.2.3')['date-version']).toBe('1.2.3-20260830-061233')
        }
        finally {
            vi.useRealTimers()
        }
    })

    it('非法版本抛错', () => {
        expect(() => getNextVersions('not-a-version')).toThrow()
    })
})

describe('processIncrementalPre', () => {
    it('末段数字递增', () => {
        expect(processIncrementalPre(['beta', 1], '1.2.3', 'beta', 2, '')).toBe('1.2.3-beta.2')
    })

    it('补位时起始为 1', () => {
        expect(processIncrementalPre(['beta'], '1.2.3', 'beta', 2, '')).toBe('1.2.3-beta.1')
    })

    it('标识不匹配时使用 fallback', () => {
        expect(processIncrementalPre(['rc', 0], '1.2.3', 'beta', 2, 'beta.1')).toBe('1.2.3-beta.1')
    })
})

describe('validateVersion', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-08-30T00:00:00.000Z'))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('合法与非法版本', () => {
        expect(validateVersion('1.2.3')).toBe(true)
        expect(validateVersion('1.2.3-beta.1')).toBe(true)
        expect(validateVersion('1.2')).toBe(false)
        expect(validateVersion('')).toBe(false)
    })
})
