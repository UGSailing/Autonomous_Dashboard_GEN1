type RpmSample = {
    time: number
    rpm: number
}

type RPMHistoryChartProps = {
    samples: RpmSample[]
}

const CHART_WIDTH = 720
const CHART_HEIGHT = 220
const CHART_PADDING = 20

export default function RPMHistoryChart({ samples }: RPMHistoryChartProps) {
    if (samples.length === 0) {
        return <div className="rpm-chart__empty">Waiting for RPM samples...</div>
    }

    const values = samples.map((sample) => sample.rpm)
    const minValue = Math.min(...values)
    const maxValue = Math.max(...values)
    const valueRange = Math.max(1, maxValue - minValue)
    const width = CHART_WIDTH - CHART_PADDING * 2
    const height = CHART_HEIGHT - CHART_PADDING * 2

    const points = samples
        .map((sample, index) => {
            const x = CHART_PADDING + (index / Math.max(1, samples.length - 1)) * width
            const normalized = (sample.rpm - minValue) / valueRange
            const y = CHART_PADDING + height - normalized * height

            return `${x.toFixed(2)},${y.toFixed(2)}`
        })
        .join(' ')

    const areaPath = createAreaPath(samples, minValue, valueRange)
    const latestSample = samples[samples.length - 1]

    return (
        <div className="rpm-chart">
            <svg className="rpm-chart__svg" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label="RPM history chart">
                <defs>
                    <linearGradient id="rpm-chart-line" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.95" />
                        <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.1" />
                    </linearGradient>
                    <linearGradient id="rpm-chart-fill" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="rgba(15, 118, 110, 0.36)" />
                        <stop offset="100%" stopColor="rgba(15, 118, 110, 0.03)" />
                    </linearGradient>
                </defs>

                <line x1={CHART_PADDING} y1={CHART_HEIGHT - CHART_PADDING} x2={CHART_WIDTH - CHART_PADDING} y2={CHART_HEIGHT - CHART_PADDING} className="rpm-chart__axis" />
                <line x1={CHART_PADDING} y1={CHART_PADDING} x2={CHART_PADDING} y2={CHART_HEIGHT - CHART_PADDING} className="rpm-chart__axis" />

                <path d={areaPath} className="rpm-chart__area" />
                <polyline points={points} className="rpm-chart__line" />

                {samples.map((sample, index) => {
                    const x = CHART_PADDING + (index / Math.max(1, samples.length - 1)) * width
                    const normalized = (sample.rpm - minValue) / valueRange
                    const y = CHART_PADDING + height - normalized * height

                    return <circle key={`${sample.time}-${index}`} cx={x} cy={y} r="3.25" className="rpm-chart__point" />
                })}
            </svg>

            <div className="rpm-chart__footer">
                <div>
                    <span className="rpm-chart__label">Latest</span>
                    <strong>{latestSample.rpm.toFixed(0)} rpm</strong>
                </div>
                <div>
                    <span className="rpm-chart__label">Min</span>
                    <strong>{minValue.toFixed(0)} rpm</strong>
                </div>
                <div>
                    <span className="rpm-chart__label">Max</span>
                    <strong>{maxValue.toFixed(0)} rpm</strong>
                </div>
            </div>
        </div>
    )
}

function createAreaPath(samples: RpmSample[], minValue: number, valueRange: number) {
    const width = CHART_WIDTH - CHART_PADDING * 2
    const height = CHART_HEIGHT - CHART_PADDING * 2

    const linePoints = samples.map((sample, index) => {
        const x = CHART_PADDING + (index / Math.max(1, samples.length - 1)) * width
        const normalized = (sample.rpm - minValue) / valueRange
        const y = CHART_PADDING + height - normalized * height

        return { x, y }
    })

    const firstPoint = linePoints[0]
    const lastPoint = linePoints[linePoints.length - 1]

    return [
        `M ${firstPoint.x.toFixed(2)} ${CHART_HEIGHT - CHART_PADDING}`,
        `L ${firstPoint.x.toFixed(2)} ${firstPoint.y.toFixed(2)}`,
        ...linePoints.slice(1).map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`),
        `L ${lastPoint.x.toFixed(2)} ${CHART_HEIGHT - CHART_PADDING}`,
        'Z',
    ].join(' ')
}