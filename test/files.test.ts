import type { PackageInfo, ReleaseTarget } from '@/types.ts'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { applyVersionFiles, syncWorkspaceDependencies } from '@/files.ts'

let dir: string

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dnmp-files-'))
})

const makeTarget = (newVersion: string, overrides: Partial<ReleaseTarget> = {}): ReleaseTarget => ({
    name: 'a',
    dir,
    manifestPath: join(dir, 'package.json'),
    currentVersion: '1.0.0',
    newVersion,
    published: false,
    ...overrides,
})

const makePackage = (name: string, manifestPath: string, version: string, isPrivate = false): PackageInfo => ({
    name,
    dir: dirname(manifestPath),
    manifestPath,
    version,
    isPrivate,
    manifest: {},
})

describe('applyVersionFiles', () => {
    it('package.json 保留 4 空格缩进与尾换行', async () => {
        const path = join(dir, 'package.json')
        await writeFile(path, '{\n    "name": "a",\n    "version": "1.0.0"\n}\n')

        const [result] = await applyVersionFiles(makeTarget('1.1.0'), ['package.json'])

        expect(result!.updated).toBe(true)
        expect(await readFile(path, 'utf-8')).toBe('{\n    "name": "a",\n    "version": "1.1.0"\n}\n')
    })

    it('无尾换行时保持无尾换行，tab 缩进保留', async () => {
        const path = join(dir, 'package.json')
        await writeFile(path, '{\n\t"name": "a",\n\t"version": "1.0.0"\n}')

        await applyVersionFiles(makeTarget('1.1.0'), ['package.json'])

        expect(await readFile(path, 'utf-8')).toBe('{\n\t"name": "a",\n\t"version": "1.1.0"\n}')
    })

    it('版本一致时不重写文件', async () => {
        const path = join(dir, 'package.json')
        await writeFile(path, '{"name":"a","version":"1.1.0"}')

        const [result] = await applyVersionFiles(makeTarget('1.1.0'), ['package.json'])

        expect(result!.updated).toBe(false)
    })

    it('package-lock.json 同步根 version 与 packages[""].version 两处', async () => {
        const path = join(dir, 'package-lock.json')
        const lock = { name: 'a', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'a', version: '1.0.0' } } }
        await writeFile(path, JSON.stringify(lock, null, 2))

        await applyVersionFiles(makeTarget('1.1.0'), ['package-lock.json'])

        const after = JSON.parse(await readFile(path, 'utf-8'))
        expect(after.version).toBe('1.1.0')
        expect(after.packages[''].version).toBe('1.1.0')
    })

    it('deno.jsonc（带注释）走正则替换，注释原样保留', async () => {
        const path = join(dir, 'deno.jsonc')
        const raw = '{\n    // 项目配置\n    "version": "1.0.0",\n    "tasks": {}\n}\n'
        await writeFile(path, raw)

        await applyVersionFiles(makeTarget('1.1.0'), ['deno.jsonc'])

        const after = await readFile(path, 'utf-8')
        expect(after).toContain('// 项目配置')
        expect(after).toContain('"version": "1.1.0"')
    })

    it('monorepo 场景：workspaceRoot 传入时更新根 package-lock.json', async () => {
        const sub = join(dir, 'packages/a')
        await mkdir(sub, { recursive: true })
        await writeFile(join(sub, 'package.json'), '{"name":"a","version":"1.0.0"}')
        const lock = { version: '1.0.0', packages: { '': { version: '1.0.0' } } }
        await writeFile(join(dir, 'package-lock.json'), JSON.stringify(lock, null, 2))

        const results = await applyVersionFiles(makeTarget('1.1.0', { dir: sub }), ['package.json', 'package-lock.json'], dir)

        const updated = results.filter(r => r.updated).map(r => r.file)
        expect(updated).toContain(join(sub, 'package.json'))
        expect(updated).toContain(join(dir, 'package-lock.json'))
    })

    it('缺失文件跳过', async () => {
        const results = await applyVersionFiles(makeTarget('1.1.0'), ['jsr.json'])
        expect(results).toHaveLength(0)
    })
})

describe('syncWorkspaceDependencies', () => {
    it('同步 ^ / workspace: / 精确区间，private 包也参与', async () => {
        const manifestA = join(dir, 'a/package.json')
        const manifestB = join(dir, 'b/package.json')
        const manifestC = join(dir, 'c/package.json')
        for (const [name, manifest] of [
            ['a', { name: 'a', version: '1.0.0' }],
            ['b', { name: 'b', version: '1.0.0', dependencies: { a: '^1.0.0' }, devDependencies: { a: 'workspace:^1.0.0' } }],
            ['c', { name: 'c', version: '1.0.0', private: true, peerDependencies: { a: '1.0.0' }, dependencies: { b: '~1.0.0' } }],
        ] as const) {
            await mkdir(join(dir, name), { recursive: true })
            await writeFile(join(dir, name, 'package.json'), JSON.stringify(manifest, null, 2))
        }

        const packages = [
            makePackage('a', manifestA, '1.0.0'),
            makePackage('b', manifestB, '1.0.0'),
            makePackage('c', manifestC, '1.0.0', true),
        ]

        const changed = await syncWorkspaceDependencies(packages, new Map([['a', '1.1.0']]))

        expect(changed).toContain(manifestB)
        expect(changed).toContain(manifestC)

        const b = JSON.parse(await readFile(manifestB, 'utf-8'))
        expect(b.dependencies.a).toBe('^1.1.0')
        expect(b.devDependencies.a).toBe('workspace:^1.1.0')

        // c 是 private 也要同步；b 未在升级列表，其区间保持原样
        const c = JSON.parse(await readFile(manifestC, 'utf-8'))
        expect(c.peerDependencies.a).toBe('1.1.0')
        expect(c.dependencies.b).toBe('~1.0.0')
    })
})
