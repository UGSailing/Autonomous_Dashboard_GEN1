type RPMCardProps = {
    rpm: number | null
}

const MAX_DISPLAY_RPM_MPS = 4500

export default function RPMCard({ rpm }: RPMCardProps) {
    const speed = typeof rpm === 'number' ? -rpm : 0
    const percent = Math.min(100, (speed / MAX_DISPLAY_RPM_MPS) * 100)

    return (
        <div className="speed-dial" style={{ ['--speed-progress' as string]: `${percent}%` }}>
            <div className="speed-dial__ring" aria-hidden="true">
                <div className="speed-dial__ring-inner">
                    <strong className="speed-dial__value">{rpm === null ? 'N/A' : speed.toFixed(2)}</strong>
                    <span className="speed-dial__unit">rpm</span>
                </div>
            </div>
        </div>
    )
}