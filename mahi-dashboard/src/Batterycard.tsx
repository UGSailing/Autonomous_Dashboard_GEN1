import './Batterycard.css'

type BatteryData = {
    voltage: number | null
    amperage: number | null
    stateOfCharge: number | null
    temperature: number | null
    online: boolean | null
    error: boolean | null
}

type Props = {
    data: BatteryData
}

export type { BatteryData }

export default function BatteryCard({ data }: Props) {
    const { voltage, amperage, stateOfCharge, temperature, online, error } = data

    const soc = stateOfCharge ?? 0
    const socClamped = Math.max(0, Math.min(100, soc))

    const socColor =
        socClamped >= 60
            ? 'var(--bat-green)'
            : socClamped >= 25
                ? 'var(--bat-amber)'
                : 'var(--bat-red)'

    return (
        <div className={`battery-card ${error ? 'battery-card--error' : ''}`}>
            {/* Status row */}
            <div className="battery-status-row">
                <span className={`battery-pill ${online ? 'battery-pill--online' : 'battery-pill--offline'}`}>
                    {online ? 'Online' : 'Offline'}
                </span>
                {error && <span className="battery-pill battery-pill--error">⚠ Error</span>}
            </div>

            {/* Visual battery */}
            <div className="battery-visual" aria-label={`Battery ${socClamped}%`}>
                <div className="battery-body">
                    <div
                        className="battery-fill"
                        style={{ width: `${socClamped}%`, background: socColor }}
                    />
                    <span className="battery-pct">{stateOfCharge !== null ? `${socClamped}%` : '—'}</span>
                </div>
                <div className="battery-nub" />
            </div>

            {/* Metrics grid */}
            <dl className="battery-metrics">
                <div className="battery-metric">
                    <dt>Voltage</dt>
                    <dd>{voltage !== null ? `${voltage.toFixed(1)} V` : '—'}</dd>
                </div>
                <div className="battery-metric">
                    <dt>Current</dt>
                    <dd className={amperage !== null && amperage < 0 ? 'bat-charging' : ''}>
                        {amperage !== null ? `${amperage.toFixed(1)} A` : '—'}
                    </dd>
                </div>
                <div className="battery-metric">
                    <dt>Temp</dt>
                    <dd>{temperature !== null ? `${temperature.toFixed(0)} °C` : '—'}</dd>
                </div>
            </dl>
        </div>
    )
}