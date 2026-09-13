import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runRelease } from '@/main.ts'

const mocks = vi.hoisted(() => ({
    calls: [] as string[],
    npmPublish: vi.fn<() => Promise<void>>(),
}))

vi.mock('@/config.ts', () => ({
    resolveOptions: vi.fn(async () => ({
        release: 'patch',
        tag: true,
        submit: true,
        git: true,
        pr: false,
        files: ['package.json'],
        npmTag: 'latest',
        npmTagExplicit: false,
        opt: '',
        dryRun: false,
        ci: false,
    })),
}))

vi.mock('@/project.ts', () => ({
    detectProject: vi.fn(async () => ({
        root: '/repo',
        isMonorepo: false,
        workspaceKind: null,
        packages: [{
            name: 'pkg',
            dir: '/repo',
            manifestPath: '/repo/package.json',
            version: '1.0.0',
            isPrivate: false,
            manifest: { name: 'pkg', version: '1.0.0' },
        }],
    })),
}))

vi.mock('@/version.ts', () => ({
    getNextVersions: vi.fn(() => {
        mocks.calls.push('select-version')
        return { patch: '1.0.1' }
    }),
}))

vi.mock('@/prompts.ts', () => ({
    confirmAction: vi.fn(async () => true),
    selectPackages: vi.fn(),
    selectPerPackageVersions: vi.fn(),
    selectReleaseVersion: vi.fn(),
}))

vi.mock('@/files.ts', () => ({
    applyVersionFiles: vi.fn(async () => {
        mocks.calls.push('write-version')
        return [{ file: '/repo/package.json', updated: true }]
    }),
    syncWorkspaceDependencies: vi.fn(),
}))

vi.mock('@/publish.ts', () => ({
    npmLoggedIn: vi.fn(async () => true),
    npmPublish: mocks.npmPublish,
    resolveDistTag: vi.fn(() => 'latest'),
}))

vi.mock('@/git.ts', () => ({
    gitPreflight: vi.fn(async () => {
        mocks.calls.push('preflight')
        return { branch: 'main', defaultBranch: 'main', dirtyFiles: [], remoteUrl: 'git@github.com:a/b.git' }
    }),
    tagExists: vi.fn(async () => false),
    computeTagNames: vi.fn(() => ['v1.0.1']),
    computeReleaseCommitMessage: vi.fn(() => 'release: v1.0.1'),
    commitRelease: vi.fn(async () => {
        mocks.calls.push('commit')
    }),
    createTag: vi.fn(async () => {
        mocks.calls.push('tag')
    }),
    pushBranchAndTags: vi.fn(async () => {
        mocks.calls.push('push')
    }),
    checkoutBranch: vi.fn(),
    parseRepoSlug: vi.fn(),
}))

vi.mock('@/pr.ts', () => ({
    createAndPushBranch: vi.fn(),
    createPr: vi.fn(),
    releaseBranchName: vi.fn(),
}))

vi.mock('@/runner.ts', () => ({ runSafe: vi.fn() }))
vi.mock('@/ui.ts', () => ({
    banner: vi.fn(),
    done: vi.fn(),
    info: vi.fn(),
    printSummary: vi.fn(),
    step: vi.fn(),
}))

describe('runRelease 发布顺序', () => {
    beforeEach(() => {
        mocks.calls.length = 0
        mocks.npmPublish.mockReset()
        mocks.npmPublish.mockImplementation(async () => {
            mocks.calls.push('publish')
        })
    })

    it('先选择并发布，再创建版本 commit、tag 和推送', async () => {
        await runRelease({ release: 'patch' })

        expect(mocks.calls).toEqual([
            'preflight',
            'select-version',
            'write-version',
            'publish',
            'commit',
            'tag',
            'push',
        ])
    })

    it('npm 发布失败时不创建 commit、tag 或推送', async () => {
        mocks.npmPublish.mockImplementation(async () => {
            mocks.calls.push('publish')
            throw new Error('publish failed')
        })

        await expect(runRelease({ release: 'patch' })).rejects.toThrow('publish failed')
        expect(mocks.calls).toEqual([
            'preflight',
            'select-version',
            'write-version',
            'publish',
        ])
    })
})
