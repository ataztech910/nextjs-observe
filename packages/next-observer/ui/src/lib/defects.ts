/** The fields of a defect the question is built from (a subset of the API's Defect). */
export interface DefectFacts {
  operation: string
  message: string
  isNew: boolean
  firstSeenVersion: string | null
  versions: string[]
  affected: { operation: string }[]
}

/** What to ask the agents about a defect — with the facts the page already knows, so they start from them. */
export function questionFor(d: DefectFacts): string {
  const where = d.affected.length ? ` (requests to ${d.affected[0].operation} fail because of it)` : ''
  const history = d.isNew && d.firstSeenVersion ? ` It first appeared in ${d.firstSeenVersion}.` : d.versions.length > 1 ? ` It is seen in ${d.versions.join(' and ')}.` : ''
  return `${d.operation} fails with "${d.message}"${where}.${history} Why does it fail, and is it new?`
}
