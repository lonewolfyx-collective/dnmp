import type { CliOptions, ProjectContext, ReleaseTarget, ResolvedOptions } from '@/types.ts'
import process from 'node:process'
import { resolveOptions } from '@/config.ts'
import { applyVersionFiles, syncWorkspaceDependencies } from '@/files.ts'
import { checkoutBranch, commitRelease, computeTagNames, createTag, gitPreflight, parseRepoSlug, pushBranchAndTags, tagExists } from '@/git.ts'
import { createAndPushBranch, createPr, releaseBranchName } from '@/pr.ts'
import { detectProject } from '@/project.ts'
import { confirmAction, selectPackages, selectPerPackageVersions, selectReleaseVersion } from '@/prompts.ts'
import { npmLoggedIn, npmPublish, resolveDistTag } from '@/publish.ts'
import { runSafe } from '@/runner.ts'
import { banner, done, info, printSummary, step } from '@/ui.ts'
import { getNextVersions } from '@/version.ts'
import { version as cliVersion } from '../package.json'

const buildTargets = async (project: ProjectContext, options: ResolvedOptions): Promise<{ targets: ReleaseTarget[], updates: Map<string, string>, versionsUniform: boolean }> => {
    if (!project.isMonorepo) {
        const pkg = project.packages[0]!
        if (pkg.isPrivate) {
            throw new Error('当前 package.json 为 private: true，按规则跳过版本发布')
        }
        if (!pkg.version) {
            throw new Error(`package.json 缺少 version 字段: ${pkg.manifestPath}`)
        }

        const next = getNextVersions(pkg.version)
        const newVersion = options.release
            ? next[options.release]
            : await selectReleaseVersion(pkg.name, pkg.version, next)

        return {
            targets: [{ name: pkg.name, dir: pkg.dir, manifestPath: pkg.manifestPath, currentVersion: pkg.version, newVersion, published: false }],
            updates: new Map([[pkg.name, newVersion]]),
            versionsUniform: true,
        }
    }

    const publishable = project.packages.filter(p => !p.isPrivate)
    if (!publishable.length) {
        throw new Error('monorepo 中没有非 private 的可发布包')
    }

    const selected = options.ci ? publishable : await selectPackages(publishable)
    if (!selected.length) {
        throw new Error('未选择任何包')
    }
    for (const pkg of selected) {
        if (!pkg.version) {
            throw new Error(`package.json 缺少 version 字段: ${pkg.manifestPath}`)
        }
    }

    const versionsUniform = new Set(selected.map(p => p.version)).size === 1
    const updates = new Map<string, string>()

    if (options.release) {
        // 显式 --release：同一升级类型逐包套用，无需交互
        for (const pkg of selected) {
            updates.set(pkg.name, getNextVersions(pkg.version)[options.release])
        }
    }
    else if (versionsUniform) {
        // 改动前版本一致：只交互一次
        const representative = selected[0]!
        const newVersion = await selectReleaseVersion(`${representative.name}（应用到全部 ${selected.length} 个包）`, representative.version, getNextVersions(representative.version))
        for (const pkg of selected) {
            updates.set(pkg.name, newVersion)
        }
    }
    else {
        // 改动前版本不一致：逐包交互
        for (const [name, version] of await selectPerPackageVersions(selected)) {
            updates.set(name, version)
        }
    }

    const targets = selected.map((pkg) => {
        const newVersion = updates.get(pkg.name)!
        return { name: pkg.name, dir: pkg.dir, manifestPath: pkg.manifestPath, currentVersion: pkg.version, newVersion, published: false }
    })
    return { targets, updates, versionsUniform }
}

const runPreflight = async (project: ProjectContext, options: ResolvedOptions): Promise<Awaited<ReturnType<typeof gitPreflight>>> => {
    const git = await gitPreflight(project.root)

    if (git.dirtyFiles.length) {
        throw new Error(`工作区存在未提交变更，请先提交或暂存（git stash）:\n${git.dirtyFiles.join('\n')}`)
    }
    if (git.branch !== git.defaultBranch) {
        throw new Error(`当前分支 ${git.branch} 不是默认分支 ${git.defaultBranch}；版本 tag 只在默认分支上创建`)
    }
    if ((options.pr || options.git) && !options.dryRun && !git.remoteUrl) {
        throw new Error('未配置 git remote origin，无法执行推送 / PR 操作')
    }
    if (options.pr && !options.dryRun) {
        const gh = await runSafe('gh', ['auth', 'status'])
        if (!gh.ok) {
            throw new Error('gh CLI 未安装或未认证（gh auth status 失败），无法创建 PR')
        }
    }
    if (options.submit && !options.dryRun && !await npmLoggedIn(project.root)) {
        throw new Error('npm 未登录（npm whoami 失败），请先 npm login 或配置 NODE_AUTH_TOKEN')
    }
    return git
}

const prBody = (targets: ReleaseTarget[]): string =>
    targets.length === 1
        ? `${targets[0]!.currentVersion} -> ${targets[0]!.newVersion}`
        : targets.map(t => `${t.name}: ${t.currentVersion} -> ${t.newVersion}`).join('\n')

export const runRelease = async (cliOptions: CliOptions): Promise<void> => {
    const options = await resolveOptions(cliOptions)
    const project = await detectProject(process.cwd())

    banner(cliVersion)
    info(`项目形态: ${project.isMonorepo ? `monorepo（${project.workspaceKind} workspaces，${project.packages.length} 个子包）` : '单包'}`)
    if (options.dryRun) {
        info('DRY RUN 模式：不会写入文件、不会执行 git / npm 操作')
    }
    if (options.ci) {
        info('CI 模式：交互已禁用，必需参数缺失将直接报错')
    }
    if (options.ci && !options.release) {
        throw new Error('CI 模式下无法交互，必须显式提供 --release')
    }

    const git = await runPreflight(project, options)
    const { targets, updates, versionsUniform } = await buildTargets(project, options)

    for (const target of targets) {
        if (target.newVersion === target.currentVersion) {
            throw new Error(`${target.name} 的新版本与当前版本一致（${target.currentVersion}），无需发布`)
        }
    }

    const tagNames = computeTagNames(targets, project.isMonorepo)
    if (options.tag) {
        for (const tag of tagNames) {
            if (await tagExists(project.root, tag)) {
                throw new Error(`tag 已存在: ${tag}`)
            }
        }
    }

    const previewLines = [
        ...targets.map(t => `${t.name}: ${t.currentVersion} → ${t.newVersion}`),
        `tags: ${options.tag ? tagNames.join(' ') : '跳过（--no-tag）'}`,
        `publish: ${options.submit ? '执行' : '跳过（--no-submit）'}`,
    ]

    if (options.dryRun) {
        printSummary(targets, options.tag ? tagNames : [], [
            `publish: ${options.submit ? '将执行（dry-run 跳过）' : '跳过（--no-submit）'}`,
        ])
        return
    }

    const confirmed = await confirmAction(`确认以下版本变更并继续？\n${previewLines.join('\n')}`, options.ci)
    if (!confirmed) {
        done('已取消，未做任何变更')
        return
    }

    // ---- 写入版本文件 ----
    const uniformAfter = new Set(targets.map(t => t.newVersion)).size === 1
    const changedFiles: string[] = []
    for (const target of targets) {
        const results = await applyVersionFiles(
            target,
            options.files,
            targets.length === 1 || uniformAfter ? project.root : undefined,
        )
        changedFiles.push(...results.filter(r => r.updated).map(r => r.file))
    }

    // workspace 依赖区间同步：仅「改动前版本一致」场景（REQUIREMENTS §3）
    if (project.isMonorepo && versionsUniform) {
        changedFiles.push(...await syncWorkspaceDependencies(project.packages, updates))
    }

    if (!changedFiles.length) {
        throw new Error('没有文件需要更新，请检查 --files 配置')
    }

    // ---- git commit / tag ----
    const commitMessage = tagNames.length === 1 ? `chore(release): ${tagNames[0]}` : 'chore(release): monorepo'
    step(`提交版本变更: ${commitMessage}`)
    await commitRelease(project.root, [...new Set(changedFiles)], commitMessage)

    if (options.tag) {
        for (const tag of tagNames) {
            step(`创建 tag: ${tag}`)
            await createTag(project.root, tag)
        }
    }

    // ---- 分支处置：PR 或直接推送 ----
    const extras: string[] = []
    if (options.pr) {
        const repo = parseRepoSlug(git.remoteUrl)
        const branch = releaseBranchName(project.isMonorepo, targets[0]!.newVersion)
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                step(`推送 release 分支: ${branch}`)
                await createAndPushBranch(project.root, branch)
                break
            }
            catch {
                if (attempt === 2 || !project.isMonorepo) {
                    throw new Error(`release 分支 ${branch} 创建或推送失败`)
                }
            }
        }

        const title = `chore(release): ${tagNames.length === 1 ? tagNames[0] : 'monorepo'}`
        step(`创建 PR: ${title}`)
        const prUrl = await createPr({
            cwd: project.root,
            repo,
            base: git.defaultBranch,
            branch,
            title,
            body: prBody(targets),
        })
        extras.push(`PR: ${prUrl}`)
        extras.push('PR 模式：tag 已在本地创建但未推送，待 PR 合并后处理')

        await checkoutBranch(project.root, git.branch)
    }
    else if (options.git) {
        step(`推送 ${git.branch} 与 tags 到远程`)
        await pushBranchAndTags(project.root, git.branch, options.tag ? tagNames : [])
    }

    // ---- npm publish（逐个、fail-fast） ----
    if (options.submit) {
        for (const target of targets) {
            const distTag = resolveDistTag(target.newVersion, options.npmTag, options.npmTagExplicit)
            step(`${target.name}: npm publish --tag ${distTag}${options.opt ? ` ${options.opt}` : ''}`)
            await npmPublish(target.dir, distTag, options.opt)
            target.published = true
        }
    }
    else {
        extras.push('npm publish 已跳过（--no-submit）')
    }

    printSummary(targets, options.tag ? tagNames : [], extras)
    done()
}
