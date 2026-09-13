import process from 'node:process'
import { cac } from 'cac'
import { runRelease } from '@/main.ts'
import { printError } from '@/ui.ts'
import { name, version } from '../package.json'

// cac 的 parse() 不会 await async action，promise 需在 action 内捕获、parse 后自行等待，
// 否则主流程的异步异常会变成 unhandled rejection（旧实现的 P0 缺陷）
const runCli = async (): Promise<void> => {
    const cli = cac(name)
    let release: Promise<void> | undefined

    cli.command('', '交互式升级版本号并发布')
        .option('--release <type>', '版本升级类型（major/minor/patch/next/rc/beta-*/pre-beta/alpha-*/date-version）')
        .option('--tag', '是否创建 git tag，仅默认分支（默认 true，--no-tag 关闭）', { default: true })
        .option('--submit', '是否执行 npm publish（默认 true，--no-submit 关闭）', { default: true })
        .option('--git', '是否推送 commit 与 tag 到远程（默认 true，--no-git 关闭；--pr 时无效）', { default: true })
        .option('--pr', '是否以 PR 形式提交版本升级（默认 false；开启后 tag 不推送）', { default: false })
        .option('--files <files...>', '需要同步版本号的文件列表（空格或逗号分隔，默认 package.json/package-lock.json/jsr.json/jsr.jsonc/deno.json/deno.jsonc）')
        .option('--npmTag <tag>', 'npm publish 的 dist-tag（默认 latest，与 --tag 的 git tag 无关）')
        .option('--opt <opt>', 'npm publish 附加参数（dnmp 配置 env.opt 存在时优先）')
        .option('--dry-run', '预览模式：只展示计划动作，不写文件、不执行 git / npm')
        .action(async (options) => {
            release = runRelease(options)
        })

    cli.help()
    cli.version(version)

    const fail = (error: unknown): never => {
        printError(error instanceof Error ? error.message : String(error))
        process.exit(1)
    }

    try {
        cli.parse()
    }
    catch (error) {
        fail(error)
    }

    if (release) {
        try {
            await release
        }
        catch (error) {
            fail(error)
        }
    }
}

runCli()
