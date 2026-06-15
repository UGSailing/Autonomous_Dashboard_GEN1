type SpeedCardProps = {
    speedMetersPerSecond: number | null
}

const MAX_DISPLAY_SPEED_MPS = 5

export default function SpeedCard({ speedMetersPerSecond }: SpeedCardProps) {
    const speed = typeof speedMetersPerSecond === 'number' ? speedMetersPerSecond : 0
    const percent = Math.min(100, (speed / MAX_DISPLAY_SPEED_MPS) * 100)

    return (
        <div className="speed-dial" style={{ ['--speed-progress' as string]: `${percent}%` }}>
            <div className="speed-dial__ring" aria-hidden="true">
                <div className="speed-dial__ring-inner">
                    <strong className="speed-dial__value">{speedMetersPerSecond === null ? 'N/A' : speed.toFixed(2)}</strong>
                    <span className="speed-dial__unit">m/s</span>
                </div>
            </div>
        </div>
    )
}