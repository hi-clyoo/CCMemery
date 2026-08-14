/**
 * GitStatusIcon - Compact icon showing a file's real git working-tree status.
 * Renders nothing for 'none' (file not inside a git repository) so files
 * outside any repo don't add noise to the file tree.
 */

import { CheckCircle2, CircleDot, CircleHelp, PencilLine } from 'lucide-react'

import type { GitFileStatus } from '@shared/types'
import type { ReactNode } from 'react'

type Lang = 'en' | 'zh'

const LABELS: Record<Exclude<GitFileStatus, 'none'>, { en: string; zh: string }> = {
  committed: { en: 'Committed', zh: '已提交' },
  modified: { en: 'Modified', zh: '已修改' },
  staged: { en: 'Staged', zh: '已暂存' },
  untracked: { en: 'Untracked', zh: '未跟踪' },
}

const ICON_NODES: Record<Exclude<GitFileStatus, 'none'>, ReactNode> = {
  committed: <CheckCircle2 className="size-3 text-green-500" />,
  modified: <PencilLine className="size-3 text-yellow-500" />,
  staged: <CircleDot className="size-3 text-sky-500" />,
  untracked: <CircleHelp className="size-3 text-text-muted" />,
}

export const GitStatusIcon = ({ status, lang = 'en' }: { status?: GitFileStatus; lang?: Lang }) => {
  if (!status || status === 'none') return null
  const label = LABELS[status]
  const title = lang === 'zh' ? label.zh : label.en
  return (
    <span title={title} className="inline-flex shrink-0 items-center">
      {ICON_NODES[status]}
    </span>
  )
}
