import type { ReleaseTarget } from '@/types.ts'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyVersionFiles, syncWorkspaceDependencies } from '@/files.ts'
import { commitRelease, computeTagNames, createTag, gitPreflight, tagExists } from '@/git.ts'
import { detectProject } from '@/project.ts'

// 集成测试：真实 git 仓库走「识别 → 写文件 → 依赖同步 → commit → tag」链路；不 push、不 publish
const git = (args: string[], cwd: string): string =>
    execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()

const setupMonorepo = async (): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), 'dnmp-e2e-'))

    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'mono-root', private: true }, null, 2))
    await mkdir(join(root, 'packages/a'), { recursive: true })
    await mkdir(join(root, 'packages/b'), { recursive: true })
    await writeFile(join(root, 'packages/a/package.json'), JSON.stringify({ name: 'a', version: '1.0.0' }, null, 2))
    await writeFile(
        join(root, 'packages/b/package.json'),
        JSON.stringify({ name: 'b', version: '1.0.0', dependencies: { a: '^1.0.0' } }, null, 2),
    )

    git(['init', '-b', 'main'], root)
    git(['config', 'user.email', 'test@test.dev'], root)
    git(['config', 'user.name', 'test'], root)
    git(['add', '-A'], root)
    git(['commit', '-m', 'chore: init'], root)
    return root
}

const toTarget = (project: Awaited<ReturnType<typeof detectProject>>, newVersion: string): ReleaseTarget[] =>
    project.packages.map(p => ({
        name: p.name,
        dir: p.dir,
        manifestPath: p.manifestPath,
        currentVersion: p.version,
        newVersion,
        published: false,
    }))

describe('monorepo 统一升级链路', () => {
    it('pnpm workspace 识别 → 统一 bump → 依赖区间同步 → commit → 单个 tag', async () => {
        const root = await setupMonorepo()
        const project = await detectProject(root)

        expect(project.isMonorepo).toBe(true)
        expect(project.workspaceKind).toBe('pnpm')
        expect(project.packages.map(p => p.name).sort()).toEqual(['a', 'b'])

        const targets = toTarget(project, '1.1.0')
        const changed: string[] = []
        for (const target of targets) {
            const results = await applyVersionFiles(target, ['package.json', 'package-lock.json'], project.root)
            changed.push(...results.filter(r => r.updated).map(r => r.file))
        }
        changed.push(...await syncWorkspaceDependencies(project.packages, new Map([['a', '1.1.0'], ['b', '1.1.0']])))

        const manifestB = JSON.parse(await readFile(join(root, 'packages/b/package.json'), 'utf-8'))
        expect(manifestB.version).toBe('1.1.0')
        expect(manifestB.dependencies.a).toBe('^1.1.0')

        expect(await gitPreflight(root)).toMatchObject({ branch: 'main', defaultBranch: 'main' })

        await commitRelease(root, [...new Set(changed)], 'chore(release): v1.1.0')

        const tagNames = computeTagNames(targets, true)
        expect(tagNames).toEqual(['v1.1.0'])
        await createTag(root, tagNames[0]!)

        expect(await tagExists(root, 'v1.1.0')).toBe(true)
        expect((await gitPreflight(root)).dirtyFiles).toHaveLength(0)
        expect(git(['log', '-1', '--pretty=%s'], root)).toBe('chore(release): v1.1.0')
    })

    it('重复 tag 前置校验可被 tagExists 拦截', async () => {
        const root = await setupMonorepo()
        await createTag(root, 'v1.1.0')

        expect(await tagExists(root, 'v1.1.0')).toBe(true)
        expect(await tagExists(root, 'v9.9.9')).toBe(false)
    })

    it('单包项目：bump + commit + vX.Y.Z tag', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dnmp-single-e2e-'))
        await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'solo', version: '1.0.0' }, null, 2))
        execFileSync('git', ['init', '-b', 'main'], { cwd: root })
        git(['config', 'user.email', 'test@test.dev'], root)
        git(['config', 'user.name', 'test'], root)
        git(['add', '-A'], root)
        git(['commit', '-m', 'chore: init'], root)

        const project = await detectProject(root)
        expect(project.isMonorepo).toBe(false)

        const [target] = toTarget(project, '1.1.0')
        const results = await applyVersionFiles(target!, ['package.json'])
        await commitRelease(root, results.filter(r => r.updated).map(r => r.file), 'chore(release): v1.1.0')
        await createTag(root, computeTagNames([target!], false)[0]!)

        expect(JSON.parse(await readFile(join(root, 'package.json'), 'utf-8')).version).toBe('1.1.0')
        expect(await tagExists(root, 'v1.1.0')).toBe(true)
    })
})
