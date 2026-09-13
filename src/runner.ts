import { x } from 'tinyexec'

export interface RunResult {
    stdout: string
    stderr: string
}

export interface RunOptions {
    cwd?: string
}

/** 执行子进程，非零退出码抛错（错误信息附带 stderr） */
export const run = async (command: string, args: string[], options: RunOptions = {}): Promise<RunResult> => {
    try {
        const proc = await x(command, args, {
            throwOnError: true,
            nodeOptions: {
                cwd: options.cwd,
                stdio: 'pipe',
            },
        })
        return { stdout: proc.stdout.trim(), stderr: proc.stderr.trim() }
    }
    catch (error) {
        const err = error as { message?: string, stderr?: string }
        throw new Error([err.message?.trim(), err.stderr?.trim()].filter(Boolean).join('\n') || `命令执行失败: ${command}`)
    }
}

/** 执行子进程并把输出直通当前终端（npm publish / gh 等需要进度可见的命令） */
export const runInherit = async (command: string, args: string[], options: RunOptions = {}): Promise<void> => {
    await x(command, args, {
        throwOnError: true,
        nodeOptions: {
            cwd: options.cwd,
            stdio: 'inherit',
        },
    })
}

/** 探测性执行：命令缺失或非零退出都返回 ok: false，用于前置校验 */
export const runSafe = async (command: string, args: string[], options: RunOptions = {}): Promise<RunResult & { ok: boolean }> => {
    try {
        const proc = await x(command, args, {
            throwOnError: false,
            nodeOptions: {
                cwd: options.cwd,
                stdio: 'pipe',
            },
        })
        return { ok: proc.exitCode === 0, stdout: proc.stdout.trim(), stderr: proc.stderr.trim() }
    }
    catch {
        return { ok: false, stdout: '', stderr: '' }
    }
}
