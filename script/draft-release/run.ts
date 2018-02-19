import { sort as semverSort, SemVer } from 'semver'

import { spawn } from '../changelog/spawn'
import { getLogLines } from '../changelog/git'
import {
  convertToChangelogFormat,
  getChangelogEntriesSince,
} from '../changelog/parser'

import { Channel } from './channel'
import { getNextVersionNumber } from './version'

const jsonStringify: (obj: any) => string = require('json-pretty')

async function getLatestRelease(options: {
  excludeBetaReleases: boolean
}): Promise<string> {
  const allTags = await spawn('git', ['tag'])
  let releaseTags = allTags
    .split('\n')
    .filter(tag => tag.startsWith('release-'))
    .filter(tag => tag.indexOf('-linux') === -1)
    .filter(tag => tag.indexOf('-test') === -1)

  if (options.excludeBetaReleases) {
    releaseTags = releaseTags.filter(tag => tag.indexOf('-beta') === -1)
  }

  const releaseVersions = releaseTags.map(tag => tag.substr(8))

  const sortedTags = semverSort(releaseVersions)
  const latestTag = sortedTags[sortedTags.length - 1]

  return latestTag instanceof SemVer ? latestTag.raw : latestTag
}

function parseChannel(arg: string): Channel {
  if (arg === 'production' || arg === 'beta' || arg === 'test') {
    return arg
  }

  throw new Error(`An invalid channel ${arg} has been provided`)
}

function printInstructions(nextVersion: string, entries: Array<string>) {
  const object: any = {}
  object[`${nextVersion}`] = entries.sort()

  const steps = [
    `Ensure the app/package.json 'version' is set to '${nextVersion}'`,
    `Add this to changelog.json as a starting point:\n${jsonStringify(
      object
    )}\n`,
    'Update the release notes so they make sense and only contain user-facing changes',
    'Commit the changes and push them to GitHub',
    'Read this to perform the release: https://github.com/desktop/desktop/blob/master/docs/process/releasing-updates.md',
  ]

  console.log(steps.map((value, index) => `${index + 1}. ${value}`).join('\n'))
}

export async function run(args: ReadonlyArray<string>): Promise<void> {
  try {
    await spawn('git', ['diff-index', '--quiet', 'HEAD'])
  } catch {
    throw new Error(
      `There are uncommitted changes in the working directory. Aborting...`
    )
  }

  if (args.length === 0) {
    throw new Error(
      `You have not specified a channel to draft this release for. Choose one of 'production' or 'beta'`
    )
  }

  const channel = parseChannel(args[0])
  const excludeBetaReleases = channel === 'production'
  const previousVersion = await getLatestRelease({ excludeBetaReleases })
  const nextVersion = getNextVersionNumber(previousVersion, channel)

  const lines = await getLogLines(`release-${previousVersion}`)
  const noChangesFound = lines.every(l => l.trim().length === 0)

  if (noChangesFound) {
    printInstructions(nextVersion, [])
  } else {
    const changelogEntries = await convertToChangelogFormat(lines)

    console.log("Here's what you should do next:\n")

    if (channel === 'production') {
      const existingChangelog = getChangelogEntriesSince(previousVersion)
      const entries = new Array<string>(
        ...changelogEntries,
        ...existingChangelog
      )
      printInstructions(nextVersion, entries)
    } else if (channel === 'beta') {
      const entries = new Array<string>(...changelogEntries)
      printInstructions(nextVersion, entries)
    }
  }
}
