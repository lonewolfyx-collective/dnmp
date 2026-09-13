import { describe, expect, it } from 'vitest'
import { resolveOptions } from '@/config.ts'

describe('resolveOptions', () => {
    it('默认值', async () => {
        const options = await resolveOptions({}, {})

        expect(options).toMatchObject({
            tag: true,
            submit: true,
            git: true,
            pr: false,
            npmTag: 'latest',
            npmTagExplicit: false,
            opt: '',
            dryRun: false,
        })
        expect(options.files).toEqual(expect.arrayContaining(['package.json', 'package-lock.json', 'deno.jsonc', 'jsr.json']))
    })

    it('--files 空格与逗号混合归一化', async () => {
        const options = await resolveOptions({ files: ['package.json', 'jsr.json,deno.json'] }, {})
        expect(options.files).toEqual(['package.json', 'jsr.json', 'deno.json'])
    })

    it('--files 传入即覆盖默认列表', async () => {
        const options = await resolveOptions({ files: 'custom.json' }, {})
        expect(options.files).toEqual(['custom.json'])
    })

    it('env.opt 优先于 CLI --opt（REQUIREMENTS §4 决策 11）', async () => {
        const options = await resolveOptions({ opt: '--from-cli' }, { env: { opt: '--from-env' } })
        expect(options.opt).toBe('--from-env')
    })

    it('env.opt 缺失时回退 CLI --opt', async () => {
        const options = await resolveOptions({ opt: '--from-cli' }, {})
        expect(options.opt).toBe('--from-cli')
    })

    it('显式 --npmTag 标记 npmTagExplicit', async () => {
        const options = await resolveOptions({ npmTag: 'next' }, {})
        expect(options.npmTag).toBe('next')
        expect(options.npmTagExplicit).toBe(true)
    })

    it('布尔开关关闭（cac --no-* 形态）', async () => {
        const options = await resolveOptions({ tag: false, submit: false, git: false, pr: true }, {})
        expect(options).toMatchObject({ tag: false, submit: false, git: false, pr: true })
    })

    it('非法 --release 报错并列出可选值', async () => {
        await expect(resolveOptions({ release: 'nope' }, {})).rejects.toThrow('--release')
    })

    it('合法 --release 通过', async () => {
        const options = await resolveOptions({ release: 'beta-minor' }, {})
        expect(options.release).toBe('beta-minor')
    })
})
