import type { ReleaseTarget } from '@/types.ts'
import { intro, log, outro } from '@clack/prompts'
import boxen from 'boxen'
import pc from 'picocolors'

export const banner = (cliVersion: string): void => intro(pc.bgCyan(` dnmp ${cliVersion} `))

export const done = (message = 'Done.'): void => outro(message)

export const info = (message: string): void => log.info(message)

export const step = (message: string): void => log.step(message)

export const printWarning = (message: string): void => console.log(boxen(message, {
    title: 'Warning',
    padding: 1,
    borderStyle: 'round',
    borderColor: 'yellow',
}))

export const printError = (message: string): void => console.error(boxen(message, {
    title: 'Error',
    padding: 1,
    borderStyle: 'round',
    borderColor: 'red',
}))

export const printSummary = (targets: ReleaseTarget[], tags: string[], extras: string[] = []): void => {
    const lines = targets.map(t =>
        `${pc.cyan(t.name)}  ${pc.dim(t.currentVersion)} → ${pc.bold(t.newVersion)}  ${t.published ? pc.green('✓ published') : pc.dim('- not published')}`,
    )
    if (tags.length) {
        lines.push(`${pc.magenta('tags')}  ${tags.join(' ')}`)
    }
    console.log(boxen(lines.join('\n'), {
        title: 'Release Summary',
        padding: 1,
        borderStyle: 'round',
        borderColor: 'cyan',
    }))
    for (const extra of extras) {
        log.info(extra)
    }
}
