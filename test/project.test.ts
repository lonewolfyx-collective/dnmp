import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectProject } from '@/project.ts'

const writeJson = async (path: string, data: unknown): Promise<void> => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(data, null, 2))
}

describe('detectProject', () => {
    it('单包项目', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dnmp-single-'))
        await writeJson(join(root, 'package.json'), { name: 'solo', version: '1.0.0' })

        const project = await detectProject(root)

        expect(project.isMonorepo).toBe(false)
        expect(project.workspaceKind).toBeNull()
        expect(project.packages).toHaveLength(1)
        expect(project.packages[0]!.name).toBe('solo')
        expect(project.packages[0]!.isPrivate).toBe(false)
    })

    it('pnpm-workspace.yaml 识别，node_modules 被忽略，private 标记正确', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dnmp-pnpm-'))
        await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
        await writeJson(join(root, 'package.json'), { name: 'root', private: true })
        await writeJson(join(root, 'packages/a/package.json'), { name: 'a', version: '1.0.0' })
        await writeJson(join(root, 'packages/b/package.json'), { name: 'b', version: '2.0.0', private: true })
        await writeJson(join(root, 'packages/a/node_modules/x/package.json'), { name: 'x', version: '0.0.1' })

        const project = await detectProject(root)

        expect(project.isMonorepo).toBe(true)
        expect(project.workspaceKind).toBe('pnpm')
        expect(project.packages.map(p => p.name).sort()).toEqual(['a', 'b'])
        expect(project.packages.find(p => p.name === 'b')!.isPrivate).toBe(true)
    })

    it('npm workspaces 数组形式', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dnmp-npm-'))
        await writeJson(join(root, 'package.json'), { name: 'root', private: true, workspaces: ['libs/*'] })
        await writeJson(join(root, 'libs/a/package.json'), { name: 'a', version: '1.0.0' })

        const project = await detectProject(root)

        expect(project.isMonorepo).toBe(true)
        expect(project.workspaceKind).toBe('npm')
        expect(project.packages.map(p => p.name)).toEqual(['a'])
    })

    it('npm workspaces 对象形式', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dnmp-npm2-'))
        await writeJson(join(root, 'package.json'), { name: 'root', workspaces: { packages: ['apps/*'] } })
        await writeJson(join(root, 'apps/a/package.json'), { name: 'a', version: '1.0.0' })

        const project = await detectProject(root)

        expect(project.isMonorepo).toBe(true)
        expect(project.packages.map(p => p.name)).toEqual(['a'])
    })

    it('空声明的 pnpm-workspace.yaml（无 packages）按单包处理', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dnmp-empty-'))
        await writeFile(join(root, 'pnpm-workspace.yaml'), 'shellEmulator: true\n')
        await writeJson(join(root, 'package.json'), { name: 'dnmp', version: '0.0.0' })

        const project = await detectProject(root)

        expect(project.isMonorepo).toBe(false)
        expect(project.packages[0]!.name).toBe('dnmp')
    })

    it('从子目录运行时向上找到 workspace 根', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dnmp-up-'))
        await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
        await writeJson(join(root, 'packages/a/package.json'), { name: 'a', version: '1.0.0' })

        const project = await detectProject(join(root, 'packages/a'))

        expect(project.isMonorepo).toBe(true)
        expect(project.root).toBe(root)
    })
})
