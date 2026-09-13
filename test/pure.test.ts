import { describe, expect, it } from 'vitest'
import { computeTagNames, parseRepoSlug } from '@/git.ts'
import { releaseBranchName } from '@/pr.ts'
import { resolveDistTag } from '@/publish.ts'

describe('computeTagNames（REQUIREMENTS §5）', () => {
    it('单包：v 前缀单个 tag', () => {
        expect(computeTagNames([{ name: 'a', newVersion: '1.2.3' }], false)).toEqual(['v1.2.3'])
    })

    it('monorepo 发布后版本一致：只打一个 v 前缀 tag', () => {
        expect(computeTagNames([
            { name: 'a', newVersion: '1.2.3' },
            { name: 'b', newVersion: '1.2.3' },
        ], true)).toEqual(['v1.2.3'])
    })

    it('monorepo 版本不一致：每包 scope@v 一个 tag', () => {
        expect(computeTagNames([
            { name: '@s/a', newVersion: '1.0.0' },
            { name: 'b', newVersion: '2.0.0' },
        ], true)).toEqual(['@s/a@v1.0.0', 'b@v2.0.0'])
    })
})

describe('parseRepoSlug', () => {
    it('ssh 形态', () => {
        expect(parseRepoSlug('git@github.com:lonewolfyx/dnmp.git')).toBe('lonewolfyx/dnmp')
    })

    it('https 形态', () => {
        expect(parseRepoSlug('https://github.com/lonewolfyx/dnmp.git')).toBe('lonewolfyx/dnmp')
    })

    it('无 .git 后缀', () => {
        expect(parseRepoSlug('git@github.com:a/b')).toBe('a/b')
    })

    it('无法解析抛错', () => {
        expect(() => parseRepoSlug('file:///srv/repo')).toThrow('remote origin')
    })
})

describe('releaseBranchName（REQUIREMENTS §6）', () => {
    it('单包：release/v{version}', () => {
        expect(releaseBranchName(false, '1.2.3', '123456')).toBe('release/v1.2.3')
    })

    it('monorepo：release/monorepo-{6 位随机数字}', () => {
        expect(releaseBranchName(true, '1.2.3')).toMatch(/^release\/monorepo-\d{6}$/)
    })
})

describe('resolveDistTag（REQUIREMENTS §11.2）', () => {
    it('显式传参原样使用', () => {
        expect(resolveDistTag('2.0.0-rc.1', 'next', true)).toBe('next')
    })

    it('正式版使用默认 latest', () => {
        expect(resolveDistTag('1.0.0', 'latest', false)).toBe('latest')
    })

    it('预发布自动映射为预发布标识', () => {
        expect(resolveDistTag('2.0.0-rc.1', 'latest', false)).toBe('rc')
        expect(resolveDistTag('1.2.3-beta.0', 'latest', false)).toBe('beta')
        expect(resolveDistTag('1.2.3-alpha.3', 'latest', false)).toBe('alpha')
    })

    it('纯数字预发布回退 next', () => {
        expect(resolveDistTag('1.2.3-0', 'latest', false)).toBe('next')
    })
})
