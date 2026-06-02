import clsx from 'clsx'

  interface Props {
    score: number
        width?: number
      }

      export function ScoreBar({ score, width = 64 }: Props) {
  const pct = Math.min(Math.max(score, 0), 100)
  const isHigh = pct >= 70

      return (
        <div className="score-bar" style={{ width }}>
      <div
            className={clsx('score-bar-fill', isHigh && 'high')}
        style={{ width: `${pct}%` }}
      />
            </div>
          )
        }
