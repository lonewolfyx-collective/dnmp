export type ReleaseType
    = | 'major'
        | 'minor'
        | 'patch'
        | 'next'
        | 'rc'
        | 'beta-major'
        | 'beta-minor'
        | 'beta-patch'
        | 'pre-beta'
        | 'alpha-beta'
        | 'alpha-major'
        | 'alpha-minor'
        | 'alpha-patch'
        | 'date-version'

export const RELEASE_TYPES: readonly ReleaseType[] = [
    'major',
    'minor',
    'patch',
    'next',
    'rc',
    'beta-major',
    'beta-minor',
    'beta-patch',
    'pre-beta',
    'alpha-beta',
    'alpha-major',
    'alpha-minor',
    'alpha-patch',
    'date-version',
]

export const isReleaseType = (value: string): value is ReleaseType =>
    (RELEASE_TYPES as readonly string[]).includes(value)
