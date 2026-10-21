/** Official monthly archive, using China's calendar regardless of visitor timezone. */
export function officialCnPatchUrl(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit',
  }).formatToParts(date)
  const year = parts.find(part => part.type === 'year')!.value
  const month = parts.find(part => part.type === 'month')!.value
  return `https://ow.blizzard.cn/news/patch-notes/live/${year}/${month}/`
}
