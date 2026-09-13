export const DEFAULT_UPDATE_FILES = [
    'package.json',
    'package-lock.json',
    'jsr.json',
    'jsr.jsonc',
    'deno.json',
    'deno.jsonc',
]

export const CUSTOM_RELEASE = 'custom'

export const DEFAULT_NPM_TAG = 'latest'

export const DEP_FIELDS = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
] as const

export const CANCEL_MESSAGE = '当前操作已取消。'
